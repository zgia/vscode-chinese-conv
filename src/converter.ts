import { Converter, Locale, type DictGroup, type DictLike } from 'opencc-js';
import { getMode, type ModeId } from './modes';

export interface StreamingConverter {
  write(text: string): string;
  end(): string;
}

type ConversionConfig = {
  normalizationChain?: readonly DictGroup[];
  segmentation?: DictLike | DictGroup;
  conversionChain: readonly DictGroup[];
};

const converters = new Map<ModeId, (text: string) => string>();
const separators = new Map<ModeId, ReadonlySet<string>>();
const CANDIDATE_SEPARATORS = '\t\r\n \u3000,.;:!?\'"`~()[]{}<>/\\=+|@#$%^&*-，。！？；：、（）【】《》「」『』〈〉';

export function createTextConverter(mode: ModeId): (text: string) => string {
  let converter = converters.get(mode);
  if (!converter) {
    const { from, to } = getMode(mode);
    converter = Converter({ from, to });
    converters.set(mode, converter);
  }
  return converter;
}

function idsArity(codePoint: number): number {
  if (codePoint >= 0x2ff0 && codePoint <= 0x2ff1) return 2;
  if (codePoint >= 0x2ff2 && codePoint <= 0x2ff3) return 3;
  if (codePoint >= 0x2ff4 && codePoint <= 0x2fff) return 2;
  return 0;
}

function safeSeparators(mode: ModeId): ReadonlySet<string> {
  const cached = separators.get(mode);
  if (cached) return cached;
  const config = Locale.configs[mode] as ConversionConfig | undefined;
  if (!config) throw new Error(`缺少转换字典：${mode}`);

  const occupied = new Set<string>();
  let generatesIds = false;
  function addDictionary(dictionary: DictLike): void {
    const pairs = typeof dictionary === 'string'
      ? dictionary.split('|').map(entry => entry.split(' '))
      : dictionary;
    for (const [source, target] of pairs) {
      for (const character of source) occupied.add(character);
      for (const character of target) {
        occupied.add(character);
        if (idsArity(character.codePointAt(0)!)) generatesIds = true;
      }
    }
  }

  for (const group of [...(config.normalizationChain ?? []), ...config.conversionChain]) {
    for (const dictionary of group) addDictionary(dictionary);
  }
  if (config.segmentation) {
    if (Array.isArray(config.segmentation) && config.segmentation.every(value => typeof value === 'string')) {
      for (const dictionary of config.segmentation) addDictionary(dictionary as string);
    } else {
      addDictionary(config.segmentation as DictLike);
    }
  }

  // No dictionary can consume or produce a separator, so conversion cannot
  // match a phrase across it. Check every stage, including normalization.
  // If a future dictionary creates IDS operators, use full conversion instead:
  // a generated operator could consume a separator as one of its operands.
  const safe = new Set(generatesIds ? [] : [...CANDIDATE_SEPARATORS].filter(character => !occupied.has(character)));
  separators.set(mode, safe);
  return safe;
}

/**
 * Flush only at separators proven safe for the pinned OpenCC dictionaries.
 * Never split a word to meet a byte/character quota. An uninterrupted run with
 * no safe separator (or an unfinished IDS sequence) stays buffered until a safe
 * boundary or EOF; memory usage therefore follows the longest such run.
 */
export function createStreamingConverter(mode: ModeId): StreamingConverter {
  const convert = createTextConverter(mode);
  const safe = safeSeparators(mode);
  let pending: string[] = [];
  let highSurrogate = '';
  let idsOperands = 0;
  let finished = false;

  return {
    write(text: string): string {
      if (finished) throw new Error('转换器已经结束');
      if (!text) return '';

      const carryLength = highSurrogate.length;
      const input = highSurrogate + text;
      highSurrogate = '';
      let boundary = -1;
      for (let offset = 0; offset < input.length;) {
        const codePoint = input.codePointAt(offset)!;
        if (offset === input.length - 1 && codePoint >= 0xd800 && codePoint <= 0xdbff) {
          highSurrogate = input[offset];
          break;
        }
        const width = codePoint > 0xffff ? 2 : 1;
        const arity = idsArity(codePoint);
        if (idsOperands > 0) {
          // OpenCC treats a complete ideographic description sequence as one
          // opaque unit, even when an operand is punctuation or a newline.
          idsOperands += arity - 1;
        } else if (arity > 0) {
          idsOperands = arity;
        } else if (safe.has(input.slice(offset, offset + width))) {
          boundary = offset + width - carryLength;
        }
        offset += width;
      }

      if (boundary < 0) {
        pending.push(text);
        return '';
      }

      pending.push(text.slice(0, boundary));
      const output = convert(pending.join(''));
      const tail = text.slice(boundary);
      pending = tail ? [tail] : [];
      return output;
    },
    end(): string {
      if (finished) throw new Error('转换器已经结束');
      finished = true;
      const output = convert(pending.join(''));
      pending = [];
      return output;
    },
  };
}

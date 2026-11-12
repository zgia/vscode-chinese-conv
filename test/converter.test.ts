import assert from 'node:assert/strict';
import test from 'node:test';
import { Converter } from 'opencc-js';
import { createStreamingConverter, createTextConverter } from '../src/converter';
import { MODES, type ModeId } from '../src/modes';

function streamed(mode: ModeId, chunks: string[]): string {
  const converter = createStreamingConverter(mode);
  return chunks.map(chunk => converter.write(chunk)).join('') + converter.end();
}

test('香港繁体保留系统的系，并使用香港字形', () => {
  assert.equal(
    createTextConverter('s2hk')('系统联系关系，里面卫生，头发发展，干杯干燥，面条后台。'),
    '系統聯繫關係，裏面衞生，頭髮發展，乾杯乾燥，麪條後台。',
  );
});

test('台湾字形与台湾词汇分别提供，避免悄悄替换项目术语', () => {
  const text = '系统里面的软件、鼠标、网络、数据库、打印机、出租车。';
  assert.equal(createTextConverter('s2tw')(text), '系統裡面的軟件、鼠標、網絡、數據庫、打印機、出租車。');
  assert.equal(createTextConverter('s2twp')(text), '系統裡面的軟體、滑鼠、網路、資料庫、印表機、計程車。');
});

test('海内存知己不误转为海記憶體知己，电脑内存仍按台湾用语转换', () => {
  for (const mode of ['s2hk', 's2tw', 's2twp'] as const) {
    const convert = createTextConverter(mode);
    assert.equal(convert('海内存知己天涯若比邻'), '海內存知己天涯若比鄰');
    assert.equal(convert('海内存知己，天涯若比邻。'), '海內存知己，天涯若比鄰。');
  }
  assert.equal(createTextConverter('s2twp')('电脑内存不足，系统正在运行。'), '電腦記憶體不足，系統正在執行。');
  assert.equal(streamed('s2twp', ['海内', '存知己，天涯若比邻。电脑内', '存不足。']), '海內存知己，天涯若比鄰。電腦記憶體不足。');
});

test('繁体转简体按所选地区转换，可选台湾词汇还原', () => {
  assert.equal(createTextConverter('hk2s')('系統聯繫關係，裏面衞生。'), '系统联系关系，里面卫生。');
  assert.equal(createTextConverter('tw2s')('系統裡面的軟體、滑鼠、網路。'), '系统里面的软体、滑鼠、网路。');
  assert.equal(createTextConverter('tw2sp')('系統裡面的軟體、滑鼠、網路。'), '系统里面的软件、鼠标、网络。');
});

const fixtures = [
  '系统软件鼠标网络，里面卫生质量。头发发展发布，干干净净一干二净干细胞树干干部干燥。',
  '皇后后台后面之后后悔，亚历杭德罗·冈萨雷斯·伊纳里图，PN结 SQL注入攻击。',
  '軟體滑鼠網路記憶體計程車，系統裏面衞生，乾乾淨淨一乾二淨。',
  '\ufeff系统\r\n头发\n<script>"后台": "数据库"</script>\t😀𠮷\u3000𤋮丽。',
  '⿰头发，系统；⿱面条\n后台；⿰ 头，⿱⿰头发⿰面条；⿰头⿰',
  '⿰\n头发，⿱ ⿰\n头。⿰⿱头发，⿲头\r\n发。',
  '\ud800系统，头发\udc00，😀丽。',
];

for (const { id, from, to } of MODES) {
  test(`${id}：每个切分位置都与 OpenCC 全量转换一致`, () => {
    const reference = Converter({ from, to });
    for (const text of fixtures) {
      const expected = reference(text);
      for (let split = 0; split <= text.length; split++) {
        assert.equal(streamed(id, [text.slice(0, split), '', text.slice(split)]), expected, `split=${split}, text=${text}`);
      }
      assert.equal(streamed(id, text.split('')), expected, `逐 UTF-16 码元输入：${text}`);
    }
  });
}

test('普通大文本持续输出，保留 UTF-8 BOM、CRLF、空白及 Unicode', () => {
  const text = '\ufeff' + '系统里面的软件、鼠标、网络。😀𠮷\r\n'.repeat(10_000);
  const converter = createStreamingConverter('s2twp');
  const output: string[] = [];
  let emitted = 0;
  for (let offset = 0; offset < text.length; offset += 1024) {
    const chunk = converter.write(text.slice(offset, offset + 1024));
    if (chunk) emitted++;
    output.push(chunk);
  }
  output.push(converter.end());
  assert.ok(emitted > 100, '应在读取过程中持续输出，不能等整个文件读完');
  assert.equal(output.join(''), Converter({ from: 'cn', to: 'twp' })(text));
});

test('无安全分隔符的长文本保留完整词组，到结束时精确转换', () => {
  const text = '头发发展干杯干燥里面卫生面条后台'.repeat(10_000);
  const converter = createStreamingConverter('s2hk');
  for (let offset = 0; offset < text.length; offset += 4096) {
    assert.equal(converter.write(text.slice(offset, offset + 4096)), '');
  }
  assert.equal(converter.end(), Converter({ from: 'cn', to: 'hk' })(text));
});

test('空文本及结束状态明确，不重复输出尾部', () => {
  assert.equal(streamed('s2hk', []), '');
  const converter = createStreamingConverter('s2hk');
  assert.equal(converter.write('系'), '');
  assert.equal(converter.write('统。'), '系統。');
  assert.equal(converter.end(), '');
  assert.throws(() => converter.write('系统'), /已经结束/);
  assert.throws(() => converter.end(), /已经结束/);
});

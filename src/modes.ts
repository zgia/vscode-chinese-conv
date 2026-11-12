export const MODES = [
  { id: 's2hk', label: '简体 → 香港繁体', description: '系統、裏面、軟件、鼠標', from: 'cn', to: 'hk' },
  { id: 's2tw', label: '简体 → 台湾繁体（字形）', description: '系統、裡面；保留原有词汇', from: 'cn', to: 'tw' },
  { id: 's2twp', label: '简体 → 台湾繁体（含台湾用语）', description: '軟體、滑鼠、網路', from: 'cn', to: 'twp' },
  { id: 'hk2s', label: '香港繁体 → 简体', description: '香港字形转简体', from: 'hk', to: 'cn' },
  { id: 'tw2s', label: '台湾繁体 → 简体', description: '台湾字形转简体，保留词汇', from: 'tw', to: 'cn' },
  { id: 'tw2sp', label: '台湾繁体 → 简体（含大陆用语）', description: '軟體、滑鼠、網路 → 软件、鼠标、网络', from: 'twp', to: 'cn' },
] as const;

export type ModeId = typeof MODES[number]['id'];

export function getMode(id: ModeId) {
  const mode = MODES.find(mode => mode.id === id);
  if (!mode) throw new Error(`未知的转换模式：${id}`);
  return mode;
}

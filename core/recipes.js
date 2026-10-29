import { calculateAllocation } from './allocation.js';

// Allocation recipes: PERCENT values are basis points (5500 = 55%), FIXED values are minor-unit strings.
// Applying a recipe (command applyRecipePreset) matches/creates envelopes by name and saves a normal template version.
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const RECIPE_PRESETS = freeze([
  { id: 'six-jars', version: 1, name: '6 chiếc hũ', summary: 'Chia mỗi khoản thu theo 55/10/10/10/10/5 cho thiết yếu, tự do tài chính, tiết kiệm dài hạn, học tập, hưởng thụ và cho đi.', suitedFor: 'Người có thu nhập đều đặn muốn cân bằng chi tiêu hằng ngày với tích lũy và phát triển bản thân.', fixedScope: 'PER_APPLICATION', shortagePolicy: 'BLOCK', leftoverPolicy: 'UNASSIGNED',
    lines: [{ key: 'necessities', envelopeName: 'Thiết yếu', type: 'PERCENT', value: 5500 }, { key: 'financial-freedom', envelopeName: 'Tự do tài chính', type: 'PERCENT', value: 1000 }, { key: 'long-term-savings', envelopeName: 'Tiết kiệm dài hạn', type: 'PERCENT', value: 1000 }, { key: 'education', envelopeName: 'Học tập', type: 'PERCENT', value: 1000 }, { key: 'play', envelopeName: 'Hưởng thụ', type: 'PERCENT', value: 1000 }, { key: 'give', envelopeName: 'Cho đi', type: 'PERCENT', value: 500 }] },
  { id: '50-30-20', version: 1, name: '50/30/20', summary: 'Một nửa cho nhu cầu thiết yếu, 30% cho mong muốn và 20% để tiết kiệm hoặc trả nợ.', suitedFor: 'Người mới bắt đầu lập ngân sách cần một quy tắc đơn giản, dễ nhớ.', fixedScope: 'PER_APPLICATION', shortagePolicy: 'BLOCK', leftoverPolicy: 'UNASSIGNED',
    lines: [{ key: 'needs', envelopeName: 'Thiết yếu', type: 'PERCENT', value: 5000 }, { key: 'wants', envelopeName: 'Mong muốn', type: 'PERCENT', value: 3000 }, { key: 'savings-debt', envelopeName: 'Tiết kiệm & trả nợ', type: 'PERCENT', value: 2000 }] },
  { id: 'pay-yourself-first', version: 1, name: 'Trả cho mình trước', summary: 'Để riêng 20% mỗi khoản thu cho tiết kiệm và đầu tư; phần còn lại chưa giao mục đích, chi tiêu linh hoạt.', suitedFor: 'Người muốn tích lũy đều đặn mà không cần theo dõi chi tiết từng nhóm chi.', fixedScope: 'PER_APPLICATION', shortagePolicy: 'BLOCK', leftoverPolicy: 'UNASSIGNED',
    lines: [{ key: 'save-invest', envelopeName: 'Tiết kiệm & đầu tư', type: 'PERCENT', value: 2000 }] },
  { id: 'zero-based', version: 1, name: 'Ngân sách bằng 0', summary: 'Giao từng đồng cho một việc cụ thể theo số tiền cố định mỗi tháng; thiếu thì ưu tiên theo thứ tự, dư thì vào hũ Dự phòng.', suitedFor: 'Người muốn kiểm soát chặt chi tiêu hằng tháng và sẵn sàng tự nhập số tiền cho từng hũ.', fixedScope: 'CALENDAR_MONTH', shortagePolicy: 'PARTIAL_BY_PRIORITY', leftoverPolicy: 'ENVELOPE', leftoverKey: 'buffer', leftoverEnvelopeName: 'Dự phòng',
    lines: [{ key: 'housing', envelopeName: 'Nhà ở', type: 'FIXED', value: '0' }, { key: 'food', envelopeName: 'Ăn uống', type: 'FIXED', value: '0' }, { key: 'transport', envelopeName: 'Đi lại', type: 'FIXED', value: '0' }, { key: 'bills', envelopeName: 'Hóa đơn & tiện ích', type: 'FIXED', value: '0' }, { key: 'savings', envelopeName: 'Tiết kiệm', type: 'FIXED', value: '0' }] },
]);
export function presetById(presetId) { return RECIPE_PRESETS.find(preset => preset.id === presetId) || null; }
export function requirePreset(presetId) { const preset = presetById(presetId); if (!preset) throw new Error('UNKNOWN_RECIPE_PRESET'); return preset; }
// Template lines for a preset; envelopeIdFor(name, key) supplies the envelope. Overrides replace values by line key.
export function recipeLines(preset, lineOverrides = {}, envelopeIdFor = (_, key) => key) {
  if (!lineOverrides || typeof lineOverrides !== 'object' || Array.isArray(lineOverrides)) throw new Error('INVALID_RECIPE_OVERRIDES');
  for (const key of Object.keys(lineOverrides)) if (!preset.lines.some(line => line.key === key)) throw new Error('UNKNOWN_RECIPE_LINE');
  return preset.lines.map((line, i) => {
    const value = Object.hasOwn(lineOverrides, line.key) ? lineOverrides[line.key] : line.value;
    return { envelopeId: envelopeIdFor(line.envelopeName, line.key), type: line.type, ...(line.type === 'PERCENT' ? { percentageBps: value } : { fixedAmountMinor: value }), priority: i + 1, stableLineKey: `${preset.id}:${line.key}` };
  });
}
// Pure preview for screens before anything is saved: amounts per recipe line for one income.
export function previewRecipe(presetId, amountMinor, { lineOverrides = {} } = {}) {
  const preset = requirePreset(presetId), lines = recipeLines(preset, lineOverrides);
  const result = calculateAllocation(amountMinor, lines, { shortagePolicy: preset.shortagePolicy, leftoverPolicy: preset.leftoverPolicy, leftoverEnvelopeId: preset.leftoverKey || '' });
  const names = new Map([...preset.lines.map(line => [line.key, line.envelopeName]), ...(preset.leftoverKey ? [[preset.leftoverKey, preset.leftoverEnvelopeName]] : [])]);
  return { ...result, presetId: preset.id, presetVersion: preset.version, lines: result.lines.map(line => ({ ...line, key: line.envelopeId, envelopeName: names.get(line.envelopeId) })) };
}

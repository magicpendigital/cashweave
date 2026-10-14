import { createDemoState } from './sample.js';
import { calculateBalances } from './ledger.js';
import { normalizeState, validateState, stripJournal, MAX_BACKUP_BYTES } from './state-schema.js';

export const storageKey = 'financial-assistant-prototype-v1';
export const migrationBackupKey = `${storageKey}-pre-v2`;
let expectedRaw;
function browserStorage() {
  try { if (!globalThis.localStorage) throw new Error(); return globalThis.localStorage; }
  catch { throw new Error('Trình duyệt không cho phép lưu dữ liệu cục bộ.'); }
}
function parseRaw(raw) {
  if (new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES) throw new Error('Dữ liệu cũ vượt giới hạn 5 MiB; dừng ghi và giữ bản gốc để khôi phục.');
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('Dữ liệu lưu trong trình duyệt không đọc được. Hãy tải bản sao trước khi đặt lại.'); }
  return normalizeState(value);
}
export function loadState() {
  const raw = browserStorage().getItem(storageKey); expectedRaw = raw;
  return raw ? parseRaw(raw) : normalizeState(createDemoState());
}
async function exclusiveWrite(action) {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) throw new Error('Chế độ chỉ đọc: môi trường này không có Web Locks để khóa ghi giữa các tab. Bạn vẫn có thể xuất bản sao; chưa ghi thay đổi.');
  try { return await locks.request('mach-tien-personal-ledger-write', { mode: 'exclusive' }, action); }
  catch (error) {
    if (['SecurityError', 'NotSupportedError'].includes(error?.name)) throw new Error('Chế độ chỉ đọc: trình duyệt chặn khóa ghi hoặc lưu dữ liệu tại địa chỉ này. Mở bản nguồn bằng npm start và http://127.0.0.1:4173; sổ hiện tại chưa bị thay đổi.');
    throw error;
  }
}
export async function saveState(state) {
  const normalized = normalizeState(state), raw = JSON.stringify(normalized);
  if (new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES - 1024) throw new Error('Dữ liệu vượt giới hạn 5 MiB của MVP. Hãy xuất bản sao, chưa ghi thay đổi.');
  const expectedAtCall = expectedRaw;
  return exclusiveWrite(() => {
  const storage = browserStorage(), current = storage.getItem(storageKey);
  if (expectedAtCall !== undefined && current !== expectedAtCall) throw new Error('Dữ liệu đã đổi ở tab khác. Hãy tải lại trước khi ghi; thay đổi này chưa được lưu.');
  // Saving the pre-migration original must succeed before replacing its key.
  if (current) {
    let old; try { old = JSON.parse(current); } catch { throw new Error('Dữ liệu cũ không đọc được; dừng ghi để giữ nguyên bản cũ.'); }
    parseRaw(current);
    if (old.version === 1 && !storage.getItem(migrationBackupKey)) storage.setItem(migrationBackupKey, current);
  }
  storage.setItem(storageKey, raw); expectedRaw = raw;
  });
}
export async function resetState() {
  const expectedAtCall = expectedRaw;
  return exclusiveWrite(() => {
  const next = normalizeState(createDemoState());
  // Explicit reset is the recovery path; retain raw legacy data as a separate recovery copy.
  const storage = browserStorage(), old = storage.getItem(storageKey);
  if (expectedAtCall !== undefined && old !== expectedAtCall) throw new Error('Dữ liệu đã đổi ở tab khác. Hãy tải lại trước khi đặt lại.');
  if (old && !storage.getItem(`${storageKey}-before-reset`)) storage.setItem(`${storageKey}-before-reset`, old);
  const raw = JSON.stringify(next); storage.setItem(storageKey, raw); expectedRaw = raw; return next;
  });
}
const eventId = () => globalThis.crypto?.randomUUID?.() || `event-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function commitChange(previous, next, label) {
  validateState(previous); const normalized = normalizeState(next);
  const text = String(label || 'Cập nhật sổ cá nhân').slice(0, 250);
  const candidate = { ...normalized, activity: [...previous.activity, { id: eventId(), at: new Date().toISOString(), label: text }].slice(-100), undoPoint: { label: text, before: stripJournal(previous) } };
  return validateState(candidate);
}
export function undoChange(state) {
  validateState(state);
  if (!state.undoPoint) throw new Error('Không còn thao tác gần nhất để hoàn tác.');
  const candidate = { ...state.undoPoint.before, activity: [...state.activity, { id: eventId(), at: new Date().toISOString(), label: `Hoàn tác: ${state.undoPoint.label}`.slice(0, 250) }].slice(-100), undoPoint: null };
  return validateState(candidate);
}
export function exportBackup(state) {
  const checked = normalizeState(state);
  const text = JSON.stringify({ format: 'mach-tien-backup', backupVersion: 2, exportedAt: new Date().toISOString(), state: checked });
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('Bản sao vượt giới hạn 5 MiB; không tạo tệp không thể khôi phục.');
  return text;
}
export function parseBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('Tệp sao lưu phải là JSON không quá 5 MiB.');
  let raw; try { raw = JSON.parse(text); } catch { throw new Error('Tệp sao lưu không phải JSON hợp lệ.'); }
  if (raw?.format === 'mach-tien-backup') {
    if (raw.backupVersion !== 2) throw new Error('Phiên bản bản sao chưa được hỗ trợ.');
    return normalizeState(raw.state);
  }
  // Legacy direct state exported by the prior recovery button is supported.
  return normalizeState(raw);
}
export function backupSummary(state) {
  const checked = normalizeState(state), balances = calculateBalances(checked);
  return { transactions: checked.transactions.length, accounts: checked.accounts.length, assets: checked.assets.length, templates: checked.budgeting.templates.length, allocations: checked.budgeting.allocations.length, netWorth: balances.netWorth, liquidCash: balances.liquidCash };
}
export function exportTransactionsCsv(state) {
  const checked = normalizeState(state);
  const headers = ['date', 'kind', 'amount', 'accountId', 'fromAccountId', 'toAccountId', 'assetId', 'category', 'note', 'planId'];
  // Formula prefixes in human text are neutralized when opened by spreadsheet software.
  const cell = value => { let text = String(value ?? ''); if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };
  return '\uFEFF' + [headers.join(','), ...checked.transactions.map(tx => headers.map(key => cell(tx[key])).join(','))].join('\r\n');
}

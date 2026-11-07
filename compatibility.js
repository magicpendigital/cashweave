import { parseBackup, storageKey } from './storage.js';
import { calculateBalances, createTransaction, validateTransaction, isValidDate, localDate } from './ledger.js';

const transactionFields = ['id','date','kind','amount','accountId','fromAccountId','toAccountId','assetId','planId','category','note'];
const sameTransaction = (a, b) => transactionFields.every(field => a?.[field] === b?.[field]);
function validateCorrectionHistory(state) {
  if (state.transactionCorrections === undefined) return;
  const history = state.transactionCorrections;
  if (!Array.isArray(history) || history.length > 10000) throw new Error('Lịch sử sửa giao dịch không hợp lệ hoặc quá lớn.');
  const latest = new Map(), ids = new Set();
  for (const entry of history) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id || entry.id.length > 160 || ids.has(entry.id) || typeof entry.reason !== 'string' || !entry.reason.trim() || entry.reason.length > 500 || typeof entry.at !== 'string' || entry.at.length > 32 || Number.isNaN(Date.parse(entry.at)) || entry.before?.id !== entry.transactionId || entry.after?.id !== entry.transactionId) throw new Error('Lịch sử sửa giao dịch thiếu giá trị trước/sau hoặc lý do.');
    for (const transaction of [entry.before, entry.after]) if (!validateTransaction({ ...state, transactions: [] }, transaction, { checkPlanRemaining: false }).ok) throw new Error('Lịch sử sửa chứa giao dịch không hợp lệ.');
    if (latest.has(entry.transactionId) && !sameTransaction(latest.get(entry.transactionId), entry.before)) throw new Error('Chuỗi lịch sử sửa không liên tục.');
    latest.set(entry.transactionId, entry.after); ids.add(entry.id);
  }
  for (const [transactionId, transaction] of latest) if (!sameTransaction(state.transactions.find(item => item.id === transactionId), transaction)) throw new Error('Giao dịch không khớp lần sửa mới nhất.');
}

export function createEmptyCompatibilityBook() {
  return parseBackup(JSON.stringify({ version: 2, demo: false, accounts: [], cards: [], assets: [], transactions: [], plans: [], settings: { buffer: 0 }, budgeting: { templates: [], funds: [], allocations: [], expenseLinks: [] }, activity: [], undoPoint: null }));
}
export function addCompatibilityAsset(state, { name, type, costBasis, currentValue, asOf }) {
  if (typeof name !== 'string' || !name.trim() || name.length > 500 || !['gold','property','fund','stock','savings','other'].includes(type) || !Number.isSafeInteger(costBasis) || costBasis < 0 || !Number.isSafeInteger(currentValue) || currentValue < 0 || !isValidDate(asOf) || asOf > localDate()) throw new Error('Nhập tên, loại, giá trị nguyên VND không âm và ngày định giá không ở tương lai.');
  const asset = { id: globalThis.crypto.randomUUID(), name: name.trim(), type, costBasis, currentValue, asOf };
  return parseBackup(JSON.stringify({ ...state, assets: [...state.assets, asset] }));
}
export function correctCompatibilityTransaction(state, transactionId, { amount, date, category, note, reason }) {
  validateCorrectionHistory(state);
  const before = state.transactions.find(transaction => transaction.id === transactionId);
  if (!before) throw new Error('Không tìm thấy giao dịch cần sửa.');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw new Error('Cần lý do sửa tối đa 500 ký tự.');
  if (state.transactionCorrections !== undefined && !Array.isArray(state.transactionCorrections)) throw new Error('Lịch sử sửa cần được kiểm tra; sổ hiện tại chưa thay đổi.');
  const plans = state.plans.map(plan => plan.id === before.planId ? { ...plan, settledAmount: (plan.settledAmount || 0) - before.amount } : plan);
  const base = { ...state, plans, transactions: state.transactions.filter(transaction => transaction.id !== transactionId) };
  const revised = createTransaction(base, { ...before, amount, date, category, note });
  const replacement = revised.transactions.at(-1);
  const transactions = state.transactions.map(transaction => transaction.id === transactionId ? replacement : transaction);
  const entry = { id: globalThis.crypto.randomUUID(), transactionId, at: new Date().toISOString(), reason: reason.trim(), before: JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(replacement)) };
  return parseBackup(JSON.stringify({ ...revised, transactions, transactionCorrections: [...(state.transactionCorrections || []), entry] }));
}

// Keep every legacy field in its original domain until a lossless mapping exists.
// This is a separate book; it never writes to or merges the schema-3 repository.
export function inspectCompatibilityBook(raw) {
  const state = parseBackup(raw);
  validateCorrectionHistory(state);
  const balances = calculateBalances(state);
  return { state, counts: { accounts: state.accounts.length, transactions: state.transactions.length, cards: state.cards.length, assets: state.assets.length, plans: state.plans.length }, balances };
}
export async function preserveCompatibilityBook(raw, { storage = globalThis.localStorage, locks = globalThis.navigator?.locks, acknowledge = false, expectedRaw = storage?.getItem(storageKey) ?? null } = {}) {
  if (!acknowledge) throw new Error('COMPATIBILITY_CONFIRMATION_REQUIRED');
  if (!storage || !locks?.request) throw new Error('COMPATIBILITY_STORAGE_LOCK_REQUIRED');
  const checked = inspectCompatibilityBook(raw), text = JSON.stringify(checked.state);
  if (new TextEncoder().encode(text).length > 5 * 1024 * 1024 - 1024) throw new Error('COMPATIBILITY_STORAGE_SIZE_LIMIT');
  return locks.request('mach-tien-personal-ledger-write', { mode: 'exclusive' }, () => {
    const prior = storage.getItem(storageKey);
    if (prior !== expectedRaw) throw new Error('COMPATIBILITY_REVISION_CONFLICT');
    // Opening the current book is read-only. Repeated visits must not duplicate
    // the full journal or consume the remaining storage quota.
    if (prior !== null && raw === prior) return { counts: checked.counts, recoveryId: null, unchanged: true };
    const transactionId = globalThis.crypto.randomUUID();
    // All recovery writes must succeed before the active legacy key changes.
    storage.setItem(storageKey + '-import-source-' + transactionId, raw);
    if (prior !== null) storage.setItem(storageKey + '-before-import-' + transactionId, prior);
    storage.setItem(storageKey, text);
    return { counts: checked.counts, recoveryId: transactionId };
  });
}

import { calculateBalances, isValidDate, validateTransaction } from './ledger.js';
import { emptyBudgeting, getBudgetSummary, validateBudgetRows, validBudgetAccount, MONEY_LIMIT } from './budgeting.js';

export const SCHEMA_VERSION = 2;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const clone = value => JSON.parse(JSON.stringify(value));
const fail = message => { throw new Error(`Dữ liệu không đúng định dạng: ${message}`); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 160 && !['__proto__', 'prototype', 'constructor'].includes(value);
const validName = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
const amount = (value, signed = false) => typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MONEY_LIMIT && (signed || value >= 0);
function array(value, name, max = 10000) { if (!Array.isArray(value) || value.length > max) fail(`${name} không phải danh sách hợp lệ hoặc vượt ${max} dòng.`); }
function uniqueIds(items, label) { const ids = new Set(); for (const item of items) { if (!isObject(item) || !safeId(item.id) || ids.has(item.id)) fail(`${label} có ID thiếu, trùng hoặc không an toàn.`); ids.add(item.id); } return ids; }
function safeTree(value, depth = 0) {
  if (depth > 25) fail('dữ liệu lồng nhau quá sâu.');
  if (typeof value === 'number' && !Number.isFinite(value)) fail('số không hữu hạn.');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('khóa đối tượng không an toàn.'); safeTree(child, depth + 1); }
}
export function validateState(state, { journal = true } = {}) {
  if (!isObject(state) || state.version !== 2) fail('phiên bản dữ liệu chưa được hỗ trợ.');
  safeTree(state);
  for (const key of ['accounts', 'cards', 'assets', 'transactions', 'plans']) array(state[key], key);
  const accountIds = uniqueIds(state.accounts, 'Tài khoản'), assetIds = uniqueIds(state.assets, 'Tài sản'), txIds = uniqueIds(state.transactions, 'Giao dịch'), planIds = uniqueIds(state.plans, 'Lịch');
  const cardIds = uniqueIds(state.cards, 'Thẻ');
  for (const a of state.accounts) if (!validName(a.name) || !['cash', 'credit'].includes(a.type) || !amount(a.openingBalance, true)) fail('tài khoản không hợp lệ.');
  for (const a of state.assets) if (!validName(a.name) || !amount(a.costBasis) || !amount(a.currentValue) || !isValidDate(a.asOf)) fail('tài sản không hợp lệ.');
  for (const c of state.cards) if (!validName(c.name) || !accountIds.has(c.accountId) || state.accounts.find(a => a.id === c.accountId).type !== 'credit' || !amount(c.limit) || c.limit <= 0 || !Number.isInteger(c.statementDay) || c.statementDay < 1 || c.statementDay > 31 || !Number.isInteger(c.dueDay) || c.dueDay < 1 || c.dueDay > 31) fail('thẻ không hợp lệ.');
  for (const p of state.plans) if (!validName(p.label) || !isValidDate(p.date) || !['income', 'expense'].includes(p.kind) || !amount(p.amount) || p.amount <= 0 || !accountIds.has(p.accountId) || (p.cardId && !cardIds.has(p.cardId)) || !amount(p.settledAmount || 0) || (p.settledAmount || 0) > p.amount) fail('khoản trong lịch không hợp lệ.');
  for (const tx of state.transactions) {
    if (!amount(tx.amount) || tx.amount <= 0 || !validateTransaction({ ...state, transactions: [] }, tx, { checkPlanRemaining: false }).ok) fail(`giao dịch ${tx.id} không hợp lệ.`);
    if ((tx.note !== undefined && (typeof tx.note !== 'string' || tx.note.length > 2000)) || (tx.category !== undefined && (typeof tx.category !== 'string' || tx.category.length > 500))) fail('chữ ghi chú giao dịch không hợp lệ.');
  }
  for (const plan of state.plans) {
    const linkedTotal = state.transactions.filter(tx => tx.planId === plan.id).reduce((sum, tx) => sum + tx.amount, 0);
    if (!Number.isSafeInteger(linkedTotal) || linkedTotal !== (plan.settledAmount || 0)) fail('số đã trả trong lịch không khớp giao dịch liên kết.');
  }
  if (!isObject(state.settings) || !amount(state.settings.buffer || 0)) fail('thiết lập không hợp lệ.');
  const budgeting = state.budgeting;
  if (!isObject(budgeting)) fail('thiếu dữ liệu quỹ.');
  for (const key of ['templates', 'funds', 'allocations', 'expenseLinks']) array(budgeting[key], `budgeting.${key}`);
  uniqueIds(budgeting.templates, 'Mẫu'); const fundIds = uniqueIds(budgeting.funds, 'Quỹ'); uniqueIds(budgeting.allocations, 'Phân bổ');
  const fundNames = new Set();
  for (const f of budgeting.funds) {
    if (!validName(f.name) || f.name.length > 80 || !validBudgetAccount(state, f.accountId)) fail('quỹ không hợp lệ.');
    const key = f.name.trim().normalize('NFC').toLocaleLowerCase('vi-VN'); if (fundNames.has(key)) fail('tên quỹ bị trùng.'); fundNames.add(key);
  }
  for (const t of budgeting.templates) {
    if (!validName(t.name) || t.name.length > 80 || t.version !== 1 || typeof t.createdAt !== 'string') fail('mẫu không hợp lệ.');
    validateBudgetRows(state, t.rows);
  }
  for (const e of budgeting.allocations) {
    const income = state.transactions.find(t => t.id === e.incomeId && t.kind === 'income');
    if (!income || typeof e.label !== 'string' || e.label.length > 120 || !isValidDate(e.date)) fail('phân bổ mất nguồn thu hoặc nhãn/ngày không hợp lệ.');
    array(e.lines, 'allocation.lines', 12); if (e.lines.length < 1) fail('phân bổ rỗng.');
    const seenFunds = new Set(); let total = 0;
    for (const line of e.lines) {
      const fund = budgeting.funds.find(f => f.id === line.fundId);
      if (!fund || seenFunds.has(line.fundId) || line.name !== fund.name || line.accountId !== fund.accountId || !amount(line.amount)) fail('dòng phân bổ không khớp quỹ.');
      seenFunds.add(line.fundId); total += line.amount;
    }
    if (!Number.isSafeInteger(total) || total <= 0 || total > income.amount) fail('tổng phân bổ sai.');
    if (e.ruleSnapshot !== null && e.ruleSnapshot !== undefined) validateBudgetRows(state, e.ruleSnapshot);
  }
  const linked = new Set();
  for (const link of budgeting.expenseLinks) {
    if (!isObject(link) || !fundIds.has(link.fundId) || linked.has(link.transactionId) || !state.transactions.some(tx => tx.id === link.transactionId && tx.kind === 'expense')) fail('liên kết chi không hợp lệ hoặc bị trùng.');
    linked.add(link.transactionId);
  }
  const summary = getBudgetSummary(state);
  if (summary.incomes.some(i => i.remaining < 0) || summary.funds.some(f => f.balance < 0)) fail('phân bổ vượt nguồn thu hoặc chi vượt quỹ.');
  const balances = calculateBalances(state);
  if (![...Object.values(balances.accounts), balances.netWorth, balances.liquidCash, balances.totalAssets, balances.totalLiabilities].every(Number.isSafeInteger)) fail('số dư vượt phạm vi tính chính xác.');
  if (journal) {
    array(state.activity, 'activity', 100);
    uniqueIds(state.activity, 'Lịch sử');
    for (const e of state.activity) if (!validName(e.label) || e.label.length > 250 || typeof e.at !== 'string') fail('lịch sử không hợp lệ.');
    if (state.undoPoint !== null) {
      if (!isObject(state.undoPoint) || !validName(state.undoPoint.label) || !isObject(state.undoPoint.before)) fail('bản hoàn tác không hợp lệ.');
      if ('undoPoint' in state.undoPoint.before || 'activity' in state.undoPoint.before) fail('bản hoàn tác lồng lịch sử.');
      validateState(state.undoPoint.before, { journal: false });
    }
  }
  return state;
}
export function normalizeState(raw) {
  if (!isObject(raw) || ![1, 2].includes(raw.version)) fail('phiên bản dữ liệu chưa được hỗ trợ.');
  safeTree(raw);
  const state = clone(raw);
  if (state.version === 1) {
    if ('budgeting' in state || 'activity' in state || 'undoPoint' in state) fail('schema v1 chứa trường của v2; không tự loại bỏ dữ liệu.');
    // Preserve existing records; never reinterpret previous transactions as allocations.
    state.version = 2; state.budgeting = emptyBudgeting(); state.activity = []; state.undoPoint = null;
  }
  return validateState(state);
}
export function stripJournal(state) { const { activity, undoPoint, ...rest } = state; return clone(rest); }

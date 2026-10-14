import { calculateBalances, createTransaction, localDate } from './ledger.js';

export const MONEY_LIMIT = 1_000_000_000_000;
export const cloneBudgetData = value => JSON.parse(JSON.stringify(value));
const rule = (name, kind, value) => ({ name, kind, value, accountId: '' });
export const BUILTIN_TEMPLATES = [
  { id: 'builtin-503020', name: '50 / 30 / 20', description: 'Ba nhóm; tỷ lệ tham khảo, có thể điều chỉnh.', rows: [rule('Nhu cầu', 'percent', 50), rule('Mong muốn', 'percent', 30), rule('Tiết kiệm & trả nợ', 'percent', 20)] },
  { id: 'builtin-jars', name: '6 hũ', description: 'Sáu mục đích; không phải khuyến nghị đầu tư.', rows: [rule('Thiết yếu', 'percent', 55), rule('Tự do tài chính', 'percent', 10), rule('Dài hạn', 'percent', 10), rule('Học tập', 'percent', 10), rule('Hưởng thụ', 'percent', 10), rule('Cho đi', 'percent', 5)] },
  { id: 'builtin-envelopes', name: 'Giao việc cho từng đồng', description: 'Tự đặt quỹ; phần dư cũng có mục đích. Số tiền chỉ minh họa.', rows: [rule('Nhà ở', 'fixed', 6_000_000), rule('Sinh hoạt', 'fixed', 4_000_000), rule('Đi lại', 'fixed', 1_000_000), rule('Hóa đơn', 'fixed', 2_000_000), rule('Dài hạn', 'fixed', 3_000_000), rule('Linh hoạt', 'remainder', 0)] },
  { id: 'builtin-payfirst', name: 'Dành tiền cho mình trước', description: '15% chỉ là ví dụ; tự chọn mức phù hợp nghĩa vụ của bạn.', rows: [rule('Dành trước', 'percent', 15), rule('Kế hoạch còn lại', 'remainder', 0)] },
  { id: 'builtin-fixed', name: 'Thiết yếu trước', description: 'Khoản cố định chạy mỗi lần áp dụng, không phải mục tiêu tháng.', rows: [rule('Tiền nhà', 'fixed', 6_000_000), rule('Sinh hoạt', 'percent', 50), rule('Dự phòng', 'percent', 30), rule('Linh hoạt', 'remainder', 0)] },
];
export const emptyBudgeting = () => ({ templates: [], funds: [], allocations: [], expenseLinks: [] });
const bget = state => state.budgeting || emptyBudgeting();
const newBudgetId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const textName = name => typeof name === 'string' && name.trim().length > 0 && name.length <= 80;
const keyName = name => name.trim().normalize('NFC').toLocaleLowerCase('vi-VN');
const validMoney = amount => Number.isSafeInteger(amount) && amount >= 0 && amount <= MONEY_LIMIT;
const safeSum = values => { const result = values.reduce((sum, value) => sum + value, 0); if (!Number.isSafeInteger(result)) throw new Error('Tổng tiền vượt phạm vi tính chính xác.'); return result; };
export function validBudgetAccount(state, id) { return id === '' || state.accounts.some(account => account.id === id && account.type === 'cash'); }
export function validateBudgetRows(state, rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 12) throw new Error('Mẫu cần từ 1 đến 12 quỹ.');
  const names = new Set(); let percent = 0, remainders = 0;
  for (const row of rows) {
    if (!textName(row.name)) throw new Error('Tên quỹ cần từ 1 đến 80 ký tự.');
    if (names.has(keyName(row.name))) throw new Error('Tên quỹ trong mẫu bị trùng.');
    names.add(keyName(row.name));
    if (!validBudgetAccount(state, row.accountId || '')) throw new Error('Quỹ chỉ liên kết với tài khoản tiền đang có.');
    if (row.kind === 'percent') {
      const points = Math.round(row.value * 100);
      if (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0 || row.value > 100 || Math.abs(points - row.value * 100) > 1e-6) throw new Error('Tỷ lệ phải từ 0 đến 100%, tối đa hai chữ số thập phân.');
      percent += points;
    } else if (row.kind === 'fixed') {
      if (!validMoney(row.value)) throw new Error('Khoản cố định phải là số nguyên đồng không âm, tối đa 1.000 tỷ.');
    } else if (row.kind === 'remainder') {
      if (row.value !== 0) throw new Error('Quỹ phần dư không có giá trị cố định; value phải bằng 0.');
      remainders++;
    }
    else throw new Error('Loại quy tắc không hợp lệ.');
  }
  if (percent > 10000) throw new Error('Tổng tỷ lệ không được vượt 100%.');
  if (remainders > 1) throw new Error('Chỉ một quỹ được nhận phần dư.');
}
export function getTemplates(state) { return cloneBudgetData([...BUILTIN_TEMPLATES, ...bget(state).templates]); }
export function previewAllocation(amount, rows, state) {
  if (!validMoney(amount) || amount === 0) throw new Error('Nguồn phân bổ phải là số nguyên đồng dương, tối đa 1.000 tỷ.');
  validateBudgetRows(state, rows);
  let left = amount, shortage = 0;
  const lines = rows.map(row => ({ name: row.name.trim(), accountId: row.accountId || '', amount: 0, rule: '' }));
  rows.forEach((row, index) => {
    if (row.kind === 'fixed') {
      lines[index].amount = Math.min(row.value, left); left -= lines[index].amount; shortage += row.value - lines[index].amount;
      lines[index].rule = `Cố định ${row.value.toLocaleString('vi-VN')} ₫ mỗi lần áp dụng`;
    }
  });
  const base = left;
  rows.forEach((row, index) => {
    if (row.kind === 'percent') {
      const value = Number(BigInt(base) * BigInt(Math.round(row.value * 100)) / 10000n);
      lines[index].amount = value; left -= value;
      lines[index].rule = `${row.value}% × ${base.toLocaleString('vi-VN')} ₫ (phần còn sau cố định)`;
    }
  });
  const remainder = rows.findIndex(row => row.kind === 'remainder');
  if (remainder >= 0) { lines[remainder].amount = left; lines[remainder].rule = 'Phần dư sau các dòng khác'; left = 0; }
  return { lines, base, shortage, unallocated: left };
}
export function saveBudgetTemplate(state, input) {
  if (!textName(input.name)) throw new Error('Tên mẫu cần từ 1 đến 80 ký tự.');
  validateBudgetRows(state, input.rows);
  const budgeting = cloneBudgetData(bget(state));
  budgeting.templates.push({ id: newBudgetId('template'), name: input.name.trim(), rows: cloneBudgetData(input.rows), description: 'Mẫu cá nhân lưu trên trình duyệt này', version: 1, createdAt: new Date().toISOString() });
  return { ...state, budgeting };
}
export function getBudgetSummary(state) {
  const budgeting = bget(state);
  const funds = budgeting.funds.map(fund => {
    const allocated = safeSum(budgeting.allocations.flatMap(event => event.lines).filter(line => line.fundId === fund.id).map(line => line.amount));
    const spent = safeSum(budgeting.expenseLinks.filter(link => link.fundId === fund.id).map(link => state.transactions.find(tx => tx.id === link.transactionId)?.amount || 0));
    return { ...fund, allocated, spent, balance: allocated - spent };
  });
  const incomes = state.transactions.filter(tx => tx.kind === 'income').map(tx => {
    const allocated = safeSum(budgeting.allocations.filter(event => event.incomeId === tx.id).flatMap(event => event.lines).map(line => line.amount));
    return { ...tx, allocated, remaining: tx.amount - allocated };
  });
  const totalAllocated = safeSum(funds.map(fund => fund.allocated)), totalSpent = safeSum(funds.map(fund => fund.spent)), totalRemaining = totalAllocated - totalSpent;
  const { liquidCash, creditDebt } = calculateBalances(state);
  const cashAvailable = Math.max(0, liquidCash - creditDebt - totalRemaining);
  const linked = new Set(budgeting.expenseLinks.map(link => link.transactionId));
  const unlinkedExpenses = state.transactions.filter(tx => tx.kind === 'expense' && !linked.has(tx.id));
  const warnings = [];
  if (unlinkedExpenses.length) warnings.push(`${unlinkedExpenses.length} khoản chi chưa gắn quỹ; số dư quỹ chỉ phản ánh các chi đã liên kết.`);
  if (totalRemaining > liquidCash - creditDebt) warnings.push('Tiền đang earmark vượt tiền mặt/ngân hàng sau khi trừ nợ thẻ đã ghi. Cần kiểm tra các khoản chi chưa gắn quỹ; không coi số dư quỹ là tiền chắc chắn có thể tiêu.');
  return { funds, incomes, totalAllocated, totalSpent, totalRemaining, liquidCash, creditDebt, cashAvailable, warnings };
}
export function applyIncomeAllocation(state, input) {
  const summary = getBudgetSummary(state), income = summary.incomes.find(tx => tx.id === input.incomeId);
  if (!income) throw new Error('Chỉ khoản thu đã ghi mới có thể phân bổ.');
  const budgeting = cloneBudgetData(bget(state));
  if (input.operationId && budgeting.allocations.some(event => event.id === input.operationId)) throw new Error('Lần phân bổ này đã được ghi, không áp dụng lại.');
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 12) throw new Error('Cần từ 1 đến 12 dòng phân bổ.');
  const names = new Set(), fundIds = new Set();
  const lines = input.lines.map(line => {
    if (!textName(line.name) || !validMoney(line.amount)) throw new Error('Tên quỹ và số tiền nguyên đồng không âm phải hợp lệ.');
    const key = keyName(line.name);
    if (names.has(key)) throw new Error('Tên quỹ trong lần phân bổ bị trùng.'); names.add(key);
    const accountId = line.accountId || '';
    if (!validBudgetAccount(state, accountId)) throw new Error('Tài khoản liên kết kế hoạch không hợp lệ.');
    let fund = line.fundId ? budgeting.funds.find(f => f.id === line.fundId) : budgeting.funds.find(f => keyName(f.name) === key);
    if (line.fundId && !fund) throw new Error('Quỹ đã chọn không còn tồn tại.');
    if (fund && (keyName(fund.name) !== key || fund.accountId !== accountId)) throw new Error(`Quỹ “${fund.name}” đã có liên kết khác. Giữ liên kết cũ hoặc dùng tên mục đích khác; đổi tài khoản không tự tạo quỹ trùng.`);
    if (!fund) { fund = { id: newBudgetId('fund'), name: line.name.trim(), accountId }; budgeting.funds.push(fund); }
    if (fundIds.has(fund.id)) throw new Error('Không phân hai dòng cho cùng một quỹ.'); fundIds.add(fund.id);
    return { fundId: fund.id, name: fund.name, accountId, amount: line.amount };
  });
  const total = safeSum(lines.map(line => line.amount));
  if (total <= 0) throw new Error('Phân bổ cần có ít nhất một đồng; hoặc chỉ ghi khoản thu.');
  if (total > income.remaining) throw new Error('Tổng chia vượt phần còn chưa phân của khoản thu.');
  if (total > summary.cashAvailable) throw new Error('Nguồn tiền hiện tại không đủ để giao thêm mục đích sau khi trừ nợ thẻ và quỹ đã có. Kiểm tra chi chưa gắn quỹ.');
  if (input.ruleSnapshot) validateBudgetRows(state, input.ruleSnapshot);
  budgeting.allocations.push({ id: input.operationId || newBudgetId('allocation'), incomeId: income.id, label: String(input.label || 'Tự chia').slice(0, 120), templateId: String(input.templateId || ''), ruleSnapshot: input.ruleSnapshot ? cloneBudgetData(input.ruleSnapshot) : null, date: localDate(), lines });
  return { ...state, budgeting };
}
export function createIncomeWithAllocation(state, input, options) {
  if (input.kind !== 'income') throw new Error('Luồng này chỉ dành cho khoản thu.');
  const next = createTransaction(state, input);
  return applyIncomeAllocation(next, { ...options, incomeId: next.transactions.at(-1).id });
}
export function linkBudgetExpense(state, transactionId, fundId) {
  const tx = state.transactions.find(tx => tx.id === transactionId);
  if (!tx || tx.kind !== 'expense') throw new Error('Chỉ giao dịch chi mới được gắn quỹ.');
  const budgeting = cloneBudgetData(bget(state));
  if (budgeting.expenseLinks.some(link => link.transactionId === transactionId)) throw new Error('Khoản chi này đã được gắn quỹ.');
  const fund = getBudgetSummary(state).funds.find(fund => fund.id === fundId);
  if (!fund || tx.amount > fund.balance) throw new Error('Quỹ không tồn tại hoặc không đủ tiền đã dành.');
  budgeting.expenseLinks.push({ transactionId, fundId });
  return { ...state, budgeting };
}

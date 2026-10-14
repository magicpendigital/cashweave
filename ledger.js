// Pure calculation and import rules for the local prototype.
// Amounts are positive VND integers; account balances may be negative.

const transactionKinds = new Set(['income', 'expense', 'transfer', 'investment']);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

export function localDate(value = new Date()) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(isoDate, days) {
  if (!isValidDate(isoDate)) throw new Error('Ngày không hợp lệ.');
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

const findAccount = (state, id) => state.accounts?.find((item) => item.id === id);
const findAsset = (state, id) => state.assets?.find((item) => item.id === id);
const validAmount = (amount) => typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0;

export function validateTransaction(state, input, options = {}) {
  const errors = [];
  if (!input || typeof input !== 'object') return { ok: false, errors: ['Thiếu thông tin giao dịch.'] };
  if (!isValidDate(input.date)) errors.push('Ngày phải có dạng YYYY-MM-DD và là ngày có thật.');
  else if (input.date > localDate()) errors.push('Giao dịch thực tế không thể ở ngày tương lai; hãy thêm vào Lịch tiền.');
  if (!transactionKinds.has(input.kind)) errors.push('Loại giao dịch không được hỗ trợ.');
  if (!validAmount(input.amount)) errors.push('Số tiền phải là số nguyên VND lớn hơn 0.');
  if (input.id && state.transactions?.some((tx) => tx.id === input.id)) errors.push('Mã giao dịch đã tồn tại.');

  if (input.kind === 'income' || input.kind === 'expense') {
    const account = findAccount(state, input.accountId);
    if (!account) errors.push('Tài khoản không tồn tại.');
    if (input.kind === 'income' && account?.type !== 'cash') errors.push('Khoản thu cần vào tài khoản tiền.');
  } else if (input.kind === 'transfer') {
    if (!findAccount(state, input.fromAccountId)) errors.push('Tài khoản chuyển đi không tồn tại.');
    if (!findAccount(state, input.toAccountId)) errors.push('Tài khoản nhận không tồn tại.');
    if (input.fromAccountId === input.toAccountId) errors.push('Hai tài khoản chuyển tiền phải khác nhau.');
    if (input.planId) {
      const plan = state.plans?.find((item) => item.id === input.planId);
      const card = state.cards?.find((item) => item.id === plan?.cardId);
      if (!plan || plan.kind !== 'expense' || !card || plan.accountId !== input.fromAccountId
          || card.accountId !== input.toAccountId) errors.push('Khoản dự kiến không khớp với lần trả thẻ này.');
      else if (options.checkPlanRemaining !== false && validAmount(input.amount)
          && input.amount > plan.amount - (plan.settledAmount || 0)) errors.push('Số tiền trả vượt phần chưa thanh toán của khoản dự kiến.');
    }
  } else if (input.kind === 'investment') {
    const account = findAccount(state, input.fromAccountId);
    if (!account || account.type !== 'cash') errors.push('Khoản đầu tư cần nguồn từ tài khoản tiền.');
    if (!findAsset(state, input.assetId)) errors.push('Tài sản đầu tư không tồn tại.');
  }
  if (input.planId && input.kind !== 'transfer') errors.push('Chỉ lần chuyển tiền trả thẻ mới được gắn với khoản dự kiến.');
  return { ok: errors.length === 0, errors };
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createTransaction(state, input) {
  const transaction = {
    id: input.id || newId(),
    date: input.date,
    kind: input.kind,
    amount: input.amount,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.fromAccountId ? { fromAccountId: input.fromAccountId } : {}),
    ...(input.toAccountId ? { toAccountId: input.toAccountId } : {}),
    ...(input.assetId ? { assetId: input.assetId } : {}),
    ...(input.planId ? { planId: input.planId } : {}),
    category: String(input.category || 'Khác').trim(),
    note: String(input.note || '').trim(),
  };
  const validation = validateTransaction(state, transaction);
  if (!validation.ok) throw new Error(validation.errors.join(' '));
  const plans = transaction.planId
    ? state.plans.map((plan) => plan.id === transaction.planId
      ? { ...plan, settledAmount: (plan.settledAmount || 0) + transaction.amount } : plan)
    : state.plans;
  return { ...state, plans, transactions: [...state.transactions, transaction] };
}

export function updateAssetValue(state, assetId, currentValue, asOf) {
  if (!findAsset(state, assetId)) throw new Error('Không tìm thấy tài sản.');
  if (!Number.isSafeInteger(currentValue) || currentValue < 0) throw new Error('Giá trị tài sản phải là số nguyên VND không âm.');
  if (!isValidDate(asOf)) throw new Error('Ngày định giá không hợp lệ.');
  if (asOf > localDate()) throw new Error('Ngày định giá không thể ở tương lai.');
  return {
    ...state,
    assets: state.assets.map((asset) => asset.id === assetId ? { ...asset, currentValue, asOf } : asset),
  };
}

export function calculateBalances(state) {
  const accounts = Object.fromEntries((state.accounts || []).map((item) => [item.id, item.openingBalance]));
  const assets = Object.fromEntries((state.assets || []).map((item) => [item.id, {
    costBasis: item.costBasis,
    currentValue: item.currentValue,
  }]));

  for (const tx of state.transactions || []) {
    const check = validateTransaction({ ...state, transactions: [] }, tx, { checkPlanRemaining: false });
    if (!check.ok) throw new Error(`Giao dịch ${tx.id || '(chưa có mã)'} không hợp lệ: ${check.errors.join(' ')}`);
    if (tx.kind === 'income') accounts[tx.accountId] += tx.amount;
    else if (tx.kind === 'expense') accounts[tx.accountId] -= tx.amount;
    else if (tx.kind === 'transfer') {
      accounts[tx.fromAccountId] -= tx.amount;
      accounts[tx.toAccountId] += tx.amount;
    } else if (tx.kind === 'investment') {
      accounts[tx.fromAccountId] -= tx.amount;
      assets[tx.assetId].costBasis += tx.amount;
      // A manual valuation already includes contributions made on or before its date.
      if (tx.date > findAsset(state, tx.assetId).asOf) assets[tx.assetId].currentValue += tx.amount;
    }
  }

  const cashAccounts = (state.accounts || []).filter((a) => a.type === 'cash');
  const creditAccounts = (state.accounts || []).filter((a) => a.type === 'credit');
  const liquidCash = cashAccounts.reduce((sum, a) => sum + accounts[a.id], 0);
  const cashAssets = cashAccounts.reduce((sum, a) => sum + Math.max(0, accounts[a.id]), 0);
  const cashOverdraft = cashAccounts.reduce((sum, a) => sum + Math.max(0, -accounts[a.id]), 0);
  const creditDebt = creditAccounts.reduce((sum, a) => sum + Math.max(0, -accounts[a.id]), 0);
  const creditSurplus = creditAccounts.reduce((sum, a) => sum + Math.max(0, accounts[a.id]), 0);
  const investedAssets = Object.values(assets).reduce((sum, asset) => sum + asset.currentValue, 0);
  const totalAssets = cashAssets + investedAssets + creditSurplus;
  const totalLiabilities = creditDebt + cashOverdraft;
  const netWorth = totalAssets - totalLiabilities;
  return { accounts, assets, liquidCash, creditDebt, totalAssets, totalLiabilities, netWorth };
}

export function calculateDashboard(state, today = localDate()) {
  if (!isValidDate(today)) throw new Error('Ngày xem báo cáo không hợp lệ.');
  const balances = calculateBalances(state);
  const month = today.slice(0, 7);
  const actual = (state.transactions || []).filter((tx) => tx.date.startsWith(month));
  const monthlyIncome = actual.filter((tx) => tx.kind === 'income').reduce((sum, tx) => sum + tx.amount, 0);
  const monthlyExpense = actual.filter((tx) => tx.kind === 'expense').reduce((sum, tx) => sum + tx.amount, 0);
  const monthlyInvested = actual.filter((tx) => tx.kind === 'investment').reduce((sum, tx) => sum + tx.amount, 0);
  const end = addDays(today, 30);
  const upcoming = (state.plans || []).filter((item) => item.date >= today && item.date <= end)
    .map((item) => ({ ...item, originalAmount: item.amount, amount: Math.max(0, item.amount - (item.settledAmount || 0)) }))
    .filter((item) => item.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  const dueNext30 = upcoming.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amount, 0);
  const plannedIncome = upcoming.filter((item) => item.kind === 'income').reduce((sum, item) => sum + item.amount, 0);
  const forecastNext30 = balances.liquidCash + plannedIncome - dueNext30;
  // Conservative by design: uncertain future income does not raise the amount available today.
  const safeToSpend = Math.max(0, balances.liquidCash - dueNext30 - Math.max(0, state.settings?.buffer || 0));
  const issues = [];
  if (forecastNext30 < 0) issues.push('Số dư tiền dự kiến âm trong 30 ngày tới.');
  for (const card of state.cards || []) {
    const debt = Math.max(0, -(balances.accounts[card.accountId] || 0));
    const cardPlanned = upcoming.filter((item) => item.cardId === card.id && item.kind === 'expense')
      .reduce((sum, item) => sum + item.amount, 0);
    if (debt > 0 && cardPlanned === 0) {
      issues.push(`Chưa có khoản trả dự kiến cho ${card.name} trong 30 ngày tới.`);
    } else if (debt > cardPlanned) {
      issues.push(`Dư nợ ${card.name} lớn hơn khoản trả đã lên lịch; hãy kiểm tra kỳ sao kê và cập nhật kế hoạch.`);
    }
  }
  for (const tx of state.transactions || []) {
    if (tx.kind === 'transfer' && !tx.planId && tx.date.startsWith(month)
        && (state.cards || []).some((card) => card.accountId === tx.toAccountId
          && upcoming.some((plan) => plan.cardId === card.id))) {
      issues.push('Có lần trả thẻ chưa gắn với Lịch tiền; dự báo có thể trừ khoản này thêm lần nữa.');
      break;
    }
  }
  return { balances, monthlyIncome, monthlyExpense, monthlyInvested, dueNext30, forecastNext30, safeToSpend, issues, upcoming };
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') {
      if (field) throw new Error('Dấu nháy CSV không hợp lệ.');
      inQuotes = true;
    } else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (inQuotes) throw new Error('CSV có dấu nháy chưa đóng.');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((item) => item.some((cell) => cell.trim() !== ''));
}

const normalize = (value) => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const keyOf = (tx) => [tx.date, tx.kind, tx.amount, tx.accountId || '', tx.fromAccountId || '', tx.toAccountId || '', tx.assetId || '', tx.planId || '', normalize(tx.category), normalize(tx.note)].join('|');
const resolveId = (items, reference) => items.find((item) => normalize(item.id) === normalize(reference) || normalize(item.name) === normalize(reference))?.id;

export function importTransactionsCsv(state, csvText, options = {}) {
  let rows;
  try { rows = parseCsv(csvText); }
  catch (error) { return { state, imported: 0, skipped: 0, duplicates: [], errors: [{ row: 0, message: error.message }] }; }
  if (rows.length < 2) return { state, imported: 0, skipped: 0, duplicates: [], errors: [{ row: 1, message: 'CSV cần hàng tiêu đề và ít nhất một giao dịch.' }] };
  const headers = rows[0].map((h) => h.trim());
  if (new Set(headers).size !== headers.length || headers.some((h) => !h)) {
    return { state, imported: 0, skipped: 0, duplicates: [], errors: [{ row: 1, message: 'Tiêu đề CSV bị trùng hoặc để trống.' }] };
  }
  if (!['date', 'kind', 'amount'].every((h) => headers.includes(h))) {
    return { state, imported: 0, skipped: 0, duplicates: [], errors: [{ row: 1, message: 'CSV cần cột date, kind, amount và mỗi hàng là một giao dịch. Bảng tổng quan chưa đủ để nhập.' }] };
  }
  let next = state, imported = 0, skipped = 0;
  const errors = [], duplicates = [];
  const seen = new Set((state.transactions || []).map(keyOf));
  for (let index = 1; index < rows.length; index++) {
    if (rows[index].length !== headers.length) {
      errors.push({ row: index + 1, message: `Số cột không khớp tiêu đề (${rows[index].length}/${headers.length}).` });
      continue;
    }
    const values = Object.fromEntries(headers.map((h, i) => [h, (rows[index][i] || '').trim()]));
    const amount = Number(values.amount?.replace(/\s/g, ''));
    const input = {
      date: values.date,
      kind: normalize(values.kind),
      amount,
      accountId: resolveId(state.accounts || [], values.accountId),
      fromAccountId: resolveId(state.accounts || [], values.fromAccountId),
      toAccountId: resolveId(state.accounts || [], values.toAccountId),
      assetId: resolveId(state.assets || [], values.assetId),
      planId: state.plans?.find((item) => normalize(item.id) === normalize(values.planId) || normalize(item.label) === normalize(values.planId))?.id,
      category: values.category || 'Khác',
      note: values.note || '',
    };
    if (values.planId && !input.planId) {
      errors.push({ row: index + 1, message: 'Không tìm thấy khoản dự kiến trong cột planId.' });
      continue;
    }
    const check = validateTransaction(next, input);
    if (!check.ok) { errors.push({ row: index + 1, message: check.errors.join(' ') }); continue; }
    const key = keyOf(input);
    if (seen.has(key) && !options.allowDuplicateRows?.includes(index + 1)) {
      skipped++;
      duplicates.push({ row: index + 1, message: 'Giao dịch giống một dòng đã có; kiểm tra trước khi nhập thêm.' });
      continue;
    }
    next = createTransaction(next, input);
    seen.add(key);
    imported++;
  }
  return { state: next, imported, skipped, duplicates, errors };
}

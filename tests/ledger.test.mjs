import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBalances,
  calculateDashboard,
  createTransaction,
  addDays,
  importTransactionsCsv,
  localDate,
  updateAssetValue,
  validateTransaction,
} from '../ledger.js';

const today = '2026-09-30';

function state(overrides = {}) {
  return {
    accounts: [
      { id: 'bank-main', name: 'Ngân hàng chính', type: 'cash', openingBalance: 10_000_000 },
      { id: 'bank-extra', name: 'Ngân hàng phụ', type: 'cash', openingBalance: 1_000_000 },
      { id: 'card', name: 'Thẻ tín dụng', type: 'credit', openingBalance: 0 },
    ],
    assets: [
      { id: 'fund', name: 'Quỹ', type: 'fund', costBasis: 0, currentValue: 0, asOf: '2026-09-29' },
    ],
    cards: [{ id: 'credit-card', name: 'Thẻ tín dụng', accountId: 'card' }],
    transactions: [],
    plans: [],
    settings: { buffer: 0 },
    ...overrides,
  };
}

function transaction(kind, amount, fields = {}) {
  return { id: `${kind}-${amount}-${Object.keys(fields).join('-')}`, date: today, kind, amount, ...fields };
}

test('mua bằng thẻ rồi trả thẻ chỉ tạo một khoản chi tiêu', () => {
  const initial = state();
  const purchase = createTransaction(initial, transaction('expense', 1_000_000, { accountId: 'card', category: 'Ăn uống' }));
  const paid = createTransaction(purchase, transaction('transfer', 1_000_000, {
    fromAccountId: 'bank-main', toAccountId: 'card', category: 'Trả thẻ',
  }));
  const report = calculateDashboard(paid, today);

  assert.equal(report.monthlyExpense, 1_000_000);
  assert.equal(report.monthlyIncome, 0);
  assert.equal(report.balances.accounts['bank-main'], 9_000_000);
  assert.equal(report.balances.accounts.card, 0);
  assert.equal(report.balances.creditDebt, 0);
  assert.equal(report.balances.netWorth, 10_000_000);
  assert.equal(initial.transactions.length, 0);
});

test('chuyển giữa hai tài khoản giữ nguyên tiền tổng, chi tiêu và tài sản ròng', () => {
  const transferred = createTransaction(state(), transaction('transfer', 2_000_000, {
    fromAccountId: 'bank-main', toAccountId: 'bank-extra',
  }));
  const report = calculateDashboard(transferred, today);

  assert.equal(report.balances.accounts['bank-main'], 8_000_000);
  assert.equal(report.balances.accounts['bank-extra'], 3_000_000);
  assert.equal(report.balances.liquidCash, 11_000_000);
  assert.equal(report.balances.netWorth, 11_000_000);
  assert.equal(report.monthlyIncome, 0);
  assert.equal(report.monthlyExpense, 0);
});

test('thẻ dư có và tài khoản tiền âm được tách đúng giữa tài sản và nợ', () => {
  const balances = calculateBalances(state({
    accounts: [
      { id: 'cash-a', name: 'Ngân hàng', type: 'cash', openingBalance: 10_000_000 },
      { id: 'cash-b', name: 'Tài khoản âm', type: 'cash', openingBalance: -1_000_000 },
      { id: 'credit-a', name: 'Thẻ còn nợ', type: 'credit', openingBalance: -5_000_000 },
      { id: 'credit-b', name: 'Thẻ dư có', type: 'credit', openingBalance: 2_000_000 },
    ],
    assets: [], cards: [],
  }));

  assert.equal(balances.liquidCash, 9_000_000);
  assert.equal(balances.creditDebt, 5_000_000);
  assert.equal(balances.totalAssets, 12_000_000);
  assert.equal(balances.totalLiabilities, 6_000_000);
  assert.equal(balances.netWorth, 6_000_000);
});

test('góp vốn đầu tư giảm tiền dùng và tăng tài sản tại giá vốn, không tăng chi tiêu', () => {
  const invested = createTransaction(state(), transaction('investment', 5_000_000, {
    fromAccountId: 'bank-main', assetId: 'fund',
  }));
  const report = calculateDashboard(invested, today);

  assert.equal(report.balances.liquidCash, 6_000_000);
  assert.deepEqual(report.balances.assets.fund, { costBasis: 5_000_000, currentValue: 5_000_000 });
  assert.equal(report.balances.netWorth, 11_000_000);
  assert.equal(report.monthlyExpense, 0);
  assert.equal(report.monthlyInvested, 5_000_000);
});

test('định giá thủ công đã bao gồm khoản góp trước ngày định giá', () => {
  const initial = state({
    assets: [{ id: 'fund', name: 'Quỹ', type: 'fund', costBasis: 4_000_000, currentValue: 9_000_000, asOf: today }],
    transactions: [transaction('investment', 5_000_000, { date: '2026-09-29', fromAccountId: 'bank-main', assetId: 'fund' })],
  });
  const balances = calculateBalances(initial);

  assert.equal(balances.assets.fund.costBasis, 9_000_000);
  assert.equal(balances.assets.fund.currentValue, 9_000_000);
});

test('dự báo cộng thu dự kiến, trừ khoản đến hạn và giữ quỹ dự phòng', () => {
  const initial = state({
    plans: [
      { id: 'due-today', label: 'Trả hóa đơn', date: today, kind: 'expense', amount: 1_000_000 },
      { id: 'due-day-30', label: 'Trả thẻ', date: '2026-10-30', kind: 'expense', amount: 2_000_000, cardId: 'credit-card' },
      { id: 'salary', label: 'Lương dự kiến', date: '2026-10-15', kind: 'income', amount: 5_000_000 },
      { id: 'later', label: 'Tháng sau', date: '2026-10-31', kind: 'expense', amount: 9_000_000 },
    ],
    settings: { buffer: 3_000_000 },
  });
  const report = calculateDashboard(initial, today);

  assert.equal(report.dueNext30, 3_000_000);
  assert.equal(report.forecastNext30, 13_000_000);
  assert.equal(report.safeToSpend, 5_000_000);
  assert.equal(report.upcoming.length, 3);
});

test('cảnh báo khi khoản trả thẻ đã lên lịch thấp hơn dư nợ đã ghi', () => {
  const initial = state({
    accounts: [
      { id: 'bank-main', name: 'Ngân hàng chính', type: 'cash', openingBalance: 10_000_000 },
      { id: 'card', name: 'Thẻ tín dụng', type: 'credit', openingBalance: -4_200_000 },
    ],
    plans: [{
      id: 'pay-card', label: 'Trả thẻ', date: '2026-10-06', kind: 'expense',
      amount: 3_200_000, accountId: 'bank-main', cardId: 'credit-card',
    }],
  });
  const report = calculateDashboard(initial, today);

  assert.equal(report.balances.creditDebt, 4_200_000);
  assert.equal(report.dueNext30, 3_200_000);
  assert.ok(report.issues.some((issue) => issue.includes('Thẻ tín dụng')));
});

test('trả thẻ gắn với khoản dự kiến không bị trừ lần thứ hai trong dự báo', () => {
  const initial = state({
    accounts: [
      { id: 'bank-main', name: 'Ngân hàng chính', type: 'cash', openingBalance: 10_000_000 },
      { id: 'card', name: 'Thẻ tín dụng', type: 'credit', openingBalance: -3_200_000 },
    ],
    plans: [{
      id: 'pay-card', label: 'Trả thẻ', date: '2026-10-06', kind: 'expense',
      amount: 3_200_000, accountId: 'bank-main', cardId: 'credit-card',
    }],
  });
  const paid = createTransaction(initial, transaction('transfer', 3_200_000, {
    fromAccountId: 'bank-main', toAccountId: 'card', planId: 'pay-card',
  }));
  const report = calculateDashboard(paid, today);

  assert.equal(report.balances.liquidCash, 6_800_000);
  assert.equal(report.balances.creditDebt, 0);
  assert.equal(report.dueNext30, 0);
  assert.equal(report.forecastNext30, 6_800_000);
  assert.equal(report.monthlyExpense, 0);
});

test('trả một phần lịch thẻ giữ phần còn lại trong dự báo và chặn trả vượt lịch', () => {
  const initial = state({
    accounts: [
      { id: 'bank-main', name: 'Ngân hàng chính', type: 'cash', openingBalance: 10_000_000 },
      { id: 'card', name: 'Thẻ tín dụng', type: 'credit', openingBalance: -3_200_000 },
    ],
    plans: [{
      id: 'pay-card', label: 'Trả thẻ', date: '2026-10-06', kind: 'expense',
      amount: 3_200_000, accountId: 'bank-main', cardId: 'credit-card',
    }],
  });
  const partial = createTransaction(initial, transaction('transfer', 1_000_000, {
    fromAccountId: 'bank-main', toAccountId: 'card', planId: 'pay-card',
  }));
  const report = calculateDashboard(partial, today);

  assert.equal(report.balances.liquidCash, 9_000_000);
  assert.equal(report.balances.creditDebt, 2_200_000);
  assert.equal(report.dueNext30, 2_200_000);
  assert.equal(report.forecastNext30, 6_800_000);
  assert.throws(() => createTransaction(partial, transaction('transfer', 2_300_000, {
    fromAccountId: 'bank-main', toAccountId: 'card', planId: 'pay-card',
  })));
});

test('giá trị tài sản cập nhật không sửa trạng thái cũ và kiểm tra giá trị đầu vào', () => {
  const initial = state();
  const updated = updateAssetValue(initial, 'fund', 7_500_000, today);

  assert.equal(initial.assets[0].currentValue, 0);
  assert.equal(initial.assets[0].asOf, '2026-09-29');
  assert.equal(updated.assets[0].currentValue, 7_500_000);
  assert.equal(updated.assets[0].asOf, today);
  assert.notEqual(updated.assets[0], initial.assets[0]);
  assert.throws(() => updateAssetValue(initial, 'fund', -1, today));
  assert.throws(() => updateAssetValue(initial, 'fund', 1, '2026-02-30'));
  assert.throws(() => updateAssetValue(initial, 'fund', 1, addDays(localDate(), 1)));
});

test('không chấp nhận ngày, số tiền, tài khoản và chuyển khoản sai', () => {
  const initial = state();
  const invalidInputs = [
    transaction('expense', -1, { accountId: 'bank-main' }),
    transaction('expense', 1.5, { accountId: 'bank-main' }),
    transaction('expense', Number.POSITIVE_INFINITY, { accountId: 'bank-main' }),
    transaction('expense', 1, { date: '2026-02-30', accountId: 'bank-main' }),
    transaction('expense', 1, { accountId: 'missing' }),
    transaction('income', 1, { accountId: 'card' }),
    transaction('transfer', 1, { fromAccountId: 'bank-main', toAccountId: 'bank-main' }),
    transaction('investment', 1, { fromAccountId: 'card', assetId: 'fund' }),
  ];

  for (const input of invalidInputs) {
    assert.equal(validateTransaction(initial, input).ok, false, JSON.stringify(input));
    assert.throws(() => createTransaction(initial, input), undefined, JSON.stringify(input));
  }
  assert.equal(initial.transactions.length, 0);
});

test('giao dịch thực tế không thể mang ngày trong tương lai', () => {
  const initial = state();
  const future = transaction('expense', 100_000, {
    date: addDays(localDate(), 1), accountId: 'bank-main',
  });
  assert.equal(validateTransaction(initial, future).ok, false);
  assert.throws(() => createTransaction(initial, future));
});

test('nhập CSV bỏ qua trùng và chỉ lưu các dòng hợp lệ', () => {
  const csv = [
    'date,kind,amount,accountId,category,note',
    '2026-09-30,expense,100000,bank-main,Ăn uống,Bữa trưa',
    '2026-09-30,expense,100000,bank-main,Ăn uống,Bữa trưa',
    '2026-02-30,expense,200000,bank-main,Ăn uống,Ngày sai',
    '2026-09-30,income,300000,bank-main,Lương,Thưởng',
  ].join('\n');
  const initial = state();
  const result = importTransactionsCsv(initial, csv);

  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.errors.map((error) => error.row), [4]);
  assert.deepEqual(result.duplicates.map((item) => item.row), [3]);
  assert.equal(result.state.transactions.length, 2);
  assert.equal(initial.transactions.length, 0);
  assert.equal(calculateDashboard(result.state, today).monthlyExpense, 100_000);
});

test('CSV dư cột hoặc trùng tên cột không âm thầm tạo giao dịch', () => {
  const initial = state();
  const extraColumn = [
    'date,kind,amount,accountId,note',
    '2026-09-30,expense,1000,bank-main,Mua hàng,giá trị bị mất',
  ].join('\n');
  const repeatedHeader = [
    'date,kind,amount,accountId,amount',
    '2026-09-30,expense,1000,bank-main,2000',
  ].join('\n');
  for (const csv of [extraColumn, repeatedHeader]) {
    const result = importTransactionsCsv(initial, csv);
    assert.equal(result.imported, 0);
    assert.equal(result.state.transactions.length, 0);
    assert.ok(result.errors.length > 0);
  }
});

test('CSV có mã lịch trả thẻ không tồn tại bị báo theo dòng', () => {
  const initial = state();
  const csv = [
    'date,kind,amount,fromAccountId,toAccountId,planId',
    '2026-09-30,transfer,100000,bank-main,card,missing-plan',
  ].join('\n');
  const result = importTransactionsCsv(initial, csv);

  assert.equal(result.imported, 0);
  assert.deepEqual(result.errors.map((error) => error.row), [2]);
  assert.equal(result.state.transactions.length, 0);
});

test('CSV hỏng cấu trúc không làm thay đổi sổ', () => {
  const initial = state();
  const invalidCsv = [
    'date,kind,amount,accountId\n2026-09-30,expense,"123,bank-main',
    'Loại,Ngày,Số tiền\nChi,2026-09-30,100000',
  ];
  for (const csv of invalidCsv) {
    const result = importTransactionsCsv(initial, csv);
    assert.equal(result.imported, 0);
    assert.equal(result.state, initial);
    assert.ok(result.errors.length > 0);
  }
});

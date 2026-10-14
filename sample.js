import { addDays, localDate } from './ledger.js';

// Fictional values only. Neither of the user's summary CSV files is loaded here.
export function createDemoState(today = localDate()) {
  const before = (days) => addDays(today, -days);
  const after = (days) => addDays(today, days);
  return {
    version: 1,
    demo: true,
    accounts: [
      { id: 'bank-main', name: 'Tài khoản thanh toán', type: 'cash', openingBalance: 22000000 },
      { id: 'bank-extra', name: 'Tài khoản dự phòng', type: 'cash', openingBalance: 8500000 },
      { id: 'cash', name: 'Tiền mặt', type: 'cash', openingBalance: 1200000 },
      { id: 'card-hsbc', name: 'Thẻ HSBC', type: 'credit', openingBalance: -2400000 },
      { id: 'card-sc', name: 'Thẻ Standard Chartered', type: 'credit', openingBalance: -1100000 },
    ],
    cards: [
      { id: 'hsbc', name: 'HSBC', accountId: 'card-hsbc', statementDay: 22, dueDay: 12, limit: 40000000 },
      { id: 'sc', name: 'Standard Chartered', accountId: 'card-sc', statementDay: 18, dueDay: 8, limit: 30000000 },
    ],
    assets: [
      { id: 'savings', name: 'Tiết kiệm', type: 'savings', costBasis: 80000000, currentValue: 81200000, asOf: before(10) },
      { id: 'gold', name: 'Vàng', type: 'gold', costBasis: 25000000, currentValue: 26700000, asOf: before(10) },
      { id: 'property', name: 'Bất động sản', type: 'property', costBasis: 450000000, currentValue: 465000000, asOf: before(10) },
      { id: 'fund', name: 'Chứng chỉ quỹ', type: 'fund', costBasis: 39000000, currentValue: 41700000, asOf: before(10) },
      { id: 'stock', name: 'Cổ phiếu', type: 'stock', costBasis: 28000000, currentValue: 26400000, asOf: before(10) },
    ],
    transactions: [
      { id: 'demo-income', date: before(8), kind: 'income', amount: 30000000, accountId: 'bank-main', category: 'Lương', note: 'Thu nhập mẫu' },
      { id: 'demo-rent', date: before(6), kind: 'expense', amount: 6500000, accountId: 'bank-main', category: 'Nhà ở', note: 'Tiền thuê nhà mẫu' },
      { id: 'demo-food', date: before(4), kind: 'expense', amount: 800000, accountId: 'card-hsbc', category: 'Ăn uống', note: 'Chi bằng thẻ mẫu' },
      { id: 'demo-travel', date: before(3), kind: 'expense', amount: 400000, accountId: 'card-sc', category: 'Di chuyển', note: 'Chi bằng thẻ mẫu' },
      { id: 'demo-invest', date: before(2), kind: 'investment', amount: 2000000, fromAccountId: 'bank-main', assetId: 'fund', category: 'Đầu tư', note: 'Chuyển vào quỹ mẫu' },
      { id: 'demo-transfer', date: before(1), kind: 'transfer', amount: 1500000, fromAccountId: 'bank-main', toAccountId: 'bank-extra', category: 'Chuyển nội bộ', note: 'Chuyển khoản mẫu' },
    ],
    plans: [
      { id: 'plan-hsbc', label: 'Thanh toán thẻ HSBC', date: after(6), kind: 'expense', amount: 3200000, accountId: 'bank-main', cardId: 'hsbc' },
      { id: 'plan-sc', label: 'Thanh toán thẻ Standard Chartered', date: after(11), kind: 'expense', amount: 1500000, accountId: 'bank-main', cardId: 'sc' },
      { id: 'plan-utilities', label: 'Điện, nước, Internet', date: after(15), kind: 'expense', amount: 1800000, accountId: 'bank-main' },
      { id: 'plan-salary', label: 'Lương kỳ tới', date: after(26), kind: 'income', amount: 30000000, accountId: 'bank-main' },
    ],
    settings: { buffer: 10000000 },
  };
}

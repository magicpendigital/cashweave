import test from 'node:test';
import assert from 'node:assert/strict';
import { queryActualLedger, accountTimeline } from '../reporting.js';
import { createMoneyFormatter } from '../money-format.js';

const fixture = () => ({ accounts: [{ id: 'a', openingBalance: 1000 }, { id: 'b', openingBalance: 0 }], transactions: [
  { id: 'before', date: '2026-09-30', kind: 'income', accountId: 'a', amount: 100 },
  { id: 'income', date: '2026-10-01', kind: 'income', accountId: 'a', amount: 500 },
  { id: 'expense', date: '2026-10-02', kind: 'expense', accountId: 'a', amount: 200 },
  { id: 'transfer', date: '2026-10-03', kind: 'transfer', fromAccountId: 'a', toAccountId: 'b', amount: 100 },
  { id: 'invest', date: '2026-10-04', kind: 'investment', fromAccountId: 'a', assetId: 'asset', amount: 50 },
  { id: 'after', date: '2026-11-01', kind: 'income', accountId: 'a', amount: 999 },
] });

test('card/drilldown query uses inclusive period and identical subtotal without mutating state', () => {
  const state = fixture(), before = structuredClone(state);
  const query = { from: '2026-10-01', to: '2026-10-31', kind: 'income', accountId: 'a' };
  const result = queryActualLedger(state, query);
  assert.deepEqual(result.rows.map(t => t.id), ['income']);
  assert.equal(result.subtotal, 500);
  assert.equal(result.subtotal, result.rows.reduce((sum, row) => sum + row.amount, 0));
  result.rows[0].amount = 0;
  assert.deepEqual(state, before);
});
test('account period opening includes history and closing includes every movement kind', () => {
  const timeline = accountTimeline(fixture(), { from: '2026-10-01', to: '2026-10-31', accountId: 'a' });
  assert.equal(timeline.opening, 1100);
  assert.deepEqual(timeline.rows.map(t => t.movement), [500, -200, -100, -50]);
  assert.equal(timeline.closing, 1250);
  assert.equal(timeline.opening + timeline.rows.reduce((s, t) => s + t.movement, 0), timeline.closing);
  assert.equal(accountTimeline(fixture(), { to: '2026-10-31', accountId: 'b' }).closing, 100);
});
test('invalid periods/accounts and filtered balance timelines fail explicitly', () => {
  assert.throws(() => queryActualLedger(fixture(), { from: '2026-02-30' }), /Invalid/);
  assert.throws(() => queryActualLedger(fixture(), { from: '2026-11-01', to: '2026-10-01' }), /reversed/);
  assert.throws(() => queryActualLedger(fixture(), { accountId: 'missing' }), /Unknown/);
  assert.throws(() => accountTimeline(fixture(), { accountId: 'a', kind: 'expense' }), /all movement/);
});
test('currency formatter groups thousands, defaults to VND and supports another currency', () => {
  assert.equal(createMoneyFormatter()(1234567), new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', useGrouping: true }).format(1234567));
  assert.equal(createMoneyFormatter({ locale: 'en-US', currency: 'USD' })(1234.5), '$1,234.50');
  assert.throws(() => createMoneyFormatter()(NaN), /Invalid/);
});

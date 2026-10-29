// Track C (independent QA) UI checks through the synthetic DOM harness (no browser layout/IndexedDB claim).
// Tests named "QA-xx ..." expose an open finding and are EXPECTED TO FAIL until it is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { nextHarness } from './next-ui-harness.mjs';
import { accountBalance, envelopeBalance, validateSnapshot } from '../core/model.js';
import { translator, errorMessage } from '../ui/i18n.js';
const t = translator();
const formValues = (h, id) => Object.fromEntries(new h.browser.FormData(h.get(id)));
async function ready(opening = '5.000.000') { const h = await nextHarness(); await h.app.go('create'); await h.submit('onboard-form', { locale: 'vi-VN', currencyCode: 'VND', timezoneId: 'Asia/Ho_Chi_Minh', name: 'Synthetic bank', accountType: 'BANK', opening, openingDate: '2026-10-01' }); return h; }
async function withBroker() {
  const h = await ready();
  await h.app.go('accounts/new');
  await h.submit('account-form', { name: 'Synthetic brokerage', accountType: 'INVESTMENT', currencyCode: 'VND', opening: '0', openingDate: '2026-10-01' });
  return { h, broker: h.app.snapshot().accounts[1] };
}

test('QA-05 price update: a Vietnamese-grouped quantity "1.000" is read like the price field (fails today: recorded as 1 unit)', async () => {
  const { h, broker } = await withBroker();
  await h.app.go('assets/update');
  // Same row, same locale: price "25.000" is parsed as 25,000 ₫ but quantity "1.000" as 1.
  h.setForm('price-form', { ['symbol-' + broker.id + '-0']: 'VNM', ['qty-' + broker.id + '-0']: '1.000', ['price-' + broker.id + '-0']: '25.000' });
  await h.submit('price-form', formValues(h, 'price-form'));
  const s = h.app.snapshot();
  assert.equal(s.valuations.length, 1);
  assert.equal(s.valuations[0].valueMinor, '25000000', '1.000 shares x 25.000 ₫ in vi-VN notation');
  h.app.close();
});

test('QA-06 price update: a holding typed without a symbol is either saved or reported, never silently dropped (fails today)', async () => {
  const { h, broker } = await withBroker();
  await h.app.go('assets/update');
  h.setForm('price-form', { ['qty-' + broker.id + '-0']: '10', ['price-' + broker.id + '-0']: '100.000' });
  // The live total already shows the 1.000.000 ₫ the user typed.
  const result = await h.submit('price-form', formValues(h, 'price-form'));
  const s = h.app.snapshot();
  const reported = !!result?.error || h.root.querySelector('[role="alert"]') !== null;
  assert.ok(s.valuations.length === 1 || reported, `valuations=${s.valuations.length}, route=${h.app.currentRoute()}, feedback shown=${reported}`);
  h.app.close();
});

test('QA-07 new core error codes have specific Vietnamese messages (fails today: all fall back to genericError)', () => {
  const generic = t('genericError');
  const unmapped = ['REVERSAL_BEFORE_LINK', 'VALUATION_DATE_IN_FUTURE', 'VALUATION_TOTAL_MISMATCH', 'INVALID_VALUATION_QUANTITY', 'INVALID_VALUATION_PRICE', 'INVALID_VALUATION_LINE', 'VALUATION_REQUIRES_INVESTMENT_ACCOUNT', 'UNKNOWN_RECIPE_PRESET', 'INVALID_SPEND_LINKS']
    .filter(code => errorMessage(new Error(code), t) === generic);
  assert.deepEqual(unmapped, []);
});

test('QA-01 (UI path) editing the date of an envelope-linked expense to an earlier day is accepted (fails today)', async () => {
  const h = await ready('0');
  const bank = h.app.snapshot().accounts[0].id;
  await h.app.perform('recordActual', { operationType: 'INCOME', accountId: bank, amountMinor: '1000000', effectiveLocalDate: '2026-10-01' });
  const pool = h.app.snapshot().budgetPools[0].id;
  await h.app.perform('addEnvelope', { name: 'Synthetic food', budgetPoolId: pool });
  let s = h.app.snapshot(); const envelope = s.envelopes[0].id;
  const [, versionId] = (await h.app.perform('saveTemplate', { name: 'All', currencyCode: 'VND', fixedScope: 'PER_APPLICATION', lines: [{ envelopeId: envelope, type: 'PERCENT', percentageBps: 10000, priority: 1 }] })).resultIds;
  await h.app.go('allocations/new/' + versionId);
  await h.submit('allocation-form', { ...formValues(h, 'allocation-form'), amount: '1.000.000', date: '2026-10-01' });
  await h.get('allocation-confirm').click();
  const expense = (await h.app.perform('recordActual', { operationType: 'EXPENSE', accountId: bank, amountMinor: '300000', effectiveLocalDate: '2026-10-20' })).resultIds;
  await h.app.perform('linkExpense', { expensePostingId: expense[1], envelopeId: envelope, amountMinor: '300000', effectiveLocalDate: '2026-10-20' });
  await h.app.go('transactions/' + expense[0]);
  const result = await h.submit('correct-form', { ...formValues(h, 'correct-form'), date: '2026-10-15' });
  s = h.app.snapshot();
  assert.equal(result?.error, undefined, 'edit rejected with ' + result?.error + ' shown as "' + errorMessage(new Error(result?.error), t) + '"');
  assert.equal(envelopeBalance(s, envelope), '700000');
  h.app.close();
});

// ---------------------------------------------------------------- verified behaviour (regressions)

test('QA regression: new UI modules have no HTML-string sinks, eval or network APIs', async () => {
  const files = ['ui/app.js', 'ui/dom.js', 'ui/features.js', 'ui/i18n.js', ...(await readdir('ui/screens')).map(f => 'ui/screens/' + f)];
  for (const file of files) {
    const source = (await readFile(file, 'utf8')).replaceAll('http://www.w3.org/2000/svg', 'SVG_NS');
    for (const pattern of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /new Function/, /\bfetch\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /\bimport\(/, /https?:\/\//])
      assert.doesNotMatch(source, pattern, file + ' ' + pattern);
  }
});

test('QA regression: hostile names and memos render as inert text on every main screen', async () => {
  const h = await ready('1.000');
  const evil = '<img src=x onerror=alert(1)>';
  const bank = h.app.snapshot().accounts[0].id, pool = h.app.snapshot().budgetPools[0].id;
  await h.app.perform('addCategory', { name: evil, direction: 'EXPENSE' });
  await h.app.perform('addEnvelope', { name: evil, budgetPoolId: pool });
  await h.app.perform('addAccount', { name: evil, accountType: 'INVESTMENT', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-10-01' });
  await h.app.perform('recordActual', { operationType: 'EXPENSE', accountId: bank, amountMinor: '10', effectiveLocalDate: '2026-10-30', memo: evil, categoryId: h.app.snapshot().categories[0].id });
  const imgs = node => (node.tagName === 'IMG' ? 1 : 0) + node.children.reduce((n, c) => n + imgs(c), 0);
  for (const route of ['overview', 'transactions', 'funds', 'recipes', 'assets', 'assets/update', 'accounts', 'categories', 'reports', 'history', 'more']) {
    await h.app.go(route);
    assert.equal(imgs(h.root), 0, route);
    if (['transactions', 'funds', 'assets'].includes(route)) assert.ok(h.text().includes(evil), route + ' shows the literal text');
  }
  h.app.close();
});

test('QA regression: memoised balances and net worth refresh after every write (no stale revision data)', async () => {
  const h = await ready('1.000');
  const bank = h.app.snapshot().accounts[0].id;
  await h.app.go('assets');
  assert.match(h.root.querySelector('[data-amount="networth"]').textContent, /^1\.000\s₫$/);
  await h.app.go('transactions/new/expense');
  await h.submit('transaction-form', { operationType: 'EXPENSE', accountId: bank, amount: '400', date: '2026-10-31', memo: 'Synthetic', categoryId: '' });
  await h.app.go('assets');
  assert.match(h.root.querySelector('[data-amount="networth"]').textContent, /^600\s₫$/);
  await h.app.go('overview');
  assert.match(h.root.querySelector('[data-amount="spendable"]').textContent, /^600\s₫$/);
  assert.equal(accountBalance(validateSnapshot(h.app.snapshot()), bank), '600');
  h.app.close();
});

test('QA regression: restore accepts a file above the old 5 MiB UI limit and still stages (two-step) before activation', async () => {
  const h = await ready('1.000');
  await h.app.go('data');
  const big = { size: 6 * 1024 * 1024, text: async () => '{' };
  const input = h.get('restore-form-backupFile') || h.root.querySelector('[name="backupFile"]');
  input.files = [big];
  const result = await h.submit('restore-form', {});
  // Size gate passes; the malformed JSON is then rejected by stageRestore, and nothing is activated.
  assert.notEqual(result?.error, 'BACKUP_TOO_LARGE');
  assert.equal(h.app.snapshot().operations.length, 1);
  h.app.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inspectCompatibilityBook, preserveCompatibilityBook, createEmptyCompatibilityBook, addCompatibilityAsset, correctCompatibilityTransaction } from '../compatibility.js';
import { storageKey, exportBackup, parseBackup } from '../storage.js';
import { createDemoState } from '../sample.js';
import { createTransaction, calculateBalances, localDate } from '../ledger.js';
import { createIncomeWithAllocation, previewAllocation, BUILTIN_TEMPLATES, linkBudgetExpense } from '../budgeting.js';
import { harness } from './ui-harness.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
function storageFixture(initial = null, failAt = 0) {
  const values = new Map(initial === null ? [] : [[storageKey, initial]]); let writes = 0, queue = Promise.resolve();
  const storage = { getItem: key => values.get(key) ?? null, setItem(key, value) { if (++writes === failAt) throw new Error('QuotaExceeded synthetic'); values.set(key, value); } };
  const locks = { request(_name, _mode, callback) { const next = queue.then(callback); queue = next.catch(() => {}); return next; } };
  return { storage, locks, values };
}
const legacy = () => inspectCompatibilityBook(JSON.stringify(createDemoState())).state;
const seededHarness = () => harness({ values: new Map([[storageKey, JSON.stringify(legacy())]]) });
function configureNative(app, services = {}) {
  vm.runInContext("modules['legacy-platform.js']", app.context).configureLegacyServices({ native: true, ...services });
  return vm.runInContext("modules['app.js']", app.context);
}

test('compatibility import retains raw source, prior book, cards/assets/balances and never merges two books', async () => {
  const first = legacy(), rawFirst = JSON.stringify(first), second = legacy(); second.accounts[0].name = 'Second fictional bank'; second.transactions = [];
  const raw = exportBackup(second), fixture = storageFixture(rawFirst);
  fixture.values.set('unrelated-modern-book-marker', 'unchanged');
  const result = await preserveCompatibilityBook(raw, { ...fixture, acknowledge: true, expectedRaw: rawFirst });
  const imported = inspectCompatibilityBook(fixture.values.get(storageKey));
  assert.equal(imported.counts.transactions, 0); assert.equal(imported.counts.cards, 2); assert.equal(imported.counts.assets, 5);
  assert.deepEqual(imported.balances, calculateBalances(second));
  assert.equal(fixture.values.get(storageKey + '-import-source-' + result.recoveryId), raw);
  assert.equal(fixture.values.get(storageKey + '-before-import-' + result.recoveryId), rawFirst);
  assert.equal(fixture.values.get('unrelated-modern-book-marker'), 'unchanged');
  assert.equal(imported.state.accounts[0].name, 'Second fictional bank');
});

test('compatibility quota failure at any recovery or activation write leaves active book intact', async () => {
  const original = JSON.stringify(legacy()), incoming = exportBackup(createEmptyCompatibilityBook());
  for (const failAt of [1, 2, 3]) {
    const fixture = storageFixture(original, failAt);
    await assert.rejects(preserveCompatibilityBook(incoming, { ...fixture, acknowledge: true, expectedRaw: original }), /QuotaExceeded/);
    assert.equal(fixture.values.get(storageKey), original);
  }
});

test('opening an existing compatibility book is read-only even when storage quota has no write headroom', async () => {
  const raw = JSON.stringify(legacy()), fixture = storageFixture(raw, 1);
  const before = [...fixture.values];
  for (let visit = 0; visit < 3; visit++) {
    const result = await preserveCompatibilityBook(raw, { ...fixture, acknowledge: true, expectedRaw: raw });
    assert.equal(result.unchanged, true); assert.equal(result.recoveryId, null);
  }
  assert.deepEqual([...fixture.values], before);
  await assert.rejects(preserveCompatibilityBook(raw, { ...fixture, acknowledge: true, expectedRaw: 'stale' }), /REVISION_CONFLICT/);
});

test('compatibility import serializes competing writers and rejects stale source or missing lock/ack', async () => {
  const raw = JSON.stringify(legacy()), fixture = storageFixture(raw), next = exportBackup(createEmptyCompatibilityBook());
  await assert.rejects(preserveCompatibilityBook(next, { ...fixture, acknowledge: false }), /CONFIRMATION/);
  await assert.rejects(preserveCompatibilityBook(next, { storage: fixture.storage, locks: null, acknowledge: true }), /STORAGE_LOCK/);
  const results = await Promise.allSettled([preserveCompatibilityBook(next, { ...fixture, expectedRaw: raw, acknowledge: true }), preserveCompatibilityBook(raw, { ...fixture, expectedRaw: raw, acknowledge: true })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /REVISION_CONFLICT/);
  assert.equal(inspectCompatibilityBook(fixture.values.get(storageKey)).counts.accounts, 0);
});

test('compatibility empty book is genuinely empty and native late setup never seeds demo data', () => {
  const empty = createEmptyCompatibilityBook();
  for (const key of ['accounts','cards','assets','transactions','plans']) assert.equal(empty[key].length, 0);
  assert.equal(empty.demo, false);
  const app = harness(); configureNative(app);
  assert.equal(app.api.getState().accounts.length, 0);
  assert.equal(app.values.has(storageKey), false);
  app.api.setView('shared'); assert.match(app.get('toast-root').innerHTML, /chưa được hỗ trợ/);
  assert.equal(app.get('shared-frame').hasAttribute('srcdoc'), false);
});

test('already-owned asset creation changes holdings, never cash or transaction counts, and has UI flow', async () => {
  const original = legacy(), before = calculateBalances(original);
  const next = addCompatibilityAsset(original, { name: 'Synthetic existing gold', type: 'gold', costBasis: 100, currentValue: 120, asOf: localDate() });
  const after = calculateBalances(next);
  assert.deepEqual(after.accounts, before.accounts); assert.equal(after.netWorth, before.netWorth + 120);
  assert.deepEqual(next.transactions, original.transactions);
  assert.throws(() => addCompatibilityAsset(original, { name: 'Future asset', type: 'gold', costBasis: 0, currentValue: 0, asOf: '9999-12-31' }), /ngày/);
  const app = seededHarness(); await app.click('add-asset');
  await app.submit('new-asset-form', { name: 'Synthetic asset', assetType: 'other', costBasis: '10', currentValue: '12', asOf: localDate() });
  assert.equal(app.api.getState().assets.length, original.assets.length + 1);
  assert.equal(app.api.getState().transactions.length, original.transactions.length);
});

test('compatibility correction preserves ID and exact original history through backup/reload and UI', async () => {
  const original = legacy(), transaction = original.transactions.find(item => item.kind === 'expense');
  const input = { amount: transaction.amount - 1, date: transaction.date, category: 'Corrected category', note: 'Corrected note', reason: 'Receipt rechecked' };
  const next = correctCompatibilityTransaction(original, transaction.id, input);
  assert.equal(next.transactions.length, original.transactions.length);
  assert.equal(next.transactions.find(item => item.id === transaction.id).amount, transaction.amount - 1);
  assert.deepEqual(next.transactionCorrections[0].before, transaction);
  assert.equal(next.transactionCorrections[0].reason, input.reason);
  assert.deepEqual(inspectCompatibilityBook(exportBackup(next)).state, next);
  const app = seededHarness(); await app.click('correct-transaction', { id: transaction.id });
  await app.submit('transaction-correction-form', { ...input, amount: String(input.amount) }, { id: transaction.id });
  assert.equal(app.api.getState().transactionCorrections.length, 1);
  const reloaded = harness({ values: app.values });
  assert.equal(reloaded.api.getState().transactionCorrections[0].before.amount, transaction.amount);
  await reloaded.api.performUndo(); assert.deepEqual(plain(reloaded.api.getState().transactions), original.transactions);
});

test('compatibility correction enforces income allocation and linked-expense capacities atomically', () => {
  let state = legacy();
  state = createIncomeWithAllocation(state, { id: 'synthetic-income', kind: 'income', date: localDate(), amount: 100, accountId: 'bank-main' }, { lines: previewAllocation(100, BUILTIN_TEMPLATES[0].rows, state).lines, label: 'Synthetic allocation' });
  state = createTransaction(state, { id: 'synthetic-expense', kind: 'expense', date: localDate(), amount: 10, accountId: 'bank-main' });
  state = linkBudgetExpense(state, 'synthetic-expense', state.budgeting.funds[0].id);
  const before = plain(state);
  assert.throws(() => correctCompatibilityTransaction(state, 'synthetic-income', { amount: 1, date: localDate(), category: '', note: '', reason: 'Would break allocation' }), /phân bổ|nguồn thu/);
  assert.throws(() => correctCompatibilityTransaction(state, 'synthetic-expense', { amount: 1000, date: localDate(), category: '', note: '', reason: 'Would overspend fund' }), /quỹ/);
  assert.deepEqual(state, before);
});

test('compatibility card-payment correction reconciles plan exactly and rejects excess', () => {
  let state = legacy(); const plan = state.plans.find(item => item.cardId), card = state.cards.find(item => item.id === plan.cardId);
  state = createTransaction(state, { id: 'synthetic-payment', kind: 'transfer', date: localDate(), amount: 100, fromAccountId: plan.accountId, toAccountId: card.accountId, planId: plan.id });
  const corrected = correctCompatibilityTransaction(state, 'synthetic-payment', { amount: 90, date: localDate(), category: 'Card', note: 'Corrected', reason: 'Receipt total' });
  assert.equal(corrected.plans.find(item => item.id === plan.id).settledAmount, 90);
  assert.equal(corrected.transactions.find(item => item.id === 'synthetic-payment').planId, plan.id);
  assert.throws(() => correctCompatibilityTransaction(state, 'synthetic-payment', { amount: plan.amount + 1, date: localDate(), category: '', note: '', reason: 'Excess' }), /vượt/);
});

test('compatibility malformed correction history is rejected before import or activation', async () => {
  const original = legacy(), transaction = original.transactions[0];
  const corrected = correctCompatibilityTransaction(original, transaction.id, { amount: transaction.amount, date: transaction.date, category: '', note: 'Updated', reason: 'Memo only' });
  corrected.transactionCorrections[0].after.amount++;
  const fixture = storageFixture(JSON.stringify(original)), before = fixture.values.get(storageKey);
  assert.throws(() => inspectCompatibilityBook(JSON.stringify(corrected)), /khớp/);
  await assert.rejects(preserveCompatibilityBook(JSON.stringify(corrected), { ...fixture, acknowledge: true }), /khớp/);
  assert.equal(fixture.values.get(storageKey), before);
});

test('native backup cancelled/failed/busy/rejected never grants restore acknowledgement or browser fallback', async () => {
  for (const response of [{ status: 'cancelled' }, { status: 'failed' }, null, 'reject']) {
    const app = seededHarness(), original = plain(app.api.getState()), incoming = exportBackup(createEmptyCompatibilityBook());
    configureNative(app, { onReadBackup: async () => ({ text: incoming, size: Buffer.byteLength(incoming) }), onDownload: async () => { if (response === 'reject') throw new Error('Synthetic native failure'); return response; } });
    app.api.openRestoreModal(); await app.api.previewRestore(app.get('restore-form'));
    await app.api.downloadCurrentBackup(); app.get('restore-ack').checked = true;
    await app.api.confirmRestore();
    assert.deepEqual(plain(app.api.getState()), original);
    assert.match(app.get('form-error').innerHTML, /xuất bản sao/);
    assert.deepEqual(app.downloads, []);
  }
});

test('native confirmed write permits explicit restore and native Back closes modal then dashboard', async () => {
  const app = seededHarness(), incoming = exportBackup(createEmptyCompatibilityBook()), writes = [];
  const exported = configureNative(app, { onReadBackup: async () => ({ text: incoming, size: Buffer.byteLength(incoming) }), onDownload: async (text, filename) => { writes.push({ text, filename }); return { status: 'written', bytes: Buffer.byteLength(text) }; } });
  app.api.openRestoreModal(); await app.api.previewRestore(app.get('restore-form')); await app.api.downloadCurrentBackup();
  app.get('restore-ack').checked = true; await app.api.confirmRestore();
  assert.equal(app.api.getState().accounts.length, 0); assert.equal(writes[0].filename, 'mach-tien-backup.json');
  assert.equal(parseBackup(writes[0].text).accounts.length, 5);
  await app.click('add-account'); assert.equal(exported.handleLegacyBack(), true);
  app.api.setView('assets'); assert.equal(exported.handleLegacyBack(), true); assert.equal(exported.handleLegacyBack(), false);
  assert.deepEqual(app.downloads, []);
});

test('native pending export cannot acknowledge a different book revision after mutation', async () => {
  const app = seededHarness(); let finish;
  configureNative(app, { onDownload: () => new Promise(resolve => { finish = resolve; }) });
  const pending = app.api.downloadCurrentBackup();
  const changed = plain(app.api.getState()); changed.settings.buffer++;
  await app.api.persistAndRender(changed, 'Synthetic intervening edit');
  finish({ status: 'written' }); assert.equal(await pending, false);
  assert.match(app.get('toast-root').innerHTML, /đã đổi/);
});

test('native CSV read stages text for explicit import and cancellation does not change the book', async () => {
  const app = seededHarness(), original = plain(app.api.getState()); let reads = 0;
  configureNative(app, { onReadBackup: async () => ++reads === 1 ? null : ({ text: 'date,kind,amount,accountId\n'+localDate()+',income,100,bank-main', size: 85 }) });
  await app.click('import-csv'); await app.click('read-native-csv');
  assert.deepEqual(plain(app.api.getState()), original);
  await app.click('read-native-csv'); assert.match(app.get('csv-text').value, /income,100/);
  assert.deepEqual(plain(app.api.getState()), original);
  await app.submit('import-form', {});
  assert.equal(app.api.getState().transactions.length, original.transactions.length + 1);
});

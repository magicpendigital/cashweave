import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDataset, validateSnapshot, poolSummary, valuationLine, COLLECTIONS } from '../core/model.js';
import { createMemoryRepository } from '../core/repository.js';
import { netWorth } from '../core/reports.js';
import { exportSnapshot, stageRestore, MAX_BACKUP_BYTES } from '../core/migration.js';
import { MAX_BACKUP_BYTES as NATIVE_MAX } from '../mobile/backup-bridge.js';
import { buildSynthetic, loadCore } from '../scripts/bench-core.mjs';

const now = '2026-10-29T03:00:00.000Z';
let serial = 0;
async function send(repo, type, input, commandId = `asset-${++serial}`) { const s = await repo.readSnapshot(); return repo.runAtomicCommand({ commandId, type, input }, s.revision, { now }); }
async function base() {
  const repo = createMemoryRepository(createDataset());
  await send(repo, 'onboard', { name: 'Synthetic bank', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '10000000', openingEffectiveLocalDate: '2026-09-01' });
  return repo;
}

test('valuation line math is exact BigInt half-up rounding to minor units', () => {
  assert.equal(valuationLine({ symbol: 'VNM', quantity: '100', unitPriceMinor: '61500' }), '6150000');
  assert.equal(valuationLine({ symbol: 'FUND', quantity: '12.345', unitPriceMinor: '10' }), '123');
  assert.equal(valuationLine({ symbol: 'FUND', quantity: '0.05', unitPriceMinor: '10' }), '1');
  assert.equal(valuationLine({ symbol: 'FUND', quantity: '0.0499', unitPriceMinor: '10' }), '0');
  assert.equal(valuationLine({ symbol: 'BIG', quantity: '1234567.123456789', unitPriceMinor: '987654321' }), String((1234567123456789n * 987654321n * 2n + 10n ** 9n) / (2n * 10n ** 9n)));
  for (const quantity of ['-1', '1e3', '01', '1.', '.5', 1, '1.0000000000001']) assert.throws(() => valuationLine({ symbol: 'X', quantity, unitPriceMinor: '1' }), /INVALID_VALUATION_QUANTITY/);
  assert.throws(() => valuationLine({ symbol: ' ', quantity: '1', unitPriceMinor: '1' }), /INVALID_VALUATION_LINE/);
  assert.throws(() => valuationLine({ symbol: 'X', quantity: '1', unitPriceMinor: '-1' }), /INVALID_VALUATION_PRICE/);
  assert.throws(() => valuationLine({ symbol: 'X', quantity: '999999999999999999', unitPriceMinor: '999999999999' }), /MONEY_OUT_OF_RANGE/);
});

test('investment and e-wallet accounts: budget membership defaults, no effect on Unassigned, valuations without postings', async () => {
  const repo = await base(); let s = await repo.readSnapshot(); const pool = s.budgetPools[0].id, bank = s.accounts[0].id;
  const before = poolSummary(s, pool);
  const [invest] = (await send(repo, 'addAccount', { name: 'Synthetic fund', accountType: 'INVESTMENT', currencyCode: 'VND', openingAmountMinor: '50000000', openingEffectiveLocalDate: '2026-09-01' })).resultIds;
  const [wallet] = (await send(repo, 'addAccount', { name: 'Synthetic wallet', accountType: 'E_WALLET', currencyCode: 'VND', openingAmountMinor: '200000', openingEffectiveLocalDate: '2026-09-01' })).resultIds;
  s = await repo.readSnapshot();
  assert.equal(s.accounts.find(a => a.id === invest).includeInBudget, false); assert.equal(s.accounts.find(a => a.id === wallet).includeInBudget, true);
  assert.equal(poolSummary(s, pool).unassigned, String(BigInt(before.unassigned) + 200000n));
  const postings = s.postings.length;
  const v = await send(repo, 'recordValuation', { accountId: invest, date: '2026-10-20', lines: [{ symbol: 'VNM', quantity: '100', unitPriceMinor: '61500' }, { symbol: 'E1VFVN30', quantity: '2500.5', unitPriceMinor: '24000' }], note: 'Synthetic' });
  s = await repo.readSnapshot(); validateSnapshot(s);
  const valuation = s.valuations.find(x => x.id === v.resultIds[0]);
  assert.equal(valuation.valueMinor, String(6150000 + 60012000)); assert.equal(s.postings.length, postings);
  assert.equal(poolSummary(s, pool).unassigned, String(BigInt(before.unassigned) + 200000n));
  await assert.rejects(send(repo, 'recordValuation', { accountId: bank, date: '2026-10-20', valueMinor: '1' }), /VALUATION_REQUIRES_INVESTMENT_ACCOUNT/);
  await assert.rejects(send(repo, 'recordValuation', { accountId: invest, date: '2026-12-01', valueMinor: '1' }), /VALUATION_DATE_IN_FUTURE/);
  await assert.rejects(send(repo, 'recordValuation', { accountId: invest, date: '2026-10-20' }), /VALUATION_VALUE_REQUIRED/);
  await assert.rejects(send(repo, 'recordValuation', { accountId: invest, date: '2026-10-20', valueMinor: '-5' }), /INVALID_VALUATION_AMOUNT/);
  await assert.rejects(send(repo, 'recordValuation', { accountId: invest, date: '2026-10-20', valueMinor: '1', lines: [{ symbol: 'A', quantity: '1', unitPriceMinor: '2' }] }), /VALUATION_TOTAL_MISMATCH/);
  await assert.rejects(send(repo, 'addAccount', { name: 'Bad', accountType: 'CREDIT', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-09-01' }), /INVALID_ACCOUNT_TYPE/);
  const forged = structuredClone(s); forged.valuations[0].valueMinor = '1'; assert.throws(() => validateSnapshot(forged), /INVALID_VALUATION/);
  const forged2 = structuredClone(s); forged2.valuations[0].accountId = bank; assert.throws(() => validateSnapshot(forged2), /INVALID_VALUATION/);
  const forged3 = structuredClone(s); forged3.valuations[0].accountId = 'missing'; assert.throws(() => validateSnapshot(forged3), /UNKNOWN_ACCOUNTS/);
});

test('netWorth totals ledger balances plus latest valuation <= date, flags stale prices and excludes investments from spendable', async () => {
  const repo = await base(); let s = await repo.readSnapshot(); const bank = s.accounts[0].id;
  const [invest] = (await send(repo, 'addAccount', { name: 'Synthetic fund', accountType: 'INVESTMENT', currencyCode: 'VND', openingAmountMinor: '50000000', openingEffectiveLocalDate: '2026-09-01' })).resultIds;
  const [usd] = (await send(repo, 'addAccount', { name: 'USD', accountType: 'BANK', currencyCode: 'USD', openingAmountMinor: '100', openingEffectiveLocalDate: '2026-09-01' })).resultIds;
  s = await repo.readSnapshot();
  let w = netWorth(s, { date: '2026-10-20' });
  assert.equal(w.totalMinor, '60000000'); assert.equal(w.spendableMinor, '10000000');
  assert.deepEqual(w.accounts.find(a => a.accountId === invest), { accountId: invest, type: 'INVESTMENT', name: 'Synthetic fund', archived: false, includeInBudget: false, valueMinor: '50000000', sinceValuationMinor: '0', ledgerMinor: '50000000', valuedAt: null, valuationId: null, stale: true });
  assert.ok(!w.accounts.some(a => a.accountId === usd));
  await send(repo, 'recordValuation', { accountId: invest, date: '2026-10-10', valueMinor: '52000000' });
  await send(repo, 'recordValuation', { accountId: invest, date: '2026-10-25', valueMinor: '55000000' });
  await send(repo, 'recordActual', { operationType: 'EXPENSE', accountId: bank, amountMinor: '1000000', effectiveLocalDate: '2026-10-21' });
  s = await repo.readSnapshot();
  w = netWorth(s, { date: '2026-10-20' });
  assert.equal(w.totalMinor, '62000000'); assert.equal(w.accounts.find(a => a.accountId === invest).valuedAt, '2026-10-10'); assert.equal(w.accounts.find(a => a.accountId === invest).stale, true);
  assert.equal(netWorth(s, { date: '2026-10-17' }).accounts.find(a => a.accountId === invest).stale, false);
  w = netWorth(s, { date: '2026-10-28', staleDays: 7 });
  assert.equal(w.totalMinor, '64000000'); assert.equal(w.spendableMinor, '9000000'); assert.equal(w.accounts.find(a => a.accountId === invest).stale, false);
  assert.deepEqual(w.groups, [{ type: 'BANK', totalMinor: '9000000' }, { type: 'INVESTMENT', totalMinor: '55000000' }]);
  assert.equal(netWorth(s, { date: '2026-10-28', currencyCode: 'USD' }).totalMinor, '100');
  assert.throws(() => netWorth(s, { date: '2026-10-28', staleDays: -1 }), /INVALID_STALE_DAYS/);
  assert.throws(() => netWorth(s, { date: '2026-13-01' }), /INVALID_LOCAL_DATE/);
});

test('snapshots and backups without valuations still open, validate, export, restore and accept writes', async () => {
  const repo = await base(); const s = await repo.readSnapshot(); delete s.valuations;
  assert.ok(COLLECTIONS.includes('valuations'));
  validateSnapshot(s);
  const s2 = structuredClone(s); s2.valuations = undefined; assert.throws(() => validateSnapshot(s2), /INVALID_CANONICAL_VALUE/);
  const s3 = structuredClone(s); s3.valuations = {}; assert.throws(() => validateSnapshot(s3), /INVALID_COLLECTION/);
  const opened = createMemoryRepository(s); assert.deepEqual((await opened.readSnapshot()).valuations, []);
  assert.equal(netWorth(s, { date: '2026-10-28' }).totalMinor, '10000000');
  const raw = await exportSnapshot(s); assert.ok(!JSON.parse(raw).entities.valuations);
  const stage = await stageRestore(raw); assert.deepEqual(stage.snapshot.valuations, []); validateSnapshot(stage.snapshot);
  const target = createMemoryRepository(createDataset()); const current = await target.readSnapshot();
  await target.stageRestore(stage);
  const active = await target.activateStage(stage.id, { expectedDatasetId: current.datasetId, expectedRevision: current.revision, confirm: true, backupAcknowledged: true });
  assert.deepEqual(active.valuations, []);
  const legacy = createMemoryRepository(s); const before = await legacy.readSnapshot();
  await legacy.runAtomicCommand({ commandId: 'legacy-write', type: 'addCategory', input: { name: 'Synthetic', direction: 'INCOME' } }, before.revision, { now });
  const after = await legacy.readSnapshot(); validateSnapshot(after); assert.deepEqual(after.valuations, []);
});

test('backup limit is 64 MiB everywhere and a backup above the old 5 MiB limit round-trips', async () => {
  assert.equal(MAX_BACKUP_BYTES, 64 * 1024 * 1024); assert.equal(NATIVE_MAX, MAX_BACKUP_BYTES);
  const java = await readFile(new URL('../android/app/src/main/java/app/cashweave/offline/trial/LocalBackupPlugin.java', import.meta.url), 'utf8');
  assert.match(java, /private static final int MAX_BYTES = 64 \* 1024 \* 1024;/);
  const core = await loadCore(), { state } = await buildSynthetic(3500, core);
  const raw = await exportSnapshot(state), bytes = new TextEncoder().encode(raw).length;
  assert.ok(bytes > 5 * 1024 * 1024 && bytes < MAX_BACKUP_BYTES, String(bytes));
  const stage = await stageRestore(raw); assert.equal(stage.snapshot.operations.length, state.operations.length);
  await assert.rejects(stageRestore('x'.repeat(MAX_BACKUP_BYTES + 1)), /BACKUP_TOO_LARGE/);
});

test('netWorth adds ledger movement after the valuation date to the valued investment', async () => {
  const repo = await base(); const bank = (await repo.readSnapshot()).accounts[0].id;
  const [broker] = (await send(repo, 'addAccount', { name: 'Synthetic broker', accountType: 'INVESTMENT', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-09-01' })).resultIds;
  await send(repo, 'recordActual', { operationType: 'TRANSFER', fromAccountId: bank, toAccountId: broker, amountMinor: '3000000', effectiveLocalDate: '2026-10-01' });
  await send(repo, 'recordValuation', { accountId: broker, date: '2026-10-20', valueMinor: '3500000' });
  await send(repo, 'recordActual', { operationType: 'TRANSFER', fromAccountId: broker, toAccountId: bank, amountMinor: '500000', effectiveLocalDate: '2026-10-22' });
  const s = await repo.readSnapshot(), row = d => netWorth(s, { date: d }).accounts.find(a => a.accountId === broker);
  assert.equal(row('2026-10-21').valueMinor, '3500000'); assert.equal(row('2026-10-22').valueMinor, '3000000'); assert.equal(row('2026-10-22').sinceValuationMinor, '-500000');
  assert.equal(netWorth(s, { date: '2026-10-22' }).totalMinor, netWorth(s, { date: '2026-10-21' }).totalMinor);
  assert.equal(row('2026-10-22').stale, false); assert.equal(row('2026-10-27').stale, false); assert.equal(row('2026-10-28').stale, true); assert.equal(netWorth(s, { date: '2026-10-24', staleDays: 3 }).accounts.find(a => a.accountId === broker).stale, true);
});

// Track C (independent QA) domain checks, synthetic data only.
// Tests named "QA-xx ..." expose an open finding and are EXPECTED TO FAIL until it is fixed.
// Tests named "QA regression ..." guard flows that were verified correct during review.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, validateSnapshot, accountBalance, envelopeBalance, poolSummary, planSummary, valuationLine } from '../core/model.js';
import { createMemoryRepository } from '../core/repository.js';
import { prepareCommand, VALIDATED_SNAPSHOT } from '../core/commands.js';
import { previewAllocationV3, calculateAllocation } from '../core/allocation.js';
import { previewRecipe, RECIPE_PRESETS, recipeLines } from '../core/recipes.js';
import { netWorth, queryReport } from '../core/reports.js';
import { exportSnapshot, stageRestore } from '../core/migration.js';
import { canonical } from '../core/identity.js';

const now = '2026-10-29T03:00:00.000Z';
let serial = 0;
const send = async (repo, type, input, commandId = `qa-${++serial}`) => { const s = await repo.readSnapshot(); return repo.runAtomicCommand({ commandId, type, input }, s.revision, { now }); };
const fails = async (fn, code) => { await assert.rejects(fn, error => { assert.equal(error.message, code); return true; }); };

// Bank with 10,000 income; `allocated` of it put into one envelope via a 100% template.
async function funded(allocated = '1000') {
  const repo = createMemoryRepository(createDataset());
  await send(repo, 'onboard', { name: 'Synthetic bank', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-09-01' });
  let s = await repo.readSnapshot(); const bank = s.accounts[0].id, pool = s.budgetPools[0].id;
  const [envelope] = (await send(repo, 'addEnvelope', { name: 'Synthetic food', budgetPoolId: pool })).resultIds;
  const [, versionId] = (await send(repo, 'saveTemplate', { name: 'All in', currencyCode: 'VND', fixedScope: 'PER_APPLICATION', lines: [{ envelopeId: envelope, type: 'PERCENT', percentageBps: 10000, priority: 1 }] })).resultIds;
  await send(repo, 'recordActual', { operationType: 'INCOME', accountId: bank, amountMinor: '10000', effectiveLocalDate: '2026-10-01' });
  s = await repo.readSnapshot();
  const request = { templateVersionId: versionId, budgetPoolId: pool, sourceIds: [s.fundingSources[0].id], requestedAmountMinor: allocated, allocationEffectiveLocalDate: '2026-10-01' };
  await send(repo, 'confirmAllocation', { ...request, previewHash: (await previewAllocationV3(s, request)).previewHash });
  return { repo, bank, pool, envelope };
}

// ---------------------------------------------------------------- open findings (expected to fail)

test('QA-01 correcting the date of an envelope-linked expense to an earlier day succeeds (fails today: REVERSAL_BEFORE_LINK)', async () => {
  const ctx = await funded();
  const [operationId, postingId] = (await send(ctx.repo, 'recordActual', { operationType: 'EXPENSE', accountId: ctx.bank, amountMinor: '300', effectiveLocalDate: '2026-10-20' })).resultIds;
  await send(ctx.repo, 'linkExpense', { expensePostingId: postingId, envelopeId: ctx.envelope, amountMinor: '300', effectiveLocalDate: '2026-10-20' });
  // The UI "Sửa" form sends the corrected date as effectiveLocalDate for both the reversal and the replacement.
  const receipt = await send(ctx.repo, 'replaceOperation', { operationId, amountMinor: '300', effectiveLocalDate: '2026-10-15', memo: 'Synthetic lunch', reason: 'Wrong day' });
  const s = await ctx.repo.readSnapshot();
  assert.equal(accountBalance(s, ctx.bank), '9700');
  assert.equal(envelopeBalance(s, ctx.envelope), '700', 'the corrected expense keeps its envelope');
  assert.equal(receipt.resultIds.length, 3);
});

test('QA-02 editing a paid plan expense keeps the plan paid (fails today: settlement is reversed and not carried)', async () => {
  const ctx = await funded();
  const [planId] = (await send(ctx.repo, 'createPlan', { title: 'Synthetic rent', direction: 'EXPENSE', currencyCode: 'VND', dueLocalDate: '2026-10-05', expectedAmountMinor: '300', expectedAccountId: ctx.bank })).resultIds;
  const [operationId] = (await send(ctx.repo, 'recordActual', { operationType: 'EXPENSE', accountId: ctx.bank, amountMinor: '300', effectiveLocalDate: '2026-10-05', settlement: { planOccurrenceId: planId, amountMinor: '300' } })).resultIds;
  assert.equal(planSummary(await ctx.repo.readSnapshot(), planId).openRemaining, '0');
  await send(ctx.repo, 'replaceOperation', { operationId, amountMinor: '300', effectiveLocalDate: '2026-10-05', memo: 'Synthetic rent, note fixed', reason: 'Note only' });
  const s = await ctx.repo.readSnapshot();
  assert.equal(accountBalance(s, ctx.bank), '9700');
  assert.equal(planSummary(s, planId).openRemaining, '0', 'a memo-only edit must not reopen a paid plan');
});

test('QA-03 moving cash into an investment account after its last valuation does not change net worth (fails today)', async () => {
  const repo = createMemoryRepository(createDataset());
  await send(repo, 'onboard', { name: 'Synthetic bank', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '10000', openingEffectiveLocalDate: '2026-10-01' });
  const bank = (await repo.readSnapshot()).accounts[0].id;
  const [broker] = (await send(repo, 'addAccount', { name: 'Synthetic broker', accountType: 'INVESTMENT', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-10-01' })).resultIds;
  await send(repo, 'recordValuation', { accountId: broker, date: '2026-10-25', valueMinor: '5000' });
  const before = netWorth(await repo.readSnapshot(), { date: '2026-10-26' });
  await send(repo, 'recordActual', { operationType: 'TRANSFER', fromAccountId: bank, toAccountId: broker, amountMinor: '2000', effectiveLocalDate: '2026-10-26' });
  const after = netWorth(await repo.readSnapshot(), { date: '2026-10-26' });
  assert.equal(before.totalMinor, '15000');
  // Today the broker still reports the 5,000 valuation while the bank lost 2,000: net worth drops to 13,000
  // and the row is not flagged stale (valuation is 1 day old).
  assert.equal(after.totalMinor, before.totalMinor, 'a transfer between own accounts must not change net worth');
});

// ---------------------------------------------------------------- verified behaviour (regressions)

test('QA-04 moving an expense to another month via "Sửa" leaves both months spending correct (fails today: reversal is dated on the new day)', async () => {
  const ctx = await funded();
  const [operationId] = (await send(ctx.repo, 'recordActual', { operationType: 'EXPENSE', accountId: ctx.bank, amountMinor: '300', effectiveLocalDate: '2026-10-02' })).resultIds;
  // UI ledger.js correct-form: effectiveLocalDate = the corrected date, used for the reversal AND the replacement.
  await send(ctx.repo, 'replaceOperation', { operationId, amountMinor: '250', effectiveLocalDate: '2026-09-28', memo: 'x', reason: 'Wrong month' });
  const s = validateSnapshot(await ctx.repo.readSnapshot());
  const spent = async (from, to) => (await queryReport(s, { metricId: 'ActualExpense', currencyCode: 'VND', startLocalDateInclusive: from, endLocalDateExclusive: to, accountIds: [] })).totalMinor;
  assert.equal(accountBalance(s, ctx.bank), '9750', 'current balance is right');
  // Today: September reports 250 - 300 = -50 spent and October still reports 300.
  assert.equal(await spent('2026-09-01', '2026-10-01'), '250', 'September spending');
  assert.equal(await spent('2026-10-01', '2026-11-01'), '0', 'October spending');
  assert.equal(accountBalance(s, ctx.bank, '2026-09-29'), '-250', 'September balance holds only the corrected expense');
  assert.equal(accountBalance(s, ctx.bank, '2026-10-05'), accountBalance(s, ctx.bank), 'no phantom +300 after the original date');
});

test('QA regression: failed replace (envelope too small) leaves the stored snapshot byte-identical; commandId can then be reused', async () => {
  const ctx = await funded('1000');
  const [operationId, postingId] = (await send(ctx.repo, 'recordActual', { operationType: 'EXPENSE', accountId: ctx.bank, amountMinor: '600', effectiveLocalDate: '2026-10-05' })).resultIds;
  await send(ctx.repo, 'linkExpense', { expensePostingId: postingId, envelopeId: ctx.envelope, amountMinor: '600', effectiveLocalDate: '2026-10-05' });
  const before = canonical(await ctx.repo.readSnapshot());
  await fails(() => send(ctx.repo, 'replaceOperation', { operationId, amountMinor: '1200', effectiveLocalDate: '2026-10-06', memo: '', reason: 'Too big' }, 'qa-replace-1'), 'ENVELOPE_INSUFFICIENT');
  assert.equal(canonical(await ctx.repo.readSnapshot()), before);
  // Explicit empty spendLinks is the escape hatch (not offered by the UI form).
  const receipt = await send(ctx.repo, 'replaceOperation', { operationId, amountMinor: '1200', effectiveLocalDate: '2026-10-06', memo: '', reason: 'Too big', spendLinks: [] }, 'qa-replace-1');
  assert.equal(receipt.resultIds.length, 2);
  const s = await ctx.repo.readSnapshot();
  assert.equal(envelopeBalance(s, ctx.envelope), '1000');
  assert.equal(accountBalance(s, ctx.bank), '8800');
});

test('QA regression: carried links honour explicit multi-envelope input and the sum cannot exceed the new amount', async () => {
  const ctx = await funded('1000');
  const [second] = (await send(ctx.repo, 'addEnvelope', { name: 'Synthetic fun', budgetPoolId: ctx.pool })).resultIds;
  const [operationId] = (await send(ctx.repo, 'recordActual', { operationType: 'EXPENSE', accountId: ctx.bank, amountMinor: '300', effectiveLocalDate: '2026-10-05' })).resultIds;
  const before = canonical(await ctx.repo.readSnapshot());
  // second envelope has 0 available -> atomic failure
  await fails(() => send(ctx.repo, 'replaceOperation', { operationId, amountMinor: '300', effectiveLocalDate: '2026-10-05', reason: 'r', spendLinks: [{ envelopeId: ctx.envelope, amountMinor: '200' }, { envelopeId: second, amountMinor: '100' }] }), 'ENVELOPE_INSUFFICIENT');
  // links above the replacement amount are rejected by the post-command validator
  await fails(() => send(ctx.repo, 'replaceOperation', { operationId, amountMinor: '300', effectiveLocalDate: '2026-10-05', reason: 'r', spendLinks: [{ envelopeId: ctx.envelope, amountMinor: '200' }, { envelopeId: ctx.envelope, amountMinor: '200' }] }), 'SPEND_CAPACITY_EXCEEDED');
  await fails(() => send(ctx.repo, 'replaceOperation', { operationId, amountMinor: '300', effectiveLocalDate: '2026-10-05', reason: 'r', spendLinks: 'all' }), 'INVALID_SPEND_LINKS');
  assert.equal(canonical(await ctx.repo.readSnapshot()), before);
});

test('QA regression: new commands are idempotent by commandId and reject a changed payload', async () => {
  const repo = createMemoryRepository(createDataset());
  await send(repo, 'onboard', { name: 'Synthetic bank', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-10-01' });
  const pool = (await repo.readSnapshot()).budgetPools[0].id;
  const [broker] = (await send(repo, 'addAccount', { name: 'Synthetic broker', accountType: 'INVESTMENT', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-10-01' })).resultIds;
  for (const [type, input, changed] of [
    ['applyRecipePreset', { presetId: 'six-jars', budgetPoolId: pool }, { presetId: '50-30-20', budgetPoolId: pool }],
    ['recordValuation', { accountId: broker, date: '2026-10-20', valueMinor: '100' }, { accountId: broker, date: '2026-10-20', valueMinor: '101' }],
  ]) {
    const commandId = 'qa-idem-' + type, s0 = await repo.readSnapshot();
    const first = await repo.runAtomicCommand({ commandId, type, input }, s0.revision, { now });
    const s1 = await repo.readSnapshot();
    const replay = await repo.runAtomicCommand({ commandId, type, input }, s0.revision, { now }); // stale revision is fine on replay
    assert.deepEqual(replay, first, type);
    assert.equal(canonical(await repo.readSnapshot()), canonical(s1), type + ' replay writes nothing');
    await fails(() => repo.runAtomicCommand({ commandId, type, input: changed }, s1.revision, { now }), 'IDEMPOTENCY_CONFLICT');
    assert.equal(canonical(await repo.readSnapshot()), canonical(s1));
  }
});

test('QA regression: valuation rounding is BigInt half-up at every boundary and the validator recomputes lines', async () => {
  const line = (quantity, unitPriceMinor) => valuationLine({ symbol: 'X', quantity, unitPriceMinor });
  assert.equal(line('0.5', '1'), '1'); assert.equal(line('0.49', '1'), '0'); assert.equal(line('0.25', '1'), '0'); assert.equal(line('1.5', '3'), '5'); // 4.5 -> 5
  assert.equal(line('0.000000000001', '500000000000'), '1'); assert.equal(line('0.000000000001', '499999999999'), '0');
  assert.equal(line('123456789012345678', '1'), '123456789012345678');
  assert.throws(() => line('123456789012345678', '100'), /MONEY_OUT_OF_RANGE/);
  for (const bad of ['1e3', '-1', '01', '1.', '.5', '1.0000000000001', ' 1', 1]) assert.throws(() => line(bad, '1'), /INVALID_VALUATION_QUANTITY/, String(bad));
  assert.throws(() => line('1', '-1'), /INVALID_VALUATION_PRICE/);
  assert.throws(() => line('1', '1.5'), /INVALID_MINOR_AMOUNT/);

  const repo = createMemoryRepository(createDataset());
  await send(repo, 'onboard', { name: 'Synthetic bank', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-10-01' });
  const [broker] = (await send(repo, 'addAccount', { name: 'Synthetic broker', accountType: 'INVESTMENT', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-10-01' })).resultIds;
  await send(repo, 'recordValuation', { accountId: broker, date: '2026-10-28', lines: [{ symbol: ' FPT ', quantity: '0.5', unitPriceMinor: '3' }, { symbol: 'VNM', quantity: '0.5', unitPriceMinor: '3' }] });
  let s = await repo.readSnapshot();
  assert.equal(s.valuations[0].valueMinor, '4', 'each line rounds (1.5->2) before summing, total 4 not round(3)=3');
  assert.equal(s.valuations[0].lines[0].symbol, 'FPT');
  await fails(() => send(repo, 'recordValuation', { accountId: broker, date: '2026-10-28', lines: [{ symbol: 'A', quantity: '1', unitPriceMinor: '3' }], valueMinor: '4' }), 'VALUATION_TOTAL_MISMATCH');
  await fails(() => send(repo, 'recordValuation', { accountId: broker, date: '2026-10-30', valueMinor: '4' }), 'VALUATION_DATE_IN_FUTURE');
  await fails(() => send(repo, 'recordValuation', { accountId: s.accounts[0].id, date: '2026-10-28', valueMinor: '4' }), 'VALUATION_REQUIRES_INVESTMENT_ACCOUNT');
  await fails(() => send(repo, 'recordValuation', { accountId: broker, date: '2026-10-28' }), 'VALUATION_VALUE_REQUIRED');
  await fails(() => send(repo, 'recordValuation', { accountId: broker, date: '2026-10-28', valueMinor: '-1' }), 'INVALID_VALUATION_AMOUNT');
  s = await repo.readSnapshot();
  const tampered = structuredClone(s); tampered.valuations[0].lines[0].valueMinor = '1';
  assert.throws(() => validateSnapshot(tampered), /INVALID_VALUATION/);
  const tampered2 = structuredClone(s); tampered2.valuations[0].valueMinor = '5';
  assert.throws(() => validateSnapshot(tampered2), /INVALID_VALUATION/);
  const tampered3 = structuredClone(s); tampered3.valuations[0].accountId = s.accounts[0].id;
  assert.throws(() => validateSnapshot(tampered3), /INVALID_VALUATION/);
});

test('QA regression: every preset allocates exactly the requested amount for awkward amounts (no lost or invented dong)', () => {
  for (const preset of RECIPE_PRESETS) {
    const bps = preset.lines.filter(l => l.type === 'PERCENT').reduce((n, l) => n + l.value, 0);
    assert.ok(bps <= 10000, preset.id);
    for (const amount of ['1', '3', '7', '99', '1001', '18500000', '18500001', '999999999999999999']) {
      const p = previewRecipe(preset.id, amount);
      const lineSum = p.lines.reduce((n, l) => n + BigInt(l.amountMinor), 0n);
      assert.equal(lineSum.toString(), p.consumptionMinor, `${preset.id} ${amount} lines = consumption`);
      assert.equal((BigInt(p.consumptionMinor) + (preset.leftoverPolicy === 'UNASSIGNED' ? BigInt(p.leftoverMinor) : 0n)).toString(), amount, `${preset.id} ${amount} nothing lost`);
      if (bps === 10000) assert.equal(p.consumptionMinor, amount, `${preset.id} ${amount} 100% presets consume everything`);
      for (const l of p.lines) assert.ok(BigInt(l.amountMinor) >= 0n);
    }
  }
  // Largest-remainder: 7 dong over 55/10/10/10/10/5 -> 55% of 7 = 3.85 gets the extra unit first.
  // Ties among the four 10% lines are broken by priority, so 7 dong -> 4/1/1/1/0/0.
  assert.deepEqual(previewRecipe('six-jars', '7').lines.map(l => l.amountMinor), ['4', '1', '1', '1', '0', '0']);
  assert.throws(() => calculateAllocation('1', recipeLines(RECIPE_PRESETS[0], { necessities: 6000 })), /PERCENT_OVER_100/);
});

test('QA regression: applying six jars via the repository then allocating moves exactly the income into envelopes', async () => {
  const repo = createMemoryRepository(createDataset());
  await send(repo, 'onboard', { name: 'Synthetic bank', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-10-01' });
  let s = await repo.readSnapshot(); const bank = s.accounts[0].id, pool = s.budgetPools[0].id;
  await send(repo, 'recordActual', { operationType: 'INCOME', accountId: bank, amountMinor: '18500001', effectiveLocalDate: '2026-10-02' });
  const [, versionId, ...envelopes] = (await send(repo, 'applyRecipePreset', { presetId: 'six-jars', budgetPoolId: pool })).resultIds;
  assert.equal(envelopes.length, 6);
  s = await repo.readSnapshot();
  const request = { templateVersionId: versionId, budgetPoolId: pool, sourceIds: [s.fundingSources[0].id], requestedAmountMinor: '18500001', allocationEffectiveLocalDate: '2026-10-02' };
  await send(repo, 'confirmAllocation', { ...request, previewHash: (await previewAllocationV3(s, request)).previewHash });
  s = await repo.readSnapshot();
  assert.equal(envelopes.reduce((n, e) => n + BigInt(envelopeBalance(s, e)), 0n).toString(), '18500001');
  assert.equal(poolSummary(s, pool).unassigned, '0');
  assert.equal(accountBalance(s, bank), '18500001');
});

test('QA regression: repository COW also protects replaceOperation (with carried links), recordActual and onboard', async () => {
  const deepFreeze = v => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze); } return v; };
  const empty = deepFreeze(createDataset());
  const onboard = await prepareCommand(empty, { commandId: 'qa-cow-onboard', type: 'onboard', input: { name: 'Synthetic bank', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-10-01' } }, 0, { now, [VALIDATED_SNAPSHOT]: true });
  assert.equal(onboard.snapshot.profile.onboardingCompletedAtUtc, now); assert.equal(empty.profile.onboardingCompletedAtUtc, null);
  const ctx = await funded();
  const [operationId, postingId] = (await send(ctx.repo, 'recordActual', { operationType: 'EXPENSE', accountId: ctx.bank, amountMinor: '300', effectiveLocalDate: '2026-10-05' })).resultIds;
  await send(ctx.repo, 'linkExpense', { expensePostingId: postingId, envelopeId: ctx.envelope, amountMinor: '300', effectiveLocalDate: '2026-10-05' });
  const base = deepFreeze(await ctx.repo.readSnapshot()), copy = canonical(base);
  for (const [type, input] of [
    ['replaceOperation', { operationId, amountMinor: '200', effectiveLocalDate: '2026-10-06', memo: 'm', reason: 'r' }],
    ['reverseOperation', { operationId, effectiveLocalDate: '2026-10-06', reason: 'r' }],
    ['recordActual', { operationType: 'EXPENSE', accountId: ctx.bank, amountMinor: '5', effectiveLocalDate: '2026-10-06' }],
    ['recordActual', { operationType: 'INCOME', accountId: ctx.bank, amountMinor: '5', effectiveLocalDate: '2026-10-06' }],
  ]) {
    const out = await prepareCommand(base, { commandId: 'qa-cow-' + type + serial++, type, input }, base.revision, { now, [VALIDATED_SNAPSHOT]: true });
    validateSnapshot(out.snapshot);
  }
  assert.equal(canonical(base), copy);
});

test('QA regression: a pre-valuations backup restores, gains an empty collection and accepts an investment write', async () => {
  const repo = createMemoryRepository(createDataset());
  await send(repo, 'onboard', { name: 'Synthetic bank', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '700', openingEffectiveLocalDate: '2026-10-01' });
  const old = await repo.readSnapshot(); delete old.valuations; validateSnapshot(old);
  assert.equal(netWorth(old, { date: '2026-10-28' }).totalMinor, '700');
  const raw = await exportSnapshot(old); assert.ok(!JSON.parse(raw).entities.valuations);
  const stage = await stageRestore(raw);
  assert.deepEqual(stage.snapshot.valuations, []);
  const target = createMemoryRepository(createDataset()), current = await target.readSnapshot();
  await target.stageRestore(stage, { mode: 'new' });
  await target.activateStage(stage.id, { expectedDatasetId: current.datasetId, expectedRevision: current.revision, confirm: true, backupAcknowledged: true, mode: 'new' });
  const [broker] = (await send(target, 'addAccount', { name: 'Synthetic broker', accountType: 'INVESTMENT', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-10-01' })).resultIds;
  await send(target, 'recordValuation', { accountId: broker, date: '2026-10-28', valueMinor: '300' });
  assert.equal(netWorth(await target.readSnapshot(), { date: '2026-10-28' }).totalMinor, '1000');
});

test('QA regression: date/UTC memo caches never let an invalid value through after a valid one', async () => {
  const s = createDataset(); validateSnapshot(s);
  for (const bad of ['2026-02-30', '2026-13-01', '2026-1-01']) { const x = structuredClone(s); x.profile.updatedAtUtc = bad + 'T00:00:00.000Z'; assert.throws(() => validateSnapshot(x), /INVALID_/, bad); }
  const x = structuredClone(s); x.profile.updatedAtUtc = new Date(s.profile.updatedAtUtc); assert.throws(() => validateSnapshot(x), /INVALID_UTC_METADATA/);
});

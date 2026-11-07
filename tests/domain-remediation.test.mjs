import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, validateSnapshot, accountBalance, planSummary, envelopeBalance, openingBalanceSummary, poolSummary, sourceCapacity } from '../core/model.js';
import { createMemoryRepository } from '../core/repository.js';
import { exportSnapshot, stageRestore } from '../core/migration.js';
import { digest } from '../core/identity.js';
import { previewAllocationV3 } from '../core/allocation.js';
import { queryReport } from '../core/reports.js';

const now = '2026-10-31T12:00:00.000Z';
let serial = 0;
async function send(repo, type, input) {
  const snapshot = await repo.readSnapshot();
  return repo.runAtomicCommand({ commandId: `domain-remediation-${++serial}`, type, input }, snapshot.revision, { now });
}
async function base() {
  const repo = createMemoryRepository(createDataset());
  await send(repo, 'onboard', { name: 'Synthetic account', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '1000', openingEffectiveLocalDate: '2026-09-01' });
  return repo;
}
async function actual(repo, operationType = 'EXPENSE', amountMinor = '10', extra = {}) {
  const snapshot = await repo.readSnapshot();
  return send(repo, 'recordActual', { operationType, amountMinor, accountId: snapshot.accounts[0].id, effectiveLocalDate: '2026-10-01', memo: 'Original memo', ...extra });
}
async function plan(repo, direction = 'INCOME', expectedAmountMinor = '100') {
  return (await send(repo, 'createPlan', { title: 'Synthetic plan', direction, currencyCode: 'VND', dueLocalDate: '2026-10-01', expectedAmountMinor })).resultIds[0];
}
async function fundedEnvelope(repo, amountMinor = '100') {
  let state = await repo.readSnapshot();
  const envelopeId = (await send(repo, 'addEnvelope', { name: 'Synthetic envelope', budgetPoolId: state.budgetPools[0].id })).resultIds[0];
  const versionId = (await send(repo, 'saveTemplate', { name: 'Original template', currencyCode: 'VND', fixedScope: 'PER_APPLICATION', lines: [{ type: 'FIXED', envelopeId, fixedAmountMinor: amountMinor, priority: 0 }] })).resultIds[1];
  state = await repo.readSnapshot();
  const request = { templateVersionId: versionId, budgetPoolId: state.budgetPools[0].id, sourceIds: [state.fundingSources[0].id], requestedAmountMinor: amountMinor, allocationEffectiveLocalDate: '2026-09-01' };
  await send(repo, 'confirmAllocation', { ...request, previewHash: (await previewAllocationV3(state, request)).previewHash });
  return envelopeId;
}
function reportDescriptor(state, metricId) { return { metricId, currencyCode: 'VND', startLocalDateInclusive: '2026-10-01', endLocalDateExclusive: '2026-11-01', datasetRevision: state.revision }; }

test('CW-01: expense undo retains history and reverses the expense report exactly once', async () => {
  const repo = await base(), receipt = await actual(repo), before = await repo.readSnapshot();
  await send(repo, 'reverseOperation', { operationId: receipt.resultIds[0], effectiveLocalDate: '2026-10-02', reason: 'Entered twice' });
  const after = await repo.readSnapshot();
  assert.equal(accountBalance(after, after.accounts[0].id), '1000');
  assert.deepEqual(after.operations.find(o => o.id === receipt.resultIds[0]), before.operations.find(o => o.id === receipt.resultIds[0]));
  assert.equal((await queryReport(after, reportDescriptor(after, 'ActualExpense'))).totalMinor, '0');
  await assert.rejects(send(repo, 'reverseOperation', { operationId: receipt.resultIds[0], effectiveLocalDate: '2026-10-03' }), /ALREADY_REVERSED/);
});

test('CW-01: unlinked expense correction changes cash and report to the replacement amount', async () => {
  const repo = await base(), receipt = await actual(repo);
  await send(repo, 'replaceOperation', { operationId: receipt.resultIds[0], amountMinor: '9', effectiveLocalDate: '2026-10-02', reason: 'Receipt total' });
  const state = await repo.readSnapshot();
  assert.equal(accountBalance(state, state.accounts[0].id), '991');
  assert.equal((await queryReport(state, reportDescriptor(state, 'ActualExpense'))).totalMinor, '9');
  assert.equal(state.operations.at(-1).memo, 'Original memo');
});

test('CW-01: linked expense undo restores envelope money without deleting spend history', async () => {
  const repo = await base(), envelopeId = await fundedEnvelope(repo), receipt = await actual(repo);
  await send(repo, 'linkExpense', { expensePostingId: receipt.resultIds[1], envelopeId, amountMinor: '10', effectiveLocalDate: '2026-10-01' });
  await send(repo, 'reverseOperation', { operationId: receipt.resultIds[0], effectiveLocalDate: '2026-10-02', reason: 'Duplicate' });
  const state = await repo.readSnapshot();
  assert.equal(envelopeBalance(state, envelopeId), '100');
  assert.equal(state.spendLinks.length, 2);
  assert.equal(state.spendLinks[1].reversalOfLinkId, state.spendLinks[0].id);
});

test('CW-11: corrected expense preserves envelope association and editable memo', async () => {
  const repo = await base(), envelopeId = await fundedEnvelope(repo), receipt = await actual(repo);
  await send(repo, 'linkExpense', { expensePostingId: receipt.resultIds[1], envelopeId, amountMinor: '8', effectiveLocalDate: '2026-10-01' });
  await send(repo, 'replaceOperation', { operationId: receipt.resultIds[0], amountMinor: '9', effectiveLocalDate: '2026-10-02', reason: 'Receipt total', memo: 'Corrected memo' });
  const state = await repo.readSnapshot(), replacement = state.operations.at(-1), posting = state.postings.find(p => p.operationId === replacement.id);
  assert.equal(replacement.memo, 'Corrected memo');
  assert.equal(envelopeBalance(state, envelopeId), '92');
  assert.equal(state.spendLinks.at(-1).expensePostingId, posting.id);
  assert.equal(state.spendLinks.at(-1).correctionOfLinkId, state.spendLinks[0].id);
});

test('CW-11: reducing linked expense requires explicit complete reconciliation and is atomic', async () => {
  const repo = await base(), envelopeId = await fundedEnvelope(repo), receipt = await actual(repo);
  const linkId = (await send(repo, 'linkExpense', { expensePostingId: receipt.resultIds[1], envelopeId, amountMinor: '10', effectiveLocalDate: '2026-10-01' })).resultIds[0];
  const before = await repo.readSnapshot(), correction = { operationId: receipt.resultIds[0], amountMinor: '9', effectiveLocalDate: '2026-10-02', reason: 'Receipt total' };
  await assert.rejects(send(repo, 'replaceOperation', correction), /CORRECTION_LINK_RECONCILIATION_REQUIRED/);
  assert.deepEqual(await repo.readSnapshot(), before);
  await assert.rejects(send(repo, 'replaceOperation', { ...correction, linkReconciliation: { spendLinks: [] } }), /INVALID_CORRECTION_RECONCILIATION/);
  assert.deepEqual(await repo.readSnapshot(), before);
  await send(repo, 'replaceOperation', { ...correction, linkReconciliation: { spendLinks: [{ linkId, amountMinor: '9' }] } });
  const state = await repo.readSnapshot();
  assert.equal(envelopeBalance(state, envelopeId), '91');
  assert.equal(accountBalance(state, state.accounts[0].id), '991');
});

test('CW-11: fully settled income correction retains the plan and accurately forecasts remaining', async () => {
  const repo = await base(), occurrenceId = await plan(repo);
  const receipt = await actual(repo, 'INCOME', '100', { settlement: { planOccurrenceId: occurrenceId, amountMinor: '100' } });
  let before = await repo.readSnapshot();
  await assert.rejects(send(repo, 'replaceOperation', { operationId: receipt.resultIds[0], amountMinor: '90', effectiveLocalDate: '2026-10-02', reason: 'Salary corrected' }), /CORRECTION_LINK_RECONCILIATION_REQUIRED/);
  assert.deepEqual(await repo.readSnapshot(), before);
  await send(repo, 'replaceOperation', { operationId: receipt.resultIds[0], amountMinor: '90', effectiveLocalDate: '2026-10-02', reason: 'Salary corrected', linkReconciliation: { settlements: [{ linkId: before.settlements[0].id, amountMinor: '90' }] } });
  const state = await repo.readSnapshot();
  assert.equal(planSummary(state, occurrenceId).netSettled, '90');
  assert.equal(planSummary(state, occurrenceId).openRemaining, '10');
  assert.equal(planSummary(state, occurrenceId, '2026-10-02').netSettled, '100');
  assert.equal((await queryReport(state, reportDescriptor(state, 'ActualIncome'))).totalMinor, '90');
});

test('CW-11: closed plan retains corrected associations without reopening it', async () => {
  const repo = await base(), occurrenceId = await plan(repo), receipt = await actual(repo, 'INCOME', '100', { settlement: { planOccurrenceId: occurrenceId, amountMinor: '100' } });
  await send(repo, 'closePlan', { occurrenceId, closure: 'FINALIZED', effectiveLocalDate: '2026-10-01', reason: 'Received' });
  await send(repo, 'replaceOperation', { operationId: receipt.resultIds[0], amountMinor: '110', effectiveLocalDate: '2026-10-02', reason: 'Receipt total', memo: '' });
  const state = await repo.readSnapshot();
  assert.equal(planSummary(state, occurrenceId).closure, 'FINALIZED');
  assert.equal(planSummary(state, occurrenceId).netSettled, '100');
  assert.equal(state.operations.at(-1).memo, '');
});

test('CW-11: multi-plan reconciliation requires every live association and permits explicit zero', async () => {
  const repo = await base(), first = await plan(repo), second = await plan(repo), receipt = await actual(repo, 'INCOME', '100');
  const firstLink = (await send(repo, 'linkSettlement', { planOccurrenceId: first, ledgerPostingId: receipt.resultIds[1], amountMinor: '60', effectiveLocalDate: '2026-10-01' })).resultIds[0];
  const secondLink = (await send(repo, 'linkSettlement', { planOccurrenceId: second, ledgerPostingId: receipt.resultIds[1], amountMinor: '40', effectiveLocalDate: '2026-10-01' })).resultIds[0];
  const correction = { operationId: receipt.resultIds[0], amountMinor: '50', effectiveLocalDate: '2026-10-02', reason: 'Receipt total' }, before = await repo.readSnapshot();
  for (const settlements of [[{ linkId: firstLink, amountMinor: '50' }], [{ linkId: firstLink, amountMinor: '30' }, { linkId: firstLink, amountMinor: '20' }]]) {
    await assert.rejects(send(repo, 'replaceOperation', { ...correction, linkReconciliation: { settlements } }), /INVALID_CORRECTION_RECONCILIATION/);
    assert.deepEqual(await repo.readSnapshot(), before);
  }
  await send(repo, 'replaceOperation', { ...correction, linkReconciliation: { settlements: [{ linkId: firstLink, amountMinor: '50' }, { linkId: secondLink, amountMinor: '0' }] } });
  const state = await repo.readSnapshot();
  assert.equal(planSummary(state, first).netSettled, '50');
  assert.equal(planSummary(state, second).netSettled, '0');
});

test('CW-02: profile types are strict before creation, commands, snapshot validation and backup stage', async () => {
  for (const locale of [[], ['vi-VN'], {}, 0, null, '', 'x'.repeat(129)]) assert.throws(() => createDataset({ locale }), /INVALID_LOCALE/);
  for (const timezoneId of [[], {}, 0, null, '', 'x'.repeat(129)]) assert.throws(() => createDataset({ timezoneId }), /INVALID_TIMEZONE/);
  const repo = await base(), before = await repo.readSnapshot(), backup = JSON.parse(await exportSnapshot(before));
  const malformed = [{ locale: [] }, { locale: ['vi-VN'] }, { timezoneId: [] }, { defaultCurrencyCode: ['VND'] }, { revision: '1' }, { id: [] }, { onboardingCompletedAtUtc: [] }, { onboardingCompletedAtUtc: '' }];
  for (const patch of malformed) {
    const state = structuredClone(before); Object.assign(state.profile, patch);
    assert.throws(() => validateSnapshot(state));
    const forged = structuredClone(backup); forged.entities = state;
    const { checksum, ...payload } = forged;
    await assert.rejects(stageRestore(JSON.stringify({ ...payload, checksum: await digest(payload) })));
    assert.deepEqual(await repo.readSnapshot(), before);
  }
  const fresh = createMemoryRepository(createDataset());
  await assert.rejects(send(fresh, 'onboard', { name: 'Synthetic account', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-09-01', locale: [] }), /INVALID_LOCALE/);
  assert.equal((await fresh.readSnapshot()).accounts.length, 0);
});

test('CW-09: template rename persists while prior allocation version remains immutable', async () => {
  const repo = await base(); await fundedEnvelope(repo);
  const before = await repo.readSnapshot(), version = before.templateVersions[0], template = before.templates[0];
  const edited = await send(repo, 'saveTemplate', { templateId: template.id, name: ' Renamed template ', currencyCode: 'VND', fixedScope: version.fixedScope, lines: version.lines });
  const state = await repo.readSnapshot();
  assert.equal(state.templates[0].name, 'Renamed template');
  assert.equal(state.templates[0].currentVersionId, edited.resultIds[1]);
  assert.deepEqual(state.templateVersions[0], version);
  assert.equal(state.allocationApplications[0].templateVersionSnapshotId, version.id);
});

test('CW-10: plan can revise after full unlink while live settled and closed plans remain guarded', async () => {
  const repo = await base(), occurrenceId = await plan(repo), receipt = await actual(repo, 'INCOME', '100', { settlement: { planOccurrenceId: occurrenceId, amountMinor: '100' } });
  const linked = await repo.readSnapshot();
  await assert.rejects(send(repo, 'revisePlan', { occurrenceId, expectedAmountMinor: '90' }), /SETTLED_PLAN_REVISION_BLOCKED/);
  await send(repo, 'unlinkSettlement', { linkId: linked.settlements[0].id, effectiveLocalDate: '2026-10-02' });
  await send(repo, 'revisePlan', { occurrenceId, expectedAmountMinor: '90' });
  let state = await repo.readSnapshot();
  assert.equal(planSummary(state, occurrenceId).openRemaining, '90');
  assert.equal(accountBalance(state, state.accounts[0].id), '1100');
  assert.equal(state.operations.find(o => o.id === receipt.resultIds[0]).memo, 'Original memo');
  await send(repo, 'closePlan', { occurrenceId, closure: 'CANCELLED', effectiveLocalDate: '2026-10-03' });
  await assert.rejects(send(repo, 'revisePlan', { occurrenceId, expectedAmountMinor: '80' }), /SETTLED_PLAN_REVISION_BLOCKED/);
});

test('CW-10: series revision updates fully unlinked/open periods and leaves live or closed periods intact', async () => {
  const repo = await base();
  const seriesId = (await send(repo, 'createMonthlyPlan', { title: 'Synthetic series', direction: 'INCOME', currencyCode: 'VND', amountMinor: '100', anchorLocalDate: '2026-09-01', monthDay: 1, monthKeys: ['2026-09', '2026-10', '2026-11'] })).resultIds[0];
  let state = await repo.readSnapshot();
  const [september, october, november] = state.occurrences;
  await actual(repo, 'INCOME', '100', { settlement: { planOccurrenceId: september.id, amountMinor: '100' } });
  await actual(repo, 'INCOME', '100', { settlement: { planOccurrenceId: october.id, amountMinor: '100' } });
  state = await repo.readSnapshot();
  await send(repo, 'unlinkSettlement', { linkId: state.settlements.find(l => l.planOccurrenceId === september.id).id, effectiveLocalDate: '2026-10-02' });
  await send(repo, 'closePlan', { occurrenceId: november.id, closure: 'CANCELLED', effectiveLocalDate: '2026-10-02' });
  await send(repo, 'revisePlanSeries', { seriesId, amountMinor: '90', validFromOccurrenceKey: '2026-09' });
  state = await repo.readSnapshot();
  assert.equal(state.occurrences.find(o => o.id === september.id).expectedAmountMinor, '90');
  assert.equal(state.occurrences.find(o => o.id === october.id).expectedAmountMinor, '100');
  assert.equal(state.occurrences.find(o => o.id === november.id).expectedAmountMinor, '100');
  await send(repo, 'generateOccurrences', { seriesId, monthKeys: ['2026-12'] });
  assert.equal((await repo.readSnapshot()).occurrences.at(-1).expectedAmountMinor, '90');
});

test('opening correction preserves original history, budget identity and non-income classification', async () => {
  const repo = await base(), before = await repo.readSnapshot(), accountId = before.accounts[0].id;
  const first = await send(repo, 'correctOpeningBalance', { accountId, openingAmountMinor: '1100', effectiveLocalDate: '2026-10-01', reason: 'Statement opening verified' });
  let state = await repo.readSnapshot();
  const summary = openingBalanceSummary(state, accountId), adjustment = state.operations.find(operation => operation.id === first.resultIds[0]);
  assert.equal(summary.correctedOpeningAmountMinor, '1100');
  assert.equal(summary.adjustmentMinor, '100');
  assert.equal(adjustment.operationType, 'ADJUSTMENT');
  assert.equal(adjustment.adjustmentForOperationId, before.operations[0].id);
  assert.deepEqual(state.operations[0], before.operations[0]);
  assert.equal(accountBalance(state, accountId), '1100');
  assert.equal((await queryReport(state, reportDescriptor(state, 'ActualIncome'))).totalMinor, '0');
  assert.equal((await queryReport(state, reportDescriptor(state, 'ActualExpense'))).totalMinor, '0');
  assert.equal((await queryReport(state, reportDescriptor(state, 'CashChangeInPeriod'))).totalMinor, '100');
  const pool = poolSummary(state, state.budgetPools[0].id);
  assert.equal(BigInt(pool.unassigned) + BigInt(pool.envelopeAvailable), BigInt(pool.poolCash));
  assert.equal(sourceCapacity(state, state.fundingSources.at(-1).id).remaining, '100');
  await send(repo, 'correctOpeningBalance', { accountId, openingAmountMinor: '950', effectiveLocalDate: '2026-10-02', reason: 'Final statement' });
  state = await repo.readSnapshot();
  assert.equal(accountBalance(state, accountId), '950');
  assert.equal(openingBalanceSummary(state, accountId).correctedOpeningAmountMinor, '950');
  assert.equal(state.postings.at(-1).signedAmountMinor, '-150');
});

test('opening correction rejects missing reason, unchanged total, history rewrite and earmarked deficit atomically', async () => {
  const repo = await base(), envelopeId = await fundedEnvelope(repo, '950');
  const before = await repo.readSnapshot(), accountId = before.accounts[0].id;
  const input = { accountId, openingAmountMinor: '900', effectiveLocalDate: '2026-10-01', reason: 'Statement corrected' };
  await assert.rejects(send(repo, 'correctOpeningBalance', input), /OPENING_CORRECTION_BUDGET_DEFICIT/);
  await assert.rejects(send(repo, 'correctOpeningBalance', { ...input, openingAmountMinor: '1000' }), /OPENING_BALANCE_UNCHANGED/);
  await assert.rejects(send(repo, 'correctOpeningBalance', { ...input, reason: '' }), /CORRECTION_REASON_REQUIRED/);
  await assert.rejects(send(repo, 'correctOpeningBalance', { ...input, effectiveLocalDate: '2026-08-31' }), /OPENING_CORRECTION_BEFORE_HISTORY/);
  assert.deepEqual(await repo.readSnapshot(), before);
  assert.equal(envelopeBalance(before, envelopeId), '950');
  await send(repo, 'correctOpeningBalance', { ...input, openingAmountMinor: '1050' });
  const after = await repo.readSnapshot();
  await assert.rejects(send(repo, 'correctOpeningBalance', { ...input, openingAmountMinor: '1100', effectiveLocalDate: '2026-09-30' }), /OPENING_CORRECTION_BEFORE_HISTORY/);
  assert.deepEqual(await repo.readSnapshot(), after);
});

test('positive opening correction can fund allocations and requires undoing them before reversal', async () => {
  const repo = await base(); await fundedEnvelope(repo, '1000');
  let state = await repo.readSnapshot();
  const accountId = state.accounts[0].id;
  const correction = await send(repo, 'correctOpeningBalance', { accountId, openingAmountMinor: '1100', effectiveLocalDate: '2026-10-01', reason: 'Statement corrected' });
  state = await repo.readSnapshot();
  const versionId = (await send(repo, 'saveTemplate', { templateId: state.templates[0].id, name: 'Additional correction', currencyCode: 'VND', fixedScope: 'PER_APPLICATION', lines: [{ type: 'FIXED', envelopeId: state.envelopes[0].id, fixedAmountMinor: '100', priority: 0 }] })).resultIds[1];
  state = await repo.readSnapshot();
  const request = { templateVersionId: versionId, budgetPoolId: state.budgetPools[0].id, sourceIds: [state.fundingSources.at(-1).id], requestedAmountMinor: '100', allocationEffectiveLocalDate: '2026-10-01' };
  const allocation = await send(repo, 'confirmAllocation', { ...request, previewHash: (await previewAllocationV3(state, request)).previewHash });
  const before = await repo.readSnapshot();
  await assert.rejects(send(repo, 'reverseOperation', { operationId: correction.resultIds[0], effectiveLocalDate: '2026-10-02', reason: 'Duplicate correction' }), /UNDO_ALLOCATIONS_FIRST/);
  await assert.rejects(send(repo, 'reverseOperation', { operationId: before.operations[0].id, effectiveLocalDate: '2026-10-02', reason: 'Duplicate opening' }), /UNDO_OPENING_CORRECTIONS_FIRST/);
  assert.deepEqual(await repo.readSnapshot(), before);
  await send(repo, 'reverseAllocation', { applicationId: allocation.resultIds[0], effectiveLocalDate: '2026-10-02' });
  await send(repo, 'reverseOperation', { operationId: correction.resultIds[0], effectiveLocalDate: '2026-10-02', reason: 'Duplicate correction' });
  state = await repo.readSnapshot();
  assert.equal(openingBalanceSummary(state, accountId).correctedOpeningAmountMinor, '1000');
  assert.equal(accountBalance(state, accountId), '1000');
});

test('opening adjustment and correction associations survive export/restore with exact balances', async () => {
  const repo = await base(), occurrenceId = await plan(repo), receipt = await actual(repo, 'INCOME', '100', { settlement: { planOccurrenceId: occurrenceId, amountMinor: '100' } });
  let state = await repo.readSnapshot();
  await send(repo, 'correctOpeningBalance', { accountId: state.accounts[0].id, openingAmountMinor: '1100', effectiveLocalDate: '2026-10-02', reason: 'Statement corrected' });
  await send(repo, 'replaceOperation', { operationId: receipt.resultIds[0], amountMinor: '100', effectiveLocalDate: '2026-10-02', reason: 'Memo correction', memo: 'Updated memo' });
  state = await repo.readSnapshot();
  const stage = await stageRestore(await exportSnapshot(state));
  validateSnapshot(stage.snapshot);
  assert.equal(openingBalanceSummary(stage.snapshot, state.accounts[0].id).correctedOpeningAmountMinor, '1100');
  assert.equal(accountBalance(stage.snapshot, state.accounts[0].id), '1200');
  assert.equal(planSummary(stage.snapshot, occurrenceId).netSettled, '100');
});

test('opening adjustment reversal cannot bypass the budget deficit guard after a later downward correction', async () => {
  const repo = await base(); await fundedEnvelope(repo, '1000');
  const state = await repo.readSnapshot(), accountId = state.accounts[0].id;
  const increase = await send(repo, 'correctOpeningBalance', { accountId, openingAmountMinor: '1100', effectiveLocalDate: '2026-10-01', reason: 'Statement correction' });
  await send(repo, 'correctOpeningBalance', { accountId, openingAmountMinor: '1050', effectiveLocalDate: '2026-10-02', reason: 'Final statement correction' });
  const before = await repo.readSnapshot();
  await assert.rejects(send(repo, 'reverseOperation', { operationId: increase.resultIds[0], effectiveLocalDate: '2026-10-03', reason: 'Undo increase' }), /OPENING_CORRECTION_BUDGET_DEFICIT/);
  assert.deepEqual(await repo.readSnapshot(), before);
});

test('reversal cannot predate original actual through commands or forged snapshots', async () => {
  const repo = await base(), receipt = await actual(repo), before = await repo.readSnapshot();
  await assert.rejects(send(repo, 'reverseOperation', { operationId: receipt.resultIds[0], effectiveLocalDate: '2026-09-30', reason: 'Backdated reversal' }), /REVERSAL_BEFORE_OPERATION/);
  assert.deepEqual(await repo.readSnapshot(), before);
  const reversal = await send(repo, 'reverseOperation', { operationId: receipt.resultIds[0], effectiveLocalDate: '2026-10-02', reason: 'Duplicate' });
  const forged = await repo.readSnapshot();
  forged.operations.find(o => o.id === reversal.resultIds[0]).effectiveLocalDate = '2026-09-30';
  forged.postings.find(p => p.operationId === reversal.resultIds[0]).effectiveLocalDate = '2026-09-30';
  assert.throws(() => validateSnapshot(forged), /REVERSAL_BEFORE_OPERATION/);
});

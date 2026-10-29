import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSynthetic, loadCore, benchWrite, benchRepositoryWrite, NOW } from '../scripts/bench-core.mjs';
import { createDataset, validateSnapshot } from '../core/model.js';
import { prepareCommand, VALIDATED_SNAPSHOT } from '../core/commands.js';
import { createMemoryRepository } from '../core/repository.js';
import { previewAllocationV3 } from '../core/allocation.js';

test('2,000-transaction write stays well under the regression bound (synthetic data)', async () => {
  const core = await loadCore(), fixture = await buildSynthetic(2000, core);
  assert.ok(fixture.state.operations.length >= 2000);
  const repoMs = await benchRepositoryWrite(fixture, core, 3), prepareMs = await benchWrite(fixture, core, 3);
  assert.ok(repoMs < 120, `repository write ${repoMs.toFixed(1)} ms`);
  assert.ok(prepareMs < 120, `prepareCommand ${prepareMs.toFixed(1)} ms`);
});

const deepFreeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; };
test('repository-mode commands never mutate records shared with the previous snapshot', async () => {
  const repo = createMemoryRepository(createDataset()); let n = 0;
  const send = async (type, input) => { const s = await repo.readSnapshot(); return (await repo.runAtomicCommand({ commandId: `cow-${++n}`, type, input }, s.revision, { now: NOW })).resultIds; };
  await send('onboard', { name: 'Synthetic bank', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-01-01' });
  let s = await repo.readSnapshot(); const bank = s.accounts[0].id, pool = s.budgetPools[0].id;
  const [invest] = await send('addAccount', { name: 'Synthetic fund', accountType: 'INVESTMENT', currencyCode: 'VND', openingAmountMinor: '1000', openingEffectiveLocalDate: '2026-01-01' });
  const [category] = await send('addCategory', { name: 'Synthetic food', direction: 'EXPENSE' });
  const [envelope] = await send('addEnvelope', { name: 'Synthetic needs', budgetPoolId: pool });
  const [templateId, versionId] = await send('saveTemplate', { name: 'Synthetic', currencyCode: 'VND', fixedScope: 'PER_APPLICATION', lines: [{ envelopeId: envelope, type: 'PERCENT', percentageBps: 10000, priority: 1 }] });
  const [incomeOp] = await send('recordActual', { operationType: 'INCOME', accountId: bank, amountMinor: '100000', effectiveLocalDate: '2026-10-01' });
  const [incomeOp2] = await send('recordActual', { operationType: 'INCOME', accountId: bank, amountMinor: '500', effectiveLocalDate: '2026-10-01' });
  s = await repo.readSnapshot(); const source = s.fundingSources.find(f => s.postings.find(p => p.id === f.sourcePostingId).operationId === incomeOp).id;
  const request = { templateVersionId: versionId, budgetPoolId: pool, sourceIds: [source], requestedAmountMinor: '50000', allocationEffectiveLocalDate: '2026-10-02' };
  const [appId] = await send('confirmAllocation', { ...request, previewHash: (await previewAllocationV3(s, request)).previewHash });
  const [, expensePosting] = await send('recordActual', { operationType: 'EXPENSE', accountId: bank, amountMinor: '300', effectiveLocalDate: '2026-10-03', categoryId: category });
  const [seriesId, occurrence] = await send('createMonthlyPlan', { title: 'Synthetic rent', direction: 'EXPENSE', currencyCode: 'VND', amountMinor: '900', monthDay: 5, anchorLocalDate: '2026-10-05', expectedAccountId: bank, monthKeys: ['2026-10', '2026-11'] });
  const [linkId] = await send('linkSettlement', { planOccurrenceId: occurrence, ledgerPostingId: expensePosting, amountMinor: '100', effectiveLocalDate: '2026-10-05' });
  const base = deepFreeze(await repo.readSnapshot()), open = base.occurrences.find(o => o.id !== occurrence).id;
  const request2 = { ...request, requestedAmountMinor: '100' };
  const commands = [
    ['addAccount', { name: 'Synthetic wallet', accountType: 'E_WALLET', currencyCode: 'VND', openingAmountMinor: '5', openingEffectiveLocalDate: '2026-01-01' }],
    ['updateAccount', { entityId: bank, name: 'Renamed' }], ['updateCategory', { entityId: category, name: 'Renamed' }], ['updateEnvelope', { entityId: envelope, name: 'Renamed' }],
    ['archiveEntity', { collection: 'categories', entityId: category, archived: true }], ['addCategory', { name: 'Other', direction: 'INCOME' }], ['addEnvelope', { name: 'Other', budgetPoolId: pool }],
    ['recordActual', { operationType: 'TRANSFER', fromAccountId: bank, toAccountId: invest, amountMinor: '10', effectiveLocalDate: '2026-10-04' }],
    ['recordActual', { operationType: 'EXPENSE', accountId: bank, amountMinor: '10', effectiveLocalDate: '2026-10-06', settlement: { planOccurrenceId: occurrence, amountMinor: '10' } }],
    ['reverseOperation', { operationId: incomeOp2, effectiveLocalDate: '2026-10-06', reason: 'Synthetic' }],
    ['createPlan', { title: 'One-off', direction: 'INCOME', currencyCode: 'VND', dueLocalDate: '2026-12-01', expectedAmountMinor: '10' }],
    ['generateOccurrences', { seriesId, monthKeys: ['2026-12'] }], ['revisePlan', { occurrenceId: open, expectedAmountMinor: '950' }],
    ['revisePlanSeries', { seriesId, validFromOccurrenceKey: '2026-11', amountMinor: '990' }], ['reschedulePlan', { occurrenceId: open, dueLocalDate: '2026-11-07' }],
    ['closePlan', { occurrenceId: occurrence, closure: 'FINALIZED', effectiveLocalDate: '2026-10-06', reason: 'done' }],
    ['unlinkSettlement', { linkId, effectiveLocalDate: '2026-10-06' }],
    ['saveTemplate', { templateId, name: 'Synthetic', currencyCode: 'VND', fixedScope: 'PER_APPLICATION', lines: [{ envelopeId: envelope, type: 'PERCENT', percentageBps: 5000, priority: 1 }] }],
    ['confirmAllocation', { ...request2, previewHash: (await previewAllocationV3(base, request2)).previewHash }],
    ['reverseAllocation', { applicationId: appId, effectiveLocalDate: '2026-10-06', acknowledgeDeficit: true }],
    ['linkExpense', { expensePostingId: expensePosting, envelopeId: envelope, amountMinor: '200', effectiveLocalDate: '2026-10-06' }],
    ['applyRecipePreset', { presetId: 'six-jars', budgetPoolId: pool }], ['recordValuation', { accountId: invest, date: '2026-10-06', valueMinor: '1500' }],
  ];
  for (const [type, input] of commands) {
    const out = await prepareCommand(base, { commandId: `frozen-${type}-${++n}`, type, input }, base.revision, { now: NOW, [VALIDATED_SNAPSHOT]: true });
    assert.equal(out.snapshot.revision, base.revision + 1, type); validateSnapshot(out.snapshot);
  }
  validateSnapshot(base);
});

test('public prepareCommand still validates its input; the repository marker cannot be forged with a string key', async () => {
  const state = createDataset(); state.accounts.push({ id: 'not-a-uuid' });
  await assert.rejects(prepareCommand(state, { commandId: 'x', type: 'addCategory', input: { name: 'n', direction: 'INCOME' } }, 0), /INVALID_RECORD_ID/);
  await assert.rejects(prepareCommand(state, { commandId: 'x', type: 'addCategory', input: { name: 'n', direction: 'INCOME' } }, 0, { validatedSnapshot: true }), /INVALID_RECORD_ID/);
});

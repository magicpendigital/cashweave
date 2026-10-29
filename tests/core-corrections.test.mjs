import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, validateSnapshot, accountBalance, envelopeBalance, poolSummary, planSummary } from '../core/model.js';
import { createMemoryRepository } from '../core/repository.js';
import { previewAllocationV3 } from '../core/allocation.js';

const now = '2026-10-29T03:00:00.000Z';
let serial = 0;
async function send(repo, type, input, commandId = `fix-${++serial}`) { const s = await repo.readSnapshot(); return repo.runAtomicCommand({ commandId, type, input }, s.revision, { now }); }
// Bank 10,000 with 1,000 allocated to one envelope.
async function funded() {
  const repo = createMemoryRepository(createDataset());
  await send(repo, 'onboard', { name: 'Synthetic bank', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-09-01' });
  let s = await repo.readSnapshot(); const bank = s.accounts[0].id, pool = s.budgetPools[0].id;
  const [envelope] = (await send(repo, 'addEnvelope', { name: 'Synthetic food', budgetPoolId: pool })).resultIds;
  const [, versionId] = (await send(repo, 'saveTemplate', { name: 'All in', currencyCode: 'VND', fixedScope: 'PER_APPLICATION', lines: [{ envelopeId: envelope, type: 'PERCENT', percentageBps: 10000, priority: 1 }] })).resultIds;
  await send(repo, 'recordActual', { operationType: 'INCOME', accountId: bank, amountMinor: '10000', effectiveLocalDate: '2026-10-01' });
  s = await repo.readSnapshot();
  const request = { templateVersionId: versionId, budgetPoolId: pool, sourceIds: [s.fundingSources[0].id], requestedAmountMinor: '1000', allocationEffectiveLocalDate: '2026-10-01' };
  await send(repo, 'confirmAllocation', { ...request, previewHash: (await previewAllocationV3(s, request)).previewHash });
  return { repo, bank, pool, envelope };
}
async function linkedExpense(ctx, amount = '300', link = amount) {
  const [operationId, postingId] = (await send(ctx.repo, 'recordActual', { operationType: 'EXPENSE', accountId: ctx.bank, amountMinor: amount, effectiveLocalDate: '2026-10-05' })).resultIds;
  if (link) await send(ctx.repo, 'linkExpense', { expensePostingId: postingId, envelopeId: ctx.envelope, amountMinor: link, effectiveLocalDate: '2026-10-05' });
  return { operationId, postingId };
}

test('a plain expense can be reversed and the ledger is restored', async () => {
  const ctx = await funded(); const { operationId } = await linkedExpense(ctx, '300', '');
  await send(ctx.repo, 'reverseOperation', { operationId, effectiveLocalDate: '2026-10-06', reason: 'Nhập nhầm' });
  const s = await ctx.repo.readSnapshot(); validateSnapshot(s);
  assert.equal(accountBalance(s, ctx.bank), '10000');
  await assert.rejects(send(ctx.repo, 'reverseOperation', { operationId, effectiveLocalDate: '2026-10-06', reason: 'again' }), /OPERATION_ALREADY_REVERSED/);
});

test('reversing a fund-linked expense releases the envelope spend', async () => {
  const ctx = await funded(); const { operationId, postingId } = await linkedExpense(ctx);
  let s = await ctx.repo.readSnapshot(); assert.equal(envelopeBalance(s, ctx.envelope), '700');
  await send(ctx.repo, 'reverseOperation', { operationId, effectiveLocalDate: '2026-10-07', reason: 'Hủy' });
  s = await ctx.repo.readSnapshot(); validateSnapshot(s);
  assert.equal(envelopeBalance(s, ctx.envelope), '1000'); assert.equal(envelopeBalance(s, ctx.envelope, '2026-10-07'), '700');
  assert.equal(accountBalance(s, ctx.bank), '10000'); assert.equal(poolSummary(s, ctx.pool).unassigned, '9000');
  assert.equal(s.spendLinks.filter(l => l.expensePostingId === postingId).reduce((n, l) => n + BigInt(l.signedAmountMinor), 0n), 0n);
  await assert.rejects(send(ctx.repo, 'linkExpense', { expensePostingId: postingId, envelopeId: ctx.envelope, amountMinor: '1', effectiveLocalDate: '2026-10-07' }), /INVALID_EXPENSE_POSTING/);
});

test('replacing a fund-linked expense: smaller and larger within capacity carry the link; beyond capacity fails atomically', async () => {
  const ctx = await funded(); const { operationId } = await linkedExpense(ctx);
  const smaller = await send(ctx.repo, 'replaceOperation', { operationId, amountMinor: '200', effectiveLocalDate: '2026-10-06', reason: 'Sửa số tiền' });
  let s = await ctx.repo.readSnapshot(); validateSnapshot(s);
  assert.equal(envelopeBalance(s, ctx.envelope), '800'); assert.equal(accountBalance(s, ctx.bank), '9800');
  const replacementOp = smaller.resultIds[1], replacementPosting = s.postings.find(p => p.operationId === replacementOp);
  assert.equal(s.spendLinks.find(l => l.id === smaller.resultIds[2]).expensePostingId, replacementPosting.id);
  const before = await ctx.repo.readSnapshot();
  await assert.rejects(send(ctx.repo, 'replaceOperation', { operationId: replacementOp, amountMinor: '1500', effectiveLocalDate: '2026-10-07', reason: 'Quá quỹ' }), /ENVELOPE_INSUFFICIENT/);
  assert.deepEqual(await ctx.repo.readSnapshot(), before);
  const larger = await send(ctx.repo, 'replaceOperation', { operationId: replacementOp, amountMinor: '900', effectiveLocalDate: '2026-10-07', reason: 'Sửa lớn hơn' });
  s = await ctx.repo.readSnapshot(); validateSnapshot(s);
  assert.equal(envelopeBalance(s, ctx.envelope), '100'); assert.equal(accountBalance(s, ctx.bank), '9100'); assert.equal(larger.resultIds.length, 3);
});

test('partial links are capped at the new amount; explicit empty spendLinks releases the envelope', async () => {
  const ctx = await funded(); const a = await linkedExpense(ctx, '300', '100');
  await send(ctx.repo, 'replaceOperation', { operationId: a.operationId, amountMinor: '50', effectiveLocalDate: '2026-10-06', reason: 'partial' });
  let s = await ctx.repo.readSnapshot(); validateSnapshot(s); assert.equal(envelopeBalance(s, ctx.envelope), '950');
  const b = await linkedExpense(ctx, '200');
  await send(ctx.repo, 'replaceOperation', { operationId: b.operationId, amountMinor: '250', effectiveLocalDate: '2026-10-06', reason: 'drop link', spendLinks: [] });
  s = await ctx.repo.readSnapshot(); validateSnapshot(s); assert.equal(envelopeBalance(s, ctx.envelope), '950');
  await assert.rejects(send(ctx.repo, 'replaceOperation', { operationId: b.operationId, amountMinor: '1', effectiveLocalDate: '2026-10-06', reason: 'x' }), /OPERATION_ALREADY_REVERSED/);
});

test('replaceOperation replays idempotently by commandId', async () => {
  const ctx = await funded(); const { operationId } = await linkedExpense(ctx);
  const first = await send(ctx.repo, 'replaceOperation', { operationId, amountMinor: '250', effectiveLocalDate: '2026-10-06', reason: 'Sửa' }, 'replace-once');
  const revision = (await ctx.repo.readSnapshot()).revision;
  assert.deepEqual(await send(ctx.repo, 'replaceOperation', { operationId, amountMinor: '250', effectiveLocalDate: '2026-10-06', reason: 'Sửa' }, 'replace-once'), first);
  const s = await ctx.repo.readSnapshot(); assert.equal(s.revision, revision); assert.equal(s.operations.filter(o => o.replacementForOperationId === operationId).length, 1);
  await assert.rejects(send(ctx.repo, 'replaceOperation', { operationId, amountMinor: '251', effectiveLocalDate: '2026-10-06', reason: 'Sửa' }, 'replace-once'), /IDEMPOTENCY_CONFLICT/);
});

test('overspending rejections still hold for fresh expenses and forged links', async () => {
  const ctx = await funded(); const { postingId, operationId } = await linkedExpense(ctx, '300', '');
  await assert.rejects(send(ctx.repo, 'linkExpense', { expensePostingId: postingId, envelopeId: ctx.envelope, amountMinor: '1001', effectiveLocalDate: '2026-10-05' }), /ENVELOPE_INSUFFICIENT/);
  await send(ctx.repo, 'linkExpense', { expensePostingId: postingId, envelopeId: ctx.envelope, amountMinor: '300', effectiveLocalDate: '2026-10-05' });
  let s = await ctx.repo.readSnapshot();
  const over = structuredClone(s); over.spendLinks[0].signedAmountMinor = '301'; assert.throws(() => validateSnapshot(over), /SPEND_CAPACITY_EXCEEDED/);
  await send(ctx.repo, 'reverseOperation', { operationId, effectiveLocalDate: '2026-10-06', reason: 'x' });
  s = await ctx.repo.readSnapshot(); const reversal = s.postings.find(p => p.reversesPostingId === postingId);
  const onReversal = structuredClone(s); onReversal.spendLinks.push({ ...structuredClone(s.spendLinks[0]), id: crypto.randomUUID(), expensePostingId: reversal.id, effectiveLocalDate: '2026-10-06' });
  assert.throws(() => validateSnapshot(onReversal), /INVALID_SPEND_LINK/);
  const unreleased = structuredClone(s); unreleased.spendLinks = unreleased.spendLinks.filter(l => !l.reversalOfLinkId);
  assert.throws(() => validateSnapshot(unreleased), /SPEND_HISTORICAL_CAPACITY_EXCEEDED/);
});

test('a correction neutralises the original in its own period; the replacement lands on its new date', async () => {
  const ctx = await funded(); const { operationId } = await linkedExpense(ctx, '300');
  const receipt = await send(ctx.repo, 'replaceOperation', { operationId, amountMinor: '250', effectiveLocalDate: '2026-09-28', reason: 'Wrong month' });
  const s = await ctx.repo.readSnapshot(); validateSnapshot(s);
  const reversal = s.operations.find(o => o.id === receipt.resultIds[0]), replacement = s.operations.find(o => o.id === receipt.resultIds[1]);
  assert.equal(reversal.effectiveLocalDate, '2026-10-05'); assert.equal(replacement.effectiveLocalDate, '2026-09-28');
  assert.equal(accountBalance(s, ctx.bank, '2026-10-01'), '-250'); assert.equal(accountBalance(s, ctx.bank, '2026-10-05'), '9750'); assert.equal(accountBalance(s, ctx.bank), '9750');
  assert.equal(envelopeBalance(s, ctx.envelope), '750'); assert.equal(envelopeBalance(s, ctx.envelope, '2026-10-05'), '750');
  // Plain cancel keeps its user-chosen date.
  const other = await linkedExpense(ctx, '10', '');
  const cancel = await send(ctx.repo, 'reverseOperation', { operationId: other.operationId, effectiveLocalDate: '2026-10-20', reason: 'Hoàn tiền' });
  assert.equal((await ctx.repo.readSnapshot()).operations.find(o => o.id === cancel.resultIds[0]).effectiveLocalDate, '2026-10-20');
});

test('replacing an income whose allocation was undone reverses after that allocation history', async () => {
  const ctx = await funded(); let s = await ctx.repo.readSnapshot();
  const app = s.allocationApplications[0];
  await send(ctx.repo, 'reverseAllocation', { applicationId: app.id, effectiveLocalDate: '2026-10-03', acknowledgeDeficit: true });
  const income = s.operations.find(o => o.operationType === 'INCOME');
  const receipt = await send(ctx.repo, 'replaceOperation', { operationId: income.id, amountMinor: '9000', effectiveLocalDate: '2026-10-01', reason: 'Lương sai' });
  s = await ctx.repo.readSnapshot(); validateSnapshot(s);
  assert.equal(s.operations.find(o => o.id === receipt.resultIds[0]).effectiveLocalDate, '2026-10-03');
  assert.equal(accountBalance(s, ctx.bank), '9000'); assert.equal(poolSummary(s, ctx.pool).unassigned, '9000');
});

test('plan settlements are carried (capped) by a correction; a currency change drops them', async () => {
  const ctx = await funded();
  const [planId] = (await send(ctx.repo, 'createPlan', { title: 'Synthetic rent', direction: 'EXPENSE', currencyCode: 'VND', dueLocalDate: '2026-10-05', expectedAmountMinor: '300', expectedAccountId: ctx.bank })).resultIds;
  const [operationId] = (await send(ctx.repo, 'recordActual', { operationType: 'EXPENSE', accountId: ctx.bank, amountMinor: '300', effectiveLocalDate: '2026-10-05', settlement: { planOccurrenceId: planId, amountMinor: '300' } })).resultIds;
  const smaller = await send(ctx.repo, 'replaceOperation', { operationId, amountMinor: '200', effectiveLocalDate: '2026-10-04', reason: 'Bớt' });
  let s = await ctx.repo.readSnapshot(); validateSnapshot(s);
  assert.equal(planSummary(s, planId).openRemaining, '100'); assert.equal(smaller.resultIds.length, 3);
  await send(ctx.repo, 'closePlan', { occurrenceId: planId, closure: 'FINALIZED', effectiveLocalDate: '2026-10-06' });
  const again = await send(ctx.repo, 'replaceOperation', { operationId: smaller.resultIds[1], amountMinor: '200', effectiveLocalDate: '2026-10-04', memo: 'note', reason: 'Ghi chú' });
  s = await ctx.repo.readSnapshot(); validateSnapshot(s); assert.equal(planSummary(s, planId).netSettled, '200'); assert.equal(again.resultIds.length, 3);
  const [usd] = (await send(ctx.repo, 'addAccount', { name: 'USD', accountType: 'BANK', currencyCode: 'USD', openingAmountMinor: '1000', openingEffectiveLocalDate: '2026-09-01' })).resultIds;
  const moved = await send(ctx.repo, 'replaceOperation', { operationId: again.resultIds[1], amountMinor: '200', effectiveLocalDate: '2026-10-04', accountId: usd, reason: 'USD' });
  s = await ctx.repo.readSnapshot(); validateSnapshot(s); assert.equal(planSummary(s, planId).netSettled, '0'); assert.equal(moved.resultIds.length, 2);
  await assert.rejects(send(ctx.repo, 'replaceOperation', { operationId: moved.resultIds[1], amountMinor: '1', effectiveLocalDate: '2026-10-04', reason: 'x', settlements: 'x' }), /INVALID_SETTLEMENTS/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDataset, validateSnapshot } from '../core/model.js';
import { createMemoryRepository } from '../core/repository.js';
import { previewAllocationV3 } from '../core/allocation.js';
import { RECIPE_PRESETS, presetById, previewRecipe } from '../core/recipes.js';

const now = '2026-10-29T03:00:00.000Z';
let serial = 0;
async function send(repo, type, input, commandId = `recipe-${++serial}`) { const s = await repo.readSnapshot(); return repo.runAtomicCommand({ commandId, type, input }, s.revision, { now }); }
async function base() {
  const repo = createMemoryRepository(createDataset());
  await send(repo, 'onboard', { name: 'Synthetic bank', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2026-09-01' });
  return repo;
}

test('recipe presets are frozen, complete and Vietnamese-labelled', () => {
  assert.deepEqual(RECIPE_PRESETS.map(p => p.id), ['six-jars', '50-30-20', 'pay-yourself-first', 'zero-based']);
  assert.ok(Object.isFrozen(RECIPE_PRESETS) && Object.isFrozen(RECIPE_PRESETS[0].lines[0]));
  assert.throws(() => { RECIPE_PRESETS[0].lines[0].value = 1; }, TypeError);
  for (const p of RECIPE_PRESETS) assert.ok(p.name && p.summary && p.suitedFor && p.version === 1 && p.lines.length);
  const jars = presetById('six-jars');
  assert.deepEqual(jars.lines.map(l => [l.envelopeName, l.value]), [['Thiết yếu', 5500], ['Tự do tài chính', 1000], ['Tiết kiệm dài hạn', 1000], ['Học tập', 1000], ['Hưởng thụ', 1000], ['Cho đi', 500]]);
  assert.deepEqual(presetById('50-30-20').lines.map(l => [l.envelopeName, l.value]), [['Thiết yếu', 5000], ['Mong muốn', 3000], ['Tiết kiệm & trả nợ', 2000]]);
  assert.deepEqual(presetById('pay-yourself-first').lines.map(l => [l.envelopeName, l.value]), [['Tiết kiệm & đầu tư', 2000]]);
  assert.equal(presetById('pay-yourself-first').leftoverPolicy, 'UNASSIGNED');
  const zero = presetById('zero-based');
  assert.ok(zero.lines.every(l => l.type === 'FIXED')); assert.equal(zero.shortagePolicy, 'PARTIAL_BY_PRIORITY'); assert.equal(zero.leftoverPolicy, 'ENVELOPE'); assert.equal(zero.leftoverEnvelopeName, 'Dự phòng');
  assert.equal(presetById('nope'), null);
  const preview = previewRecipe('50-30-20', '1000001');
  assert.deepEqual(preview.lines.map(l => l.amountMinor), ['500001', '300000', '200000']);
  assert.throws(() => previewRecipe('six-jars', '100', { lineOverrides: { missing: 1 } }), /UNKNOWN_RECIPE_LINE/);
});

test('six jars on 18,500,000 VND previews exactly 55/10/10/10/10/5 and sums to the income', async () => {
  const repo = await base(); let s = await repo.readSnapshot(); const pool = s.budgetPools[0].id;
  const receipt = await send(repo, 'applyRecipePreset', { presetId: 'six-jars', budgetPoolId: pool });
  s = await repo.readSnapshot(); validateSnapshot(s);
  const [templateId, versionId, ...envelopeIds] = receipt.resultIds;
  assert.equal(envelopeIds.length, 6); assert.deepEqual(envelopeIds.map(id => s.envelopes.find(e => e.id === id).name), ['Thiết yếu', 'Tự do tài chính', 'Tiết kiệm dài hạn', 'Học tập', 'Hưởng thụ', 'Cho đi']);
  const version = s.templateVersions.find(v => v.id === versionId);
  assert.equal(version.templateId, templateId); assert.equal(version.presetId, 'six-jars'); assert.equal(version.presetVersion, 1);
  assert.equal(s.templates.find(t => t.id === templateId).name, '6 chiếc hũ');
  await send(repo, 'recordActual', { operationType: 'INCOME', accountId: s.accounts[0].id, amountMinor: '18500000', effectiveLocalDate: '2026-10-06' });
  s = await repo.readSnapshot();
  const request = { templateVersionId: versionId, budgetPoolId: pool, sourceIds: [s.fundingSources[0].id], requestedAmountMinor: '18500000', allocationEffectiveLocalDate: '2026-10-06' };
  const preview = await previewAllocationV3(s, request);
  assert.deepEqual(preview.result.lines.map(l => l.amountMinor), ['10175000', '1850000', '1850000', '1850000', '1850000', '925000']);
  assert.equal(preview.result.lines.reduce((n, l) => n + BigInt(l.amountMinor), 0n), 18500000n);
  assert.equal(preview.result.consumptionMinor, '18500000');
  await send(repo, 'confirmAllocation', { ...request, previewHash: preview.previewHash });
  validateSnapshot(await repo.readSnapshot());
});

test('applying twice reuses envelopes (case-insensitive) and the template; archived envelopes are not matched; replay is idempotent', async () => {
  const repo = await base(); let s = await repo.readSnapshot(); const pool = s.budgetPools[0].id;
  const [existing] = (await send(repo, 'addEnvelope', { name: '  thiết YẾU ', budgetPoolId: pool })).resultIds;
  const [archived] = (await send(repo, 'addEnvelope', { name: 'Mong muốn', budgetPoolId: pool })).resultIds;
  await send(repo, 'archiveEntity', { collection: 'envelopes', entityId: archived, archived: true });
  const first = await send(repo, 'applyRecipePreset', { presetId: '50-30-20', budgetPoolId: pool }, 'recipe-fixed-id');
  s = await repo.readSnapshot();
  assert.equal(first.resultIds[2], existing); assert.notEqual(first.resultIds[3], archived);
  const count = s.envelopes.length, revision = s.revision;
  const replay = await send(repo, 'applyRecipePreset', { presetId: '50-30-20', budgetPoolId: pool }, 'recipe-fixed-id');
  assert.deepEqual(replay, first); assert.equal((await repo.readSnapshot()).revision, revision);
  await assert.rejects(send(repo, 'applyRecipePreset', { presetId: 'six-jars', budgetPoolId: pool }, 'recipe-fixed-id'), /IDEMPOTENCY_CONFLICT/);
  const second = await send(repo, 'applyRecipePreset', { presetId: '50-30-20', budgetPoolId: pool, lineOverrides: { needs: 6000, wants: 2000 } });
  s = await repo.readSnapshot(); validateSnapshot(s);
  assert.equal(s.envelopes.length, count); assert.deepEqual(second.resultIds.slice(2), first.resultIds.slice(2));
  assert.equal(second.resultIds[0], first.resultIds[0]); assert.equal(s.templates.length, 1);
  const version = s.templateVersions.find(v => v.id === second.resultIds[1]);
  assert.equal(version.versionNumber, 2); assert.deepEqual(version.lines.map(l => l.percentageBps), [6000, 2000, 2000]);
  assert.deepEqual(version.lines.map(l => l.stableLineKey), s.templateVersions.find(v => v.id === first.resultIds[1]).lines.map(l => l.stableLineKey));
});

test('recipe command failures are atomic and validated', async () => {
  const repo = await base(); const s = await repo.readSnapshot(), pool = s.budgetPools[0].id;
  await assert.rejects(send(repo, 'applyRecipePreset', { presetId: 'missing', budgetPoolId: pool }), /UNKNOWN_RECIPE_PRESET/);
  await assert.rejects(send(repo, 'applyRecipePreset', { presetId: 'six-jars', budgetPoolId: pool, lineOverrides: { give: 1000 } }), /PERCENT_OVER_100/);
  await assert.rejects(send(repo, 'applyRecipePreset', { presetId: 'six-jars', budgetPoolId: pool, lineOverrides: { other: 1 } }), /UNKNOWN_RECIPE_LINE/);
  await assert.rejects(send(repo, 'applyRecipePreset', { presetId: 'six-jars', budgetPoolId: 'missing' }), /UNKNOWN_BUDGETPOOLS/);
  const after = await repo.readSnapshot(); assert.equal(after.envelopes.length, 0); assert.equal(after.revision, s.revision);
  const zero = await send(repo, 'applyRecipePreset', { presetId: 'zero-based', budgetPoolId: pool, lineOverrides: { housing: '5000000', food: '3000000' } });
  const state = await repo.readSnapshot(), version = state.templateVersions.find(v => v.id === zero.resultIds[1]);
  assert.equal(version.fixedScope, 'CALENDAR_MONTH'); assert.equal(state.envelopes.find(e => e.id === version.leftoverEnvelopeId).name, 'Dự phòng');
  assert.equal(zero.resultIds.length, 2 + 6);
});

test('recipes module stays inside the pure domain boundary', async () => {
  const source = await readFile(new URL('../core/recipes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"][^'"]*(?:ui\/|@capacitor|mobile\/|backend\/)/);
  assert.doesNotMatch(source, /\b(?:document|window|localStorage|indexedDB|fetch|WebSocket)\s*[.(]/);
});

// Measured fictional recovery rehearsal. Payloads remain in worker RAM; only a
// sanitized receipt is written. Never opens saves, IndexedDB, native APIs or a network.
import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { readFile, readdir, lstat, mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createDataset, record, validateSnapshot, accountBalance, COLLECTIONS } from '../core/model.js';
import { canonical } from '../core/identity.js';
import { addDays } from '../core/calendar.js';
import { createMemoryRepository } from '../core/repository.js';
import { exportSnapshotFiles, stageRestoreFiles } from '../core/migration.js';

const script = fileURLToPath(import.meta.url), root = resolve(dirname(script), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ms = start => Math.round((performance.now() - start) * 1000) / 1000;
const now = '2026-10-20T00:00:00.000Z', targetPostings = 10000, maxRuntimeMs = 30000;
const prohibited = /(^|\/)(\.env(?:\..*)?|\.git|node_modules|credentials?|secrets?|.*\.(?:pem|p12|pfx|keystore|jks))($|\/)/i;

async function sourceInputs() {
  const profile = JSON.parse(await readFile(resolve(root, 'docs/release/release-profile.json'), 'utf8'));
  const entries = new Map();
  async function visit(name) {
    if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || name.split('/').some(part => !part || part === '.' || part === '..') || prohibited.test(name)) throw new Error('UNSAFE_REHEARSAL_INPUT');
    let path = root;
    for (const part of name.split('/')) { path = resolve(path, part); if ((await lstat(path)).isSymbolicLink()) throw new Error('SYMLINK_REHEARSAL_INPUT'); }
    const metadata = await lstat(path);
    if (metadata.isDirectory()) for (const entry of (await readdir(path)).sort()) await visit(`${name}/${entry}`);
    else if (metadata.isFile()) entries.set(name, { path: name, sha256: hash(await readFile(path)), bytes: metadata.size });
    else throw new Error('UNSUPPORTED_REHEARSAL_INPUT');
  }
  for (const name of profile.inputRoots) await visit(name);
  // Bind this script even if a future profile accidentally removes scripts/.
  await visit('scripts/rehearse-recovery.mjs');
  const files = [...entries.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { sha256: hash(JSON.stringify(files)), files };
}

function fixture() {
  const state = createDataset(); let serial = 100;
  state.datasetId = '00000000-0000-4000-8000-000000000001';
  Object.assign(state.profile, { id: '00000000-0000-4000-8000-000000000002', datasetId: state.datasetId, createdAtUtc: now, updatedAtUtc: now, onboardingCompletedAtUtc: now });
  const add = (collection, fields) => { const item = record(state, fields, now, `00000000-0000-4000-8000-${(serial++).toString(16).padStart(12, '0')}`); state[collection].push(item); return item; };
  const pool = add('budgetPools', { name: 'Fictional recovery VND pool', currencyCode: 'VND' });
  const accounts = [0, 1].map(index => add('accounts', { name: `Fictional recovery account ${index + 1}`, type: 'BANK', currencyCode: 'VND', includeInBudget: true, budgetPoolId: pool.id, archivedAtUtc: null }));
  for (const account of accounts) {
    const operation = add('operations', { operationType: 'OPENING', commandId: `fictional-opening-${account.id}`, effectiveLocalDate: '2025-12-31', memo: 'Fictional opening', committedAtUtc: now });
    const posting = add('postings', { operationId: operation.id, accountId: account.id, currencyCode: 'VND', signedAmountMinor: '1000000000', reportingOrigin: 'OPENING', effectiveLocalDate: '2025-12-31', stableOrder: 0 });
    add('fundingSources', { budgetPoolId: pool.id, sourcePostingId: posting.id, currencyCode: 'VND', eligibleAmountMinor: posting.signedAmountMinor });
  }
  const categories = [0, 1].map(index => add('categories', { name: index ? 'Fictional expense' : 'Fictional income', direction: index ? 'EXPENSE' : 'INCOME', archivedAtUtc: null }));
  for (let index = 0; state.postings.length < targetPostings; index++) {
    const transfer = index % 10 === 0 && state.postings.length + 2 <= targetPostings;
    const kind = transfer ? 'TRANSFER' : index % 3 === 0 ? 'INCOME' : 'EXPENSE', date = addDays('2026-01-01', index % 292);
    const operation = add('operations', { operationType: kind, commandId: `fictional-recovery-${index}`, effectiveLocalDate: date, memo: `Fictional recovery ${kind.toLowerCase()} ${index}`, committedAtUtc: now });
    const legs = transfer ? [{ accountId: accounts[0].id, signedAmountMinor: '-100' }, { accountId: accounts[1].id, signedAmountMinor: '100' }] : [{ accountId: accounts[index % 2].id, signedAmountMinor: kind === 'INCOME' ? '150' : '-100' }];
    for (const [stableOrder, leg] of legs.entries()) {
      const posting = add('postings', { ...leg, operationId: operation.id, currencyCode: 'VND', reportingOrigin: kind, effectiveLocalDate: date, stableOrder, ...(transfer ? {} : { categoryId: categories[kind === 'INCOME' ? 0 : 1].id }) });
      if (kind === 'INCOME') add('fundingSources', { budgetPoolId: pool.id, sourcePostingId: posting.id, currencyCode: 'VND', eligibleAmountMinor: posting.signedAmountMinor });
    }
    if (index % 1000 === 0) add('occurrences', { title: `Fictional plan ${index}`, direction: 'EXPENSE', currencyCode: 'VND', dueLocalDate: '2026-11-01', originalDueLocalDate: '2026-11-01', expectedAmountMinor: '200', expectedAccountId: accounts[0].id, closure: 'OPEN', closureHistory: [] });
  }
  state.revision = 1; state.profile.revision = 1;
  return validateSnapshot(state);
}

const counts = snapshot => Object.fromEntries(COLLECTIONS.map(collection => [collection, snapshot[collection].length]));
const balances = snapshot => snapshot.accounts.map(account => ({ accountId: account.id, currencyCode: account.currencyCode, amountMinor: accountBalance(snapshot, account.id) }));
function rebaseToSource(snapshot, sourceDatasetId) {
  const rebased = structuredClone(snapshot);
  rebased.datasetId = sourceDatasetId; rebased.profile.datasetId = sourceDatasetId;
  for (const collection of COLLECTIONS) for (const item of rebased[collection]) item.datasetId = sourceDatasetId;
  return rebased;
}
function reconcile(snapshot, source) {
  validateSnapshot(snapshot);
  assert.equal(canonical(rebaseToSource(snapshot, source.datasetId)), canonical(source), 'Full snapshot differs beyond dataset-ID rebasing');
  assert.deepEqual(counts(snapshot), counts(source)); assert.deepEqual(balances(snapshot), balances(source));
}
const expected = snapshot => ({ expectedDatasetId: snapshot.datasetId, expectedRevision: snapshot.revision, mode: 'new' });

async function rehearsal() {
  const phases = []; let source, files, rawSource, repository, baseline, stage, restored, restoreRtoMs, rollbackRtoMs, freshRestoreRtoMs;
  const phase = async (name, action) => {
    const start = performance.now(), detail = await action();
    const result = { phase: name, status: 'PASS', durationMs: ms(start), ...detail };
    phases.push(result); parentPort.postMessage({ type: 'phase', value: result });
  };
  await phase('fictional-fixture-validation', async () => {
    source = fixture(); repository = createMemoryRepository();
    await repository.runAtomicCommand({ commandId: 'fictional-destination-onboard', type: 'onboard', input: { name: 'Fictional retained destination', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '500', openingEffectiveLocalDate: '2026-10-01' } }, 0, { now });
    baseline = await repository.readSnapshot();
    return { sourceCounts: counts(source), sourceBalances: balances(source), baselineCounts: counts(baseline), baselineBalances: balances(baseline), sourceSnapshotSha256: hash(canonical(source)) };
  });
  await phase('multipart-export', async () => {
    files = await exportSnapshotFiles(source); assert.ok(files.length > 1, '10k fixture must exercise multipart');
    assert.ok(files.every(file => Buffer.byteLength(file.text) <= 5 * 1024 * 1024));
    const parts = files.map(file => JSON.parse(file.text)).sort((a, b) => a.index - b.index);
    rawSource = Buffer.concat(parts.map(part => Buffer.from(part.dataBase64, 'base64'))).toString('utf8');
    assert.equal(canonical(JSON.parse(rawSource).entities), canonical(source));
    return { fileCount: files.length, envelopeBytes: Buffer.byteLength(rawSource), files: files.map(file => ({ name: file.name, bytes: Buffer.byteLength(file.text), sha256: hash(file.text) })), exactRawSourceSha256: hash(rawSource) };
  });
  await phase('reordered-restore-and-guarded-activation', async () => {
    const start = performance.now();
    stage = await stageRestoreFiles([...files].reverse().map(file => file.text)); reconcile(stage.snapshot, source);
    await repository.stageRestore(stage, { mode: 'new' });
    assert.equal((await repository.readStage(stage.id)).rawBackup, rawSource, 'Exact source backup was not retained');
    for (const options of [{ ...expected(baseline), backupAcknowledged: true }, { ...expected(baseline), confirm: true }]) await assert.rejects(repository.activateStage(stage.id, options), /STAGE_CONFIRMATION_REQUIRED/);
    await assert.rejects(repository.activateStage(stage.id, { ...expected(baseline), expectedRevision: baseline.revision + 1, confirm: true, backupAcknowledged: true }), /ACTIVATION_DATASET_REVISION_CONFLICT/);
    assert.equal(canonical(await repository.readSnapshot()), canonical(baseline), 'Failed activation modified destination');
    await repository.activateStage(stage.id, { ...expected(baseline), confirm: true, backupAcknowledged: true });
    restored = await repository.readSnapshot(); reconcile(restored, source); restoreRtoMs = ms(start);
    assert.equal((await repository.readStage(stage.id)).rawBackup, rawSource);
    return { fullSnapshotMatchExceptDatasetIds: true, allCollectionsMatch: true, allBalancesMatch: true, exactRawSourceRetained: true, missingConfirmRejected: true, missingBackupAcknowledgementRejected: true, staleRevisionRejected: true, failedActivationPreservedDestination: true, measuredRestoreRtoMs: restoreRtoMs };
  });
  await phase('snapshot-only-memory-reopen-simulation', async () => {
    const reopened = createMemoryRepository(JSON.parse(JSON.stringify(restored)));
    reconcile(await reopened.readSnapshot(), source);
    return { activeSnapshotMatch: true, storage: 'memory', realRestartOrPersistenceTested: false, retainedArchivesReopened: false, reason: 'Node has no IndexedDB; only the active snapshot is serialized and reconstructed in RAM. Original RAM repository retains rollback history for the following phase.' };
  });
  await phase('guarded-rollback-and-fresh-same-backup-restore', async () => {
    let start = performance.now();
    await repository.rollback(baseline.datasetId, { ...expected(restored), confirm: true });
    assert.equal(canonical(await repository.readSnapshot()), canonical(baseline)); rollbackRtoMs = ms(start);
    start = performance.now();
    const fresh = await stageRestoreFiles(files.map(file => file.text));
    assert.notEqual(fresh.id, stage.id); assert.notEqual(fresh.snapshot.datasetId, restored.datasetId);
    await repository.stageRestore(fresh, { mode: 'new' });
    await repository.activateStage(fresh.id, { ...expected(baseline), confirm: true, backupAcknowledged: true });
    reconcile(await repository.readSnapshot(), source); freshRestoreRtoMs = ms(start);
    assert.equal((await repository.readStage(fresh.id)).rawBackup, rawSource);
    return { baselineRestoredExactly: true, sameBackupFreshStageActivated: true, freshDatasetIdentity: true, fullSnapshotAndBalancesMatch: true, exactRawSourceRetained: true, measuredRollbackRtoMs: rollbackRtoMs, measuredFreshRestoreRtoMs: freshRestoreRtoMs };
  });
  await phase('corrupt-and-missing-parts-preserve-active', async () => {
    const before = canonical(await repository.readSnapshot()), damaged = files.map(file => file.text), part = JSON.parse(damaged[0]);
    part.dataBase64 = (part.dataBase64[0] === 'A' ? 'B' : 'A') + part.dataBase64.slice(1); damaged[0] = JSON.stringify(part);
    await assert.rejects(stageRestoreFiles(files.slice(1).map(file => file.text)), /BACKUP_PARTS_INCOMPLETE/);
    assert.equal(canonical(await repository.readSnapshot()), before);
    await assert.rejects(stageRestoreFiles(damaged), /BACKUP_PART_CHECKSUM_MISMATCH/);
    assert.equal(canonical(await repository.readSnapshot()), before);
    return { missingPartsRejected: true, corruptPartRejected: true, activeSnapshotUnchangedAfterEachRejection: true };
  });
  return {
    status: 'PASS', phases, fixture: { postings: source.postings.length, sourceCounts: counts(source), sourceBalances: balances(source), fictitious: true },
    recoveryMeasurement: { scope: 'Synthetic 10k-posting multipart export/restore within memory repository only; no real storage, process restart or device RPO/RTO inferred', rpo: { lostPostings: 0, lostOperations: 0, collectionCountDifferences: 0, accountBalanceDifferences: 0, timeWindowSeconds: null, reason: 'Exact exported fictional source recovered without record or balance loss. A real write-to-failure time window was not measured.' }, rto: { restoreStageValidateActivateReadbackMs: restoreRtoMs, rollbackReadbackMs: rollbackRtoMs, freshSameBackupRestoreReadbackMs: freshRestoreRtoMs }, productionOrDeviceAcceptance: 'BLOCKED' },
  };
}

if (!isMainThread) {
  try { parentPort.postMessage({ type: 'done', value: await rehearsal() }); }
  catch (error) { parentPort.postMessage({ type: 'done', value: { status: 'FAIL', error: String(error.message), errorName: error.name } }); }
} else {
  const args = process.argv.slice(2);
  if (!(args.length === 0 || args.length === 2 && args[0] === '--out')) throw new Error('Usage: node scripts/rehearse-recovery.mjs [--out evidence/<new-receipt>.json]');
  const output = resolve(root, args[1] || 'evidence/remediation-20261020/recovery-rehearsal.json'), evidenceRoot = resolve(root, 'evidence');
  if (!output.startsWith(evidenceRoot + sep) || !output.endsWith('.json')) throw new Error('UNSAFE_REHEARSAL_OUTPUT');
  await mkdir(dirname(output), { recursive: true });
  let cursor = root;
  for (const part of dirname(output).slice(root.length + 1).split(sep)) { cursor = resolve(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new Error('SYMLINK_REHEARSAL_OUTPUT'); }
  try { await access(output); throw new Error('REHEARSAL_OUTPUT_EXISTS_USE_NEW_PATH'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const startedAt = new Date().toISOString(), totalStart = performance.now(), before = await sourceInputs();
  const timeoutMs = Math.max(1, maxRuntimeMs - Math.ceil(ms(totalStart)) - 1500);
  const results = await new Promise(resolveResult => {
    const phases = [], worker = new Worker(script, { resourceLimits: { maxOldGenerationSizeMb: 512 } }); let finished = false;
    const finish = async value => { if (finished) return; finished = true; clearTimeout(timer); await worker.terminate(); resolveResult({ ...value, phases: value.phases || phases }); };
    const timer = setTimeout(() => finish({ status: 'BLOCKED', reason: `Rehearsal exceeded bounded worker runtime ${timeoutMs} ms; no remaining checks claimed`, timedOut: true }), timeoutMs);
    worker.on('message', message => { if (message.type === 'phase') phases.push(message.value); else if (message.type === 'done') finish(message.value); });
    worker.on('error', error => finish({ status: 'FAIL', error: String(error.message) }));
    worker.on('exit', code => { if (!finished) finish({ status: 'FAIL', error: `Worker exited before result: ${code}` }); });
  });
  const after = await sourceInputs(), unchanged = before.sha256 === after.sha256, durationMs = ms(totalStart), runtimeExceeded = durationMs > maxRuntimeMs;
  const status = results.status === 'FAIL' ? 'FAIL' : results.status === 'BLOCKED' || !unchanged || runtimeExceeded ? 'BLOCKED' : 'PASS';
  const receipt = { schemaVersion: 1, validationType: 'SyntheticMemoryRecoveryRehearsal', status, releaseAuthorized: false, startedAt, finishedAt: new Date().toISOString(), durationMs, maxRuntimeMs, environment: { node: process.version, platform: process.platform, arch: process.arch, storage: 'memory', indexedDbAvailable: typeof globalThis.indexedDB !== 'undefined' }, sourceInputs: before, sourceInputsSha256End: after.sha256, sourceUnchanged: unchanged, ...(!unchanged ? { reason: 'SOURCE_INPUTS_CHANGED_DURING_REHEARSAL; rerun after source freeze' } : runtimeExceeded ? { reason: 'REHEARSAL_RUNTIME_BUDGET_EXCEEDED; no bounded-runtime PASS claimed' } : {}), ...Object.fromEntries(Object.entries(results).filter(([key]) => key !== 'status')), limitations: ['Synthetic RAM evidence only. No save, IndexedDB, browser/native/device API, installation, signing, packaging or network access.', 'Full source records and exported backup payloads were not written to disk. Receipt contains fictional counts, balances, hashes and timings only.', 'Snapshot-only RAM reconstruction does not prove process restart persistence or retention of rollback history across restart.', 'Device RPO/RTO and acceptance remain BLOCKED.'] };
  // Exclusive create makes both the early check and a concurrent run fail
  // without replacing an existing receipt. Preserve all historical evidence.
  await writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status, sourceUnchanged: unchanged, durationMs: receipt.durationMs, postings: targetPostings, phases: receipt.phases, recoveryMeasurement: receipt.recoveryMeasurement, report: output.slice(root.length + 1).split(sep).join('/'), releaseAuthorized: false }, null, 2));
  process.exitCode = status === 'PASS' ? 0 : status === 'FAIL' ? 1 : 2;
}

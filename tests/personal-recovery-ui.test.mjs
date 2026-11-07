// Synthetic DOM and real backup validation. Durable IDB/crash recovery and
// rendered browser/native lifecycle remain separate integration gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextHarness } from './next-ui-harness.mjs';
import { createDataset, validateSnapshot, accountBalance } from '../core/model.js';
import { exportSnapshotFiles, exportRecoverySnapshotFiles } from '../core/migration.js';
import { translator } from '../ui/i18n.js';

const onboarding = { locale: 'vi-VN', currencyCode: 'VND', timezoneId: 'Asia/Ho_Chi_Minh', name: 'Synthetic recovery bank', accountType: 'BANK', opening: '123', openingDate: '2026-10-01' };
const file = value => ({ size: new TextEncoder().encode(value.text).length, text: async () => value.text });
async function backup({ large = false, namespace = 'personal' } = {}) {
  const h = await nextHarness(); if (namespace !== 'personal') await h.app.openNamespace(namespace);
  await h.app.go('create'); await h.submit('onboard-form', onboarding); const snapshot = h.app.snapshot(); h.app.close();
  if (large) { snapshot.retainedSyntheticData = 'x'.repeat(5 * 1024 * 1024); validateSnapshot(snapshot); }
  return { snapshot, files: await exportSnapshotFiles(snapshot) };
}
function recoveryRepository(raw = { ...createDataset(), profile: { locale: [] }, revision: 27 }) {
  let active = structuredClone(raw), stage = null, retained = null;
  const calls = { stage: [], activate: [], rawExport: [] };
  const repo = {
    calls,
    async readSnapshot() { return structuredClone(active); },
    async listRecoveryDatasets() {
      const row = (value, isActive) => { let valid = true; try { validateSnapshot(value); } catch { valid = false; } return { datasetId: value?.datasetId ?? null, revision: Number.isSafeInteger(value?.revision) && value.revision >= 0 ? value.revision : null, active: isActive, valid, accountCount: value?.accounts?.length || 0, operationCount: value?.operations?.length || 0 }; };
      return [...(retained ? [row(retained, false)] : []), row(active, true)];
    },
    async readRecoverySnapshot(key) { calls.rawExport.push(key); return structuredClone(key === active?.datasetId ? active : retained); },
    async stageRecoveryRestore(candidate, options) { calls.stage.push({ candidate: structuredClone(candidate), options: structuredClone(options) }); stage = structuredClone(candidate); return stage.id; },
    async activateStage(stageId, options) {
      calls.activate.push({ stageId, options: structuredClone(options) });
      if (options.expectedDatasetId !== (active?.datasetId ?? null) || options.expectedRevision !== (Number.isSafeInteger(active?.revision) && active.revision >= 0 ? active.revision : null)) throw new Error('ACTIVATION_DATASET_REVISION_CONFLICT');
      assert.equal(options.recoveryAcknowledged, true); assert.equal(options.backupAcknowledged, true); assert.equal(options.confirm, true); assert.equal(options.mode, 'new'); assert.equal(stageId, stage.id);
      retained = active; active = structuredClone(stage.snapshot); return active.datasetId;
    },
    mutateRaw(change) { active = { ...active, ...change }; },
    raw: () => structuredClone(active), retained: () => structuredClone(retained), close() {}
  };
  return repo;
}
async function harness(repo, appOptions = {}) {
  return nextHarness({ appOptions: { repositoryFactory: async () => repo, ...appOptions } });
}
async function browserStage(h, files) {
  const form = h.get('recovery-restore-form');
  h.get('recovery-restore-form-backupFile').files = files.map(file);
  await form.dispatch('submit');
}
async function confirm(h, all = true) {
  h.get('recovery-activate-form-backupAck').checked = true;
  h.get('recovery-activate-form-replaceAck').checked = true;
  h.get('recovery-activate-form-recoveryAck').checked = all;
  await h.get('recovery-activate-form').dispatch('submit');
}

test('corrupt-only personal storage accepts a checked backup without requiring a valid active profile', async () => {
  const valid = await backup(), repo = recoveryRepository(), original = repo.raw(), h = await harness(repo);
  assert.equal(h.app.currentRoute(), 'recovery'); assert.equal(h.app.snapshot(), null);
  await browserStage(h, valid.files);
  assert.match(h.text(), /Bản xem trước phục hồi sổ cá nhân/); assert.match(h.text(), /Synthetic recovery bank/);
  assert.deepEqual(repo.raw(), original); assert.equal(repo.calls.stage.length, 1);
  assert.deepEqual(repo.calls.stage[0].options, { expectedDatasetId: original.datasetId, expectedRevision: 27 });
  await confirm(h, false); assert.equal(repo.calls.activate.length, 0); assert.deepEqual(repo.raw(), original);
  await confirm(h, true);
  assert.equal(repo.calls.activate.length, 1); assert.equal(h.app.currentRoute(), 'overview');
  assert.equal(accountBalance(h.app.snapshot(), valid.snapshot.accounts[0].id), '123');
  assert.notEqual(h.app.snapshot().datasetId, valid.snapshot.datasetId); assert.deepEqual(repo.retained(), original); h.app.close();
});

test('missing active metadata binds an external backup to explicit null identity and revision', async () => {
  const valid = await backup(), repo = recoveryRepository(null), h = await harness(repo);
  await browserStage(h, valid.files);
  assert.deepEqual(repo.calls.stage[0].options, { expectedDatasetId: null, expectedRevision: null });
  await confirm(h); assert.equal(h.app.currentRoute(), 'overview'); assert.equal(repo.calls.activate[0].options.expectedDatasetId, null); h.app.close();
});

test('cancelled native selection and oversized browser files never create a recovery stage', async () => {
  const repo = recoveryRepository(), original = repo.raw();
  const native = await harness(repo, { onReadBackup: async () => null });
  await native.get('recovery-restore-form').dispatch('submit');
  assert.match(native.text(), /Đã hủy chọn bản sao/); assert.equal(repo.calls.stage.length, 0); assert.equal(native.get('recovery-activate-form'), null); native.app.close();
  const browser = await harness(repo); browser.get('recovery-restore-form-backupFile').files = [{ size: 5 * 1024 * 1024 + 1, text: async () => { throw new Error('MUST_NOT_READ'); } }];
  await browser.get('recovery-restore-form').dispatch('submit');
  assert.equal(repo.calls.stage.length, 0); assert.deepEqual(repo.raw(), original); assert.equal(browser.get('recovery-activate-form'), null); browser.app.close();
});

test('legacy, recovery-only and corrupt-checksum files cannot become a direct personal recovery stage', async () => {
  const valid = await backup(), changed = JSON.parse(valid.files[0].text); changed.checksum = '0'.repeat(64);
  const repo = recoveryRepository(), h = await harness(repo), [archive] = await exportRecoverySnapshotFiles(repo.raw());
  const samples = [JSON.stringify({ version: 1, demo: false, accounts: [], cards: [], assets: [], transactions: [], plans: [], settings: { buffer: 0 } }), archive.text, JSON.stringify(changed)];
  for (const text of samples) { await browserStage(h, [{ text }]); assert.equal(repo.calls.stage.length, 0); assert.equal(h.get('recovery-activate-form'), null); assert.equal(h.app.currentRoute(), 'recovery'); }
  assert.doesNotMatch(h.text(), /Đã lưu\./); h.app.close();
});

test('recovery I/O consumes Back and blocks route, namespace and duplicate submission while waiting for local file bytes', async () => {
  const valid = await backup(), repo = recoveryRepository(), h = await harness(repo); let release;
  h.get('recovery-restore-form-backupFile').files = [{ size: new TextEncoder().encode(valid.files[0].text).length, text: () => new Promise(resolve => { release = resolve; }) }];
  const pending = h.get('recovery-restore-form').dispatch('submit'); await Promise.resolve();
  assert.equal(await h.app.handleNativeBack(), true);
  await h.app.go('shared'); assert.equal(h.app.currentRoute(), 'recovery');
  await assert.rejects(h.app.openNamespace('sandbox'), /WRITE_IN_PROGRESS/);
  const repeated = h.app.submit('recovery-restore-form', {}); release(valid.files[0].text); await Promise.all([pending, repeated]);
  assert.equal(repo.calls.stage.length, 1); assert.match(h.text(), /Bản xem trước phục hồi/); h.app.close();
});

test('stale personal recovery activation leaves raw active data untouched and reports no saved result', async () => {
  const valid = await backup(), repo = recoveryRepository(), h = await harness(repo); await browserStage(h, valid.files);
  repo.mutateRaw({ revision: 28 }); const changed = repo.raw(); await confirm(h);
  assert.deepEqual(repo.raw(), changed); assert.equal(h.app.snapshot(), null); assert.equal(h.app.currentRoute(), 'recovery');
  assert.doesNotMatch(h.text(), /Đã lưu\./); assert.ok(h.root.querySelector('[role="alert"]')); h.app.close();
});

test('Back discards the personal recovery preview without changing the raw active dataset', async () => {
  const valid = await backup(), repo = recoveryRepository(), original = repo.raw(), h = await harness(repo);
  await browserStage(h, valid.files); assert.ok(h.get('recovery-activate-form'));
  assert.equal(await h.app.handleNativeBack(), true);
  assert.equal(h.get('recovery-activate-form'), null); assert.deepEqual(repo.raw(), original); assert.equal(repo.calls.activate.length, 0); h.app.close();
});

test('closing during a pending recovery file read cannot stage or render its late result', async () => {
  const valid = await backup(), repo = recoveryRepository(), h = await harness(repo); let release;
  h.get('recovery-restore-form-backupFile').files = [{ size: new TextEncoder().encode(valid.files[0].text).length, text: () => new Promise(resolve => { release = resolve; }) }];
  const pending = h.get('recovery-restore-form').dispatch('submit'); await Promise.resolve(); const visible = h.text(); h.app.close(); release(valid.files[0].text); await pending;
  assert.equal(repo.calls.stage.length, 0); assert.equal(repo.calls.activate.length, 0); assert.equal(h.text(), visible);
});

test('personal recovery export separates confirmed native saves from requested and cancelled downloads', async () => {
  let result = { status: 'requested' }; const repo = recoveryRepository(), h = await harness(repo, { onDownload: async () => result });
  const exportButton = () => h.button(translator()('recoveryExport'));
  await exportButton().click(); assert.match(h.text(), /Chưa xác nhận tệp đã được lưu/); assert.doesNotMatch(h.text(), /Đã xác nhận lưu/);
  result = { status: 'written' }; await exportButton().click(); assert.match(h.text(), /Đã xác nhận lưu 1 tệp phục hồi/);
  result = { status: 'cancelled' }; await exportButton().click(); assert.doesNotMatch(h.text(), /Đã xác nhận lưu/); assert.equal(repo.calls.activate.length, 0); h.app.close();
});

test('failed read after recovery activation leaves a recovery screen and never claims the new state was confirmed', async () => {
  const valid = await backup(), repo = recoveryRepository(), original = repo.raw(), h = await harness(repo); await browserStage(h, valid.files);
  const read = repo.readSnapshot; repo.readSnapshot = async () => { if (repo.calls.activate.length) throw new Error('POST_COMMIT_READ_FAILED'); return read(); };
  await confirm(h); assert.equal(h.app.snapshot(), null); assert.equal(h.app.currentRoute(), 'recovery'); assert.doesNotMatch(h.text(), /Đã lưu\./);
  assert.deepEqual(repo.retained(), original); assert.equal(accountBalance(repo.raw(), valid.snapshot.accounts[0].id), '123'); h.app.close();
});

test('multipart personal recovery requires the complete verified set and supports reversed browser order', async () => {
  const valid = await backup({ large: true }); assert.ok(valid.files.length > 1);
  const repo = recoveryRepository(), h = await harness(repo);
  await browserStage(h, valid.files.slice(1)); assert.equal(repo.calls.stage.length, 0); assert.equal(h.get('recovery-activate-form'), null);
  await browserStage(h, valid.files.slice().reverse()); assert.equal(repo.calls.stage.length, 1); assert.match(h.text(), /Bản xem trước phục hồi/);
  await confirm(h); assert.equal(h.app.snapshot().retainedSyntheticData.length, 5 * 1024 * 1024); h.app.close();
});

test('native multipart cancellation stops at missing part without activation or a saved claim', async () => {
  const valid = await backup({ large: true }), repo = recoveryRepository(); let picks = 0;
  const h = await harness(repo, { onReadBackup: async () => ++picks === 1 ? file(valid.files[0]) : null });
  await h.get('recovery-restore-form').dispatch('submit');
  assert.equal(picks, 2); assert.equal(repo.calls.stage.length, 0); assert.equal(repo.calls.activate.length, 0); assert.equal(h.get('recovery-activate-form'), null);
  assert.doesNotMatch(h.text(), /Đã lưu\./); h.app.close();
});

test('a new recovery preview requires fresh acknowledgements for its selected backup', async () => {
  const valid = await backup(), repo = recoveryRepository(), original = repo.raw(), h = await harness(repo);
  try {
    await browserStage(h, valid.files);
    await h.submit('recovery-activate-form', { backupAck: 'yes', replaceAck: 'yes' });
    assert.equal(repo.calls.activate.length, 0);
    await browserStage(h, valid.files);
    for (const key of ['backupAck', 'replaceAck', 'recoveryAck']) assert.notEqual(h.get('recovery-activate-form-' + key).checked, true);
    assert.deepEqual(repo.raw(), original);
  } finally { h.app.close(); }
});

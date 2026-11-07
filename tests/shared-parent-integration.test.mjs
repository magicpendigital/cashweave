import test from 'node:test';
import assert from 'node:assert/strict';
import { nextHarness } from './next-ui-harness.mjs';
import { createDataset, validateSnapshot } from '../core/model.js';

const creation = (name = 'Fictional shared home') => ({ 'shared-book-name': name, 'shared-name-a': 'Fictional A', 'shared-name-b': 'Fictional B', 'shared-consent-a': 'on', 'shared-consent-b': 'on', 'shared-device-ack': 'on' });
async function open(h) { await h.app.go('shared'); const controller = h.app.sharedController(); await controller.readyPromise; return controller; }

test('shared book can start without a personal book and keeps personal state untouched', async t => {
  const h = await nextHarness(), personal = h.app.snapshot();
  t.after(() => h.app.close());
  assert.ok(h.get('start-shared'));
  const shared = await open(h);
  assert.equal(shared.snapshot().space, null);
  const result = await shared.submit('shared-create-form', creation('<b>Fictional home</b>'));
  assert.equal(result.ok, true);
  assert.deepEqual(shared.snapshot().space.members, ['A', 'B']);
  assert.equal(h.root.querySelector('b'), null, 'book name must remain text');
  assert.deepEqual(h.app.snapshot(), personal);
  await h.app.go('help'); await h.app.go('shared');
  assert.equal(h.app.sharedController(), shared);
  assert.equal(shared.snapshot().space.name, '<b>Fictional home</b>');
  h.app.close();
});

test('shared personal and sandbox stores are isolated and namespace changes reopen the correct book', async t => {
  const h = await nextHarness(); t.after(() => h.app.close()); let shared = await open(h);
  assert.equal((await shared.submit('shared-create-form', creation('Personal shared fixture'))).ok, true);
  const saved = shared.snapshot();
  await h.app.openNamespace('sandbox'); shared = await open(h);
  assert.equal(shared.snapshot().space, null);
  assert.equal((await shared.submit('shared-create-form', creation('Sandbox shared fixture'))).ok, true);
  assert.equal(shared.snapshot().namespace, 'sandbox');
  await h.app.openNamespace('personal'); shared = await open(h);
  assert.deepEqual(shared.snapshot(), saved);
  assert.equal(h.app.snapshot().accounts.length, 0);
  h.app.close();
});

test('pending shared commit blocks outer navigation, native Back and namespace changes', async t => {
  const h = await nextHarness(), shared = await open(h), repository = h.sharedRepositories.get('personal');
  t.after(() => h.app.close());
  const original = repository.execute.bind(repository); let release;
  repository.execute = (...args) => new Promise(resolve => { release = () => resolve(original(...args)); });
  const write = shared.submit('shared-create-form', creation());
  assert.equal(shared.isBusy(), true);
  await h.app.go('help'); assert.equal(h.app.currentRoute(), 'shared');
  assert.equal(await h.app.handleNativeBack(), true);
  await assert.rejects(h.app.openNamespace('sandbox'), /WRITE_IN_PROGRESS/);
  release(); assert.equal((await write).ok, true);
  await h.app.go('help'); assert.equal(h.app.currentRoute(), 'help');
  h.app.close();
});

test('corrupt personal data does not block the independently stored shared book', async t => {
  const invalid = createDataset(); invalid.profile.locale = [];
  const repository = { async readSnapshot() { validateSnapshot(invalid); }, async listRecoveryDatasets() { return [{ datasetId: invalid.datasetId, revision: invalid.revision, active: true, valid: false }]; }, async readRecoverySnapshot() { return structuredClone(invalid); }, close() {} };
  const h = await nextHarness({ appOptions: { repositoryFactory: async () => repository } }); t.after(() => h.app.close());
  assert.equal(h.app.currentRoute(), 'recovery');
  const shared = await open(h);
  assert.equal((await shared.submit('shared-create-form', creation())).ok, true);
  assert.equal(h.app.snapshot(), null);
  await h.app.go('recovery'); assert.equal(h.app.currentRoute(), 'recovery');
  assert.deepEqual(await repository.readRecoverySnapshot(invalid.datasetId), invalid);
  h.app.close();
});

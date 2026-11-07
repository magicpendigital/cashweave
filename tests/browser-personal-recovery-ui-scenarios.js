// Real DOM/FormData/File controls and IndexedDB, using one unique QA alias.
// Every record is fictional; this module never opens a normal saved book.
import { createNextApp } from '../ui/app.js';
import { openIndexedDbRepository } from '../core/repository.js';
import { exportSnapshot } from '../core/migration.js';
import { accountBalance } from '../core/model.js';
import { canonical } from '../core/identity.js';
import { translator } from '../ui/i18n.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const pause = delay => new Promise(resolve => setTimeout(resolve, delay));

export async function verifyPersonalRecoveryBrowserUi(documentroot = null) {
  const doc = documentroot?.nodeType === 9 ? documentroot : documentroot?.ownerDocument || globalThis.document;
  const win = doc.defaultView, root = documentroot?.nodeType === 1 ? documentroot : doc.createElement('div');
  if (!root.id) root.id = 'next-app';
  if (!root.isConnected) doc.body.replaceChildren(root); else root.replaceChildren();
  const suffix = win.crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const databaseName = 'cw-personal-recovery-ui-' + suffix, handles = [], checks = [], downloads = [];
  const clock = () => new Date('2026-10-20T10:00:00.000Z'), started = performance.now(), t = translator();
  const qaIndexedDb = { open(name, version) {
    assert(name === 'mach-tien-v3-personal', 'Unexpected repository database request: ' + name);
    return win.indexedDB.open(databaseName, version);
  } };
  const legacyStorage = { getItem: () => null, setItem: () => { throw new Error('QA_LEGACY_STORAGE_WRITE_FORBIDDEN'); } };
  let app = null, removeBrowserListeners = () => {};

  async function repository() {
    const value = await openIndexedDbRepository({ namespace: 'personal', indexedDB: qaIndexedDb });
    handles.push(value); return value;
  }
  async function until(predicate, label, timeout = 2500) {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) { if (predicate()) return; await pause(5); }
    throw new Error(label + ': ' + (root.querySelector('#feedback')?.textContent || 'condition did not complete'));
  }
  function control(form, name) {
    const node = form.elements.namedItem(name); assert(node, 'Real recovery control missing: ' + name); return node;
  }
  function acknowledgement(form, name, value) {
    const node = control(form, name); assert(node.type === 'checkbox' && node.required, 'Recovery acknowledgement must be required: ' + name);
    node.checked = value; node.dispatchEvent(new win.Event('change', { bubbles: true }));
  }
  async function openApp() {
    const listeners = [];
    const browser = { FormData: win.FormData, Blob: win.Blob, URL: win.URL, navigator: win.navigator, location: { hash: '' }, setTimeout: win.setTimeout.bind(win), matchMedia: win.matchMedia.bind(win), addEventListener(type, listener, options) { win.addEventListener(type, listener, options); listeners.push([type, listener, options]); } };
    removeBrowserListeners = () => { for (const args of listeners) win.removeEventListener(...args); };
    app = await createNextApp(root, { document: doc, browser, clock, legacyStorage,
      repositoryFactory: options => { assert(options.namespace === 'personal', 'Recovery scenario must remain in its QA personal namespace'); return repository(); },
      sharedRepositoryFactory: () => { throw new Error('QA_SHARED_REPOSITORY_MUST_NOT_OPEN'); },
      onDownload: async (text, name) => { const bytes = new TextEncoder().encode(text).length; downloads.push({ text, name, bytes }); return { status: 'written', bytes }; }
    });
  }
  function closeApp() { app?.close(); app = null; removeBrowserListeners(); removeBrowserListeners = () => {}; }
  async function corruptOnlySnapshot(invalid) {
    const db = await new Promise((resolve, reject) => { const request = win.indexedDB.open(databaseName, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      await new Promise((resolve, reject) => { const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(invalid); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); tx.onerror = () => {}; });
    } finally { db.close(); }
  }

  try {
    const seed = await repository(); let original = await seed.readSnapshot();
    await seed.runAtomicCommand({ commandId: win.crypto.randomUUID(), type: 'onboard', input: { name: 'Tài khoản phục hồi giả lập', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '123456', openingEffectiveLocalDate: '2026-10-01' } }, original.revision, { now: clock().toISOString() });
    original = await seed.readSnapshot(); const backup = await exportSnapshot(original);
    assert((await seed.listRecoveryDatasets()).length === 1, 'QA fixture must begin with exactly one dataset'); seed.close();
    const invalid = structuredClone(original); invalid.profile.locale = []; invalid.retainedSyntheticFields = { label: 'Giữ nguyên kho lỗi giả lập', values: [7, 11] };
    await corruptOnlySnapshot(invalid); await openApp();
    assert(app.currentRoute() === 'recovery' && app.snapshot() === null, 'Invalid-only personal profile must render recovery without a substitute valid state');
    assert(root.querySelector('#recovery-restore-form') && !root.querySelector('#onboard-form'), 'Actual recovery DOM must expose file import instead of a replacement onboarding form');
    checks.push('first and only corrupt personal dataset opens the real recovery DOM without a temporary book');

    const exportButton = [...root.querySelectorAll('button')].find(node => node.textContent === t('recoveryExport'));
    assert(exportButton && !exportButton.disabled, 'Raw recovery export must remain accessible'); exportButton.click();
    await until(() => downloads.length === 1 && !root.querySelector('#recovery-restore-form button').disabled, 'Raw recovery export');
    assert(downloads[0].bytes <= 5 * 1024 * 1024 && JSON.parse(downloads[0].text).formatId === 'cash-weave-recovery-archive', 'Raw export must use a bounded recovery-only file');
    checks.push('actual raw-export action produces a bounded recovery archive through the injected receipt adapter');

    const form = root.querySelector('#recovery-restore-form'), input = control(form, 'backupFile'), transfer = new win.DataTransfer();
    transfer.items.add(new win.File([backup], 'fictional-personal-recovery.json', { type: 'application/json' })); input.files = transfer.files;
    input.dispatchEvent(new win.Event('change', { bubbles: true })); assert(form.checkValidity(), 'Real local File input must satisfy the recovery form'); form.requestSubmit();
    await until(() => root.querySelector('#recovery-activate-form'), 'Recovery file preview');
    assert(app.snapshot() === null && root.textContent.includes('Tài khoản phục hồi giả lập'), 'Preview must show the checked backup account while keeping the invalid active state unchanged');
    const inspection = await repository(), beforeActivation = await inspection.listRecoveryDatasets();
    assert(beforeActivation.length === 1 && beforeActivation[0].active && !beforeActivation[0].valid, 'Staging must retain one untouched invalid active dataset');
    assert(canonical(await inspection.readRecoverySnapshot(original.datasetId)) === canonical(invalid), 'Real IDB raw source must remain exact after preview'); inspection.close();
    checks.push('DataTransfer/File and requestSubmit validate a backup preview without changing the raw active dataset');

    let activation = root.querySelector('#recovery-activate-form');
    acknowledgement(activation, 'backupAck', true); acknowledgement(activation, 'replaceAck', false); acknowledgement(activation, 'recoveryAck', false);
    assert(!activation.checkValidity(), 'One acknowledgement must fail real HTML validation'); activation.requestSubmit(); await pause(10);
    assert(app.snapshot() === null, 'One acknowledgement must not activate');
    acknowledgement(activation, 'replaceAck', true);
    assert(!activation.checkValidity(), 'Two acknowledgements must still require explicit invalid-storage recovery confirmation'); activation.requestSubmit(); await pause(10);
    assert(app.snapshot() === null, 'Two acknowledgements must not activate');
    checks.push('real required checkboxes reject both one-acknowledgement and two-acknowledgement activation');
    acknowledgement(activation, 'recoveryAck', true); assert(activation.checkValidity(), 'All three explicit acknowledgements must satisfy the real form'); activation.requestSubmit();
    await until(() => app.snapshot()?.accounts?.length === 1 && app.currentRoute() === 'overview', 'Personal recovery activation');
    const restored = app.snapshot(), restoredId = restored.datasetId;
    assert(restoredId !== original.datasetId && accountBalance(restored, original.accounts[0].id) === '123456', 'Three-acknowledgement recovery must retain exact opening cash under a new dataset identity');
    checks.push('three actual acknowledgements activate the checked backup as a distinct personal book with exact cash');

    closeApp(); await openApp();
    assert(app.currentRoute() === 'overview' && app.snapshot().datasetId === restoredId && accountBalance(app.snapshot(), original.accounts[0].id) === '123456', 'Actual repository/app close and reopen must retain the recovered book');
    checks.push('actual IndexedDB and app reopen retain the activated personal book and cash');
    const reopened = await repository(), rows = await reopened.listRecoveryDatasets();
    assert(rows.length === 2 && rows.some(row => row.active && row.valid && row.datasetId === restoredId) && rows.some(row => !row.active && !row.valid && row.datasetId === original.datasetId), 'Reopen must expose both the valid active book and retained invalid source');
    assert(canonical(await reopened.readRecoverySnapshot(original.datasetId)) === canonical(invalid), 'Full invalid raw snapshot and synthetic unknown fields must survive activation/reopen exactly'); reopened.close();
    checks.push('invalid original dataset remains exactly readable as a retained raw recovery source after reopen');
    const ids = [...root.querySelectorAll('[id]')].map(node => node.id);
    assert(ids.length === new Set(ids).size, 'Final recovered personal DOM must retain unique IDs');
    return { passed: checks.length, checks, durationMs: performance.now() - started, databaseNames: [databaseName], scope: 'Real DOM, FormData, DataTransfer/File and isolated actual IndexedDB transactions/reopen. File completion is an injected in-memory adapter receipt; no native filesystem, device or store publishing claim.' };
  } finally {
    closeApp(); for (const handle of handles) handle.close();
    // Only this invocation's generated QA alias may be deleted.
    assert(databaseName.startsWith('cw-personal-recovery-ui-') && databaseName.endsWith(suffix), 'Refuse non-QA database cleanup');
    await new Promise((resolve, reject) => { const request = win.indexedDB.deleteDatabase(databaseName); request.onsuccess = resolve; request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('QA_DATABASE_CLOSE_OR_DELETE_BLOCKED:' + databaseName)); });
  }
}

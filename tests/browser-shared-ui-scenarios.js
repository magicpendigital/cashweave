// Real DOM, FormData/File controls and IndexedDB in explicitly named QA books.
// All records are fictional. Never opens the application's normal saved books.
import { createNextApp } from '../ui/app.js';
import { openIndexedDbRepository } from '../core/repository.js';
import { openSharedRepository } from '../core/shared-repository.js';
import { canonical } from '../core/identity.js';
import { summary } from '../couples.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const pause = delay => new Promise(resolve => setTimeout(resolve, delay));

export async function verifySharedBrowserUi(documentroot = null) {
  const doc = documentroot?.nodeType === 9 ? documentroot : documentroot?.ownerDocument || globalThis.document;
  const win = doc.defaultView, root = documentroot?.nodeType === 1 ? documentroot : doc.createElement('div');
  if (!root.id) root.id = 'next-app';
  if (!root.isConnected) doc.body.replaceChildren(root);
  else root.replaceChildren();
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12), checks = [], downloads = [], sharedHandles = [], databases = new Set();
  const started = performance.now(), clock = () => new Date('2026-10-20T10:00:00.000Z');
  const sharedNames = Object.fromEntries(['personal', 'sandbox'].map(namespace => [namespace, `cash-weave-shared-v1-${namespace}-qa-${suffix}`]));
  assert(Object.values(sharedNames).every(name => name.length <= 64), 'QA shared database names must remain bounded');
  // Only the database-name routing is adapted. Every transaction, File control,
  // form event, rendering update and repository reopen uses the real browser.
  const personalIndexedDb = { open(name, version) {
    assert(/^mach-tien-v3-(personal|sandbox)$/.test(name), 'Unexpected personal repository database request');
    const namespace = name.endsWith('-sandbox') ? 'sandbox' : 'personal', alias = `cw-shared-ui-${suffix}-${namespace}`;
    databases.add(alias); return win.indexedDB.open(alias, version);
  } };
  const legacyStorage = { getItem: () => null, setItem: () => { throw new Error('QA_LEGACY_STORAGE_WRITE_FORBIDDEN'); } };
  let app = null, shared = null, removeBrowserListeners = () => {};

  async function until(predicate, label, timeout = 4000) {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) { if (predicate()) return; await pause(10); }
    throw new Error(label + ': ' + (root.querySelector('#shared-feedback')?.textContent || 'condition did not complete'));
  }
  const host = () => root.querySelector('.shared-offline');
  function button(label, scope = host()) {
    const found = [...scope.querySelectorAll('button')].find(node => node.textContent === label);
    assert(found, 'Rendered shared action missing: ' + label); return found;
  }
  async function click(label, scope) {
    const node = button(label, scope); assert(!node.disabled, 'Shared action unexpectedly disabled: ' + label);
    node.click(); await until(() => !shared.isBusy(), 'Shared action did not finish: ' + label);
  }
  function fields(form, values) {
    for (const [name, value] of Object.entries(values)) {
      const control = form.elements.namedItem(name); assert(control, 'Real form control missing: ' + name);
      if (control.type === 'checkbox') control.checked = value === true || value === 'yes';
      else control.value = String(value);
      control.dispatchEvent(new win.Event('input', { bubbles: true }));
      control.dispatchEvent(new win.Event('change', { bubbles: true }));
    }
  }
  async function submit(formId, values = {}) {
    const form = root.querySelector('#' + formId); assert(form, 'Real shared form missing: ' + formId);
    fields(form, values); assert(form.checkValidity(), 'Real shared form invalid: ' + formId);
    form.requestSubmit();
    await until(() => !shared.isBusy(), 'Shared form did not finish: ' + formId);
    assert(host().querySelector('#shared-feedback')?.getAttribute('role') !== 'alert', 'Shared form rejected: ' + formId + ': ' + host().querySelector('#shared-feedback')?.textContent);
  }
  function selectActor(actor) {
    const select = host().querySelector('#shared-actor'); assert(select, 'Local attribution selector missing');
    select.value = actor; select.dispatchEvent(new win.Event('change', { bubbles: true }));
  }
  async function addEntry(kind, amount, note) {
    await click('Giao dịch chung');
    await submit('shared-entry-form', { 'shared-entry-kind': kind, 'shared-entry-amount': amount, 'shared-entry-date': '2026-10-20', 'shared-entry-note': note });
  }
  async function openApp(namespace = 'personal') {
    const listeners = [];
    // Location changes stay in this test's facade, avoiding callbacks left by
    // earlier independent scenarios. Browser navigation is outside this test.
    const browser = { FormData: win.FormData, Blob: win.Blob, URL: win.URL, navigator: win.navigator, location: { hash: '' }, setTimeout: win.setTimeout.bind(win), matchMedia: win.matchMedia.bind(win), addEventListener(type, listener, options) { win.addEventListener(type, listener, options); listeners.push([type, listener, options]); } };
    removeBrowserListeners = () => { for (const args of listeners) win.removeEventListener(...args); };
    app = await createNextApp(root, {
      document: doc, browser, namespace, clock, legacyStorage,
      repositoryFactory: options => openIndexedDbRepository({ ...options, indexedDB: personalIndexedDb }),
      sharedRepositoryFactory: async options => {
        const databaseName = sharedNames[options.namespace]; assert(databaseName, 'Unexpected shared namespace'); databases.add(databaseName);
        const repository = await openSharedRepository({ ...options, indexedDB: win.indexedDB, locks: win.navigator.locks, databaseName }); sharedHandles.push(repository); return repository;
      },
      onDownload: async (text, name) => { const bytes = new TextEncoder().encode(text).length; downloads.push({ text, name, bytes }); return { status: 'written', bytes }; }
    });
    await app.go('shared'); shared = app.sharedController(); assert(shared, 'Parent app must install the shared controller');
    await shared.readyPromise; await until(() => !shared.isBusy(), 'Shared startup');
  }
  function closeApp() { app?.close(); app = null; shared = null; removeBrowserListeners(); removeBrowserListeners = () => {}; }

  try {
    await openApp();
    const personalBefore = canonical(app.snapshot());
    assert(app.snapshot().accounts.length === 0 && shared.snapshot().space === null, 'Shared entry must be reachable before personal onboarding without a seeded book');
    checks.push('shared route before personal onboarding with isolated real IndexedDB');
    const creation = root.querySelector('#shared-create-form');
    fields(creation, { 'shared-book-name': 'Nhà thử nghiệm offline', 'shared-name-a': 'Người thử A', 'shared-name-b': 'Người thử B', 'shared-consent-a': true, 'shared-consent-b': false, 'shared-device-ack': true });
    assert(!creation.checkValidity(), 'Missing local consent must fail real HTML form validation'); creation.requestSubmit(); await pause(20);
    assert(shared.snapshot().space === null, 'Incomplete consent must not create a book');
    await submit('shared-create-form', { 'shared-consent-b': true });
    assert(shared.snapshot().space.entries.length === 0 && shared.snapshot().space.members.join(',') === 'A,B', 'Creation must persist an empty locally attributed book');
    assert(canonical(app.snapshot()) === personalBefore, 'Creating a shared book must leave personal storage unchanged');
    checks.push('actual create form requires all local acknowledgements and leaves personal book untouched');

    await addEntry('contribution', '1.000.000', 'Khoản góp giả lập của A');
    selectActor('B'); await addEntry('contribution', '200.000', 'Khoản góp giả lập của B');
    await addEntry('expense', '100.000', 'Khoản chi giả lập cần sửa');
    let totals = summary(shared.snapshot().space, '2026-10');
    assert(totals.cash === 1100000 && totals.spent === 100000 && totals.contributions.A === 1000000 && totals.contributions.B === 200000, 'Real entry forms must retain exact financial totals');
    checks.push('actual contribution and expense forms persist exact VND totals');
    await click('Xem khoản 2026-10-20 · Chi từ quỹ');
    await submit('shared-correct-form', { 'shared-correct-amount': '90.000', 'shared-correct-date': '2026-10-20', 'shared-correct-note': 'Khoản chi giả lập đã đối chiếu', 'shared-correct-reason': 'Đối chiếu hóa đơn giả lập' });
    totals = summary(shared.snapshot().space, '2026-10');
    assert(totals.cash === 1110000 && totals.spent === 90000 && shared.snapshot().space.entryCorrections.length === 1, 'Correction form must preserve exact balance and full history');
    await submit('shared-void-form', { 'shared-void-reason': 'Hủy khoản ghi trùng giả lập', 'shared-void-ack': true });
    const voided = shared.snapshot().space.entries.find(entry => entry.kind === 'expense');
    assert(voided.voided === true && shared.snapshot().space.entryCorrections.length === 2 && summary(shared.snapshot().space, '2026-10').cash === 1200000, 'Void must retain entry/history and release cash');
    assert(host().textContent.includes('Đối chiếu hóa đơn giả lập') && host().textContent.includes('Hủy khoản ghi trùng giả lập'), 'Actual detail DOM must display both retained reasons');
    checks.push('actual correction and void forms retain history and reconcile cash');
    await addEntry('expense', '120.000', 'Chi chung giả lập đang có hiệu lực');

    await click('Dữ liệu sổ chung'); await click('Xuất bản sao sổ chung');
    assert(downloads.length === 1 && downloads[0].bytes <= 5 * 1024 * 1024, 'Shared export adapter must receive one bounded JSON file');
    const backup = JSON.parse(downloads[0].text);
    assert(backup.formatId === 'cash-weave-shared-backup' && backup.entities.space.entryCorrections.length === 2, 'Shared JSON must retain the correction journal');
    checks.push('shared backup uses separate bounded format with correction history');
    await click('Hóa đơn và mục tiêu');
    await submit('shared-goal-form', { 'shared-goal-title': 'Mục tiêu giả lập sau sao lưu', 'shared-goal-target': '2.000.000' });
    const beforeRestore = shared.snapshot(), originalDataset = beforeRestore.datasetId;
    await click('Dữ liệu sổ chung');
    const transfer = new win.DataTransfer(); transfer.items.add(new win.File([downloads[0].text], 'fictional-shared.json', { type: 'application/json' }));
    const fileInput = root.querySelector('#shared-backup-file'); assert(fileInput, 'Shared import must expose a real browser File input');
    fileInput.files = transfer.files; fileInput.dispatchEvent(new win.Event('change', { bubbles: true }));
    await submit('shared-import-form');
    assert(root.querySelector('#shared-activate-form') && canonical(shared.snapshot()) === canonical(beforeRestore), 'File preview must not activate or alter the active dataset');
    checks.push('actual DataTransfer File preview preserves the current dataset');
    const activation = root.querySelector('#shared-activate-form');
    fields(activation, { 'shared-restore-backup-ack': true, 'shared-restore-replace-ack': false });
    assert(!activation.checkValidity(), 'Both restore acknowledgements must be required by the real form'); activation.requestSubmit(); await pause(20);
    assert(canonical(shared.snapshot()) === canonical(beforeRestore), 'One acknowledgement must not activate a backup');
    await submit('shared-activate-form', { 'shared-restore-replace-ack': true });
    const restoredDataset = shared.snapshot().datasetId;
    assert(restoredDataset !== originalDataset && shared.snapshot().space.goal === null && summary(shared.snapshot().space, '2026-10').cash === 1080000, 'Two-ack activation must restore the exact earlier shared book with a new identity');
    checks.push('one acknowledgement blocked and two acknowledgements activate the checked backup');

    closeApp(); await openApp();
    assert(shared.snapshot().datasetId === restoredDataset && shared.snapshot().space.entryCorrections.length === 2 && summary(shared.snapshot().space, '2026-10').cash === 1080000, 'Actual IndexedDB reopen must retain activated data and history');
    checks.push('controller close and actual IndexedDB reopen retain the activated shared book');
    await click('Dữ liệu sổ chung');
    const retained = [...host().querySelectorAll('article')].find(node => !node.querySelector('h4')?.textContent.includes('đang dùng') && node.querySelector('h4')?.textContent.includes('Nhà thử nghiệm offline'));
    assert(retained, 'Prior shared dataset must remain in the actual recovery DOM');
    await click('Chọn phục hồi bản này', retained);
    await submit('shared-rollback-form', { 'shared-rollback-backup-ack': true, 'shared-rollback-ack': true });
    assert(canonical(shared.snapshot()) === canonical(beforeRestore), 'Rollback after reopen must recover the exact pre-activation snapshot');
    checks.push('actual retained-dataset confirmation rolls back exactly after reopen');

    await app.openNamespace('sandbox'); await app.go('shared'); shared = app.sharedController(); await shared.readyPromise;
    assert(shared.snapshot().namespace === 'sandbox' && shared.snapshot().space === null && app.snapshot().accounts.length === 0, 'Sandbox shared and personal stores must remain blank and separate');
    await app.openNamespace('personal'); await app.go('shared'); shared = app.sharedController(); await shared.readyPromise;
    assert(canonical(shared.snapshot()) === canonical(beforeRestore) && canonical(app.snapshot()) === personalBefore, 'Returning from sandbox must recover the original shared state without modifying the personal book');
    checks.push('personal and sandbox shared databases remain separate through parent navigation');
    await click('Tổng quan');
    const ids = [...root.querySelectorAll('[id]')].map(node => node.id);
    assert(ids.length === new Set(ids).size && !root.querySelector('iframe'), 'Rendered shared DOM must have unique IDs and no embedded demo frame');
    assert(host().textContent.includes('Nhãn ghi nhận · không xác thực') && !host().textContent.includes('MOI-DEMO'), 'Shared UI must describe local attribution honestly');
    assert(summary(shared.snapshot().space, '2026-10').cash === 1080000, 'Final screenshot fixture must retain the expected financial state');
    checks.push('final shared overview has unique DOM IDs, honest local labels and no demo iframe');
    return { passed: checks.length, checks, durationMs: performance.now() - started, databaseNames: [...databases], scope: 'Real DOM/form/File and isolated real IndexedDB. Export completion is an injected in-memory adapter receipt; no native filesystem/device behavior or browser URL-navigation claim.', finalScreen: 'Shared offline overview with fictional data; controllers closed after capture-ready DOM is retained.' };
  } finally {
    closeApp(); for (const repository of sharedHandles) repository.close();
    // Delete only names created above, after all controllers/DB handles close.
    // The rendered DOM remains in place for viewport screenshots by the caller.
    for (const name of databases) await new Promise((resolve, reject) => { const request = win.indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('QA_DATABASE_CLOSE_OR_DELETE_BLOCKED:' + name)); });
  }
}

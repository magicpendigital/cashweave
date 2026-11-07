// Actual browser viewport/focus regression. Only fictional in-memory books are
// injected: this test never opens or changes the application's saved stores.
import { createNextApp } from '../ui/app.js';
import { createSharedOfflineView } from '../ui/shared-offline-view.js';
import { createMemoryRepository } from '../core/repository.js';
import { createMemorySharedRepository } from '../core/shared-repository.js';
import { createDataset } from '../core/model.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
export async function verifyRouteScrollBrowserUi(documentroot = null) {
  const doc = documentroot?.nodeType === 9 ? documentroot : documentroot?.ownerDocument || document;
  const win = doc.defaultView, root = documentroot?.nodeType === 1 ? documentroot : doc.createElement('div');
  if (!root.id) root.id = 'next-app';
  if (!root.isConnected) doc.body.replaceChildren(root); else root.replaceChildren();
  // Keep document height stable across route changes. Otherwise changing to a
  // shorter page can clamp scroll to zero and make the broken implementation pass.
  const tail = doc.createElement('div'); tail.style.height = '3000px'; tail.setAttribute('aria-hidden', 'true'); tail.style.pointerEvents = 'none'; doc.body.append(tail);
  const personal = new Map(), handles = [], checks = [], listeners = [], initialUrl = win.location.href;
  const clock = () => new Date('2026-10-22T10:00:00.000Z'), started = performance.now();
  let app, shared, detached;
  const frame = () => new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
  const browser = { FormData: win.FormData, navigator: win.navigator, location: { hash: '' }, matchMedia: win.matchMedia.bind(win), addEventListener(type, listener, options) { win.addEventListener(type, listener, options); listeners.push([type, listener, options]); } };
  const y = () => doc.scrollingElement.scrollTop;
  const at = (expected, label) => assert(Math.abs(y() - expected) <= 2, label + ': expected ' + expected + ', actual ' + y());
  const notAtTop = label => assert(y() > 100, label + ': same-page rendering unexpectedly reset the viewport to top');
  function fields(form, values) {
    for (const [name, value] of Object.entries(values)) {
      const node = form.elements.namedItem(name); assert(node, 'Missing real form control: ' + name);
      if (node.type === 'checkbox') node.checked = value === true; else node.value = String(value);
    }
  }
  async function scrollTo(value) { doc.scrollingElement.scrollTop = value; await frame(); assert(y() >= value - 2, 'Viewport must stay scrollable for the regression fixture'); return y(); }
  async function until(predicate, label) {
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) { if (predicate()) { await frame(); return; } await new Promise(resolve => setTimeout(resolve, 5)); }
    throw new Error(label + ': ' + root.textContent.slice(-400));
  }
  const mainFocused = () => assert(doc.activeElement === root.querySelector('#main-content'), 'Changed personal route must focus its noneditable main content');
  const sharedFocused = () => assert(doc.activeElement === root.querySelector('.shared-offline .page-head h2'), 'Changed shared route must focus its noneditable heading');
  try {
    app = await createNextApp(root, { document: doc, browser, clock, legacyStorage: { getItem: () => null },
      repositoryFactory: async ({ namespace }) => { if (!personal.has(namespace)) personal.set(namespace, createMemoryRepository(createDataset({ namespace }))); return personal.get(namespace); },
      sharedRepositoryFactory: async ({ namespace }) => { const repo = createMemorySharedRepository({ namespace }); handles.push(repo); return repo; },
      onDownload: async () => ({ status: 'cancelled' })
    });
    await app.go('create');
    let form = root.querySelector('#onboard-form');
    fields(form, { name: 'QC Scroll Personal', accountType: 'BANK', currencyCode: 'VND', timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN', opening: '1000000', openingDate: '2026-10-22' });
    const onboardingScroll = await scrollTo(700); assert(onboardingScroll > 100, 'Onboarding must begin visibly scrolled');
    assert(form.checkValidity(), 'Onboarding fixture must satisfy actual HTML validation'); form.requestSubmit();
    await until(() => app.currentRoute() === 'overview' && app.snapshot().accounts.length === 1 && !root.querySelector('#onboard-form'), 'Onboarding commit');
    at(0, 'Onboarding direct perform/render navigation'); mainFocused(); checks.push('scrolled onboarding direct commit opens overview at top with main focus');

    // Exercise the real hash listener and browser history, not only the facade.
    // The runner invokes this scenario before other app UI scenarios install
    // their window listeners; only this app is active on the isolated QA page.
    browser.location = win.location; win.history.replaceState(null, '', win.location.pathname + win.location.search + '#overview');
    await scrollTo(700); win.location.hash = '#help'; await until(() => app.currentRoute() === 'help', 'Actual hashchange'); at(0, 'Actual hash route navigation'); mainFocused();
    await scrollTo(600); await app.go('transactions'); await frame(); at(0, 'Programmatic real hash route change');
    win.history.back(); await until(() => app.currentRoute() === 'help', 'Actual fragment history Back'); at(0, 'Actual hash history Back'); mainFocused();
    checks.push('general personal, real hashchange and fragment-history navigation reset viewport and focus');
    await app.go('transactions/new'); await scrollTo(500); const sameRouteY = y();
    await app.render(); await frame(); notAtTop('Same personal route render'); mainFocused();
    checks.push('same-route personal rerender preserves scroll and logical content focus');
    form = root.querySelector('#transaction-form'); const kind = form.elements.namedItem('operationType');
    kind.value = 'EXPENSE'; kind.dispatchEvent(new win.Event('change', { bubbles: true }));
    await until(() => root.querySelector('#transaction-form') !== form, 'Same-page type change'); notAtTop('Same-route type change');
    form = root.querySelector('#transaction-form'); fields(form, { amount: 'invalid', date: '2026-10-22', memo: 'QC Scroll invalid input' });
    const beforeInvalid = app.snapshot().revision, amountControl = form.elements.namedItem('amount'); amountControl.focus({ preventScroll: true }); form.requestSubmit(); await until(() => root.querySelector('#feedback [role="alert"]'), 'Domain validation error');
    notAtTop('Same-route validation feedback'); assert(doc.activeElement === amountControl && amountControl.value === 'invalid' && form.elements.namedItem('memo').value === 'QC Scroll invalid input', 'Validation must keep editable focus and the current draft'); assert(app.snapshot().revision === beforeInvalid, 'Invalid text must not write a financial command');
    checks.push('same-route selector and invalid form feedback do not reset viewport');

    await app.go('categories'); await scrollTo(500); const categoryY = y(); form = root.querySelector('#category-form');
    fields(form, { name: 'QC Scroll Category', direction: 'EXPENSE' }); form.requestSubmit();
    await until(() => app.snapshot().categories.some(item => item.name === 'QC Scroll Category'), 'Same-route category commit');
    notAtTop('Successful same-route personal commit'); checks.push('successful same-route commit preserves scroll');
    await app.go('help'); await scrollTo(600); await app.openNamespace('sandbox'); await frame(); at(0, 'Namespace switch'); mainFocused();
    await scrollTo(600); await app.openNamespace('personal'); await frame(); at(0, 'Return namespace switch');
    checks.push('namespace changes reset viewport even when route resolution is automatic');

    await app.go('help'); await scrollTo(500); const detachedY = y();
    const detachedRepo = createMemorySharedRepository(); handles.push(detachedRepo);
    detached = createSharedOfflineView(doc, { repositoryFactory: async () => detachedRepo, clock, FormData: win.FormData });
    await detached.readyPromise; await frame(); at(detachedY, 'Detached shared composition'); detached.close(); detached = null;
    checks.push('detached shared startup cannot consume navigation or alter the parent viewport');

    await app.go('shared'); shared = app.sharedController(); await shared.readyPromise;
    form = root.querySelector('#shared-create-form');
    fields(form, { 'shared-book-name': 'QC Scroll Shared', 'shared-name-a': 'QC A', 'shared-name-b': 'QC B', 'shared-consent-a': true, 'shared-consent-b': true, 'shared-device-ack': true });
    await scrollTo(700); form.requestSubmit(); await until(() => !shared.isBusy() && shared.snapshot().space, 'Shared creation');
    at(0, 'Shared blank-to-book direct commit'); sharedFocused(); checks.push('shared creation changes the logical view and resets viewport/focus');

    await scrollTo(650); await shared.go('ledger'); await frame(); at(0, 'Shared tab change'); sharedFocused();
    checks.push('shared tab navigation resets viewport and focuses the shared heading');
    form = root.querySelector('#shared-entry-form'); fields(form, { 'shared-entry-kind': 'contribution', 'shared-entry-amount': '10000', 'shared-entry-date': '2026-10-22', 'shared-entry-note': 'QC Scroll contribution' });
    await scrollTo(650); const pendingY = y(); form.requestSubmit();
    notAtTop('Shared pending same-route render'); await until(() => !shared.isBusy() && shared.snapshot().space.entries.length === 1, 'Shared commit');
    notAtTop('Shared confirmed same-route render');
    form = root.querySelector('#shared-entry-form'); fields(form, { 'shared-entry-kind': 'expense', 'shared-entry-amount': 'invalid', 'shared-entry-date': '2026-10-22' }); form.requestSubmit();
    await until(() => !shared.isBusy() && root.querySelector('#shared-feedback').getAttribute('role') === 'alert', 'Shared validation feedback'); notAtTop('Shared rejected same-route render'); assert(root.querySelector('#shared-entry-amount').value === 'invalid', 'Rejected shared input must keep its draft');
    checks.push('shared pending, confirmed and rejected form renders preserve viewport');

    const detail = [...root.querySelectorAll('.shared-offline button')].find(node => node.textContent.startsWith('Xem khoản ')); assert(detail, 'Rendered shared entry action missing');
    detail.click(); await frame(); at(0, 'Shared entry detail navigation'); sharedFocused();
    await scrollTo(600); assert(shared.back(), 'Shared Back must consume detail navigation'); await frame(); at(0, 'Shared Back navigation');
    checks.push('shared detail and Back navigation reset viewport');
    return { passed: checks.length, checks, durationMs: performance.now() - started, scope: 'Real browser scrolling, focus, FormData and form events with fictional in-memory repositories; stable-height tail prevents false PASS from document clamping. No saved stores, device or native execution.' };
  } finally {
    detached?.close(); app?.close(); for (const handle of handles) handle.close(); for (const args of listeners) win.removeEventListener(...args); win.history.replaceState(null, '', initialUrl); tail.remove();
  }
}

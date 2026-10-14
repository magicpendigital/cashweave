// Code-level integration checks with a minimal DOM stub, not real browser/visual QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { sharedDocument } from '../shared-embed.js';
import { sharedScriptHash } from '../shared-csp.js';
import { createDemoState } from '../sample.js';
import * as ledger from '../ledger.js';
import { reviewArtifactUrl } from '../scripts/review-output.mjs';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('index.html', root), 'utf8');
const html = await readFile(reviewArtifactUrl('financial-assistant-couples-demo.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const code = scripts[0]?.[1];
const sharedCode = /<script>([\s\S]*?)<\/script>/.exec(sharedDocument)?.[1];
const storageKey = 'financial-assistant-prototype-v1';
const hash = value => 'sha256-' + createHash('sha256').update(value).digest('base64');
const plain = value => JSON.parse(JSON.stringify(value));

function node(name = '') {
  const attributes = new Map();
  const classes = new Set();
  const children = new Map();
  const listeners = new Map();
  let srcdoc = '';
  return {
    name, innerHTML: '', textContent: '', value: '', hidden: false, dataset: {}, style: {}, srcdocWrites: 0,
    classList: { toggle(key, on) { if (on) classes.add(key); else classes.delete(key); }, contains(key) { return classes.has(key); } },
    get srcdoc() { return srcdoc; },
    set srcdoc(value) { srcdoc = value; this.srcdocWrites++; attributes.set('srcdoc', value); },
    setAttribute(key, value) { attributes.set(key, value); },
    removeAttribute(key) { attributes.delete(key); },
    hasAttribute(key) { return attributes.has(key); },
    getAttribute(key) { return attributes.get(key); },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    async dispatch(type, target = this) { for (const fn of listeners.get(type) || []) await fn({ target, preventDefault() {} }); },
    focus() {}, reportValidity() { return true; },
    querySelector(selector) { if (!children.has(selector)) children.set(selector, node(selector)); return children.get(selector); },
    querySelectorAll() { return []; },
    closest(selector) {
      if (selector === 'button') return this;
      const data = /^\[data-([\w-]+)\]$/.exec(selector)?.[1];
      if (data) return Object.hasOwn(this.dataset, data.replace(/-([a-z])/g, (_, c) => c.toUpperCase())) ? this : null;
      return selector === '#' + this.id ? this : null;
    },
  };
}
function harness(initial = new Map(), { shared = false } = {}) {
  const nodes = new Map();
  const get = name => { if (!nodes.has(name)) nodes.set(name, node(name)); return nodes.get(name); };
  const views = (shared ? ['space', 'agreement', 'ledger', 'plans', 'close'] : ['dashboard', 'transactions', 'assets', 'calendar', 'guide', 'shared']).map(view => {
    const item = node(view); item.dataset.view = view; return item;
  });
  const document = Object.assign(node('document'), {
    title: '', body: node('body'),
    getElementById: id => get('#' + id),
    querySelector: selector => get(selector),
    querySelectorAll: selector => selector === '[data-view]' ? views : [],
  });
  const values = new Map(initial);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  class FormDataStub {
    constructor(form) { this.values = new Map(Object.entries(form.values || {})); }
    get(key) { return this.values.get(key) ?? null; }
    has(key) { return this.values.has(key); }
  }
  const sandbox = { document, window: { scrollTo() {}, confirm() { return false; } }, localStorage: storage, FormData: FormDataStub, console: { error() {}, log() {} }, structuredClone, TextEncoder, navigator: { locks: { async request(name, options, callback) { return callback(); } } }, crypto: { randomUUID }, setTimeout() { return 1; }, clearTimeout() {}, Blob, URL };
  // Shared code must not attempt to read the parent or its localStorage. This is
  // a tripwire; the actual origin boundary is verified via sandbox attributes.
  if (shared) {
    Object.defineProperty(sandbox, 'parent', { get() { throw new Error('Unexpected parent access'); } });
    Object.defineProperty(sandbox, 'localStorage', { get() { throw new Error('Unexpected shared storage access'); } });
  }
  const context = vm.createContext(sandbox);
  vm.runInContext(shared ? sharedCode : code, context, { timeout: 1000 });
  const click = async view => { const button = views.find(item => item.dataset.view === view); assert.ok(button); await document.dispatch('click', button); };
  const submit = async (id, values, dataset = {}) => {
    const form = node(id); form.id = id; form.values = values; form.dataset = dataset;
    await (shared ? get('#workspace') : document).dispatch('submit', form);
    return form;
  };
  return { context, document, nodes, get, values, click, submit };
}

test('standalone has one strict bundled script, inline styles and no external asset imports', () => {
  assert.equal(scripts.length, 1);
  assert.ok(code.startsWith("'use strict';"));
  assert.doesNotMatch(html, /<script\s[^>]*src=|<link\s[^>]*rel=["']stylesheet/);
  assert.doesNotMatch(code, /^\s*(?:import|export)\s/m);
  assert.doesNotMatch(sharedCode, /^\s*(?:import|export)\s/m);
  assert.doesNotMatch(sharedDocument, /(?:src|href)=["']\.\//);
  assert.match(html, /<style>/);
  assert.match(html, /Không cần mời ai/);
});

test('shared frame permits scripted form handling but keeps origin, storage, popup and parent isolation', () => {
  for (const page of [source, html]) {
    const frame = /<iframe\b[^>]*id="shared-frame"[^>]*>/.exec(page)?.[0];
    assert.ok(frame);
    const flags = /sandbox="([^"]+)"/.exec(frame)[1].split(/\s+/).sort();
    assert.deepEqual(flags, ['allow-forms', 'allow-scripts']);
    assert.match(frame, /referrerpolicy="no-referrer"/);
    assert.doesNotMatch(frame, /allow-same-origin|allow-top-navigation|allow-popups/);
  }
});

test('standalone and shared CSP hashes match exact scripts; network/form submission remain disabled', () => {
  const parentPolicy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
  const childPolicy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(sharedDocument)?.[1];
  assert.ok(parentPolicy?.includes("'" + hash(code) + "'"));
  assert.equal(sharedScriptHash, hash(sharedCode));
  assert.ok(parentPolicy.includes("'" + sharedScriptHash + "'"));
  assert.ok(childPolicy?.includes("'" + sharedScriptHash + "'"));
  for (const policy of [parentPolicy, childPolicy]) {
    assert.match(policy, /default-src 'none'/);
    assert.match(policy, /connect-src 'none'/);
    assert.match(policy, /form-action 'none'/);
    assert.match(policy, /base-uri 'none'/);
    assert.doesNotMatch(/script-src ([^;]+)/.exec(policy)[1], /unsafe-inline|unsafe-eval/);
  }
});

test('standalone boots into personal dashboard and all five personal views render using bundled modules', async () => {
  const app = harness();
  assert.equal(app.get('#page-title').textContent, 'Tổng quan');
  assert.equal(app.get('#shared-frame').srcdocWrites, 0);
  assert.equal(app.get('#shared-view').hidden, true);
  const expected = { dashboard: 'Tài khoản & thẻ', transactions: 'Thêm giao dịch', assets: 'Cập nhật giá', calendar: 'Thêm khoản dự kiến', guide: 'Quy tắc tính quan trọng' };
  for (const [view, text] of Object.entries(expected)) {
    await app.click(view);
    assert.ok(app.get('#view').innerHTML.includes(text), view);
    assert.equal(app.get('#view').hidden, false);
    assert.equal(app.get('.top-add').hidden, false);
  }
});

test('switching shared/personal loads the iframe once and preserves personal data and date display', async () => {
  const app = harness();
  const date = ledger.localDate();
  await app.submit('transaction-form', { date, kind: 'expense', amount: '123456', accountId: 'bank-main', category: 'Kiểm thử', note: 'Khoản kiểm thử riêng' });
  const saved = app.values.get(storageKey);
  assert.ok(saved?.includes('Khoản kiểm thử riêng'));
  await app.click('shared');
  assert.equal(app.get('#view').hidden, true);
  assert.equal(app.get('#shared-view').hidden, false);
  assert.equal(app.get('.top-add').hidden, true);
  assert.equal(app.get('#today-label').hidden, true);
  assert.equal(app.get('#shared-frame').srcdoc, sharedDocument);
  assert.equal(app.get('#shared-frame').srcdocWrites, 1);
  await app.click('transactions');
  assert.ok(app.get('#view').innerHTML.includes('Khoản kiểm thử riêng'));
  assert.equal(app.get('#today-label').hidden, false);
  await app.click('shared');
  assert.equal(app.get('#shared-frame').srcdocWrites, 1);
  assert.equal(app.values.get(storageKey), saved);
  const reloaded = harness(app.values);
  await reloaded.click('transactions');
  assert.ok(reloaded.get('#view').innerHTML.includes('Khoản kiểm thử riêng'));
});

test('corrupt stored data remains intact and cannot be silently replaced by a navigation click', async () => {
  const raw = '{bad-json';
  const app = harness(new Map([[storageKey, raw]]));
  assert.equal(app.get('#page-title').textContent, 'Cần khôi phục dữ liệu');
  assert.ok(app.get('#view').innerHTML.includes('Tải bản sao dữ liệu cũ'));
  await app.click('shared');
  assert.equal(app.values.get(storageKey), raw);
  assert.equal(app.get('#shared-frame').srcdocWrites, 0);
});

test('bundled ledger produces the same accounting and CSV results as original ES modules', () => {
  const app = harness();
  const bundled = vm.runInContext("modules['ledger.js']", app.context);
  const original = createDemoState();
  const transaction = { id: 'test-credit-purchase', date: ledger.localDate(), kind: 'expense', amount: 234567, accountId: 'card-hsbc' };
  const actual = bundled.createTransaction(original, transaction);
  const expected = ledger.createTransaction(original, transaction);
  assert.deepEqual(plain(bundled.calculateDashboard(actual)), plain(ledger.calculateDashboard(expected)));
  const csv = `date,kind,amount,accountId,note\n${ledger.localDate()},income,234567,bank-main,CSV test`;
  const left = bundled.importTransactionsCsv(original, csv);
  const right = ledger.importTransactionsCsv(original, csv);
  assert.deepEqual(plain(bundled.calculateDashboard(left.state)), plain(ledger.calculateDashboard(right.state)));
  assert.equal(left.imported, 1);
});

test('embedded shared app boots, handles consent and entries, and runs all five views without personal data', async () => {
  const app = harness(new Map(), { shared: true });
  assert.ok(app.get('#workspace').innerHTML.includes('Tạo không gian demo'));
  await app.submit('create', { name: 'QA shared', 'create-consent': 'on' }, { form: 'create' });
  assert.ok(app.get('#workspace').innerHTML.includes('QA shared'));
  await app.submit('invite', { 'invite-consent': 'on' }, { form: 'invite' });
  app.get('#actor-select').value = 'B';
  await app.get('#actor-select').dispatch('change');
  await app.submit('accept', { token: 'MOI-DEMO-1', 'join-consent': 'on' }, { form: 'accept' });
  assert.ok(app.get('#status-message').textContent.includes('Cả hai đã đồng ý'));
  await app.submit('entry', { kind: 'contribution', 'entry-amount': '1000000', date: '2026-10-10', note: 'Shared test' }, { form: 'entry' });
  assert.ok(app.get('#status-message').textContent.includes('Đã ghi giao dịch chung'));
  for (const view of ['space', 'agreement', 'ledger', 'plans', 'close']) {
    await app.click(view);
    assert.ok(app.get('#workspace').innerHTML.length > 1000, view);
  }
  await app.click('ledger');
  assert.ok(app.get('#workspace').innerHTML.includes('Shared test'));
  assert.equal(app.values.size, 0);
});

test('shared iframe has bottom breathing room when mobile navigation is fixed', async () => {
  const css = await readFile(new URL('styles.css', root), 'utf8');
  assert.match(css, /@media\(max-width:900px\)\{\.shared-view\{padding-bottom:calc\(76px \+ env\(safe-area-inset-bottom\)\)\}\}/);
});

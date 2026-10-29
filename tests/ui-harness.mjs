// Minimal DOM adapter for execution tests. Not a browser renderer or HTML conformance test.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { reviewArtifactUrl } from '../scripts/review-output.mjs';
const html = await readFile(reviewArtifactUrl('financial-assistant-couples-demo.html'), 'utf8');
const code = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
const injected = code.replace(/\r?\nrender\(\);\r?\n/,`\nglobalThis.testUI = { getState: () => state, getDraft: () => allocationDraft, render, setView, openTransactionModal, openLaterAllocation, openTemplateEditor, beginAllocationEditor, showAllocationPreview, updateBudgetField, saveTransactionForm, persistAndRender, openRestoreModal, previewRestore, downloadCurrentBackup, confirmRestore, performUndo, handleSubmit, renderAllocations, renderData, closeModal };\nrender();\n`);
const decode = value => value.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
export function harness({ values = new Map(), failWrite = false, lockRequest, locks = true, protocol = 'http:' } = {}) {
  const nodes = new Map(); const listeners = new Map(); const downloads = []; let htmlCounter = 0;
  function node(id = '') {
    let markup = ''; let ownedIds = [];
    const element = { id, dataset: {}, value: '', checked: false, hidden: false, style: {}, files: [], textContent: '', classList: { toggle() {} }, focus() {}, setAttribute() {}, removeAttribute() {}, hasAttribute() { return false; }, click() { downloads.push(this.download); }, querySelector(selector) { return nodes.get(selector.replace(/^#/, '')) || node(); }, querySelectorAll() { return []; }, closest(selector) { if (selector === '#' + id) return this; const match = /^\[data-([\w-]+)\]$/.exec(selector); return match && this.dataset[match[1]] !== undefined ? this : null; } };
    Object.defineProperty(element, 'innerHTML', { get: () => markup, set(value) {
      for (const old of ownedIds) nodes.delete(old); ownedIds = []; markup = value; htmlCounter++;
      for (const match of value.matchAll(/<([a-z][a-z0-9-]*)[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const child = node(match[2]); const attrs = match[0];
        child.value = decode(/\bvalue="([^"]*)"/.exec(attrs)?.[1] || '');
        for (const data of attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)) child.dataset[data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = decode(data[2]);
        if (match[1] === 'select') { const tail = value.slice(match.index + attrs.length).split('</select>')[0]; const opts = [...tail.matchAll(/<option[^>]*value="([^"]*)"([^>]*)>/g)]; child.value = decode((opts.find(option => /selected/.test(option[2])) || opts[0])?.[1] || ''); }
        nodes.set(child.id, child); ownedIds.push(child.id);
      }
    }});
    return element;
  }
  const root = node('root'); root.innerHTML = html;
  const document = { body: node('body'), getElementById: id => nodes.get(id) || null, querySelector: selector => nodes.get(selector.replace(/^#/, '')) || node(), querySelectorAll: () => [], createElement: () => node(), addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); } };
  class FormDataStub { constructor(form) { this.values = form.values || {}; } get(key) { return this.values[key] ?? null; } }
  const storage = { getItem: key => values.get(key) ?? null, setItem(key, value) { if (failWrite) throw new Error('QuotaExceeded synthetic'); values.set(key, value); }, removeItem: key => values.delete(key) };
  const sandbox = { document, location: { protocol }, window: { scrollTo() {}, confirm: () => true }, navigator: locks ? { locks: { request: lockRequest || (async (name, options, callback) => callback()) } } : {}, localStorage: storage, FormData: FormDataStub, TextEncoder, crypto: { randomUUID }, console: { error() {} }, Blob, URL, setTimeout() {}, clearTimeout() {} };
  const context = vm.createContext(sandbox); vm.runInContext(injected, context);
  const api = sandbox.testUI;
  const submit = async (id, values, dataset = {}) => { const form = nodes.get(id) || node(id); form.values = values; Object.assign(form.dataset, dataset); await api.handleSubmit({ target: form, preventDefault() {} }); return form; };
  const change = async (id, value) => { const target = nodes.get(id); if (!target) throw new Error('Missing mock element ' + id); target.value = value; target.closest = selector => nodes.get(selector.replace(/^#/, '')) || null; for (const fn of listeners.get('change') || []) await fn({ target }); };
  const click = async (action, data = {}) => { const target = node(); target.dataset = { action, ...data }; for (const fn of listeners.get('click') || []) await fn({ target }); };
  return { api, nodes, get: id => nodes.get(id), values, submit, change, click, downloads, context, storage, htmlCounter: () => htmlCounter };
}

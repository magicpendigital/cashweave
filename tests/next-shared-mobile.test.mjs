// Scoped shared adapter tests use a minimal DOM stub; no rendered/browser claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedView} from '../ui/shared-view.js';
import {readFile} from 'node:fs/promises';
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
function harness(){
 const nodes=new Map(),get=name=>{if(!nodes.has(name))nodes.set(name,node(name));return nodes.get(name);};
 const views=['space','agreement','ledger','plans','close'].map(view=>{const n=node(view);n.dataset.view=view;return n;});
 const scope=Object.assign(node('scope'),{querySelector:get,querySelectorAll:selector=>selector==='[data-view]'?views:[]});
 const pageDocument={createElement(){return Object.assign(node('host'),{attachShadow(){return scope;}});}};
 class FormData{constructor(form){this.values=new Map(Object.entries(form.values||{}));}get(key){return this.values.get(key)??null;}has(key){return this.values.has(key);}}
 const browser={FormData};Object.defineProperty(browser,'localStorage',{get(){throw new Error('Must not access personal storage');}});
 const view=createSharedView(pageDocument,browser);
 return {view,scope,get,async click(key){await scope.dispatch('click',views.find(n=>n.dataset.view===key));},async submit(kind,values){const form=node(kind);form.dataset={form:kind};form.values=values;await get('#workspace').dispatch('submit',form);}};
}
test('shared scoped view preserves consent and simulated entries with no parent ledger or storage access',async()=>{
 const h=harness();assert.ok(h.get('#workspace').innerHTML.includes('Tạo không gian demo'));assert.ok(h.scope.innerHTML.includes('Không nhập dữ liệu tài chính thật'));assert.ok(!h.scope.innerHTML.includes('<iframe'));assert.ok(!h.scope.innerHTML.includes('<aside'));
 await h.submit('create',{name:'Synthetic shared home','create-consent':'on'});await h.submit('invite',{'invite-consent':'on'});h.get('#actor-select').value='B';await h.get('#actor-select').dispatch('change');await h.submit('accept',{token:'MOI-DEMO-1','join-consent':'on'});
 assert.ok(h.get('#status-message').textContent.includes('Cả hai đã đồng ý'));await h.submit('entry',{kind:'contribution','entry-amount':'1000000',date:'2026-10-10',note:'Synthetic shared funding'});
 for(const key of ['space','agreement','ledger','plans','close']){await h.click(key);assert.ok(h.get('#workspace').innerHTML.length>1000,key);}await h.click('ledger');assert.ok(h.get('#workspace').innerHTML.includes('Synthetic shared funding'));assert.equal(h.view.back(),true);assert.equal(h.view.back(),false);
});
test('separate shared adapter instances cannot see one another and a new session starts empty',async()=>{
 const a=harness(),b=harness();await a.submit('create',{name:'Synthetic shared one','create-consent':'on'});assert.ok(a.get('#workspace').innerHTML.includes('Synthetic shared one'));assert.ok(!b.get('#workspace').innerHTML.includes('Synthetic shared one'));assert.ok(b.get('#workspace').innerHTML.includes('Tạo không gian demo'));
});
test('shared adapter source exposes no persistence or personal dataset capabilities',async()=>{
 const s=await readFile(new URL('../ui/shared-view.js',import.meta.url),'utf8');assert.doesNotMatch(s,/localStorage|indexedDB|repositoryFactory|\.Capacitor|\.fetch\(/);assert.match(s,/const FormData=browser.FormData/);assert.match(s,/attachShadow/);
});

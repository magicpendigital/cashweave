// Synthetic UI / source checks. These do not certify pixels, touch, native or browser IndexedDB.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {nextHarness} from './next-ui-harness.mjs';
import {translator} from '../ui/i18n.js';
import {exportSnapshot} from '../core/migration.js';
const t=translator();
async function ready(options){const h=await nextHarness(options);await h.app.go('create');await h.submit('onboard-form',{locale:'vi-VN',currencyCode:'VND',timezoneId:'Asia/Ho_Chi_Minh',name:'Synthetic mobile bank',accountType:'BANK',opening:'1000',openingDate:'2026-10-01'});return h;}
const hasClass=(node,name)=>(node.getAttribute('class')||'').split(' ').includes(name);
test('home answers balance, unassigned money, due items and recent activity in that order; the ＋ action is unique',async()=>{
 const h=await ready(),accountId=h.app.snapshot().accounts[0].id;await h.app.perform('createPlan',{title:'Synthetic rent due',direction:'EXPENSE',currencyCode:'VND',dueLocalDate:'2026-11-05',expectedAmountMinor:'300',expectedAccountId:accountId});await h.app.go('transactions/new');await h.submit('transaction-form',{operationType:'EXPENSE',accountId,amount:'20',date:'2026-10-31',memo:'Synthetic home coffee'});await h.app.go('overview');
 const text=h.text(),order=[t('spendable'),t('unassignedSuggest'),t('dueSoon'),t('recent')].map(key=>text.indexOf(key));assert.ok(order.every(i=>i>=0),String(order));assert.deepEqual([...order].sort((a,b)=>a-b),order);
 assert.match(h.root.querySelector('[data-amount="spendable"]').textContent,/^980\s₫$/);assert.ok(text.includes('Synthetic rent due'));assert.ok(text.includes('Synthetic home coffee'));assert.ok(h.root.querySelector('[data-pay]'));
 for(const route of ['overview','transactions','plans','funds','more']){await h.app.go(route);assert.equal(h.root.querySelectorAll('[id="quick-expense"]').length,1,route);}
 await h.get('quick-expense').click();assert.equal(h.get('quick-expense'),null);assert.equal(h.get('transaction-form-operationType').value,'EXPENSE');assert.equal(h.app.currentRoute(),'transactions/new/expense');h.app.close();
});
test('filter sheets dismiss with Back and Escape without losing route or changing financial records',async()=>{
 const h=await ready(),before=h.app.snapshot();await h.app.go('transactions');let sheet=h.root.querySelector('[data-filter-sheet]');sheet.open=true;
 assert.equal(await h.app.handleNativeBack(),true);assert.equal(sheet.open,false);assert.equal(h.app.currentRoute(),'transactions');sheet.open=true;await sheet.dispatch('keydown',{key:'Escape'});assert.equal(sheet.open,false);assert.deepEqual(h.app.snapshot(),before);
 await h.app.go('overview');assert.equal(await h.app.handleNativeBack(),false);h.app.close();
});
test('ledger rows are grouped by day, keep category/account meta and link to the exact original detail',async()=>{
 const h=await ready(),accountId=h.app.snapshot().accounts[0].id;await h.app.perform('addCategory',{name:'Synthetic food',direction:'EXPENSE'});const category=h.app.snapshot().categories[0].id;await h.app.go('transactions/new');await h.submit('transaction-form',{operationType:'EXPENSE',accountId,categoryId:category,amount:'20',date:'2026-10-31',memo:'Synthetic mobile coffee'});const operation=h.app.snapshot().operations.at(-1);await h.app.go('transactions');
 const day=h.root.querySelectorAll('section').find(n=>hasClass(n,'day-group'));assert.ok(day.textContent.includes(t('today')+' · 31/10'));const row=h.root.querySelectorAll('a').find(n=>n.textContent.includes('Synthetic mobile coffee'));assert.ok(row);assert.ok(row.textContent.includes('Synthetic food · Synthetic mobile bank'));assert.ok(row.textContent.includes('-20'));assert.equal(row.getAttribute('href'),'#transactions/'+operation.id);await row.click();assert.equal(h.app.currentRoute(),'transactions/'+operation.id);h.app.close();
});
test('shared scope never uses iframe or mutates personal ledger; personal quick action is not shown there',async()=>{
 const h=await ready(),before=h.app.snapshot();await h.app.go('shared');assert.equal(h.root.querySelector('iframe'),null);assert.equal(h.get('quick-expense'),null);assert.ok(h.text().includes(t('sharedDemo')));const host=h.root.querySelector('section[class="shared-host"]');assert.ok(host);await h.app.go('overview');assert.deepEqual(h.app.snapshot(),before);await h.app.go('shared');assert.equal(h.root.querySelector('section[class="shared-host"]'),host);h.app.close();
});
test('native local backup cancel, oversize and malformed imports leave active data untouched',async()=>{
 let result=null;const h=await ready({appOptions:{onReadBackup:async()=>result}}),before=h.app.snapshot();await h.app.go('data');assert.equal(h.get('restore-form').querySelector('input[type="file"]'),null);await h.submit('restore-form',{});assert.deepEqual(h.app.snapshot(),before);
 for(const item of [{text:'{}',size:6*1024*1024},{text:'{broken',size:7},{text:'{}',size:-1}]){result=item;await h.submit('restore-form',{});assert.deepEqual(h.app.snapshot(),before);assert.ok(h.root.querySelector('[role="alert"]'));}h.app.close();
});
test('native JSON restore stages a checked new dataset but does not activate without explicit acknowledgement',async()=>{
 const source=await ready(),text=await exportSnapshot(source.app.snapshot());source.app.close();const h=await ready({appOptions:{onReadBackup:async()=>({text,size:Buffer.byteLength(text)})}}),before=h.app.snapshot();await h.app.go('data');await h.submit('restore-form',{});assert.deepEqual(h.app.snapshot(),before);assert.ok(h.text().includes(t('stageReady')));assert.ok(h.get('activate-stage-form'));h.app.close();
});
test('style source carries the redesign tokens, offline font stack, safe areas and touch-size controls',async()=>{
 const css=await readFile(new URL('../ui/next.css',import.meta.url),'utf8');for(const token of ['--bg:#F6F7F2','--text:#17211C','--muted:#5B6B63','--brand:#1F5A45','--warn:#9A5418','--warn-bg:#FBEFD9','--positive:#1C6B45',"'Be Vietnam Pro',system-ui",'tabular-nums','var(--safe-area-inset-bottom','max-height:90dvh','.tab-bar{','.tab-fab{','tr.mobile-record','min-height:44px','min-height:48px','--column:560px'])assert.ok(css.includes(token),token);
 assert.doesNotMatch(css,/user-scalable\s*:\s*no|maximum-scale\s*:\s*1/);assert.doesNotMatch(css,/@import|url\(\s*['"]?https?:/);const html=await readFile(new URL('../next.html',import.meta.url),'utf8');assert.doesNotMatch(html,/fonts\.googleapis|https?:\/\//);
});
test('native picker completing after navigation is discarded rather than staging into the new context',async()=>{
 let finish;const h=await ready({appOptions:{onReadBackup:()=>new Promise(resolve=>{finish=resolve;})}}),text=await exportSnapshot(h.app.snapshot()),before=h.app.snapshot();await h.app.go('data');const pending=h.app.submit('restore-form',{});await h.app.go('help');await h.app.go('data');finish({text,size:Buffer.byteLength(text)});await pending;assert.deepEqual(h.app.snapshot(),before);assert.equal(h.get('activate-stage-form'),null);h.app.close();
});

test('native Back stays in the app while an atomic write is still pending',async()=>{
 const h=await ready(),repo=h.repositories.get('personal'),write=repo.runAtomicCommand.bind(repo);let release;repo.runAtomicCommand=(...args)=>new Promise(resolve=>{release=()=>resolve(write(...args));});const pending=h.app.perform('addCategory',{name:'Synthetic wait',direction:'EXPENSE'});assert.equal(await h.app.handleNativeBack(),true);assert.equal(h.app.currentRoute(),'overview');release();await pending;assert.equal(await h.app.handleNativeBack(),false);h.app.close();
});

test('settlement unlink remains a visible action cell and preserves actual cash when used',async()=>{
 const h=await ready(),accountId=h.app.snapshot().accounts[0].id;await h.app.go('plans/new');await h.submit('plan-form',{title:'Synthetic settlement',direction:'EXPENSE',amount:'100',due:'2026-10-31',accountId,recurrence:'NONE'});const planId=h.app.snapshot().occurrences.at(-1).id;await h.app.go('transactions/new/'+planId);await h.submit('transaction-form',{operationType:'EXPENSE',accountId,amount:'20',date:'2026-10-31',memo:'Synthetic settlement payment'});await h.app.go('plans/'+planId);
 const unlink=h.button(t('unlink')),cell=unlink?.parentNode;assert.ok(unlink);assert.ok(hasClass(cell,'record-action'));assert.ok(!hasClass(cell,'record-detail'));const before=h.app.snapshot();await unlink.click();assert.deepEqual(h.app.snapshot().postings,before.postings);assert.equal(h.app.snapshot().settlements.length,before.settlements.length+1);h.app.close();
});
test('forecast compact card labels remaining amount as primary and keeps variance separate',async()=>{
 const h=await ready(),accountId=h.app.snapshot().accounts[0].id;await h.app.go('plans/new');await h.submit('plan-form',{title:'Synthetic future income',direction:'INCOME',amount:'500',due:'2026-11-10',accountId,recurrence:'NONE'});await h.app.go('forecast');const row=h.root.querySelectorAll('tr').find(n=>n.textContent.includes('Synthetic future income'));assert.ok(row);const amount=row.children.find(n=>hasClass(n,'record-amount'));assert.equal(amount.getAttribute('data-label'),t('remaining'));assert.equal(amount.getAttribute('data-amount-label'),'true');assert.ok(amount.textContent.includes('500'));assert.ok(!amount.textContent.includes('-')&&!amount.textContent.includes('−'));const variance=row.children.find(n=>n.getAttribute('data-label')===t('variance'));assert.ok(hasClass(variance,'record-meta'));assert.ok(!hasClass(variance,'record-amount'));assert.ok(row.children.every(n=>!hasClass(n,'record-detail')));h.app.close();
});
test('mobile filter is a modal with inert background, initial focus, scroll lock and Apply return focus',async()=>{
 const h=await ready({viewportWidth:390});await h.app.go('transactions');let sheet=h.root.querySelector('[data-filter-sheet]'),panel=sheet.querySelector('section');const nav=h.root.querySelector('nav');sheet.open=true;await sheet.dispatch('toggle');assert.equal(panel.getAttribute('role'),'dialog');assert.equal(panel.getAttribute('aria-modal'),'true');assert.equal(h.document.activeElement,panel);assert.equal(nav.inert,true);assert.equal(h.document.body.style.overflow,'hidden');
 await h.submit('period-form',{from:'2026-10-01',through:'2026-10-31',currencyCode:'VND',accountId:''});sheet=h.root.querySelector('[data-filter-sheet]');assert.equal(nav.inert,false);assert.equal(h.document.body.style.overflow,'');assert.equal(h.document.activeElement,sheet.querySelector('summary'));assert.equal(panel.getAttribute('aria-modal'),null);h.app.close();
});
test('desktop filter stays a non-modal disclosure and does not trap keyboard Tab',async()=>{
 const h=await ready({viewportWidth:1280});await h.app.go('transactions');const sheet=h.root.querySelector('[data-filter-sheet]');sheet.open=true;await sheet.dispatch('toggle');const panel=sheet.querySelector('section');assert.equal(panel.getAttribute('role'),null);assert.equal(h.root.querySelector('nav').inert,false);assert.notEqual(h.document.body.style.overflow,'hidden');let prevented=false;await panel.dispatch('keydown',{key:'Tab',shiftKey:true,preventDefault(){prevented=true;}});assert.equal(prevented,false);await h.app.go('plans');h.app.close();
});
test('invalid mobile filter shows and focuses an alert inside the active dialog',async()=>{
 const h=await ready({viewportWidth:390});await h.app.go('transactions');const sheet=h.root.querySelector('[data-filter-sheet]');sheet.open=true;await sheet.dispatch('toggle');const panel=sheet.querySelector('section'),before=h.app.snapshot();await h.submit('period-form',{from:'2026-11-02',through:'2026-11-01',currencyCode:'VND',accountId:''});const alert=panel.querySelector('[role="alert"]');assert.ok(alert);assert.equal(h.document.activeElement,alert);assert.equal(panel.getAttribute('aria-modal'),'true');assert.deepEqual(h.app.snapshot(),before);await h.submit('period-form',{from:'2026-10-01',through:'2026-10-31',currencyCode:'VND',accountId:''});assert.equal(h.root.querySelector('[role="alert"]'),null);h.app.close();
});
test('route changes scroll to the top, tabs expose aria-current, and the hidden shared ledger keeps old links working',async()=>{
 const h=await ready(),start=h.scrolls();await h.app.go('transactions');assert.ok(h.scrolls()>start);const after=h.scrolls();await h.app.render();assert.equal(h.scrolls(),after);
 const current=()=>h.root.querySelectorAll('[aria-current="page"]').filter(n=>n.getAttribute('data-nav')).map(n=>n.getAttribute('data-nav'));assert.deepEqual(current(),['transactions']);await h.app.go('plans');assert.deepEqual(current(),['plans']);
 assert.equal(h.root.querySelector('[data-nav="shared"]'),null);h.browser.location.hash='#shared';await h.browser.emit('hashchange');assert.equal(h.app.currentRoute(),'shared');assert.equal(h.root.querySelector('nav[aria-label="'+t('mainNavigation')+'"]'),null);h.app.close();
});

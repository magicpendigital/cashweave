import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoState } from '../sample.js';
import { calculateBalances, createTransaction, localDate } from '../ledger.js';
import { saveBudgetTemplate, createIncomeWithAllocation, BUILTIN_TEMPLATES, previewAllocation } from '../budgeting.js';
import { normalizeState, MAX_BACKUP_BYTES } from '../state-schema.js';
import { loadState, saveState, resetState, commitChange, undoChange, exportBackup, parseBackup, backupSummary, exportTransactionsCsv, storageKey, migrationBackupKey } from '../storage.js';
async function withStorage(fn){const old=globalThis.localStorage,nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),values=new Map();let queue=Promise.resolve();Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(_name,_options,action)=>{const current=queue.then(action);queue=current.catch(()=>{});return current;}}}});globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};try{return await fn(values,globalThis.localStorage)}finally{if(old===undefined)delete globalThis.localStorage;else globalThis.localStorage=old;if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator}}

test('v1 migration preserves every personal record and keeps original raw before first save',()=>withStorage(async values=>{
 const old=createDemoState(),raw=JSON.stringify(old);values.set(storageKey,raw);const next=loadState();assert.equal(next.version,2);for(const key of ['accounts','cards','assets','transactions','plans','settings'])assert.deepEqual(next[key],old[key]);assert.deepEqual(calculateBalances(next),calculateBalances(old));assert.equal(values.get(storageKey),raw);assert.equal(values.has(migrationBackupKey),false);await saveState(next);assert.equal(values.get(migrationBackupKey),raw);assert.equal(JSON.parse(values.get(storageKey)).version,2);
}));
test('templates persist across reload and export restore preserves allocations and card data',()=>withStorage(async ()=>{
 let s=loadState();s=saveBudgetTemplate(s,{name:'Riêng',rows:BUILTIN_TEMPLATES[0].rows});s=createIncomeWithAllocation(s,{id:'new',kind:'income',date:localDate(),amount:20_000_000,accountId:'bank-main'},{lines:previewAllocation(20_000_000,BUILTIN_TEMPLATES[0].rows,s).lines,label:'50/30/20'});await saveState(s);const reloaded=loadState();assert.equal(reloaded.budgeting.templates.length,1);assert.deepEqual(reloaded,s);const restored=parseBackup(exportBackup(s));assert.deepEqual(restored,s);assert.deepEqual(backupSummary(restored),backupSummary(s));
}));
test('newest change undo restores income allocation atomically and survives reload',()=>withStorage(async ()=>{
 const old=loadState();const next=createIncomeWithAllocation(old,{id:'new',kind:'income',date:localDate(),amount:20_000_000,accountId:'bank-main'},{lines:previewAllocation(20_000_000,BUILTIN_TEMPLATES[0].rows,old).lines,label:'50/30/20'});const committed=commitChange(old,next,'Ghi thu và phân bổ');await saveState(committed);const restored=undoChange(loadState());assert.deepEqual(restored.transactions,old.transactions);assert.deepEqual(restored.budgeting,old.budgeting);assert.equal(restored.undoPoint,null);assert.match(restored.activity.at(-1).label,/Hoàn tác/);assert.throws(()=>undoChange(restored),/Không còn/);
}));
test('failed storage write leaves saved state unchanged',()=>withStorage(async (values,storage)=>{
 const old=loadState();await saveState(old);const raw=values.get(storageKey);const next=commitChange(old,saveBudgetTemplate(old,{name:'Riêng',rows:BUILTIN_TEMPLATES[0].rows}),'Thêm mẫu');storage.setItem=()=>{throw new Error('QuotaExceededError')};await assert.rejects(()=>saveState(next),/Quota/);assert.equal(values.get(storageKey),raw);assert.equal(old.budgeting.templates.length,0);
}));
test('migration backup failure prevents overwriting legacy data',()=>withStorage(async (values,storage)=>{
 const raw=JSON.stringify(createDemoState());values.set(storageKey,raw);const s=loadState();storage.setItem=()=>{throw new Error('Quota')};await assert.rejects(()=>saveState(s),/Quota/);assert.equal(values.get(storageKey),raw);
}));
test('stale tab cannot overwrite more recent state or reset it',()=>withStorage(async values=>{
 const s=loadState();await saveState(s);loadState();values.set(storageKey,JSON.stringify({...s,demo:false}));await assert.rejects(()=>saveState(s),/tab khác/);await assert.rejects(()=>resetState(),/tab khác/);assert.equal(JSON.parse(values.get(storageKey)).demo,false);
}));
test('future schema corrupt fields duplicate IDs and poison keys rejected without writes',()=>withStorage(async values=>{
 const s=loadState();await saveState(s);const raw=values.get(storageKey);const changed=structuredClone(s);changed.version=99;assert.throws(()=>parseBackup(JSON.stringify(changed)),/phiên bản/);changed.version=2;changed.accounts.push(changed.accounts[0]);assert.throws(()=>parseBackup(JSON.stringify(changed)),/ID/);assert.throws(()=>parseBackup('{"version":1,"__proto__":{"polluted":true}}'),/khóa/);assert.equal({}.polluted,undefined);assert.equal(values.get(storageKey),raw);
}));
test('malformed amounts references and orphan allocated income rejected',()=>{
 const s=normalizeState(createDemoState());let x=structuredClone(s);x.accounts[0].openingBalance='22000000';assert.throws(()=>parseBackup(JSON.stringify(x)),/tài khoản/);x=structuredClone(s);x.transactions[0].accountId='missing';assert.throws(()=>parseBackup(JSON.stringify(x)),/giao dịch/);assert.throws(()=>parseBackup('x'.repeat(MAX_BACKUP_BYTES+1)),/5 MiB/);
});
test('restore can be undone as one action without merging or duplicating rows',()=>withStorage(async ()=>{
 const before=loadState();const incoming=normalizeState(createDemoState());incoming.transactions=[];const committed=commitChange(before,parseBackup(exportBackup(incoming)),'Khôi phục bản sao');await saveState(committed);assert.equal(loadState().transactions.length,0);const undone=undoChange(loadState());assert.deepEqual(undone.transactions,before.transactions);
}));
test('CSV export quotes text and neutralizes spreadsheet formulas',()=>{
 let s=normalizeState(createDemoState());s=createTransaction(s,{kind:'income',date:localDate(),amount:100,accountId:'bank-main',category:'=HYPERLINK("x")',note:'comma, newline\nquote"'});const csv=exportTransactionsCsv(s);assert.match(csv,/'=HYPERLINK/);assert(csv.includes('comma, newline\nquote""'));assert(csv.startsWith('\uFEFFdate,kind,amount'));
});
test('legacy recoverable raw can import but fake v1 with v2 budgeting is not silently stripped',()=>{
 const s=createDemoState();assert.equal(parseBackup(JSON.stringify(s)).version,2);s.budgeting={};assert.throws(()=>parseBackup(JSON.stringify(s)),/schema v1/);
});
test('reset explicitly preserves a recovery copy and persists new demo',()=>withStorage(async values=>{
 const s=loadState();await saveState(s);const raw=values.get(storageKey);const reset=await resetState();assert.equal(reset.version,2);assert.equal(values.get(storageKey+'-before-reset'),raw);assert.deepEqual(loadState(),reset);
}));

test('concurrent module contexts serialize writes, then reject stale writer',()=>withStorage(async values=>{
 const original=normalizeState(createDemoState());values.set(storageKey,JSON.stringify(original));
 const a=await import('../storage.js?tab-a='+Date.now()),b=await import('../storage.js?tab-b='+Date.now());
 const sa=a.loadState(),sb=b.loadState();sa.settings.buffer=111;sb.settings.buffer=222;
 const result=await Promise.allSettled([a.saveState(sa),b.saveState(sb)]);
 assert.equal(result[0].status,'fulfilled');assert.equal(result[1].status,'rejected');assert.match(result[1].reason.message,/tab khác/);assert.equal(JSON.parse(values.get(storageKey)).settings.buffer,111);
}));
test('missing write-lock capability leaves readable export but prevents writes/reset',()=>withStorage(async values=>{
 const s=loadState();const before=values.get(storageKey);globalThis.navigator.locks=undefined;
 await assert.rejects(()=>saveState(s),/Chế độ chỉ đọc/);await assert.rejects(()=>resetState(),/Chế độ chỉ đọc/);assert.equal(values.get(storageKey),before);assert.equal(parseBackup(exportBackup(s)).version,2);
}));
test('backup rejects fabricated paid status and missing settled status for card payments',()=>{
 const s=createDemoState();s.plans.filter(p=>p.cardId).forEach(p=>p.settledAmount=p.amount);assert.throws(()=>parseBackup(JSON.stringify(s)),/số đã trả/);
 let t=normalizeState(createDemoState());const p=t.plans.find(p=>p.cardId);const card=t.cards.find(c=>c.id===p.cardId);t=createTransaction(t,{id:'pay-forged',kind:'transfer',date:localDate(),amount:100,fromAccountId:p.accountId,toAccountId:card.accountId,planId:p.id});t.plans.find(x=>x.id===p.id).settledAmount=0;assert.throws(()=>parseBackup(JSON.stringify(t)),/số đã trả/);
});
test('same-module queued writes retain invocation revision instead of overwriting each other',()=>withStorage(async values=>{
 const old=loadState();await saveState(old);const a=structuredClone(old),b=structuredClone(old);a.settings.buffer=111;b.settings.buffer=222;
 const result=await Promise.allSettled([saveState(a),saveState(b)]);assert.equal(result[0].status,'fulfilled');assert.equal(result[1].status,'rejected');assert.equal(JSON.parse(values.get(storageKey)).settings.buffer,111);
}));
test('oversized existing local data remains untouched in recovery mode',()=>withStorage(async values=>{
 const raw='x'.repeat(MAX_BACKUP_BYTES+1);values.set(storageKey,raw);assert.throws(()=>loadState(),/5 MiB/);assert.equal(values.get(storageKey),raw);
}));
test('remainder template value cannot carry imported HTML or arbitrary ignored data',()=>{
 let s=normalizeState(createDemoState());s=saveBudgetTemplate(s,{name:'Mẫu',rows:[{name:'Dư',kind:'remainder',value:0,accountId:''}]});s.budgeting.templates[0].rows[0].value='" /><img src=x onerror=alert(1)><input value="';assert.throws(()=>parseBackup(JSON.stringify(s)),/value phải bằng 0/);
});
test('present lock API that rejects file or opaque origin gives safe readable error',()=>withStorage(async values=>{
 const s=loadState();const before=values.get(storageKey);globalThis.navigator.locks.request=async()=>{const error=new Error('Opaque origin');error.name='SecurityError';throw error;};
 await assert.rejects(()=>saveState(s),/Chế độ chỉ đọc.*npm start/);assert.equal(values.get(storageKey),before);assert.equal(parseBackup(exportBackup(s)).version,2);
}));

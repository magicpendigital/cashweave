// Synthetic UI + actual native-adapter contract; no native filesystem/device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextHarness } from './next-ui-harness.mjs';
import { createNativeBackupAdapter } from '../mobile/backup-bridge.js';
import { translator } from '../ui/i18n.js';
const t=translator();
const onboarding={locale:'vi-VN',currencyCode:'VND',timezoneId:'Asia/Ho_Chi_Minh',name:'Synthetic bank',accountType:'BANK',opening:'0',openingDate:'2026-10-01'};
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(check){for(let n=0;n<400;n++){if(check())return;await pause();}throw new Error('SYNTHETIC_CONDITION_TIMEOUT');}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function fixture(){const h=await nextHarness();try{await h.app.go('create');await h.submit('onboard-form',onboarding);return h.app.snapshot();}finally{h.app.close();}}
const initial=await fixture();
async function harness(onDownload,large=false){const state=structuredClone(initial);if(large)state.retainedSyntheticData='x'.repeat(6*1024*1024);const h=await nextHarness({initial:state,appOptions:{onDownload}});await h.app.go('data');return h;}
const rootFeedback=h=>h.get('feedback')?.textContent||'';
const alert=h=>h.get('feedback')?.querySelector('[role="alert"]');
const exportNow=h=>h.button(t('export')).click();
function native(){let handler=async()=>({cancelled:true});const calls=[],notices=[];const adapter=createNativeBackupAdapter({async saveJson(input){calls.push(input);return handler(input);}},(message,error=false)=>notices.push({message,error}));return {calls,notices,download:adapter.onDownload,set:next=>{handler=next;}};}

test('Cancelled native export then confirmed write clears the old root alert only after completion',async()=>{
 const io=native(),h=await harness(io.download);try{
  const before=h.app.snapshot();await exportNow(h);assert.equal(rootFeedback(h),t('backupWriteNotConfirmed'));assert.ok(alert(h));
  const done=deferred();io.set(async({text})=>{await done.promise;return {saved:true,bytes:new TextEncoder().encode(text).length};});
  const pending=exportNow(h);await until(()=>io.calls.length===2);assert.ok(alert(h),'not cleared while native write pending');done.resolve();await pending;
  assert.match(io.notices.at(-1).message,/Đã lưu bản sao/);assert.equal(rootFeedback(h),'');assert.equal(alert(h),null);assert.deepEqual(h.app.snapshot(),before);
 }finally{h.app.close();}
});

test('Native byte mismatch stays unconfirmed and never produces a saved claim',async()=>{
 const io=native();io.set(async()=>({saved:true,bytes:1}));const h=await harness(io.download);try{await exportNow(h);assert.equal(rootFeedback(h),t('backupWriteNotConfirmed'));assert.ok(alert(h));assert.equal(io.notices.at(-1).error,true);assert.doesNotMatch(io.notices.at(-1).message,/^Đã lưu/);}finally{h.app.close();}
});

for(const result of [undefined,null,{status:'failed'},{status:'unknown'}])test('Unconfirmed adapter result '+JSON.stringify(result)+' never clears an export warning',async()=>{
 const h=await harness(async()=>result);try{await exportNow(h);assert.equal(rootFeedback(h),t('backupWriteNotConfirmed'));assert.ok(alert(h));}finally{h.app.close();}
});

test('Browser requested completion replaces stale error with an explicitly unconfirmed download request',async()=>{
 let result={status:'cancelled'};const h=await harness(async()=>result);try{await exportNow(h);assert.ok(alert(h));result={status:'requested'};await exportNow(h);assert.equal(rootFeedback(h),t('downloadStarted'));assert.equal(alert(h),null);assert.doesNotMatch(rootFeedback(h),/^Đã lưu/);}finally{h.app.close();}
});

test('Actual browser fallback reports requested while retaining no false native write confirmation',async()=>{
 const h=await harness(null);try{let revoked=false;h.browser.Blob=Blob;h.browser.URL={createObjectURL:()=> 'blob:synthetic',revokeObjectURL:()=>{revoked=true;}};h.browser.setTimeout=fn=>fn();await exportNow(h);assert.equal(rootFeedback(h),t('downloadStarted'));assert.equal(alert(h),null);assert.equal(revoked,true);}finally{h.app.close();}
});

for(const status of ['cancelled','failed'])test('Multipart '+status+' after the first written part stops later files and keeps the warning',async()=>{
 let calls=0;const h=await harness(async()=>({status:++calls===1?'written':status}),true);try{await exportNow(h);assert.equal(calls,2);assert.equal(rootFeedback(h),t('backupWriteNotConfirmed'));assert.ok(alert(h));}finally{h.app.close();}
});

test('Multipart mixed requested/written stays unconfirmed; a later all-written set clears progress only at the end',async()=>{
 let calls=0,mixed=true;const done=deferred();const h=await harness(async()=>{calls++;if(!mixed&&calls===4)await done.promise;return {status:mixed&&calls===2?'requested':'written'};},true);try{
  await exportNow(h);assert.equal(calls,4);assert.equal(rootFeedback(h),t('downloadStarted'));calls=0;mixed=false;
  const pending=exportNow(h);await until(()=>calls===4);assert.ok(rootFeedback(h).includes(t('multipartExport')));assert.notEqual(rootFeedback(h),'');done.resolve();await pending;assert.equal(rootFeedback(h),'');assert.equal(alert(h),null);
 }finally{h.app.close();}
});

for(const status of ['written','failed'])test('Late '+status+' from an old export cannot replace a newer same-route error',async()=>{
 const done=deferred();let calls=0;const h=await harness(async()=>{calls++;return done.promise;});try{
  const pending=exportNow(h);await until(()=>calls===1);await h.submit('restore-form',{});const newer=rootFeedback(h);assert.ok(alert(h));assert.notEqual(newer,'');done.resolve({status});await pending;assert.equal(rootFeedback(h),newer);assert.ok(alert(h));
 }finally{h.app.close();}
});

test('Late completion after route away-and-back cannot clear a new identical export error',async()=>{
 const done=deferred();let calls=0;const h=await harness(async()=>++calls===1?done.promise:{status:'cancelled'});try{
  const pending=exportNow(h);await until(()=>calls===1);await h.app.go('help');await h.app.go('data');await exportNow(h);const newer=rootFeedback(h);assert.equal(newer,t('backupWriteNotConfirmed'));done.resolve({status:'written'});await pending;assert.equal(rootFeedback(h),newer);assert.ok(alert(h));
 }finally{h.app.close();}
});

test('Newer export owns feedback when two injected writes complete out of order',async()=>{
 const old=deferred();let calls=0;const h=await harness(async()=>++calls===1?old.promise:{status:'requested'});try{
  const pending=exportNow(h);await until(()=>calls===1);await exportNow(h);assert.equal(rootFeedback(h),t('downloadStarted'));old.resolve({status:'written'});await pending;assert.equal(rootFeedback(h),t('downloadStarted'));
 }finally{h.app.close();}
});

test('Namespace switch and close prevent a late export from changing current feedback',async()=>{
 const done=deferred();let calls=0;const h=await harness(async()=>{calls++;return done.promise;});try{
  const pending=exportNow(h);await until(()=>calls===1);await h.app.openNamespace('sandbox');await h.app.go('data');await h.submit('restore-form',{});const newer=rootFeedback(h);assert.ok(alert(h));h.app.close();done.resolve({status:'written'});await pending;assert.equal(rootFeedback(h),newer);assert.ok(alert(h));
 }finally{h.app.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { nextHarness } from './next-ui-harness.mjs';
import { accountBalance, planSummary, poolSummary } from '../core/model.js';
import { translator } from '../ui/i18n.js';
const t=translator();
const onboarding={locale:'vi-VN',currencyCode:'VND',timezoneId:'Asia/Ho_Chi_Minh',name:'Synthetic bank',accountType:'BANK',opening:'0',openingDate:'2026-10-01'};
async function ready(options){const h=await nextHarness(options);await h.app.go('create');await h.submit('onboard-form',onboarding);return h;}
async function income(h,amount='20.000.000'){await h.app.go('transactions/new');await h.submit('transaction-form',{operationType:'INCOME',accountId:h.app.snapshot().accounts[0].id,toAccountId:'',amount,date:'2026-10-31',memo:'Synthetic salary'});}
function uniqueIds(h){const ids=h.root.querySelectorAll('[id]').map(n=>n.id);assert.equal(new Set(ids).size,ids.length);}
test('clean onboarding creates only opening cash; routes and currencies remain scoped',async()=>{
 const h=await nextHarness();assert.equal(h.app.currentRoute(),'start');assert.equal(h.app.snapshot().postings.length,0);
 await h.app.go('create');await h.submit('onboard-form',{...onboarding,opening:'1.000.000'});const s=h.app.snapshot();assert.equal(s.accounts.length,1);assert.equal(accountBalance(s,s.accounts[0].id),'1000000');assert.equal(s.operations.length,1);
 assert.equal(h.root.querySelector('[data-metric="actualIncome"]').children[2].textContent,'0 ₫');uniqueIds(h);
 await h.app.go('calendar');assert.equal(h.app.currentRoute(),'plans');await h.app.go('help');assert.ok(h.text().includes(t('allocationHelp')));h.app.close();
});
test('locale decimal precision is exact and invalid money leaves the form retryable',async()=>{
 const h=await nextHarness();await h.app.go('create');await h.submit('onboard-form',{...onboarding,locale:'en-US',currencyCode:'USD',opening:'1,000.25'});let s=h.app.snapshot();assert.equal(accountBalance(s,s.accounts[0].id),'100025');
 await h.app.go('transactions/new');await h.submit('transaction-form',{operationType:'INCOME',accountId:s.accounts[0].id,amount:'1.234',date:'2026-10-31',memo:''});assert.equal(h.app.snapshot().revision,s.revision);assert.equal(h.get('transaction-form-amount').value,'1.234');assert.ok(h.root.querySelector('[role="alert"]'));
 await h.submit('transaction-form',{operationType:'INCOME',accountId:s.accounts[0].id,amount:'12.34',date:'2026-10-31',memo:''});s=h.app.snapshot();assert.equal(accountBalance(s,s.accounts[0].id),'101259');h.app.close();
});
test('template preview is reversible, changed inputs require review, confirm preserves actual income once',async()=>{
 const h=await ready();await income(h);await h.app.go('templates');await h.submit('envelope-form',{name:'Rent'});let s=h.app.snapshot();const envelopeId=s.envelopes[0].id;
 await h.app.go('templates/new');await h.submit('template-form',{name:'Monthly rent',fixedScope:'CALENDAR_MONTH',shortagePolicy:'BLOCK',leftoverPolicy:'UNASSIGNED',leftoverEnvelopeId:'','envelope-0':envelopeId,'kind-0':'FIXED','value-0':'6.000.000'});s=h.app.snapshot();const versionId=s.templates[0].currentVersionId;await h.app.go('allocations/new/'+versionId);
 const values={sourceId:'all',amount:'8.000.000',date:'2026-10-31'};await h.submit('allocation-form',values);assert.equal(h.app.snapshot().allocationApplications.length,0);assert.ok(h.text().includes(t('proposed')));
 h.get('allocation-form-amount').value='7.000.000';await h.get('allocation-form-amount').dispatch('input');assert.equal(h.get('allocation-confirm').disabled,true);assert.equal(h.app.snapshot().allocationApplications.length,0);
 await h.submit('allocation-form',values);await h.get('allocation-confirm').click();s=h.app.snapshot();assert.equal(s.allocationApplications.length,1);assert.equal(s.operations.filter(o=>o.operationType==='INCOME').length,1);assert.equal(accountBalance(s,s.accounts[0].id),'20000000');assert.equal(poolSummary(s,s.budgetPools[0].id).unassigned,'14000000');uniqueIds(h);h.app.close();
});
test('card drilldown retains descriptor and timeline carries cash across days',async()=>{
 const h=await ready();await income(h,'8.000.000');await h.app.go('overview');const card=h.root.querySelector('[data-metric="actualIncome"]');const shown=card.children[2].textContent;await card.click();assert.equal(h.app.currentRoute(),'reports/ActualIncome');assert.ok(h.text().includes(shown));assert.ok(h.text().includes('Synthetic salary'));
 const accountId=h.app.snapshot().accounts[0].id;await h.app.go('accounts/'+accountId+'/timeline');assert.ok(h.text().includes('8.000.000'));assert.ok(h.text().includes(t('noMovement')));h.app.close();
});
test('partial plan receipt records cash once; finalizing preserves variance without creating cash',async()=>{
 const h=await ready();const accountId=h.app.snapshot().accounts[0].id;await h.app.go('plans/new');await h.submit('plan-form',{title:'Expected salary',direction:'INCOME',amount:'10.000.000',due:'2026-10-31',accountId,recurrence:'NONE'});let s=h.app.snapshot();const planId=s.occurrences[0].id;assert.equal(accountBalance(s,accountId),'0');
 await h.app.go('transactions/new/'+planId);await h.submit('transaction-form',{operationType:'INCOME',accountId,amount:'8.000.000',date:'2026-10-31',memo:'Partial salary'});s=h.app.snapshot();assert.equal(planSummary(s,planId).openRemaining,'2000000');assert.equal(accountBalance(s,accountId),'8000000');
 await h.button(t('finalize')).click();s=h.app.snapshot();const p=planSummary(s,planId);assert.equal(p.openRemaining,'0');assert.equal(p.variance,'-2000000');assert.equal(accountBalance(s,accountId),'8000000');assert.equal(s.settlements.length,1);h.app.close();
});
test('restore preview requires acknowledgements, identity guard and supports rollback',async()=>{
 const h=await ready();await income(h,'8.000.000');await h.app.go('data');await h.button(t('export')).click();const backup=h.downloads[0],original=h.app.snapshot();
 h.get('restore-form-backupFile').files=[{size:backup.text.length,text:async()=>backup.text}];await h.submit('restore-form',{});assert.ok(h.text().includes(t('stageReady')));assert.equal(h.app.snapshot().datasetId,original.datasetId);
 await h.submit('activate-stage-form',{});assert.equal(h.app.snapshot().datasetId,original.datasetId);
 await h.submit('activate-stage-form',{backupAck:'yes',replaceAck:'yes'});assert.notEqual(h.app.snapshot().datasetId,original.datasetId);assert.equal(accountBalance(h.app.snapshot(),original.accounts[0].id),'8000000');
 await h.app.go('data');await h.button(t('rollback')).click();assert.equal(h.app.snapshot().datasetId,original.datasetId);h.app.close();
});
test('sandbox has its own empty dataset and legacy detection never reads or mutates unrelated keys',async()=>{
 const h=await ready();const personal=h.app.snapshot().datasetId;await h.app.openNamespace('sandbox');assert.equal(h.app.currentRoute(),'start');assert.equal(h.app.snapshot().accounts.length,0);assert.ok(h.text().includes(t('sandbox')));await h.app.openNamespace('personal');assert.equal(h.app.snapshot().datasetId,personal);h.app.close();
 const legacy=await nextHarness({legacyRaw:'{"accounts":[]}'});assert.equal(legacy.app.currentRoute(),'start');await legacy.app.go('data-review');await legacy.submit('migration-form',{});assert.equal(legacy.app.snapshot().revision,0);legacy.app.close();
});
test('failed persistence does not report success or mutate UI snapshot',async()=>{
 const h=await nextHarness({failWrite:true});const before=h.app.snapshot();await h.app.go('create');await h.submit('onboard-form',onboarding);assert.deepEqual(h.app.snapshot(),before);assert.equal(h.app.currentRoute(),'create');assert.ok(h.root.querySelector('[role="alert"]'));assert.ok(h.get('onboard-form'));h.app.close();
});
test('restore activation rejects changes after preview and delayed file reads cannot replace another route',async()=>{
 const h=await ready();await h.app.go('data');await h.button(t('export')).click();const backup=h.downloads[0];h.get('restore-form-backupFile').files=[{size:backup.text.length,text:async()=>backup.text}];await h.submit('restore-form',{});
 const originalId=h.app.snapshot().datasetId;await h.app.perform('addAccount',{name:'Intervening synthetic account',accountType:'CASH',currencyCode:'VND',openingAmountMinor:'0',openingEffectiveLocalDate:'2026-10-31'});const current=h.app.snapshot();await h.submit('activate-stage-form',{backupAck:'yes',replaceAck:'yes'});assert.deepEqual(h.app.snapshot(),current);assert.equal(h.app.snapshot().datasetId,originalId);
 let release,reading;const readStarted=new Promise(resolve=>{reading=resolve;});h.get('restore-form-backupFile').files=[{size:100,text:()=>new Promise(resolve=>{release=resolve;reading();})}];const pending=h.submit('restore-form',{});await readStarted;await h.app.go('help');release(backup.text);await pending;assert.equal(h.app.currentRoute(),'help');assert.equal(h.get('activate-stage-form'),null);h.app.close();
});
test('per-application continuation reuses auto-created group and frozen original template version',async()=>{
 const h=await ready();await income(h,'200');await h.app.go('templates');await h.submit('envelope-form',{name:'Synthetic target'});const envelopeId=h.app.snapshot().envelopes[0].id;
 const values={name:'Per application',fixedScope:'PER_APPLICATION',shortagePolicy:'PARTIAL_BY_PRIORITY',leftoverPolicy:'UNASSIGNED',leftoverEnvelopeId:'','envelope-0':envelopeId,'kind-0':'FIXED','value-0':'100'};await h.app.go('templates/new');await h.submit('template-form',values);let s=h.app.snapshot();const template=s.templates[0],version=template.currentVersionId;
 await h.app.go('allocations/new/'+version);await h.submit('allocation-form',{sourceId:'all',amount:'40',date:'2026-10-31'});await h.get('allocation-confirm').click();s=h.app.snapshot();const first=s.allocationApplications[0];assert.ok(first.applicationGroupId);
 await h.app.go('templates/'+template.id+'/edit');await h.submit('template-form',{...values,'value-0':'200'});await h.app.go('allocations/'+first.id);await h.button(t('continueApplication')).click();assert.equal(h.app.currentRoute(),'allocations/new/'+version+'/'+first.applicationGroupId);
 await h.submit('allocation-form',{sourceId:'all',amount:'160',date:'2026-10-31'});await h.get('allocation-confirm').click();s=h.app.snapshot();assert.equal(s.allocationApplications.length,2);assert.equal(s.allocationApplications[1].applicationGroupId,first.applicationGroupId);assert.equal(poolSummary(s,s.budgetPools[0].id).unassigned,'100');assert.equal(accountBalance(s,s.accounts[0].id),'200');h.app.close();
});
test('completed dataset honors deep-link aliases on initial open',async()=>{
 const h=await ready();const initial=h.app.snapshot();h.app.close();const linked=await nextHarness({initial,hash:'#calendar'});assert.equal(linked.app.currentRoute(),'plans');uniqueIds(linked);linked.app.close();
});
test('allocation route changes, back/forward and cancel discard proposals before another template opens',async()=>{
 const h=await ready();await income(h,'200');await h.app.go('templates');await h.submit('envelope-form',{name:'Synthetic target'});const envelopeId=h.app.snapshot().envelopes[0].id;
 const values={name:'Template A',fixedScope:'CALENDAR_MONTH',shortagePolicy:'BLOCK',leftoverPolicy:'UNASSIGNED',leftoverEnvelopeId:'','envelope-0':envelopeId,'kind-0':'FIXED','value-0':'10'};
 await h.app.go('templates/new');await h.submit('template-form',values);const versionA=h.app.snapshot().templates[0].currentVersionId;
 await h.app.go('templates/new');await h.submit('template-form',{...values,name:'Template B','value-0':'80'});const versionB=h.app.snapshot().templates[1].currentVersionId;
 const routeA='allocations/new/'+versionA,routeB='allocations/new/'+versionB,request={sourceId:'all',amount:'100',date:'2026-10-31'};
 await h.app.go(routeA);await h.submit('allocation-form',request);assert.ok(h.get('allocation-confirm'));assert.ok(h.get('allocation-preview').textContent.includes('10'));
 await h.app.go('templates');await h.app.go(routeB);assert.equal(h.get('allocation-confirm'),null);assert.equal(h.get('allocation-preview').textContent,'');
 await h.submit('allocation-form',request);assert.ok(h.get('allocation-preview').textContent.includes('80'));await h.app.go(routeA);assert.equal(h.get('allocation-confirm'),null);await h.app.go(routeB);assert.equal(h.get('allocation-confirm'),null);
 await h.submit('allocation-form',request);await h.app.go('overview');await h.app.go(routeB);assert.equal(h.get('allocation-confirm'),null);assert.equal(h.app.snapshot().allocationApplications.length,0);
 await h.submit('allocation-form',request);await h.get('allocation-confirm').click();assert.equal(h.app.snapshot().allocationApplications.length,1);assert.equal(poolSummary(h.app.snapshot(),h.app.snapshot().budgetPools[0].id).unassigned,'120');h.app.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { nextHarness } from './next-ui-harness.mjs';
import { accountBalance, createDataset, record, validateSnapshot, planSummary } from '../core/model.js';
import { exportSnapshot, exportSnapshotFiles } from '../core/migration.js';
import { translator } from '../ui/i18n.js';
const t=translator();
const onboarding={locale:'vi-VN',currencyCode:'VND',timezoneId:'Asia/Ho_Chi_Minh',name:'Synthetic bank',accountType:'BANK',opening:'1.000',openingDate:'2026-10-01'};
async function ready(){const h=await nextHarness();await h.app.go('create');await h.submit('onboard-form',onboarding);return h;}
async function actual(h,type,amount,extra={}){const receipt=await h.app.perform('recordActual',{operationType:type,accountId:h.app.snapshot().accounts[0].id,amountMinor:amount,effectiveLocalDate:'2026-10-20',memo:'Retained memo',...extra});return receipt.resultIds[0];}
function file(text){return {size:new TextEncoder().encode(text).length,text:async()=>text};}

test('CW-01/CW-11: rendered expense correction retains memo and ordinary undo restores cash',async()=>{
  const h=await ready(),accountId=h.app.snapshot().accounts[0].id,operationId=await actual(h,'EXPENSE','100');
  await h.app.go('transactions/'+operationId);assert.equal(h.get('correct-form-memo').value,'Retained memo');
  await h.submit('correct-form',{amount:'90',date:'2026-10-31',reason:'Synthetic correction',memo:'Updated memo'});
  let state=h.app.snapshot();assert.equal(accountBalance(state,accountId),'910');const replacement=state.operations.find(o=>o.operationType==='EXPENSE'&&o.id!==operationId);assert.equal(replacement.memo,'Updated memo');
  await h.app.go('transactions/'+replacement.id);await h.submit('reverse-form',{date:'2026-10-31',reason:'Synthetic undo'});state=h.app.snapshot();assert.equal(accountBalance(state,accountId),'1000');assert.equal(state.operations.filter(o=>o.operationType==='REVERSAL').length,2);h.app.close();
});
test('CW-11: correction UI requires explicit plan reconciliation and keeps reduced association',async()=>{
  const h=await ready(),accountId=h.app.snapshot().accounts[0].id;
  const plan=await h.app.perform('createPlan',{title:'Synthetic salary',direction:'INCOME',currencyCode:'VND',expectedAmountMinor:'100',dueLocalDate:'2026-10-20',expectedAccountId:accountId});
  const operationId=await actual(h,'INCOME','100',{settlement:{planOccurrenceId:plan.resultIds[0],amountMinor:'100'}}),link=h.app.snapshot().settlements[0];
  await h.app.go('transactions/'+operationId);const before=h.app.snapshot();await h.submit('correct-form',{amount:'90',date:'2026-10-31',reason:'Reduce actual',memo:'Retained memo'});assert.equal(h.app.snapshot().revision,before.revision);assert.ok(h.text().includes(t('correctionReconcileError')));
  await h.submit('correct-form',{amount:'90',date:'2026-10-31',reason:'Reduce actual',memo:'Reconciled',['settlements-'+link.id]:'90'});const state=h.app.snapshot();assert.equal(planSummary(state,plan.resultIds[0]).netSettled,'90');assert.equal(planSummary(state,plan.resultIds[0]).openRemaining,'10');assert.equal(accountBalance(state,accountId),'1090');h.app.close();
});
test('CW-08: monthly horizon can extend, stop and resume without booking actuals or duplicate periods',async()=>{
  const h=await ready(),accountId=h.app.snapshot().accounts[0].id;
  await h.app.go('plans/new');assert.ok(h.text().includes(t('recurrenceHelp')));await h.submit('plan-form',{title:'Synthetic monthly plan',direction:'EXPENSE',amount:'10',due:'2026-10-31',accountId,recurrence:'MONTHLY'});let state=h.app.snapshot();assert.equal(state.occurrences.length,12);const seriesId=state.planSeries[0].id;
  await h.app.go('plans');assert.ok(h.text().includes('2027-09'));await h.button(t('extendSeries')).click();state=h.app.snapshot();assert.equal(state.occurrences.length,24);assert.equal(new Set(state.occurrences.map(o=>o.occurrenceKey)).size,24);assert.equal(accountBalance(state,accountId),'1000');
  await h.submit('series-end-'+seriesId,{until:'2028-09-30'});assert.equal(h.app.snapshot().planSeries[0].untilDate,'2028-09-30');assert.ok(h.button(t('resumeSeries')));await h.button(t('resumeSeries')).click();assert.equal(h.app.snapshot().planSeries[0].untilDate,null);await h.button(t('extendSeries')).click();assert.equal(h.app.snapshot().occurrences.length,36);assert.equal(h.app.snapshot().postings.length,1);h.app.close();
});
test('Opening correction UI records an adjustment without counting it as income',async()=>{
  const h=await ready(),accountId=h.app.snapshot().accounts[0].id;await h.app.go('accounts/'+accountId);assert.ok(h.get('opening-correction-form'));
  await h.submit('opening-correction-form',{amount:'1.200',date:'2026-10-31',reason:'Correct synthetic opening'});const state=h.app.snapshot();assert.equal(accountBalance(state,accountId),'1200');assert.equal(state.operations.at(-1).operationType,'ADJUSTMENT');assert.equal(state.operations.filter(o=>o.operationType==='INCOME').length,0);assert.equal(state.operations[0].operationType,'OPENING');h.app.close();
});
test('CW-03: file envelope import exposes dates, previews mapping and activates only after acknowledgements',async()=>{
  const h=await nextHarness(),old={version:1,demo:false,accounts:[{id:'old-bank',name:'Synthetic old bank',type:'cash',openingBalance:100}],cards:[],assets:[],transactions:[],plans:[],settings:{buffer:0}};
  const raw=JSON.stringify({format:'mach-tien-backup',backupVersion:2,state:old});await h.app.go('data');h.get('restore-form-backupFile').files=[file(raw)];await h.submit('restore-form',{});assert.equal(h.app.currentRoute(),'data-review');assert.ok(h.get('migration-form-opening-0'));assert.equal(h.app.snapshot().revision,0);
  await h.submit('migration-form',{'opening-0':'2026-10-01',backupAck:'yes'});assert.ok(h.text().includes(t('stageReady')));assert.equal(h.app.snapshot().revision,0);await h.submit('activate-stage-form',{backupAck:'yes',replaceAck:'yes'});const state=h.app.snapshot();assert.equal(state.accounts.length,1);assert.equal(accountBalance(state,state.accounts[0].id),'100');h.app.close();
});
test('CW-05: multipart UI rejects incomplete selection, then accepts all parts in any order',async()=>{
  const h=await ready(),large=h.app.snapshot();for(let i=0;i<7200;i++)large.categories.push(record(large,{name:'Synthetic '+i+'-'.repeat(480),direction:'EXPENSE',archivedAtUtc:null},'2026-10-31T10:00:00.000Z'));large.revision++;validateSnapshot(large);const parts=await exportSnapshotFiles(large);assert.ok(parts.length>1);
  await h.app.go('data');const before=h.app.snapshot();h.get('restore-form-backupFile').files=[file(parts[0].text)];await h.submit('restore-form',{});assert.equal(h.app.snapshot().datasetId,before.datasetId);assert.equal(h.get('activate-stage-form'),null);
  h.get('restore-form-backupFile').files=parts.toReversed().map(part=>file(part.text));await h.submit('restore-form',{});assert.ok(h.get('activate-stage-form'));await h.submit('activate-stage-form',{backupAck:'yes',replaceAck:'yes'});assert.equal(h.app.snapshot().categories.length,7200);await h.app.go('data');assert.ok(h.button(t('rollback')));await h.button(t('rollback')).click();assert.equal(h.app.snapshot().datasetId,before.datasetId);h.app.close();
});
test('CW-06: retained rollback remains reachable after reopening the UI on the same repository',async()=>{
  const h=await ready();await h.app.go('data');await h.button(t('export')).click();const backup=h.downloads[0],original=h.app.snapshot().datasetId;h.get('restore-form-backupFile').files=[file(backup.text)];await h.submit('restore-form',{});await h.submit('activate-stage-form',{backupAck:'yes',replaceAck:'yes'});const repository=h.repositories.get('personal');h.app.close();
  const reopened=await nextHarness({appOptions:{repositoryFactory:async()=>repository}});await reopened.app.go('data');assert.ok(reopened.button(t('rollback')));await reopened.button(t('rollback')).click();assert.equal(reopened.app.snapshot().datasetId,original);reopened.app.close();
});
test('CW-02: invalid active data opens independent recovery with raw export and confirmed valid selection',async()=>{
  const source=await ready(),valid=source.app.snapshot();source.app.close();const bad=structuredClone(valid);bad.datasetId=crypto.randomUUID();bad.profile.datasetId=bad.datasetId;bad.profile.locale=[];let active=bad,rollbackCalls=0;
  const repository={async readSnapshot(){validateSnapshot(active);return structuredClone(active);},async listRecoveryDatasets(){return [{datasetId:bad.datasetId,active:active===bad,revision:bad.revision,valid:false,accountCount:1,operationCount:1},{datasetId:valid.datasetId,active:active===valid,revision:valid.revision,valid:true,accountCount:1,operationCount:1}];},async readRecoverySnapshot(id){return structuredClone(id===bad.datasetId?bad:valid);},async rollback(id,options){assert.equal(options.confirm,true);assert.equal(options.expectedDatasetId,bad.datasetId);assert.equal(id,valid.datasetId);rollbackCalls++;active=valid;},close(){}};
  const h=await nextHarness({appOptions:{repositoryFactory:async()=>repository}});assert.equal(h.app.currentRoute(),'recovery');assert.ok(h.text().includes(t('recoveryHelp')));await h.button(t('recoveryExport')).click();assert.equal(JSON.parse(h.downloads[0].text).formatId,'cash-weave-recovery-archive');assert.deepEqual(JSON.parse(h.downloads[0].text).entities.profile.locale,[]);
  await h.submit('recovery-'+valid.datasetId,{});assert.equal(rollbackCalls,0);await h.submit('recovery-'+valid.datasetId,{acknowledge:'yes'});assert.equal(rollbackCalls,1);assert.equal(h.app.snapshot().datasetId,valid.datasetId);assert.equal(h.app.currentRoute(),'overview');h.app.close();
});
test('Native multipart export cancellation does not continue saving or claim a complete backup',async()=>{
  const h=await ready();h.app.close();const cancelled=await nextHarness({initial:h.app.snapshot(),appOptions:{onDownload:async()=>({status:'cancelled'})}});await cancelled.app.go('data');await cancelled.button(t('export')).click();assert.ok(cancelled.text().includes(t('backupWriteNotConfirmed')));assert.equal(cancelled.app.snapshot().datasetId,h.app.snapshot().datasetId);cancelled.app.close();
});

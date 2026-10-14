import test from 'node:test';
import assert from 'node:assert/strict';
import {createDataset,validateSnapshot,sourceCapacity,poolSummary,planSummary} from '../core/model.js';
import {createMemoryRepository} from '../core/repository.js';
import {previewAllocationV3,fixedApplied} from '../core/allocation.js';
import {exportSnapshot,stageRestore,stageLegacyMigration} from '../core/migration.js';
import {queryReport} from '../core/reports.js';
import {digest} from '../core/identity.js';
const now='2026-10-31T12:00:00.000Z';let serial=0;
async function send(repo,type,input){const s=await repo.readSnapshot();return repo.runAtomicCommand({commandId:'qa-regression-'+(++serial),type,input},s.revision,{now});}
async function base(amount='100'){const r=createMemoryRepository(createDataset());await send(r,'onboard',{name:'Synthetic account',accountType:'BANK',currencyCode:'VND',openingAmountMinor:amount,openingEffectiveLocalDate:'2026-10-01'});return r;}
async function template(repo,scope='CALENDAR_MONTH',target='100',prior=null){let s=await repo.readSnapshot();if(!s.envelopes.length)await send(repo,'addEnvelope',{name:'Synthetic rent',budgetPoolId:s.budgetPools[0].id});s=await repo.readSnapshot();const receipt=await send(repo,'saveTemplate',{name:'Synthetic template',currencyCode:'VND',fixedScope:scope,shortagePolicy:'PARTIAL_BY_PRIORITY',leftoverPolicy:'UNASSIGNED',...(prior?{templateId:prior.templateId}:{}),lines:[{stableLineKey:prior?.stableLineKey||crypto.randomUUID(),envelopeId:s.envelopes[0].id,type:'FIXED',fixedAmountMinor:target,priority:0}]});return (await repo.readSnapshot()).templateVersions.find(v=>v.id===receipt.resultIds[1]);}
async function allocate(repo,version,amount,date,group){const s=await repo.readSnapshot(),input={templateVersionId:version.id,budgetPoolId:s.budgetPools[0].id,sourceIds:s.fundingSources.map(f=>f.id),requestedAmountMinor:amount,allocationEffectiveLocalDate:date,...(group?{applicationGroupId:group}:{})},preview=await previewAllocationV3(s,input);const receipt=await send(repo,'confirmAllocation',{...input,previewHash:preview.previewHash});return {preview,receipt};}
async function uncheckedExport(state){const payload={formatId:'mach-tien-export',schemaVersion:3,appVersion:'synthetic-restore-repro',datasetId:state.datasetId,currencyTableVersion:state.currencyTableVersion,entities:state};return JSON.stringify({...payload,checksum:await digest(payload)});}
test('QA P1: future allocation undo cannot release source or monthly quota for an earlier cutoff',async()=>{
  const repo=await base(),v=await template(repo),first=await allocate(repo,v,'100','2026-10-03');
  await send(repo,'reverseAllocation',{applicationId:first.receipt.resultIds[0],effectiveLocalDate:'2026-10-10'});
  const before=await repo.readSnapshot();
  await assert.rejects(allocate(repo,v,'100','2026-10-05'),/HISTORICAL_SOURCE_OR_UNASSIGNED/);
  assert.deepEqual(await repo.readSnapshot(),before);
  assert.equal(sourceCapacity(before,before.fundingSources[0].id,'2026-10-06').consumed,'100');
  assert.equal(fixedApplied(before,v.templateId,'2026-10',v.lines[0].stableLineKey,'','2026-10-06'),100n);
  assert.equal(poolSummary(before,before.budgetPools[0].id,'2026-10-06').unassigned,'0');
  const forged=structuredClone(before),app=structuredClone(before.allocationApplications[0]);app.id=crypto.randomUUID();app.allocationEffectiveLocalDate='2026-10-05';forged.allocationApplications.push(app);
  for(const e of before.allocationEntries.filter(e=>e.applicationId===first.receipt.resultIds[0]))forged.allocationEntries.push({...structuredClone(e),id:crypto.randomUUID(),applicationId:app.id});
  assert.throws(()=>validateSnapshot(forged),/SOURCE_HISTORICAL_CAPACITY/);
});
test('QA P1: per-application continuation uses original target snapshot after template revision',async()=>{
  const repo=await base('200'),v1=await template(repo,'PER_APPLICATION','100'),first=await allocate(repo,v1,'40','2026-10-03');
  const s=await repo.readSnapshot(),group=s.allocationApplications[0].applicationGroupId;
  const v2=await template(repo,'PER_APPLICATION','200',{templateId:v1.templateId,stableLineKey:v1.lines[0].stableLineKey});
  const continued=await allocate(repo,v2,'160','2026-10-05',group);
  assert.equal(continued.preview.templateVersion.id,v1.id);assert.equal(continued.preview.result.fixedGrantedMinor,'60');assert.equal(continued.preview.result.leftoverMinor,'100');
  const after=await repo.readSnapshot();assert.equal(after.allocationApplications.reduce((n,a)=>n+BigInt(a.fixedContributions[0].signedAmountMinor),0n),100n);
  assert.equal(after.templateVersions.length,2);assert.equal(after.allocationApplications[0].id,first.receipt.resultIds[0]);
});
const oldAllocated=()=>({version:2,accounts:[{id:'bank',name:'Synthetic legacy',type:'cash',openingBalance:0}],cards:[],assets:[],transactions:[{id:'income',date:'2026-10-01',kind:'income',accountId:'bank',amount:100}],plans:[],settings:{buffer:0},budgeting:{templates:[],funds:[{id:'rent',name:'Rent',accountId:''}],allocations:[{id:'allocation',incomeId:'income',label:'Manual allocation',templateId:'',date:'2026-10-03',lines:[{fundId:'rent',name:'Rent',accountId:'',amount:100}]}],expenseLinks:[]},activity:[],undoPoint:null});
test('QA P1: absent legacy rule snapshot survives migration export and restore roundtrip',async()=>{
  const stage=await stageLegacyMigration(JSON.stringify(oldAllocated()),{backupAcknowledged:true,openingDates:{bank:'2026-10-01'}});
  assert.equal(stage.activationAllowed,true);assert.equal(stage.snapshot.allocationApplications[0].frozenInput.legacyRuleSnapshot,null);
  const restored=await stageRestore(await exportSnapshot(stage.snapshot));assert.equal(restored.activationAllowed,true);assert.equal(restored.snapshot.allocationEntries.length,2);
});
test('QA P1: activation binds dataset identity even if different active datasets have the same revision',async()=>{
  const repo=createMemoryRepository(createDataset()),before=await repo.readSnapshot();
  const b=await stageRestore(await exportSnapshot(createDataset())),c=await stageRestore(await exportSnapshot(createDataset()));await repo.stageRestore(b);await repo.stageRestore(c);
  await repo.activateStage(b.id,{expectedDatasetId:before.datasetId,expectedRevision:before.revision,confirm:true,backupAcknowledged:true});const active=await repo.readSnapshot();assert.equal(active.revision,before.revision);
  await assert.rejects(repo.activateStage(c.id,{expectedDatasetId:before.datasetId,expectedRevision:before.revision,confirm:true,backupAcknowledged:true}),/DATASET_REVISION_CONFLICT/);assert.deepEqual(await repo.readSnapshot(),active);
  await repo.rollback(before.datasetId);await assert.rejects(repo.activateStage(b.id,{expectedDatasetId:before.datasetId,expectedRevision:before.revision,confirm:true,backupAcknowledged:true}),/ALREADY_ACTIVATED_OTHER_DATASET/);
});
test('QA P1: personal repository rejects sandbox-bound activation without relabeling provenance',async()=>{
  const repo=createMemoryRepository(createDataset()),before=await repo.readSnapshot(),sandbox=createDataset({namespace:'sandbox'}),stage=await stageRestore(await exportSnapshot(sandbox),{namespace:'sandbox'});
  await assert.rejects(repo.stageRestore(stage),/NAMESPACE_MISMATCH/);assert.deepEqual(await repo.readSnapshot(),before);
});
test('QA P1: orphan allocation entry is rejected before checksummed export or restore',async()=>{
  const repo=await base(),v=await template(repo);await allocate(repo,v,'100','2026-10-03');const state=await repo.readSnapshot();
  const orphan={...structuredClone(state.allocationEntries[0]),id:crypto.randomUUID(),applicationId:crypto.randomUUID()};state.allocationEntries.push(orphan);
  assert.throws(()=>validateSnapshot(state),/UNKNOWN_ALLOCATIONAPPLICATIONS/);await assert.rejects(exportSnapshot(state),/UNKNOWN_ALLOCATIONAPPLICATIONS/);await assert.rejects(stageRestore(await uncheckedExport(state)),/UNKNOWN_ALLOCATIONAPPLICATIONS/);
});
test('QA P1: invalid closure history date and mismatch are rejected instead of reopening old remaining',async()=>{
  const repo=await base('0'),p=await send(repo,'createPlan',{title:'Fake plan',direction:'INCOME',currencyCode:'VND',expectedAmountMinor:'100',dueLocalDate:'2026-10-01'});await send(repo,'closePlan',{occurrenceId:p.resultIds[0],closure:'FINALIZED',effectiveLocalDate:'2026-10-03'});
  const state=await repo.readSnapshot();assert.equal(planSummary(state,p.resultIds[0],'2026-10-06').openRemaining,'0');state.occurrences[0].closureHistory[0].effectiveLocalDate='2026-99-99';assert.throws(()=>validateSnapshot(state),/INVALID_LOCAL_DATE/);await assert.rejects(exportSnapshot(state),/INVALID_LOCAL_DATE/);await assert.rejects(stageRestore(await uncheckedExport(state)),/INVALID_LOCAL_DATE/);
});
test('QA P2: null legacy input remains quarantined; off-budget envelope spending is explicitly blocked',async()=>{
  const stage=await stageLegacyMigration('null');assert.equal(stage.rawBackup,'null');assert.equal(stage.activationAllowed,false);assert.equal(stage.quarantine[0].record,null);
  const repo=await base(),v=await template(repo);await allocate(repo,v,'100','2026-10-03');await send(repo,'addAccount',{name:'Outside pool',accountType:'CASH',currencyCode:'VND',openingAmountMinor:'100',openingEffectiveLocalDate:'2026-10-01',includeInBudget:false});let s=await repo.readSnapshot();const expense=await send(repo,'recordActual',{operationType:'EXPENSE',accountId:s.accounts[1].id,amountMinor:'100',effectiveLocalDate:'2026-10-05'});
  s=await repo.readSnapshot();await assert.rejects(send(repo,'linkExpense',{expensePostingId:expense.resultIds[1],envelopeId:s.envelopes[0].id,amountMinor:'100',effectiveLocalDate:'2026-10-05'}),/OFF_BUDGET/);
});
test('QA P2: includeArchived policy applies consistently to actual, planned and forecast rows',async()=>{
  const repo=await base('0');let s=await repo.readSnapshot();await send(repo,'createPlan',{title:'Fake plan',direction:'INCOME',currencyCode:'VND',expectedAmountMinor:'100',dueLocalDate:'2026-10-05',expectedAccountId:s.accounts[0].id});s=await repo.readSnapshot();s.accounts[0].archivedAtUtc=now;validateSnapshot(s);
  const d={currencyCode:'VND',startLocalDateInclusive:'2026-10-01',endLocalDateExclusive:'2026-11-01',includeArchived:false};
  for(const metricId of ['ActualIncome','PlannedOpenInPeriod','ForecastAsOf'])assert.equal((await queryReport(s,{...d,metricId})).totalMinor,'0');
});
test('allocated dataset restore rebases ownership while preserving immutable version provenance and totals',async()=>{
  const original=await base(),v=await template(original);await allocate(original,v,'100','2026-10-03');const before=await original.readSnapshot(),stage=await stageRestore(await exportSnapshot(before));
  validateSnapshot(stage.snapshot);assert.notEqual(stage.snapshot.datasetId,before.datasetId);
  const target=createMemoryRepository(createDataset()),active=await target.readSnapshot();await target.stageRestore(stage);await target.activateStage(stage.id,{expectedDatasetId:active.datasetId,expectedRevision:active.revision,confirm:true,backupAcknowledged:true});
  assert.deepEqual(poolSummary(await target.readSnapshot(),before.budgetPools[0].id),poolSummary(before,before.budgetPools[0].id));
  await target.rollback(active.datasetId);assert.deepEqual(await target.readSnapshot(),active);
});

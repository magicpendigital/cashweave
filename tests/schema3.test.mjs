import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, accountBalance, poolSummary, planSummary, sourceCapacity, envelopeBalance, validateSnapshot } from '../core/model.js';
import { createMemoryRepository } from '../core/repository.js';
import { previewAllocationV3, calculateAllocation } from '../core/allocation.js';
import { minor, parseMoney, formatMinor, INT64_MAX } from '../core/money.js';
import { queryReport, dailyAccountTimeline } from '../core/reports.js';
import { exportSnapshot, stageRestore, stageLegacyMigration } from '../core/migration.js';
import { monthlyDate, todayInTimezone } from '../core/calendar.js';

const now = '2026-10-31T12:00:00.000Z';
let serial = 0;
async function send(repo,type,input,commandId = `synthetic-${++serial}`) { const snapshot = await repo.readSnapshot(); return repo.runAtomicCommand({commandId,type,input},snapshot.revision,{now}); }
async function base(opening = '0') {
  const repo = createMemoryRepository(createDataset());
  await send(repo,'onboard',{name:'Synthetic bank',accountType:'BANK',currencyCode:'VND',openingAmountMinor:opening,openingEffectiveLocalDate:'2026-09-01'});
  return repo;
}
async function income(repo,amountMinor,date = '2026-10-06',extra = {}) { const state = await repo.readSnapshot(); return send(repo,'recordActual',{operationType:'INCOME',accountId:state.accounts[0].id,amountMinor,effectiveLocalDate:date,...extra}); }
async function setupTemplate(repo,{fixed = '5000000',scope = 'CALENDAR_MONTH',percentages = [5000,3000,2000],shortagePolicy = 'BLOCK',templateId = ''} = {}) {
  let state = await repo.readSnapshot();
  if (!state.envelopes.length) for (const name of ['Rent','Savings','Learning','Flexible']) await send(repo,'addEnvelope',{name,budgetPoolId:state.budgetPools[0].id});
  state = await repo.readSnapshot();
  const old = templateId && state.templateVersions.find(v => v.id === state.templates.find(t => t.id === templateId).currentVersionId);
  const lines = [{envelopeId:state.envelopes[0].id,type:'FIXED',fixedAmountMinor:fixed,priority:1,...(old ? {stableLineKey:old.lines[0].stableLineKey} : {})},...percentages.map((percentageBps,i) => ({envelopeId:state.envelopes[i+1].id,type:'PERCENT',percentageBps,priority:i+2,...(old ? {stableLineKey:old.lines[i+1].stableLineKey} : {})}))];
  const result = await send(repo,'saveTemplate',{name:'Synthetic monthly',currencyCode:'VND',fixedScope:scope,shortagePolicy,lines,...(templateId ? {templateId} : {})});
  return result.resultIds[1];
}
async function allocate(repo,versionId,amountMinor,sourceIds,extra = {}) {
  const state = await repo.readSnapshot(), input = {templateVersionId:versionId,budgetPoolId:state.budgetPools[0].id,sourceIds:sourceIds || state.fundingSources.map(s => s.id),requestedAmountMinor:amountMinor,allocationEffectiveLocalDate:'2026-10-10',...extra};
  const preview = await previewAllocationV3(state,input);
  const receipt = await send(repo,'confirmAllocation',{...input,previewHash:preview.previewHash});
  return {preview,receipt};
}
function descriptor(state,metricId,extra = {}) { return {metricId,currencyCode:'VND',startLocalDateInclusive:'2026-10-01',endLocalDateExclusive:'2026-11-01',datasetRevision:state.revision,...extra}; }

test('schema 3 is empty and onboarding opening is not income; currencies use exact minor units',async () => {
  const empty = createDataset(); assert.equal(empty.operations.length,0); assert.equal(empty.accounts.length,0);
  const repo = await base('20000000'), state = await repo.readSnapshot();
  assert.equal(accountBalance(state,state.accounts[0].id),'20000000');
  assert.equal((await queryReport(state,descriptor(state,'ActualIncome'))).totalMinor,'0');
  assert.equal(parseMoney('10,000','VND','en-US').amountMinor,'10000');
  assert.equal(parseMoney('1,234.50','USD','en-US').amountMinor,'123450');
  assert.equal(parseMoney('1.234,500','KWD','de-DE').amountMinor,'1234500');
  assert.throws(() => parseMoney('1,23','VND','en-US'),/AMBIGUOUS/);
  assert.throws(() => parseMoney('10.1','VND','en-US'),/FRACTION/);
  assert.throws(() => minor((INT64_MAX + 1n).toString()),/OUT_OF_RANGE/);
  assert.match(formatMinor('123456789012345678','USD','en-US'),/1,234,567,890,123,456\.78/);
  assert.equal(formatMinor('-1','USD','en-US'),'-$0.01');
});
test('paired transfer is atomic and excluded from income/expense; daily timeline carries empty days',async () => {
  const repo = await base('20000000'); await send(repo,'addAccount',{name:'Wallet',accountType:'CASH',currencyCode:'VND',openingAmountMinor:'0',openingEffectiveLocalDate:'2026-09-01'});
  let state = await repo.readSnapshot();
  await send(repo,'recordActual',{operationType:'TRANSFER',fromAccountId:state.accounts[0].id,toAccountId:state.accounts[1].id,amountMinor:'2000000',effectiveLocalDate:'2026-10-02'});
  state = await repo.readSnapshot(); assert.equal(accountBalance(state,state.accounts[0].id),'18000000'); assert.equal(accountBalance(state,state.accounts[1].id),'2000000');
  assert.equal((await queryReport(state,descriptor(state,'ActualIncome'))).totalMinor,'0');
  assert.equal((await queryReport(state,descriptor(state,'ActualExpense'))).totalMinor,'0');
  const timeline = dailyAccountTimeline(state,descriptor(state,'CashBalanceAsOf',{accountIds:[state.accounts[0].id],endLocalDateExclusive:'2026-10-05'}));
  assert.equal(timeline.openingBeforeRangeMinor,'20000000'); assert.deepEqual(timeline.days.map(d => d.closingMinor),['20000000','18000000','18000000','18000000']);
  const report = await queryReport(state,descriptor(state,'CashBalanceAsOf',{accountIds:[state.accounts[0].id]}));
  assert.equal(report.totalMinor,'18000000'); assert.equal(report.contributorRows[0].rowType,'OPENING_BEFORE_RANGE');
  assert.equal(report.contributorRows.reduce((n,r) => n + BigInt(r.contributionMinor),0n).toString(),report.totalMinor);
});
test('10 million salary plan: multiple receipts, historical cutoff, finalized variance and unlink',async () => {
  const repo = await base(); let state = await repo.readSnapshot();
  const plan = await send(repo,'createPlan',{title:'Salary',direction:'INCOME',currencyCode:'VND',expectedAmountMinor:'10000000',dueLocalDate:'2026-10-05',expectedAccountId:state.accounts[0].id}); const occurrenceId = plan.resultIds[0];
  const first = await income(repo,'8000000','2026-10-06',{settlement:{planOccurrenceId:occurrenceId,amountMinor:'8000000'}});
  state = await repo.readSnapshot(); assert.equal(planSummary(state,occurrenceId).openRemaining,'2000000');
  assert.equal(planSummary(state,occurrenceId,'2026-10-06').netSettled,'0');
  await send(repo,'closePlan',{occurrenceId,closure:'FINALIZED',effectiveLocalDate:'2026-10-07',reason:'Final salary'});
  state = await repo.readSnapshot(); assert.equal(planSummary(state,occurrenceId).openRemaining,'0'); assert.equal(planSummary(state,occurrenceId).variance,'-2000000');
  assert.equal(planSummary(state,occurrenceId,'2026-10-07').openRemaining,'2000000');
  await send(repo,'closePlan',{occurrenceId,closure:'OPEN',effectiveLocalDate:'2026-10-09'});
  await income(repo,'2000000','2026-10-10',{settlement:{planOccurrenceId:occurrenceId,amountMinor:'2000000'}});
  state = await repo.readSnapshot(); assert.equal(planSummary(state,occurrenceId).netSettled,'10000000'); assert.equal(planSummary(state,occurrenceId,'2026-10-08').netSettled,'8000000');
  const historical = await queryReport(state,descriptor(state,'PlannedOpenInPeriod',{endLocalDateExclusive:'2026-10-07'})); assert.equal(historical.totalMinor,'2000000');
  const link = state.settlements.find(l => l.ledgerPostingId === first.resultIds[1]);
  await send(repo,'unlinkSettlement',{linkId:link.id,effectiveLocalDate:'2026-10-11'});
  state = await repo.readSnapshot(); assert.equal(planSummary(state,occurrenceId).openRemaining,'8000000'); assert.equal(accountBalance(state,state.accounts[0].id),'10000000');
});
test('one receipt can link to multiple plans but cannot exceed posting capacity',async () => {
  const repo = await base(); const receipt = await income(repo,'10');
  const p1 = await send(repo,'createPlan',{title:'A',direction:'INCOME',currencyCode:'VND',expectedAmountMinor:'6',dueLocalDate:'2026-10-05'});
  const p2 = await send(repo,'createPlan',{title:'B',direction:'INCOME',currencyCode:'VND',expectedAmountMinor:'4',dueLocalDate:'2026-10-05'});
  await send(repo,'linkSettlement',{planOccurrenceId:p1.resultIds[0],ledgerPostingId:receipt.resultIds[1],amountMinor:'6',effectiveLocalDate:'2026-10-06'});
  await send(repo,'linkSettlement',{planOccurrenceId:p2.resultIds[0],ledgerPostingId:receipt.resultIds[1],amountMinor:'4',effectiveLocalDate:'2026-10-06'});
  await assert.rejects(send(repo,'linkSettlement',{planOccurrenceId:p1.resultIds[0],ledgerPostingId:receipt.resultIds[1],amountMinor:'1',effectiveLocalDate:'2026-10-06'}),/CAPACITY/);
});
test('backdated settlement cannot exceed posting at any historical prefix after a later unlink',async()=>{
  const repo=await base(),receipt=await income(repo,'100','2026-10-01');
  const plan=await send(repo,'createPlan',{title:'Synthetic salary',direction:'INCOME',currencyCode:'VND',expectedAmountMinor:'100',dueLocalDate:'2026-10-01'});
  const original=await send(repo,'linkSettlement',{planOccurrenceId:plan.resultIds[0],ledgerPostingId:receipt.resultIds[1],amountMinor:'100',effectiveLocalDate:'2026-10-01'});
  await send(repo,'unlinkSettlement',{linkId:original.resultIds[0],effectiveLocalDate:'2026-10-10'});
  const before=await repo.readSnapshot();
  await assert.rejects(send(repo,'linkSettlement',{planOccurrenceId:plan.resultIds[0],ledgerPostingId:receipt.resultIds[1],amountMinor:'100',effectiveLocalDate:'2026-10-05'}),/HISTORICAL_CAPACITY/);
  assert.deepEqual(await repo.readSnapshot(),before);
  assert.equal(planSummary(before,plan.resultIds[0],'2026-10-06').netSettled,'100');
  const forged=structuredClone(before),copy=structuredClone(before.settlements[0]);copy.id=crypto.randomUUID();copy.effectiveLocalDate='2026-10-05';forged.settlements.push(copy);
  assert.throws(()=>validateSnapshot(forged),/HISTORICAL_CAPACITY/);
});
test('monthly recurrence clamps day 31; rescheduling and regeneration preserve unique occurrence',async () => {
  assert.equal(monthlyDate('2028-02',31),'2028-02-29'); assert.equal(monthlyDate('2027-02',31),'2027-02-28');
  assert.equal(todayInTimezone('America/New_York',new Date('2026-03-08T04:30:00Z')),'2026-03-07');
  const repo = await base(); const result = await send(repo,'createMonthlyPlan',{title:'Rent',direction:'EXPENSE',currencyCode:'VND',amountMinor:'5',anchorLocalDate:'2026-01-31',monthDay:31,monthKeys:['2026-01','2026-02']});
  let state = await repo.readSnapshot(); const feb = state.occurrences.find(o => o.occurrenceKey === '2026-02'); assert.equal(feb.dueLocalDate,'2026-02-28');
  await send(repo,'reschedulePlan',{occurrenceId:feb.id,dueLocalDate:'2026-03-03'});
  await send(repo,'generateOccurrences',{seriesId:result.resultIds[0],monthKeys:['2026-02']});
  state = await repo.readSnapshot(); assert.equal(state.occurrences.length,2); assert.equal(state.occurrences.find(o => o.id === feb.id).originalDueLocalDate,'2026-02-28'); assert.equal(state.occurrences.find(o => o.id === feb.id).dueLocalDate,'2026-03-03');
});
test('fixed first and frozen remainder allocate 8 million; rent expense changes cash exactly once',async () => {
  const repo = await base(); await income(repo,'8000000'); const version = await setupTemplate(repo);
  const {preview} = await allocate(repo,version,'8000000'); assert.deepEqual(preview.result.lines.map(l => l.amountMinor),['5000000','1500000','900000','600000']);
  let state = await repo.readSnapshot(); assert.equal(accountBalance(state,state.accounts[0].id),'8000000'); assert.equal(poolSummary(state,state.budgetPools[0].id).unassigned,'0');
  assert.equal((await queryReport(state,descriptor(state,'ActualExpense'))).totalMinor,'0');
  const expense = await send(repo,'recordActual',{operationType:'EXPENSE',accountId:state.accounts[0].id,amountMinor:'5000000',effectiveLocalDate:'2026-10-11'});
  await send(repo,'linkExpense',{expensePostingId:expense.resultIds[1],envelopeId:state.envelopes[0].id,amountMinor:'5000000',effectiveLocalDate:'2026-10-11'});
  state = await repo.readSnapshot(); assert.equal(accountBalance(state,state.accounts[0].id),'3000000'); assert.equal(envelopeBalance(state,state.envelopes[0].id),'0');
  await income(repo,'2000000','2026-10-12');
  const next = await allocate(repo,version,'2000000',null,{allocationEffectiveLocalDate:'2026-10-13'});
  assert.equal(next.preview.result.lines[0].amountMinor,'0'); assert.equal(next.preview.result.fixedRequestedMinor,'0');
});
test('monthly target partial salary and template revision preserve net fixed already earmarked',async () => {
  const repo = await base(); await income(repo,'3000000'); let version = await setupTemplate(repo,{shortagePolicy:'PARTIAL_BY_PRIORITY'});
  await allocate(repo,version,'3000000'); await income(repo,'5000000','2026-10-11');
  const result = await allocate(repo,version,'5000000',null,{allocationEffectiveLocalDate:'2026-10-12'});
  assert.equal(result.preview.result.lines[0].amountMinor,'2000000'); assert.equal(result.preview.result.remainderMinor,'3000000');
  let state = await repo.readSnapshot(); const templateId = state.templates[0].id;
  await income(repo,'2000000','2026-10-13'); version = await setupTemplate(repo,{fixed:'6000000',templateId,shortagePolicy:'PARTIAL_BY_PRIORITY'});
  const revised = await allocate(repo,version,'2000000',null,{allocationEffectiveLocalDate:'2026-10-14'}); assert.equal(revised.preview.result.lines[0].amountMinor,'1000000');
});
test('source capacity alone is insufficient after unassigned cash has been spent',async () => {
  const repo = await base(); await income(repo,'8000000'); const version = await setupTemplate(repo); let state = await repo.readSnapshot();
  await send(repo,'recordActual',{operationType:'EXPENSE',accountId:state.accounts[0].id,amountMinor:'8000000',effectiveLocalDate:'2026-10-07'});
  state = await repo.readSnapshot(); assert.equal(sourceCapacity(state,state.fundingSources[0].id).remaining,'8000000'); assert.equal(poolSummary(state,state.budgetPools[0].id).unassigned,'0');
  await assert.rejects(allocate(repo,version,'8000000'),/INSUFFICIENT_SOURCE_OR_UNASSIGNED/);
});
test('shortage defaults BLOCK; explicit partial and largest remainder preserve exact sums',() => {
  const lines = [{stableLineKey:'a',envelopeId:'rent',type:'FIXED',fixedAmountMinor:'3000000',priority:1},{stableLineKey:'b',envelopeId:'insurance',type:'FIXED',fixedAmountMinor:'2000000',priority:2}];
  const blocked = calculateAllocation('4000000',lines); assert.equal(blocked.allowed,false); assert.equal(blocked.shortageMinor,'1000000');
  assert.deepEqual(calculateAllocation('4000000',lines,{shortagePolicy:'PARTIAL_BY_PRIORITY'}).lines.map(l => l.amountMinor),['3000000','1000000']);
  const percent = [5000,3000,2000].map((percentageBps,i) => ({stableLineKey:String(i),envelopeId:String(i),type:'PERCENT',percentageBps,priority:i}));
  assert.deepEqual(calculateAllocation('9003',percent).lines.map(l => l.amountMinor),['4501','2701','1801']);
  const partial = calculateAllocation('9003',percent.slice(0,2)); assert.equal(partial.leftoverMinor,'1801'); assert.equal(partial.consumptionMinor,'7202');
  for (let n = 1; n <= 100; n++) { const r = calculateAllocation(String(n),percent); assert.equal(r.lines.reduce((s,l) => s + BigInt(l.amountMinor),0n) + BigInt(r.leftoverMinor),BigInt(n)); }
});
test('idempotent replay, stale preview, two concurrent writers and failure do not produce partial records',async () => {
  const repo = await base(); let state = await repo.readSnapshot(); const command = {commandId:'retry-one',type:'recordActual',input:{operationType:'INCOME',accountId:state.accounts[0].id,amountMinor:'8000000',effectiveLocalDate:'2026-10-06'}};
  const first = await repo.runAtomicCommand(command,state.revision,{now}); const after = await repo.readSnapshot();
  assert.deepEqual(await repo.runAtomicCommand(command,state.revision,{now}),first); assert.equal((await repo.readSnapshot()).revision,after.revision);
  await assert.rejects(repo.runAtomicCommand({...command,input:{...command.input,amountMinor:'1'}},after.revision,{now}),/IDEMPOTENCY/);
  const version = await setupTemplate(repo); state = await repo.readSnapshot();
  const input = {templateVersionId:version,budgetPoolId:state.budgetPools[0].id,sourceIds:state.fundingSources.map(s => s.id),requestedAmountMinor:'8000000',allocationEffectiveLocalDate:'2026-10-10'}, preview = await previewAllocationV3(state,input);
  const allocation = {commandId:'one-allocation',type:'confirmAllocation',input:{...input,previewHash:preview.previewHash}};
  await assert.rejects(repo.runAtomicCommand(allocation,state.revision,{now,failBeforeCommit:true}),/SIMULATED/); assert.deepEqual(await repo.readSnapshot(),state);
  const results = await Promise.allSettled([repo.runAtomicCommand(allocation,state.revision,{now}),repo.runAtomicCommand({...allocation,commandId:'other-allocation'},state.revision,{now})]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length,1); assert.equal((await repo.readSnapshot()).allocationApplications.length,1);
});
test('reversal preserves originals, metrics and spend history; allocation undo restores capacity',async () => {
  const repo = await base(); const receipt = await income(repo,'8000000'); const version = await setupTemplate(repo); const allocation = await allocate(repo,version,'8000000');
  await assert.rejects(send(repo,'reverseOperation',{operationId:receipt.resultIds[0],effectiveLocalDate:'2026-10-12',reason:'Correction'}),/UNDO_ALLOCATIONS_FIRST/);
  await send(repo,'reverseAllocation',{applicationId:allocation.receipt.resultIds[0],effectiveLocalDate:'2026-10-12'});
  let state = await repo.readSnapshot(); assert.equal(sourceCapacity(state,state.fundingSources[0].id).remaining,'8000000');
  await send(repo,'reverseOperation',{operationId:receipt.resultIds[0],effectiveLocalDate:'2026-10-12',reason:'Correction'});
  state = await repo.readSnapshot(); assert.equal(state.operations.length,3); assert.equal((await queryReport(state,descriptor(state,'ActualIncome'))).totalMinor,'0'); assert.equal(accountBalance(state,state.accounts[0].id),'0');
  await assert.rejects(send(repo,'reverseOperation',{operationId:receipt.resultIds[0],effectiveLocalDate:'2026-10-12'}),/ALREADY_REVERSED/);
});
test('pagination total and grouped subtotals reflect all rows, not the visible page',async () => {
  const repo = await base(); for (let i=0;i<5;i++) await income(repo,'10'); const state = await repo.readSnapshot();
  const report = await queryReport(state,descriptor(state,'ActualIncome'),{pageSize:2}); assert.equal(report.contributorRows.length,2); assert.equal(report.totalMinor,'50'); assert.equal(report.groups[0].subtotalMinor,'50'); assert.equal(report.paginationCursor,2);
  await assert.rejects(queryReport(state,descriptor(state,'CashBalanceAsOf',{searchQuery:'synthetic'})),/FILTER_INVALID/);
  await assert.rejects(queryReport(state,descriptor(state,'ActualIncome',{datasetRevision:0})),/REVISION/);
});
const legacy = () => ({version:2,accounts:[{id:'bank',name:'Legacy fake',type:'cash',openingBalance:100}],cards:[],assets:[],transactions:[{id:'tx',date:'2026-10-01',kind:'income',accountId:'bank',amount:50}],plans:[],settings:{buffer:0},budgeting:{templates:[],funds:[],allocations:[],expenseLinks:[]},activity:[],undoPoint:null});
test('migration is export-first, reconciles totals, preserves exact raw, and rollback is atomic',async () => {
  const raw = JSON.stringify(legacy()); const blocked = await stageLegacyMigration(raw,{openingDates:{bank:'2026-09-01'}}); assert.equal(blocked.activationAllowed,false);
  const stage = await stageLegacyMigration(raw,{backupAcknowledged:true,openingDates:{bank:'2026-09-01'}}); assert.equal(stage.activationAllowed,true); assert.equal(stage.rawBackup,raw); assert.equal(stage.report.accountReconciliation[0].afterMinor,'150');
  const repo = await base(), before = await repo.readSnapshot(); await repo.stageRestore(stage);
  await assert.rejects(repo.activateStage(stage.id,{expectedDatasetId:before.datasetId,expectedRevision:before.revision,confirm:true,backupAcknowledged:true,failBeforeCommit:true}),/SIMULATED/); assert.deepEqual(await repo.readSnapshot(),before);
  await repo.activateStage(stage.id,{expectedDatasetId:before.datasetId,expectedRevision:before.revision,confirm:true,backupAcknowledged:true}); assert.equal((await repo.readSnapshot()).postings.length,2);
  await repo.rollback(before.datasetId); assert.deepEqual(await repo.readSnapshot(),before);
});
test('corrupt/future/unsupported legacy data remains quarantined rather than reset',async () => {
  assert.equal((await stageLegacyMigration('{bad')).rawBackup,'{bad');
  assert.ok((await stageLegacyMigration(JSON.stringify({version:99}))).blockers.includes('FUTURE_SCHEMA_READ_ONLY'));
  const bad = legacy(); bad.accounts[0].type = 'credit'; const staged = await stageLegacyMigration(JSON.stringify(bad),{backupAcknowledged:true,openingDates:{bank:'2026-09-01'}}); assert.equal(staged.activationAllowed,false); assert.ok(staged.blockers.length);
});
test('restore verifies checksum and repeated activation does not append duplicate income; sandbox isolated',async () => {
  const repo = await base(); await income(repo,'10'); const state = await repo.readSnapshot(), backup = await exportSnapshot(state), stage = await stageRestore(backup);
  assert.notEqual(stage.snapshot.datasetId,state.datasetId); assert.equal(stage.snapshot.postings.length,state.postings.length); assert.equal(stage.report.sourceDatasetId,state.datasetId); const altered = JSON.parse(backup); altered.entities.postings[0].signedAmountMinor = '123'; await assert.rejects(stageRestore(JSON.stringify(altered)),/CHECKSUM/);
  const target = await base(); await target.stageRestore(stage); let current = await target.readSnapshot(); await target.activateStage(stage.id,{expectedDatasetId:current.datasetId,expectedRevision:current.revision,confirm:true,backupAcknowledged:true}); current = await target.readSnapshot();
  await target.activateStage(stage.id,{expectedDatasetId:current.datasetId,expectedRevision:current.revision,confirm:true,backupAcknowledged:true}); assert.equal((await target.readSnapshot()).postings.length,state.postings.length);
  const sandbox = createDataset({namespace:'sandbox'}); await assert.rejects(stageRestore(await exportSnapshot(sandbox)),/SANDBOX/);
});

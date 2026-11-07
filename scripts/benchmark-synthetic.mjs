// Read-only synthetic RAM benchmark. Never opens IndexedDB, localStorage,
// personal saves, a network connection or native/device APIs.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createDataset, record, validateSnapshot, accountBalance } from '../core/model.js';
import { canonical } from '../core/identity.js';
import { queryReport, dailyAccountTimeline } from '../core/reports.js';
import { addDays } from '../core/calendar.js';
import { MAX_PORTABLE_BACKUP_BYTES, backupByteLength } from '../core/backup-policy.js';

const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function inputs() {const files=['scripts/benchmark-synthetic.mjs','package.json',...(await readdir(resolve(root,'core'))).filter(n=>n.endsWith('.js')).map(n=>`core/${n}`)].sort();const records=[];for(const name of files)records.push({path:name,sha256:sha(await readFile(resolve(root,name)))});return {sha256:sha(JSON.stringify(records)),files:records};}
function fixture(targetPostings) {
  const state=createDataset(),now='2026-10-20T00:00:00.000Z';let serial=100;
  state.datasetId='00000000-0000-4000-8000-000000000001';Object.assign(state.profile,{id:'00000000-0000-4000-8000-000000000002',datasetId:state.datasetId,createdAtUtc:now,updatedAtUtc:now,onboardingCompletedAtUtc:now});
  const add=(collection,fields)=>{const entity=record(state,fields,now,`00000000-0000-4000-8000-${(serial++).toString(16).padStart(12,'0')}`);state[collection].push(entity);return entity;};
  const pool=add('budgetPools',{name:'Synthetic VND pool',currencyCode:'VND'}),accounts=[0,1].map(n=>add('accounts',{name:`Synthetic account ${n+1}`,type:'BANK',currencyCode:'VND',includeInBudget:true,budgetPoolId:pool.id,archivedAtUtc:null}));
  for(const account of accounts){const operation=add('operations',{operationType:'OPENING',commandId:`synthetic-opening-${account.id}`,effectiveLocalDate:'2025-12-31',memo:'Fictional opening',committedAtUtc:now});const posting=add('postings',{operationId:operation.id,accountId:account.id,currencyCode:'VND',signedAmountMinor:'1000000000',reportingOrigin:'OPENING',effectiveLocalDate:'2025-12-31',stableOrder:0});add('fundingSources',{budgetPoolId:pool.id,sourcePostingId:posting.id,currencyCode:'VND',eligibleAmountMinor:'1000000000'});}
  const categories=[0,1].map(n=>add('categories',{name:n?'Synthetic expense':'Synthetic income',direction:n?'EXPENSE':'INCOME',archivedAtUtc:null}));
  let index=0,expectedIncome=0n;
  while(state.postings.length<targetPostings){
    const transfer=index%10===0&&state.postings.length+2<=targetPostings,kind=transfer?'TRANSFER':index%3===0?'INCOME':'EXPENSE',date=addDays('2026-01-01',index%365);
    const operation=add('operations',{operationType:kind,commandId:`synthetic-tx-${index}`,effectiveLocalDate:date,memo:`Fictional benchmark ${kind.toLowerCase()} ${index}`,committedAtUtc:now});
    const legs=transfer?[{accountId:accounts[0].id,signedAmountMinor:'-100'},{accountId:accounts[1].id,signedAmountMinor:'100'}]:[{accountId:accounts[index%2].id,signedAmountMinor:kind==='INCOME'?'150':'-100'}];
    for(const [stableOrder,leg] of legs.entries()){const posting=add('postings',{...leg,operationId:operation.id,currencyCode:'VND',reportingOrigin:kind,effectiveLocalDate:date,stableOrder,...(transfer?{}:{categoryId:categories[kind==='INCOME'?0:1].id})});if(kind==='INCOME')add('fundingSources',{budgetPoolId:pool.id,sourcePostingId:posting.id,currencyCode:'VND',eligibleAmountMinor:posting.signedAmountMinor});}
    if(kind==='INCOME')expectedIncome+=150n;
    if(index%1000===0)add('occurrences',{title:`Synthetic plan ${index}`,direction:'EXPENSE',currencyCode:'VND',dueLocalDate:'2026-11-01',originalDueLocalDate:'2026-11-01',expectedAmountMinor:'200',expectedAccountId:accounts[0].id,closure:'OPEN',closureHistory:[]});
    index++;
  }
  state.revision=1;state.profile.revision=1;
  return {state,expectedIncome:String(expectedIncome)};
}
if(!isMainThread){
  const phases=[];let state,expectedIncome;
  async function phase(name,action){const started=performance.now(),value=await action();const result={phase:name,status:'PASS',durationMs:Math.round((performance.now()-started)*1000)/1000,...value};phases.push(result);parentPort.postMessage({type:'phase',value:result});}
  try{
    await phase('fixture-build',()=>{({state,expectedIncome}=fixture(workerData.size));return {postings:state.postings.length,operations:state.operations.length,fundingSources:state.fundingSources.length,plans:state.occurrences.length,heapUsedBytes:process.memoryUsage().heapUsed};});
    await phase('full-snapshot-validation',()=>{validateSnapshot(state);return {};});
    await phase('account-balances',()=>({accounts:state.accounts.length,balances:state.accounts.map(a=>accountBalance(state,a.id))}));
    const descriptor={metricId:'ActualIncome',currencyCode:'VND',startLocalDateInclusive:'2026-01-01',endLocalDateExclusive:'2027-01-01',grouping:'month'};
    await phase('actual-income-report-paginated',async()=>{const result=await queryReport(state,descriptor,{pageSize:100});if(result.totalMinor!==expectedIncome)throw new Error('SYNTHETIC_INCOME_RECONCILIATION_FAILED');return {totalMinor:result.totalMinor,contributionCount:result.contributionCount,visibleRows:result.contributorRows.length,groups:result.groups.length};});
    await phase('daily-balance-timeline',()=>{const result=dailyAccountTimeline(state,{...descriptor,accountIds:[state.accounts[0].id]});const expected=accountBalance(state,state.accounts[0].id);if(result.closingMinor!==expected)throw new Error('SYNTHETIC_BALANCE_RECONCILIATION_FAILED');return {days:result.days.length,closingMinor:result.closingMinor};});
    await phase('canonical-serialization',()=>{const snapshotBytes=Buffer.byteLength(canonical(state)),backupEnvelopeBytes=backupByteLength(state),portableRestoreSupported=backupEnvelopeBytes<=MAX_PORTABLE_BACKUP_BYTES;return {snapshotBytes,backupEnvelopeBytes,portableRestoreSupported,backupPolicy:portableRestoreSupported?'PORTABLE_RESTORE_SUPPORTED':'RECOVERY_ARCHIVE_ONLY_EXCEEDS_64_MIB',heapUsedBytes:process.memoryUsage().heapUsed};});
    parentPort.postMessage({type:'done',value:{status:'PASS',size:workerData.size,phases}});
  }catch(error){parentPort.postMessage({type:'done',value:{status:'FAIL',size:workerData.size,phases,error:error.message}});}
}else{
  const argv=process.argv.slice(2);let sizes=[10000,100000],timeoutMs=30000;
  for(let n=0;n<argv.length;n+=2){if(argv[n]==='--sizes')sizes=argv[n+1]?.split(',').map(Number);else if(argv[n]==='--timeout-ms')timeoutMs=Number(argv[n+1]);else throw new Error('Usage: --sizes 10000,100000 --timeout-ms 30000');}
  if(!sizes?.length||sizes.length>4||sizes.some(n=>!Number.isSafeInteger(n)||n<100||n>100000)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)throw new Error('INVALID_BENCHMARK_BOUNDS');
  const before=await inputs(),results=[],startedAt=new Date().toISOString();
  for(const size of sizes){
    const result=await new Promise(resolveResult=>{const phases=[],started=performance.now(),worker=new Worker(script,{workerData:{size},resourceLimits:{maxOldGenerationSizeMb:768}});let finished=false;const finish=async value=>{if(finished)return;finished=true;clearTimeout(timer);await worker.terminate();resolveResult({...value,durationMs:Math.round(performance.now()-started)});};const timer=setTimeout(()=>finish({status:'BLOCKED',size,phases,reason:`Host benchmark exceeded ${timeoutMs} ms; remaining phases unmeasured, no acceptance PASS claimed`}),timeoutMs);worker.on('message',message=>{if(message.type==='phase')phases.push(message.value);else if(message.type==='done')finish(message.value);});worker.on('error',error=>finish({status:'FAIL',size,phases,error:error.message}));worker.on('exit',code=>{if(!finished)finish({status:'FAIL',size,phases,error:`Worker exited before result: ${code}`});});});
    results.push(result);
  }
  const after=await inputs(),status=results.some(r=>r.status==='FAIL')?'FAIL':results.some(r=>r.status==='BLOCKED')||before.sha256!==after.sha256?'BLOCKED':'PASS';
  console.log(JSON.stringify({schemaVersion:1,kind:'SyntheticHostReadBenchmark',status,startedAt,finishedAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch},sourceInputs:before,sourceInputsSha256End:after.sha256,sourceUnchanged:before.sha256===after.sha256,fixture:'Deterministic fictional two-account VND ledger; income/expense/paired transfers, opening postings, open plans. No DB/save/network.',limits:{maxPortableBackupBytes:MAX_PORTABLE_BACKUP_BYTES,perFixtureTimeoutMs:timeoutMs},acceptance:{status:'NOT_APPLICABLE',reason:'Host measurements only. Device UX thresholds remain proposals until owner/reviewer agree and Android/iOS devices are measured.'},results},null,2));
  process.exitCode=status==='PASS'?0:status==='FAIL'?1:2;
}

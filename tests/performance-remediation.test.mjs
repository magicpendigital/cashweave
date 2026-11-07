import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from '../core/repository.js';
import { validateSnapshot } from '../core/model.js';
import { queryReport, dailyAccountTimeline } from '../core/reports.js';

const now='2026-10-20T00:00:00.000Z';
async function ledger(){
  const repo=createMemoryRepository();let serial=0;
  const send=async(type,input)=>repo.runAtomicCommand({commandId:`index-regression-${++serial}`,type,input},(await repo.readSnapshot()).revision,{now});
  await send('onboard',{name:'Fictional indexed account',accountType:'BANK',currencyCode:'VND',openingAmountMinor:'1000',openingEffectiveLocalDate:'2026-09-01'});
  const state=await repo.readSnapshot();await send('recordActual',{operationType:'INCOME',accountId:state.accounts[0].id,amountMinor:'100',effectiveLocalDate:'2026-10-01',memo:'alpha'});
  return repo.readSnapshot();
}
const descriptor={metricId:'ActualIncome',currencyCode:'VND',startLocalDateInclusive:'2026-10-01',endLocalDateExclusive:'2026-11-01'};

test('per-call validation indexes retain duplicate/reference and funding-source membership guards',async()=>{
  const state=await ledger();validateSnapshot(state);
  const duplicate=structuredClone(state);duplicate.postings[1].id=duplicate.postings[0].id;assert.throws(()=>validateSnapshot(duplicate),/^Error: INVALID_RECORD_ID$/);
  const orphan=structuredClone(state);orphan.postings[1].accountId=crypto.randomUUID();assert.throws(()=>validateSnapshot(orphan),/^Error: UNKNOWN_ACCOUNTS$/);
  const missingLeg=structuredClone(state);missingLeg.postings[1].operationId=crypto.randomUUID();assert.throws(()=>validateSnapshot(missingLeg),/^Error: OPERATION_WITHOUT_POSTINGS$/);
  const membership=structuredClone(state);membership.fundingSources.push({...membership.fundingSources[0],id:crypto.randomUUID()});assert.throws(()=>validateSnapshot(membership),/^Error: INVALID_FUNDING_SOURCE_MEMBERSHIP$/);
  // Reusing the same mutable snapshot never reuses a previous validation map.
  state.postings[1].accountId=crypto.randomUUID();assert.throws(()=>validateSnapshot(state),/^Error: UNKNOWN_ACCOUNTS$/);
});

test('report indexes refresh after mutation and preserve first-match lookup and stable timeline row order',async()=>{
  const state=await ledger(),operation=state.operations.find(item=>item.operationType==='INCOME');
  assert.equal((await queryReport(state,{...descriptor,searchQuery:'alpha'})).totalMinor,'100');
  operation.memo='beta';assert.equal((await queryReport(state,{...descriptor,searchQuery:'beta'})).totalMinor,'100');assert.equal((await queryReport(state,{...descriptor,searchQuery:'alpha'})).totalMinor,'0');
  // Query APIs historically use first matching ID. Validation still rejects
  // duplicate IDs; indexing must not change their lookup to last-wins.
  state.operations.push({...operation,memo:'wrong duplicate'});
  assert.equal((await queryReport(state,descriptor)).contributorRows[0].memo,'beta');
  state.operations.pop();
  const timeline=dailyAccountTimeline(state,{...descriptor,accountIds:[state.accounts[0].id]});
  assert.deepEqual(timeline.days[0].postingIds,[state.postings[1].id]);assert.equal(timeline.days[0].openingMinor,'1000');assert.equal(timeline.days[0].closingMinor,'1100');
  assert.deepEqual(timeline.days[1].postingIds,[]);assert.equal(timeline.days[1].closingMinor,'1100');
  state.postings[1].effectiveLocalDate='2026-10-02';operation.effectiveLocalDate='2026-10-02';
  const next=dailyAccountTimeline(state,{...descriptor,accountIds:[state.accounts[0].id]});assert.deepEqual(next.days[0].postingIds,[]);assert.deepEqual(next.days[1].postingIds,[state.postings[1].id]);
});

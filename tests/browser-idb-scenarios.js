import { openIndexedDbRepository } from '../core/repository.js';
import { exportSnapshot, stageRestore } from '../core/migration.js';
const assert = (condition,message) => { if (!condition) throw new Error(message); };
const now = '2026-10-31T12:00:00.000Z';
export async function verifyIndexedDb() {
  const a = await openIndexedDbRepository({namespace:'sandbox'}), b = await openIndexedDbRepository({namespace:'sandbox'});
  try {
    let snapshot = await a.readSnapshot(); assert(snapshot.accounts.length === 0,'isolated DB must be empty');
    const onboard = {commandId:'browser-onboard',type:'onboard',input:{name:'Synthetic browser account',accountType:'BANK',currencyCode:'VND',openingAmountMinor:'0',openingEffectiveLocalDate:'2026-09-01'}};
    await a.runAtomicCommand(onboard,snapshot.revision,{now}); snapshot = await b.readSnapshot();
    const accountId = snapshot.accounts[0].id, command = {commandId:'browser-retry',type:'recordActual',input:{operationType:'INCOME',accountId,amountMinor:'10',effectiveLocalDate:'2026-10-01'}};
    const concurrent = await Promise.all([a.runAtomicCommand(command,snapshot.revision,{now}),b.runAtomicCommand(command,snapshot.revision,{now})]);
    assert(concurrent[0].resultIds[0] === concurrent[1].resultIds[0],'same command receipt on concurrent retry');
    snapshot = await a.readSnapshot(); assert(snapshot.operations.length === 2,'no duplicate income');
    const before = JSON.stringify(snapshot), failing = {...command,commandId:'browser-failing'};
    let rejected = false; try { await a.runAtomicCommand(failing,snapshot.revision,{now,failBeforeCommit:true}); } catch { rejected = true; }
    assert(rejected,'injected abort must reject'); assert(JSON.stringify(await b.readSnapshot()) === before,'abort rolls back postings and receipt');
    const collisions = await Promise.allSettled([a.runAtomicCommand({...command,commandId:'browser-writer-a'},snapshot.revision,{now}),b.runAtomicCommand({...command,commandId:'browser-writer-b'},snapshot.revision,{now})]);
    assert(collisions.filter(r => r.status === 'fulfilled').length === 1,'only one stale concurrent writer commits');
    snapshot = await a.readSnapshot(); const rollbackId = snapshot.datasetId;
    const stage = await stageRestore(await exportSnapshot(snapshot),{namespace:'sandbox'}); await a.stageRestore(stage,{mode:'new'});
    await a.activateStage(stage.id,{expectedDatasetId:snapshot.datasetId,expectedRevision:snapshot.revision,confirm:true,backupAcknowledged:true,mode:'new'});
    await a.rollback(rollbackId); assert((await a.readSnapshot()).datasetId === rollbackId,'rollback retains old snapshot');
    const personal = await openIndexedDbRepository({namespace:'personal'}); assert((await personal.readSnapshot()).accounts.length === 0,'sandbox does not touch personal DB'); personal.close();
    return {passed:7,checks:['empty dataset','concurrent idempotent retry','no duplicate receipt','atomic abort','revision conflict','stage/rollback','namespace isolation']};
  } finally { a.close(); b.close(); }
}

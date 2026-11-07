import { openIndexedDbRepository } from '../core/repository.js';
import { exportSnapshot, stageRestore, exportRecoverySnapshotFiles } from '../core/migration.js';
const assert = (condition,message) => { if (!condition) throw new Error(message); };
const now = '2026-10-31T12:00:00.000Z';
export async function verifyIndexedDb() {
  const a = await openIndexedDbRepository({namespace:'sandbox'}), b = await openIndexedDbRepository({namespace:'sandbox'});
  let reopened;
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
    const unsubscribe=a.subscribe(()=>{throw new Error('FICTIONAL_SUBSCRIBER_FAILURE');});
    await a.runAtomicCommand({...command,commandId:'subscriber-safe-commit'},snapshot.revision,{now});unsubscribe();snapshot=await a.readSnapshot();assert(snapshot.receipts.filter(r=>r.commandId==='subscriber-safe-commit').length===1,'throwing subscriber never reports a committed financial command as failed');
    const backup=await exportSnapshot(snapshot),stage = await stageRestore(backup,{namespace:'sandbox'}),staleStage=await stageRestore(backup,{namespace:'sandbox'}); await a.stageRestore(stage,{mode:'new'});await a.stageRestore(staleStage,{mode:'new'});
    await a.activateStage(stage.id,{expectedDatasetId:snapshot.datasetId,expectedRevision:snapshot.revision,confirm:true,backupAcknowledged:true,mode:'new'});
    const restored=await a.readSnapshot();a.close();b.close();
    reopened=await openIndexedDbRepository({namespace:'sandbox'});
    const recovery=await reopened.listRecoveryDatasets();assert(recovery.some(s=>s.datasetId===rollbackId&&s.valid&&!s.active),'prior dataset and rollback handle survive reopen');
    assert((await reopened.readRecoverySnapshot(rollbackId)).datasetId===rollbackId,'archived snapshot can be exported after reopen');
    await reopened.rollback(rollbackId,{expectedDatasetId:restored.datasetId,expectedRevision:restored.revision,confirm:true});assert((await reopened.readSnapshot()).datasetId===rollbackId,'guarded rollback after restart retains old snapshot');
    let activatedReplayRejected=false;try{await reopened.activateStage(stage.id,{expectedDatasetId:snapshot.datasetId,expectedRevision:snapshot.revision,confirm:true,backupAcknowledged:true});}catch(error){activatedReplayRejected=error.message==='STAGE_ALREADY_ACTIVATED_OTHER_DATASET';}assert(activatedReplayRejected,'previously activated stage cannot silently reactivate after rollback');
    let staleStageRejected=false;try{await reopened.activateStage(staleStage.id,{expectedDatasetId:snapshot.datasetId,expectedRevision:snapshot.revision,confirm:true,backupAcknowledged:true});}catch(error){staleStageRejected=error.message==='ACTIVATION_DATASET_REVISION_CONFLICT';}assert(staleStageRejected,'unactivated old stage cannot bypass generation after rollback returns identical dataset/revision');
    const commandAbaStage=await stageRestore(backup,{namespace:'sandbox'});await reopened.stageRestore(commandAbaStage);
    const originalDigest=crypto.subtle.digest;let releaseHash,signalHash;const heldHash=new Promise(resolve=>{releaseHash=resolve;}),hashStarted=new Promise(resolve=>{signalHash=resolve;});
    crypto.subtle.digest=function(...args){signalHash();return heldHash.then(()=>originalDigest.apply(this,args));};
    const delayedCommand=reopened.runAtomicCommand({...command,commandId:'command-generation-aba'},snapshot.revision,{now});
    try{await hashStarted;crypto.subtle.digest=originalDigest;const switched=await reopened.activateStage(commandAbaStage.id,{expectedDatasetId:snapshot.datasetId,expectedRevision:snapshot.revision,confirm:true,backupAcknowledged:true});await reopened.rollback(rollbackId,{expectedDatasetId:switched.datasetId,expectedRevision:switched.revision,confirm:true});}finally{crypto.subtle.digest=originalDigest;releaseHash();}
    let commandAbaBlocked=false;try{await delayedCommand;}catch(error){commandAbaBlocked=error.message==='DATASET_CHANGED';}assert(commandAbaBlocked&&!(await reopened.readSnapshot()).receipts.some(r=>r.commandId==='command-generation-aba'),'prepared financial command cannot commit after pointer ABA');
    const repeated=await stageRestore(backup,{namespace:'sandbox'});await reopened.stageRestore(repeated);await reopened.activateStage(repeated.id,{expectedDatasetId:snapshot.datasetId,expectedRevision:snapshot.revision,confirm:true,backupAcknowledged:true});
    const selected=await reopened.readSnapshot(),sameBefore=JSON.stringify(selected);let rollbackConflict=false;try{await reopened.rollback(rollbackId,{expectedDatasetId:'stale',expectedRevision:selected.revision,confirm:true});}catch(error){rollbackConflict=error.message==='ROLLBACK_DATASET_REVISION_CONFLICT';}assert(rollbackConflict&&JSON.stringify(await reopened.readSnapshot())===sameBefore,'stale rollback preserves active snapshot atomically');
    let rollbackAbort=false;try{await reopened.rollback(rollbackId,{expectedDatasetId:selected.datasetId,expectedRevision:selected.revision,confirm:true,failBeforeCommit:true});}catch(error){rollbackAbort=error.message==='SIMULATED_COMMIT_FAILURE';}assert(rollbackAbort&&JSON.stringify(await reopened.readSnapshot())===sameBefore,'interrupted rollback preserves active pointer');
    // Corrupt only fictional data using raw IDB, then exercise the public
    // recovery API without going through the normal snapshot/profile reader.
    const rawDb=await new Promise((resolve,reject)=>{const request=indexedDB.open('mach-tien-v3-sandbox',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const invalid=structuredClone(selected);invalid.profile.locale=[];
    await new Promise((resolve,reject)=>{const tx=rawDb.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(invalid);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});rawDb.close();reopened.close();
    reopened=await openIndexedDbRepository({namespace:'sandbox'});
    let corruptReadBlocked=false;try{await reopened.readSnapshot();}catch{corruptReadBlocked=true;}assert(corruptReadBlocked,'invalid active profile must block ordinary reads');
    const emergency=await reopened.listRecoveryDatasets();assert(emergency.some(s=>s.active&&!s.valid)&&emergency.some(s=>!s.active&&s.valid),'recovery listing works independently of corrupt active profile');
    assert(Array.isArray((await reopened.readRecoverySnapshot(selected.datasetId)).profile.locale),'emergency export retains invalid original bytes/fields');
    let invalidRollbackBlocked=false;try{await reopened.rollback(selected.datasetId,{expectedDatasetId:selected.datasetId,expectedRevision:selected.revision,confirm:true});}catch{invalidRollbackBlocked=true;}assert(invalidRollbackBlocked,'invalid archived snapshot cannot become recovery target');
    await reopened.rollback(rollbackId,{expectedDatasetId:selected.datasetId,expectedRevision:selected.revision,confirm:true});assert(JSON.stringify(await reopened.readSnapshot())===JSON.stringify(snapshot),'valid prior dataset recovers corrupt active state without changing financial records');
    const personal = await openIndexedDbRepository({namespace:'personal'}); assert((await personal.readSnapshot()).accounts.length === 0,'sandbox does not touch personal DB'); personal.close();
    return {passed:18,checks:['empty dataset','concurrent idempotent retry','no duplicate receipt','atomic abort','revision conflict','subscriber failure isolated after commit','persistent recovery after reopen','raw recovery read','guarded rollback after reopen','activated-stage replay protection','stale stage generation protection after rollback','prepared financial command generation ABA blocked','same backup fresh-stage restore after rollback','stale rollback atomicity','interrupted rollback atomicity','corrupt-profile independent recovery','invalid rollback target rejected','namespace isolation']};
  } finally { a.close(); b.close(); reopened?.close(); }
}

// This isolated browser profile contains synthetic fixtures only. Each case
// starts with exactly one dataset and no retained valid recovery candidate.
export async function verifyPersonalEmergencyRestore(){
  const checks=[],name='mach-tien-v3-sandbox';
  const rawOpen=()=>new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const rejects=async(action,pattern)=>{let error;try{await action();}catch(caught){error=caught;}assert(error&&(!pattern||pattern.test(error.message)),'expected recovery rejection: '+(error?.message||'none'));};
  const edit=async action=>{const db=await rawOpen();try{await new Promise((resolve,reject)=>{const tx=db.transaction(['snapshots','meta','stages'],'readwrite');action(tx.objectStore('snapshots'),tx.objectStore('meta'),tx.objectStore('stages'));tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}finally{db.close();}};
  for(const kind of ['corrupt-profile','future','non-json','missing-head','malformed-head']){
    await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('SYNTHETIC_DB_DELETE_BLOCKED'));});
    let repo=await openIndexedDbRepository({namespace:'sandbox'});
    try{
      let old=await repo.readSnapshot();const cmd={commandId:'first-only-onboard',type:'onboard',input:{name:'Synthetic recovery bank',accountType:'BANK',currencyCode:'VND',openingAmountMinor:'100',openingEffectiveLocalDate:'2026-10-01'}};
      const captured=repo.runAtomicCommand(cmd,old.revision,{now});cmd.input.openingAmountMinor='1000';await captured;old=await repo.readSnapshot();assert(old.postings[0].signedAmountMinor==='100','IDB captures caller command before awaiting reads');
      const backup=await exportSnapshot(old);assert((await repo.listRecoveryDatasets()).length===1,'only one source dataset before corruption');repo.close();
      await edit((snapshots,meta)=>{if(kind==='missing-head'){meta.delete('active');return;}if(kind==='malformed-head'){meta.put({key:'active',generation:4});return;}const r=snapshots.get(old.datasetId);r.onsuccess=()=>{const value=r.result;if(kind==='future')value.schemaVersion=99;else if(kind==='non-json'){value.revision=NaN;value.loop=value;value.optional=undefined;}else {value.profile.locale=[];value.retained={constructor:{kind:'synthetic'}};}snapshots.put(value);};});
      repo=await openIndexedDbRepository({namespace:'sandbox'});await rejects(()=>repo.readSnapshot());let rows=await repo.listRecoveryDatasets(),active=rows.find(row=>row.active);assert(active&&!active.valid,'invalid head independently discoverable');assert(rows.filter(row=>row.datasetId===old.datasetId).length===1,'open never silently seeds a new book over existing records');
      if(kind==='non-json'){const files=await exportRecoverySnapshotFiles(await repo.readRecoverySnapshot(old.datasetId)),archive=JSON.parse(files[0].text);assert(archive.entities.encoding==='cash-weave-structured-clone-graph-v1','NaN and cycles archived losslessly as graph');}
      let stage=await stageRestore(backup,{namespace:'sandbox'}),expect={expectedDatasetId:active.datasetId,expectedRevision:active.revision};
      const tampered=structuredClone(stage);tampered.snapshot.accounts[0].name='Tampered staged book';await rejects(()=>repo.stageRecoveryRestore(tampered,expect),/STAGE_SNAPSHOT_MISMATCH/);
      await repo.stageRecoveryRestore(stage,expect);const opts={...expect,mode:'new',confirm:true,backupAcknowledged:true};
      await rejects(()=>repo.activateStage(stage.id,opts),/RECOVERY_CONFIRMATION_REQUIRED/);
      const originalStage=await repo.readStage(stage.id);await edit((_snapshots,_meta,stages)=>{const tampered=structuredClone(originalStage);tampered.snapshot.accounts[0].name='Tampered after preview';stages.put(tampered);});
      await rejects(()=>repo.activateStage(stage.id,{...opts,recoveryAcknowledged:true}),/STAGE_SNAPSHOT_MISMATCH/);await edit((_snapshots,_meta,stages)=>stages.put(originalStage));
      await rejects(()=>repo.activateStage(stage.id,{...opts,recoveryAcknowledged:true,failBeforeCommit:true}),/SIMULATED_COMMIT_FAILURE/);await rejects(()=>repo.readSnapshot());
      // Raw mutation without revision change must invalidate the staged binding.
      await edit((snapshots,meta)=>{const r=meta.get('active');r.onsuccess=()=>meta.put({...r.result,key:'active',generation:(r.result?.generation||0)+1});});
      await rejects(()=>repo.activateStage(stage.id,{...opts,recoveryAcknowledged:true}),/ACTIVATION_DATASET_REVISION_CONFLICT/);
      rows=await repo.listRecoveryDatasets();active=rows.find(row=>row.active);stage=await stageRestore(backup,{namespace:'sandbox'});await repo.stageRecoveryRestore(stage,{expectedDatasetId:active.datasetId,expectedRevision:active.revision});
      const restored=await repo.activateStage(stage.id,{expectedDatasetId:active.datasetId,expectedRevision:active.revision,mode:'new',confirm:true,backupAcknowledged:true,recoveryAcknowledged:true});assert(restored.accounts[0].name==='Synthetic recovery bank'&&restored.postings[0].signedAmountMinor==='100','external backup recovery preserves exact financial records');
      repo.close();repo=await openIndexedDbRepository({namespace:'sandbox'});assert((await repo.readSnapshot()).datasetId===restored.datasetId,'external recovery persists through reopen');const archived=await repo.readRecoverySnapshot(old.datasetId);assert(archived.datasetId===old.datasetId,'old raw dataset retained');if(kind==='non-json')assert(Number.isNaN(archived.revision)&&archived.loop===archived&&Object.hasOwn(archived,'optional'),'nonJSON raw values remain exact after activation/reopen');checks.push('personal first-only '+kind+' archive/preview/ack/abort/stale/reopen');
    }finally{repo.close();}
  }
  return {passed:checks.length,checks,scope:'synthetic first-only invalid/missing-head external recovery in actual IndexedDB'};
}

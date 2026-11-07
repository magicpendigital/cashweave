import { clone, digest } from './identity.js';
import { createDataset, validateSnapshot } from './model.js';
import { prepareCommand } from './commands.js';
import { assertBackupWriteSize } from './backup-policy.js';
import { validateRecoveryRestoreStage } from './migration.js';

function recoverySummary(snapshot, activeId) {
  let valid=true,validationError=null;try{validateSnapshot(snapshot);}catch(error){valid=false;validationError=String(error.message).slice(0,200);}
  return {id:snapshot.datasetId,datasetId:snapshot.datasetId,active:snapshot.datasetId===activeId,revision:Number.isSafeInteger(snapshot.revision)&&snapshot.revision>=0?snapshot.revision:null,namespace:snapshot.namespace,valid,validationError,accountCount:Array.isArray(snapshot.accounts)?snapshot.accounts.length:0,operationCount:Array.isArray(snapshot.operations)?snapshot.operations.length:0,locale:typeof snapshot.profile?.locale==='string'?snapshot.profile.locale:null,currencyCode:typeof snapshot.profile?.defaultCurrencyCode==='string'?snapshot.profile.defaultCurrencyCode:null};
}
function checkRollbackCurrent(current, options) {
  if (options.confirm === false) throw new Error('ROLLBACK_CONFIRMATION_REQUIRED');
  if ((options.expectedDatasetId !== undefined && (current?.datasetId??null) !== options.expectedDatasetId) || (options.expectedRevision !== undefined && (current?.revision??null) !== options.expectedRevision)) throw new Error('ROLLBACK_DATASET_REVISION_CONFLICT');
}

const headDatasetId=head=>typeof head.active?.datasetId==='string'&&head.active.datasetId?head.active.datasetId:null;
function rawEqual(a,b,seen=new Map(),reverse=new Map()){
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return Object.is(a,b);
  // A record may legitimately contain its own "constructor" data property.
  // Compare actual prototypes and preserve a bijection between cloned graphs.
  if(Object.getPrototypeOf(a)!==Object.getPrototypeOf(b))return false;
  if(seen.has(a)||reverse.has(b))return seen.get(a)===b&&reverse.get(b)===a;
  seen.set(a,b);reverse.set(b,a);
  if(Array.isArray(a)&&a.length!==b.length)return false;
  if(a instanceof Date)return Object.is(a.getTime(),b.getTime());
  if(a instanceof RegExp)return String(a)===String(b)&&a.lastIndex===b.lastIndex;
  if(a instanceof ArrayBuffer||ArrayBuffer.isView(a)){if(ArrayBuffer.isView(a))return a.byteOffset===b.byteOffset&&a.byteLength===b.byteLength&&rawEqual(a.buffer,b.buffer,seen,reverse);const aa=new Uint8Array(a),bb=new Uint8Array(b);return aa.length===bb.length&&aa.every((n,i)=>n===bb[i]);}
  if(a instanceof Map){if(a.size!==b.size)return false;const other=[...b];return [...a].every(([key,value],i)=>rawEqual(key,other[i][0],seen,reverse)&&rawEqual(value,other[i][1],seen,reverse));}
  if(a instanceof Set){if(a.size!==b.size)return false;const other=[...b];return [...a].every((value,i)=>rawEqual(value,other[i],seen,reverse));}
  if(a instanceof Error)return a.name===b.name&&a.message===b.message&&a.stack===b.stack&&rawEqual(a.cause,b.cause,seen,reverse);
  // Blob bytes are immutable. This CAS compares metadata; it does not claim
  // authentication against an owner replacing same-origin storage contents.
  if(typeof Blob!=='undefined'&&a instanceof Blob)return a.size===b.size&&a.type===b.type&&a.name===b.name&&a.lastModified===b.lastModified;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&rawEqual(a[key],b[key],seen,reverse));
}
function recoveryHeadIdentity(head,namespace){return {namespace,datasetId:headDatasetId(head),revision:Number.isSafeInteger(head.snapshot?.revision)&&head.snapshot.revision>=0?head.snapshot.revision:null,generation:head.active?.generation||0};}
async function bindRecoveryStage(stage,head,namespace,options){
  stage=clone(stage);await validateRecoveryRestoreStage(stage,namespace);
  let valid=true;try{validateSnapshot(head.snapshot);}catch{valid=false;}if(valid)throw new Error('RECOVERY_REQUIRES_INVALID_ACTIVE');
  const identity=recoveryHeadIdentity(head,namespace);
  if(!Object.hasOwn(options,'expectedDatasetId')||!Object.hasOwn(options,'expectedRevision')||options.expectedDatasetId!==identity.datasetId||options.expectedRevision!==identity.revision)throw new Error('ACTIVATION_DATASET_REVISION_CONFLICT');
  const bound=await bindStage(stage,{datasetId:identity.datasetId,revision:identity.revision,namespace,profile:{defaultCurrencyCode:stage.snapshot?.profile?.defaultCurrencyCode}},'new',identity.generation);
  bound.activationBinding.recovery=true;bound.activationBinding.recoveryHead=clone(head);return bound;
}
async function checkRecoveryActivation(stage,head,namespace,options){
  const binding=stage.activationBinding,identity=recoveryHeadIdentity(head,namespace);
  if(!options.recoveryAcknowledged||!binding?.recovery)throw new Error('RECOVERY_CONFIRMATION_REQUIRED');
  await validateRecoveryRestoreStage(stage,namespace);
  if(options.mode!=='new'||identity.datasetId!==binding.datasetId||identity.revision!==binding.revision||identity.generation!==binding.generation||options.expectedDatasetId!==binding.datasetId||options.expectedRevision!==binding.revision||!rawEqual(head,binding.recoveryHead))throw new Error('ACTIVATION_DATASET_REVISION_CONFLICT');
  if(binding.namespace!==namespace||stage.snapshot.namespace!==namespace)throw new Error('ACTIVATION_NAMESPACE_MISMATCH');
  if(stage.id!==binding.stageId||stage.snapshot.datasetId!==binding.targetDatasetId||stage.sourceFingerprint!==binding.fingerprint)throw new Error('ACTIVATION_STAGE_CONFLICT');
  validateSnapshot(stage.snapshot);
}

async function bindStage(stage,current,mode,generation=0){
  if(!['new','replace'].includes(mode))throw new Error('INVALID_RESTORE_MODE');
  validateSnapshot(stage.snapshot);
  if(stage.snapshot.datasetId===current.datasetId)throw new Error('ACTIVATION_REQUIRES_DISTINCT_DATASET');
  if(stage.snapshot.namespace!==current.namespace)throw new Error('ACTIVATION_NAMESPACE_MISMATCH');
  if(typeof stage.rawBackup!=='string'||await digest(stage.rawBackup)!==stage.sourceFingerprint||stage.backupDigest!==stage.sourceFingerprint)throw new Error('STAGE_FINGERPRINT_MISMATCH');
  return {...clone(stage),activationBinding:{datasetId:current.datasetId,revision:current.revision,generation,namespace:current.namespace,currencyCode:current.profile.defaultCurrencyCode,mode,stageId:stage.id,fingerprint:stage.sourceFingerprint,targetDatasetId:stage.snapshot.datasetId,targetNamespace:stage.snapshot.namespace,targetCurrencyCode:stage.snapshot.profile.defaultCurrencyCode}};
}
function checkActivation(stage,current,options,generation=0){
  const binding=stage.activationBinding;
  if(!binding||options.expectedDatasetId!==binding.datasetId||options.expectedRevision!==binding.revision||current.datasetId!==binding.datasetId||current.revision!==binding.revision||(binding.generation||0)!==generation)throw new Error('ACTIVATION_DATASET_REVISION_CONFLICT');
  if(options.mode!==binding.mode||stage.id!==binding.stageId||stage.sourceFingerprint!==binding.fingerprint||stage.snapshot.datasetId!==binding.targetDatasetId)throw new Error('ACTIVATION_STAGE_CONFLICT');
  if(current.namespace!==binding.namespace||stage.snapshot.namespace!==binding.targetNamespace||current.namespace!==stage.snapshot.namespace)throw new Error('ACTIVATION_NAMESPACE_MISMATCH');
  if(current.profile.defaultCurrencyCode!==binding.currencyCode||stage.snapshot.profile.defaultCurrencyCode!==binding.targetCurrencyCode)throw new Error('ACTIVATION_CURRENCY_CONFLICT');
}
function checkReplay(stage,current,options,targetDatasetId){
  if(current.datasetId!==targetDatasetId)throw new Error('STAGE_ALREADY_ACTIVATED_OTHER_DATASET');
  const binding=stage.activationBinding;
  if(!binding||options.mode!==binding.mode||stage.sourceFingerprint!==binding.fingerprint)throw new Error('ACTIVATION_STAGE_CONFLICT');
  if(current.namespace!==binding.targetNamespace||stage.snapshot.namespace!==current.namespace)throw new Error('ACTIVATION_NAMESPACE_MISMATCH');
  if(!((options.expectedDatasetId===binding.datasetId&&options.expectedRevision===binding.revision)||(options.expectedDatasetId===current.datasetId&&options.expectedRevision===current.revision)))throw new Error('ACTIVATION_DATASET_REVISION_CONFLICT');
}

export function createMemoryRepository(initial = createDataset()) {
  let snapshot = clone(validateSnapshot(initial)), queue = Promise.resolve(),generation=0;
  const namespace = snapshot.namespace;
  const stages = new Map(), archived = new Map(), activated = new Map();
  const atomic = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  return {
    async readSnapshot() { return clone(snapshot); },
    async listRecoveryDatasets() { return [...archived.values(),snapshot].filter((value,index,all)=>all.findLastIndex(s=>s.datasetId===value.datasetId)===index).map(value=>recoverySummary(value,snapshot.datasetId)); },
    async readRecoverySnapshot(datasetId) { const value=datasetId===snapshot.datasetId?snapshot:archived.get(datasetId);if(!value)throw new Error('UNKNOWN_ROLLBACK_DATASET');return clone(value); },
    runAtomicCommand(command, expectedRevision, options = {}) { command=clone(command);options={...options};return atomic(async () => { const prepared = await prepareCommand(snapshot, command, expectedRevision, options); if(!prepared.replay)assertBackupWriteSize(snapshot,prepared.snapshot);if (options.failBeforeCommit) throw new Error('SIMULATED_COMMIT_FAILURE'); snapshot = prepared.snapshot; return clone(prepared.result); }); },
    async stageRestore(stage,{mode='new'}={}) { stages.set(stage.id,await bindStage(stage,snapshot,mode,generation)); return stage.id; },
    async readStage(stageId) { const stage = stages.get(stageId); if (!stage) throw new Error('UNKNOWN_STAGE'); return clone(stage); },
    activateStage(stageId, { expectedDatasetId, expectedRevision, confirm = false, backupAcknowledged = false, mode = 'new', failBeforeCommit = false } = {}) { return atomic(async () => {
      const stage = stages.get(stageId);
      if (!stage?.activationAllowed || !confirm || !backupAcknowledged) throw new Error('STAGE_CONFIRMATION_REQUIRED');
      if (!['new','replace'].includes(mode)) throw new Error('INVALID_RESTORE_MODE');
      if(activated.has(stage.id)){checkReplay(stage,snapshot,{expectedDatasetId,expectedRevision,mode},activated.get(stage.id));return clone(snapshot);}
      checkActivation(stage,snapshot,{expectedDatasetId,expectedRevision,mode},generation);
      validateSnapshot(stage.snapshot);
      if (failBeforeCommit) throw new Error('SIMULATED_COMMIT_FAILURE');
      archived.set(snapshot.datasetId, clone(snapshot)); snapshot = clone(stage.snapshot);generation++;
      activated.set(stage.id,snapshot.datasetId);
      return clone(snapshot);
    }); },
    async rollback(datasetId, options = {}) { return atomic(() => { checkRollbackCurrent(snapshot,options);const previous = datasetId===snapshot.datasetId?snapshot:archived.get(datasetId); if (!previous) throw new Error('UNKNOWN_ROLLBACK_DATASET'); validateSnapshot(previous);if(previous.namespace!==namespace)throw new Error('ACTIVATION_NAMESPACE_MISMATCH');if(options.failBeforeCommit)throw new Error('SIMULATED_COMMIT_FAILURE');archived.set(snapshot.datasetId,clone(snapshot)); snapshot = clone(previous);generation++; return clone(snapshot); }); },
  };
}

const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const completed = transaction => new Promise((resolve,reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error || new Error('TRANSACTION_ABORTED')); transaction.onerror = () => {}; });
export async function openIndexedDbRepository({ namespace = 'personal', profile = {}, indexedDB = globalThis.indexedDB } = {}) {
  if (!['personal','sandbox'].includes(namespace)) throw new Error('INVALID_DB_NAMESPACE');
  if (!indexedDB) throw new Error('INDEXEDDB_UNAVAILABLE');
  const opening = indexedDB.open(`mach-tien-v3-${namespace}`,1);
  opening.onupgradeneeded = () => { const db = opening.result; db.createObjectStore('snapshots',{ keyPath:'datasetId' }); db.createObjectStore('meta',{ keyPath:'key' }); db.createObjectStore('stages',{ keyPath:'id' }); };
  const db = await request(opening); db.onversionchange = () => db.close();
  const channel = globalThis.BroadcastChannel ? new BroadcastChannel(`mach-tien-v3-${namespace}-revision`) : null;
  const listeners = new Set(),deliver=message=>{for(const listener of listeners)try{listener(message);}catch{}};
  if (channel) channel.onmessage = event => deliver(event.data);
  const announce = state => { const message = { datasetId:state.datasetId, revision:state.revision };try{channel?.postMessage(message);}catch{}deliver(message); };
  {
    const fresh = createDataset({ ...profile, namespace }), tx = db.transaction(['meta','snapshots'],'readwrite'), done = completed(tx), meta = tx.objectStore('meta');
    const get = meta.get('active'); get.onsuccess = () => { if (!get.result) { const keys=tx.objectStore('snapshots').getAllKeys();keys.onsuccess=()=>{if(!keys.result.length){tx.objectStore('snapshots').put(fresh);meta.put({ key:'active',datasetId:fresh.datasetId,generation:0 });}}; } };
    await done;
  }
  async function readRawHeadSnapshot() {
    const tx = db.transaction(['meta','snapshots'],'readonly'), done = completed(tx);
    const active = await request(tx.objectStore('meta').get('active'));
    const key=typeof active?.datasetId==='string'&&active.datasetId?active.datasetId:null;
    const snapshot = key?await request(tx.objectStore('snapshots').get(key)):undefined; await done;
    return {snapshot:clone(snapshot),active:clone(active)};
  }
  async function readHeadSnapshot(){const head=await readRawHeadSnapshot();return {snapshot:clone(validateSnapshot(head.snapshot)),generation:head.active?.generation||0};}
  async function readSnapshot() {return (await readHeadSnapshot()).snapshot;}
  return {
    readSnapshot,
    async listRecoveryDatasets() {
      // Deliberately independent of readSnapshot: an invalid active profile must
      // not prevent finding the last valid dataset after a restart.
      const tx=db.transaction(['meta','snapshots'],'readonly'),done=completed(tx);
      const activeRequest=request(tx.objectStore('meta').get('active')),allRequest=request(tx.objectStore('snapshots').getAll());
      const [active,all]=await Promise.all([activeRequest,allRequest]);await done;
      const key=headDatasetId({active}),rows=all.map(value=>recoverySummary(value,key));if(!rows.some(row=>row.active))rows.push({datasetId:key,id:key,revision:null,active:true,valid:false,validationError:'ACTIVE_SNAPSHOT_MISSING',accountCount:0,operationCount:0});return rows;
    },
    async readRecoverySnapshot(datasetId) {const tx=db.transaction('snapshots','readonly'),done=completed(tx),value=await request(tx.objectStore('snapshots').get(datasetId));await done;if(!value)throw new Error('UNKNOWN_ROLLBACK_DATASET');return clone(value);},
    async runAtomicCommand(command, expectedRevision, options = {}) {
      command=clone(command);options={...options};
      const head = await readHeadSnapshot(),before=head.snapshot, prepared = await prepareCommand(before,command,expectedRevision,options);
      if (prepared.replay) return clone(prepared.result);
      assertBackupWriteSize(before,prepared.snapshot);
      // Async hashing/calculation completes before opening the transaction; no transaction awaits unrelated promises.
      const tx = db.transaction(['meta','snapshots'],'readwrite'), done = completed(tx); let conflict, receipt = prepared.result, committed = true;
      const active = tx.objectStore('meta').get('active');
      active.onsuccess = () => {
        if (active.result?.datasetId !== before.datasetId || (active.result?.generation||0)!==head.generation) { conflict = new Error('DATASET_CHANGED'); tx.abort(); return; }
        const current = tx.objectStore('snapshots').get(before.datasetId);
        current.onsuccess = () => {
          if (!current.result || current.result.revision !== before.revision) {
            const existing = current.result?.receipts?.find(r => r.commandId === command.commandId);
            if (existing?.payloadHash === prepared.result.payloadHash) { receipt = existing; committed = false; return; }
            conflict = new Error('REVISION_CONFLICT'); tx.abort(); return;
          }
          if (options.failBeforeCommit) { conflict = new Error('SIMULATED_COMMIT_FAILURE'); tx.abort(); return; }
          tx.objectStore('snapshots').put(prepared.snapshot);
        };
      };
      try { await done; } catch (error) { throw conflict || error; }
      if (committed) announce(prepared.snapshot); return clone(receipt);
    },
    async stageRestore(stage,{mode='new'}={}) { const head=await readHeadSnapshot(),bound=await bindStage(stage,head.snapshot,mode,head.generation);const tx = db.transaction('stages','readwrite'), done = completed(tx); tx.objectStore('stages').put(bound); await done; return stage.id; },
    async stageRecoveryRestore(stage,options={}) {stage=clone(stage);options={...options};const head=await readRawHeadSnapshot(),bound=await bindRecoveryStage(stage,head,namespace,options);const tx=db.transaction('stages','readwrite'),done=completed(tx);tx.objectStore('stages').put(bound);await done;return stage.id;},
    async readStage(stageId) { const tx = db.transaction('stages','readonly'), done = completed(tx); const stage = await request(tx.objectStore('stages').get(stageId)); await done; if (!stage) throw new Error('UNKNOWN_STAGE'); return clone(stage); },
    async activateStage(stageId, { expectedDatasetId, expectedRevision, confirm = false, backupAcknowledged = false, recoveryAcknowledged=false, mode = 'new', failBeforeCommit = false } = {}) {
      if (!['new','replace'].includes(mode)) throw new Error('INVALID_RESTORE_MODE');
      const read = db.transaction('stages','readonly'), readDone = completed(read), stage = await request(read.objectStore('stages').get(stageId)); await readDone;
      if (!stage?.activationAllowed || !confirm || !backupAcknowledged) throw new Error('STAGE_CONFIRMATION_REQUIRED');
      validateSnapshot(stage.snapshot);
      const recoveryHead=stage.activationBinding?.recovery?await readRawHeadSnapshot():null;
      if(recoveryHead)await checkRecoveryActivation(stage,recoveryHead,namespace,{expectedDatasetId,expectedRevision,mode,recoveryAcknowledged});
      const replacement = clone(stage.snapshot);
      const tx = db.transaction(['stages','meta','snapshots'],'readwrite'), done = completed(tx); let conflict, activated = replacement;
      const active = tx.objectStore('meta').get('active');
      active.onsuccess = () => { const inspectCurrent=currentValue=>{
        const marker = tx.objectStore('meta').get(`activated-stage:${stage.id}`);
        marker.onsuccess = () => {
          if (marker.result || stage.activatedAtUtc) {try{checkReplay(stage,currentValue,{expectedDatasetId,expectedRevision,mode},marker.result?.datasetId||stage.snapshot.datasetId);}catch(error){conflict=error;tx.abort();return;}activated = currentValue; return; }
          try{if(recoveryHead){if(!rawEqual({active:active.result,snapshot:currentValue},recoveryHead))throw new Error('ACTIVATION_DATASET_REVISION_CONFLICT');}else checkActivation(stage,currentValue,{expectedDatasetId,expectedRevision,mode},active.result?.generation||0);}catch(error){conflict=error;tx.abort();return;}
          if (failBeforeCommit) { conflict = new Error('SIMULATED_COMMIT_FAILURE'); tx.abort(); return; }
          const collision=tx.objectStore('snapshots').get(replacement.datasetId);collision.onsuccess=()=>{if(collision.result){conflict=new Error('ACTIVATION_DATASET_ALREADY_EXISTS');tx.abort();return;}
          tx.objectStore('meta').put({ key:`rollback:${replacement.datasetId}`, datasetId:active.result?.datasetId??null });
          tx.objectStore('snapshots').put(replacement);
          tx.objectStore('meta').put({ key:'active',datasetId:replacement.datasetId,generation:(active.result?.generation||0)+1 });
          tx.objectStore('meta').put({ key:`activated:${stage.sourceFingerprint}`,datasetId:replacement.datasetId });
          tx.objectStore('meta').put({ key:`activated-stage:${stage.id}`,datasetId:replacement.datasetId });
          tx.objectStore('stages').put({ ...stage, activatedAtUtc:new Date().toISOString() });
          };
        };
      };const key=headDatasetId({active:active.result});if(key){const current=tx.objectStore('snapshots').get(key);current.onsuccess=()=>inspectCurrent(current.result);}else inspectCurrent(undefined); };
      try { await done; } catch (error) { throw conflict || error; }
      announce(activated); return clone(activated);
    },
    async rollback(datasetId,options = {}) {
      const tx = db.transaction(['meta','snapshots'],'readwrite'), done = completed(tx); let restored, conflict;
      const active=tx.objectStore('meta').get('active');active.onsuccess=()=>{const restoreFrom=current=>{
        try{checkRollbackCurrent(current,options);}catch(error){conflict=error;tx.abort();return;}
        const previous = tx.objectStore('snapshots').get(datasetId);
        previous.onsuccess = () => { if (!previous.result) { conflict = new Error('UNKNOWN_ROLLBACK_DATASET'); tx.abort(); return; }try{validateSnapshot(previous.result);if(previous.result.namespace!==namespace)throw new Error('ACTIVATION_NAMESPACE_MISMATCH');if(options.failBeforeCommit)throw new Error('SIMULATED_COMMIT_FAILURE');}catch(error){conflict=error;tx.abort();return;}restored = previous.result;tx.objectStore('meta').put({key:`rollback:${datasetId}`,datasetId:current?.datasetId||active.result?.datasetId||null});tx.objectStore('meta').put({ key:'active',datasetId,generation:(active.result?.generation||0)+1 }); };
      };if(active.result?.datasetId!==undefined){const current=tx.objectStore('snapshots').get(active.result.datasetId);current.onsuccess=()=>restoreFrom(current.result);}else restoreFrom(undefined);};
      try { await done; } catch (error) { throw conflict || error; } announce(restored); return clone(restored);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { channel?.close(); db.close(); },
  };
}

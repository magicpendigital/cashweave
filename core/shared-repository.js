import { canonical, clone, digest } from './identity.js';
import { createSharedDataset, validateSharedSnapshot, validateSharedCommand, prepareSharedExecution } from './shared-schema.js';
import { assertSharedWriteSize, validateSharedStage } from './shared-backup.js';

const FORMAT='cash-weave-shared-validated-state-v1';
const STAGE_FORMAT='cash-weave-shared-validated-stage-v1';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function requireCondition(condition,message){if(!condition)throw new Error(message);}
function syntheticLock(){let queue=Promise.resolve();return {request(_name,_options,action){const result=queue.then(action);queue=result.catch(()=>{});return result;}};}
async function seal(snapshot){return {formatId:FORMAT,datasetId:snapshot.datasetId,snapshot:clone(snapshot),integrityHash:await digest(snapshot)};}
async function decode(record,namespace){
  requireCondition(record&&record.formatId===FORMAT&&record.datasetId===record.snapshot?.datasetId&&await digest(record.snapshot)===record.integrityHash,'SHARED_STORED_INTEGRITY_MISMATCH');
  // This digest capsule detects accidental stored corruption. It is not an
  // authentication boundary against someone able to rewrite same-origin IDB
  // and recompute hashes. Only trusted command results/full-replayed restores
  // are sealed; every untrusted file must undergo full historical replay.
  validateSharedSnapshot(record.snapshot,{replay:false});requireCondition(record.snapshot.namespace===namespace,'SHARED_NAMESPACE_MISMATCH');return clone(record.snapshot);
}
function generation(head){return head?.meta?.generation||0;}
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
function sameHead(current,before){return current?.meta?.datasetId===before?.meta?.datasetId&&generation(current)===generation(before)&&rawEqual(current?.record||null,before?.record||null);}
function rawSnapshot(record){return record&&Object.hasOwn(record,'snapshot')?record.snapshot:record;}
function rawRevision(record){const value=rawSnapshot(record)?.revision;return Number.isSafeInteger(value)&&value>=0?value:null;}
function rollbackGuard(head,options){requireCondition(options.confirm===true,'SHARED_ROLLBACK_CONFIRMATION_REQUIRED');requireCondition(Object.hasOwn(options,'expectedDatasetId')&&Object.hasOwn(options,'expectedRevision'),'SHARED_ROLLBACK_EXPECTATION_REQUIRED');requireCondition(options.expectedDatasetId===(head.meta?.datasetId??null)&&options.expectedRevision===rawRevision(head.record),'SHARED_ROLLBACK_CONFLICT');}
function bindStage(stage,head,current){requireCondition(uuid(stage.id)&&uuid(stage.snapshot.datasetId),'SHARED_INVALID_STAGE_ID');requireCondition(stage.snapshot.datasetId!==current.datasetId,'SHARED_ACTIVATION_REQUIRES_DISTINCT_DATASET');return {...stage,activationBinding:{datasetId:current.datasetId,revision:current.revision,generation:generation(head),namespace:current.namespace,stageId:stage.id,targetDatasetId:stage.snapshot.datasetId,fingerprint:stage.sourceFingerprint}};}
function bindRecoveryStage(stage,head,namespace){const current={datasetId:head.meta?.datasetId??null,revision:rawRevision(head.record),namespace},bound=bindStage(stage,head,current);return {...bound,activationBinding:{...bound.activationBinding,recovery:true}};}
function activationGuard(stage,head,current,options){
  const binding=stage.activationBinding;requireCondition(binding&&binding.datasetId===current.datasetId&&binding.revision===current.revision&&binding.generation===generation(head)&&options.expectedDatasetId===binding.datasetId&&options.expectedRevision===binding.revision,'SHARED_ACTIVATION_REVISION_CONFLICT');
  requireCondition(binding.stageId===stage.id&&binding.targetDatasetId===stage.snapshot.datasetId&&binding.fingerprint===stage.sourceFingerprint,'SHARED_ACTIVATION_STAGE_CONFLICT');requireCondition(binding.namespace===current.namespace&&stage.snapshot.namespace===current.namespace,'SHARED_NAMESPACE_MISMATCH');
}
function replayGuard(stage,marker,current,options){requireCondition(current.datasetId===marker.datasetId,'SHARED_STAGE_ALREADY_ACTIVATED_OTHER_DATASET');const binding=stage.activationBinding;requireCondition((options.expectedDatasetId===current.datasetId&&options.expectedRevision===current.revision)||(options.expectedDatasetId===binding.datasetId&&options.expectedRevision===binding.revision),'SHARED_ACTIVATION_REVISION_CONFLICT');}
function injectedFailure(options){if(options.failWithQuota){const error=new Error('SHARED_SIMULATED_QUOTA_EXCEEDED');error.name='QuotaExceededError';throw error;}if(options.failBeforeCommit)throw new Error('SHARED_SIMULATED_COMMIT_FAILURE');}
function controller(adapter,{namespace,locks,databaseName,writable=true}){
  let closed=false;const listeners=new Set();let channel=null;
  try{if(globalThis.BroadcastChannel)channel=new BroadcastChannel(databaseName+'-revision');}catch{}
  const deliver=message=>{for(const listener of listeners){try{listener(message);}catch{}}};if(channel)channel.onmessage=event=>deliver(event.data);
  const announce=snapshot=>{const message={datasetId:snapshot.datasetId,revision:snapshot.revision};try{channel?.postMessage(message);}catch{}deliver(message);};
  const exclusive=action=>{requireCondition(!closed,'SHARED_REPOSITORY_CLOSED');requireCondition(writable&&typeof locks?.request==='function','SHARED_WRITE_LOCK_UNAVAILABLE');return locks.request(databaseName+'-write',{mode:'exclusive'},()=>{requireCondition(!closed,'SHARED_REPOSITORY_CLOSED');return action();});};
  async function readSnapshot(){requireCondition(!closed,'SHARED_REPOSITORY_CLOSED');const head=await adapter.readHead();requireCondition(head.record,'SHARED_ACTIVE_MISSING');return decode(head.record,namespace);}
  return {
    writable:Boolean(writable&&typeof locks?.request==='function'),readSnapshot,
    execute(command,expectedRevision,options={}){
      // Capture identity and all nested input before waiting for a lock or IDB.
      const captured=clone(command),capturedOptions={...options};validateSharedCommand(captured);canonical(captured);
      return exclusive(async()=>{const head=await adapter.readHead(),before=await decode(head.record,namespace),prepared=prepareSharedExecution(before,captured,expectedRevision,capturedOptions);if(prepared.replay)return clone(before);assertSharedWriteSize(before,prepared.snapshot);const record=await seal(prepared.snapshot);await adapter.commit(head,record,{kind:'execute',options:capturedOptions});announce(prepared.snapshot);return clone(prepared.snapshot);});
    },
    async stageRestore(stage,options={}){const captured=clone(stage),capturedOptions={...options},verified=await validateSharedStage(captured,namespace);return exclusive(async()=>{requireCondition(!await adapter.get(verified.snapshot.datasetId),'SHARED_RESTORE_TARGET_ALREADY_EXISTS');requireCondition(!await adapter.getStage(verified.id),'SHARED_STAGE_ID_ALREADY_EXISTS');const head=await adapter.readHead();let bound;if(capturedOptions.recovery===true){let valid=true;try{await decode(head.record,namespace);}catch{valid=false;}requireCondition(!valid,'SHARED_RECOVERY_REQUIRES_INVALID_ACTIVE');bound=bindRecoveryStage(verified,head,namespace);}else bound=bindStage(verified,head,await decode(head.record,namespace));const record={formatId:STAGE_FORMAT,id:bound.id,stage:bound,integrityHash:await digest(bound)};await adapter.putStage(record);return bound.id;});},
    async readStage(stageId){const record=await adapter.getStage(stageId);requireCondition(record,'SHARED_UNKNOWN_STAGE');requireCondition(record.formatId===STAGE_FORMAT&&await digest(record.stage)===record.integrityHash,'SHARED_STAGE_INTEGRITY_MISMATCH');return clone(record.stage);},
    activateStage(stageId,options={}){const captured={...options};return exclusive(async()=>{requireCondition(captured.confirm===true&&captured.backupAcknowledged===true,'SHARED_STAGE_CONFIRMATION_REQUIRED');const record=await adapter.getStage(stageId);requireCondition(record&&record.formatId===STAGE_FORMAT&&await digest(record.stage)===record.integrityHash,'SHARED_STAGE_INTEGRITY_MISMATCH');const stage=record.stage,head=await adapter.readHead(),marker=await adapter.activation(stageId);if(stage.activationBinding?.recovery)requireCondition(captured.recoveryConfirmation===true,'SHARED_RECOVERY_CONFIRMATION_REQUIRED');if(marker){const current=await decode(head.record,namespace);replayGuard(stage,marker,current,captured);return current;}const current=stage.activationBinding?.recovery?{datasetId:head.meta?.datasetId??null,revision:rawRevision(head.record),namespace}:await decode(head.record,namespace);activationGuard(stage,head,current,captured);validateSharedSnapshot(stage.snapshot,{replay:false});const replacement=await seal(stage.snapshot);await adapter.commit(head,replacement,{kind:'activate',stageId,options:captured});announce(stage.snapshot);return clone(stage.snapshot);});},
    async listRecoveryDatasets(){const all=await adapter.all();const rows=[];for(const record of all.records){let valid=true,validationError=null;try{await decode(record,namespace);}catch(error){valid=false;validationError=String(error.message).slice(0,200);}const raw=rawSnapshot(record);rows.push({id:record.datasetId,datasetId:record.datasetId,active:record.datasetId===all.meta?.datasetId,valid,validationError,revision:rawRevision(record),createdAtUtc:raw?.createdAtUtc??null,updatedAtUtc:raw?.updatedAtUtc??null,name:typeof raw?.space?.name==='string'?raw.space.name:null,names:raw?.names&&typeof raw.names==='object'?clone(raw.names):null,entries:Array.isArray(raw?.space?.entries)?raw.space.entries.length:null,bills:Array.isArray(raw?.space?.bills)?raw.space.bills.length:null,plans:Array.isArray(raw?.space?.plans)?raw.space.plans.length:null});}if(!rows.some(row=>row.active))rows.push({id:all.meta?.datasetId??null,datasetId:all.meta?.datasetId??null,active:true,valid:false,validationError:'SHARED_ACTIVE_MISSING',revision:null,name:null,names:null,entries:null,bills:null,plans:null});return rows;},
    async readRecoverySnapshot(datasetId){const record=await adapter.get(datasetId);requireCondition(record,'SHARED_UNKNOWN_RECOVERY_DATASET');return clone(rawSnapshot(record));},
    rollback(datasetId,options={}){const captured={...options};return exclusive(async()=>{const head=await adapter.readHead();rollbackGuard(head,captured);const target=await adapter.get(datasetId);requireCondition(target,'SHARED_UNKNOWN_RECOVERY_DATASET');const snapshot=await decode(target,namespace);await adapter.commit(head,target,{kind:'rollback',options:captured});announce(snapshot);return snapshot;});},
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    close(){if(closed)return;closed=true;listeners.clear();channel?.close();adapter.close?.();},
  };
}

export function createMemorySharedRepository({namespace='personal',initialSnapshot,locks=syntheticLock()}={}){
  const initial=clone(initialSnapshot||createSharedDataset({namespace}));validateSharedSnapshot(initial);requireCondition(initial.namespace===namespace,'SHARED_NAMESPACE_MISMATCH');
  // Async sealing is private initialization; no financial write occurs until a
  // queued command successfully commits under the synthetic lock/CAS adapter.
  const ready=seal(initial),records=new Map(),stages=new Map(),markers=new Map();let meta={key:'active',datasetId:initial.datasetId,generation:0};
  const initialize=async()=>{if(!records.size)records.set(initial.datasetId,await ready);};
  const adapter={
    async readHead(){await initialize();return clone({meta,record:records.get(meta.datasetId)});},async get(datasetId){await initialize();return clone(records.get(datasetId));},async all(){await initialize();return clone({meta,records:[...records.values()]});},async putStage(record){stages.set(record.id,clone(record));},async getStage(stageId){return clone(stages.get(stageId));},async activation(stageId){return clone(markers.get(stageId));},
    async commit(before,record,{kind,stageId,options}){await initialize();const current={meta,record:records.get(meta.datasetId)};requireCondition(sameHead(current,before),'SHARED_DATASET_CONFLICT');injectedFailure(options);records.set(record.datasetId,clone(record));if(kind!=='execute')meta={key:'active',datasetId:record.datasetId,generation:meta.generation+1};if(kind==='activate')markers.set(stageId,{datasetId:record.datasetId});},
  };
  return controller(adapter,{namespace,locks,writable:typeof locks?.request==='function',databaseName:'memory-shared-'+initial.datasetId});
}

const request=operation=>new Promise((resolve,reject)=>{operation.onsuccess=()=>resolve(operation.result);operation.onerror=()=>reject(operation.error);});
const completed=transaction=>new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error||new Error('SHARED_TRANSACTION_ABORTED'));transaction.onerror=()=>{};});
export async function openSharedRepository({namespace='personal',indexedDB=globalThis.indexedDB,locks=globalThis.navigator?.locks,databaseName='cash-weave-shared-v1-'+namespace}={}){
  requireCondition(['personal','sandbox'].includes(namespace),'SHARED_INVALID_NAMESPACE');requireCondition(indexedDB,'SHARED_INDEXEDDB_UNAVAILABLE');requireCondition(databaseName==='cash-weave-shared-v1-'+namespace||new RegExp('^cash-weave-shared-v1-'+namespace+'-qa-[a-z0-9-]{1,64}$').test(databaseName),'SHARED_INVALID_DATABASE_NAME');
  const canLock=typeof locks?.request==='function';
  async function open(allowCreate){const opening=indexedDB.open(databaseName);opening.onupgradeneeded=()=>{if(!allowCreate){opening.transaction.abort();return;}const db=opening.result;db.createObjectStore('snapshots',{keyPath:'datasetId'});db.createObjectStore('meta',{keyPath:'key'});db.createObjectStore('stages',{keyPath:'id'});};return request(opening);}
  let db;
  if(canLock)db=await locks.request(databaseName+'-write',{mode:'exclusive'},()=>open(true));
  else{try{db=await open(false);}catch(error){if(error.name==='AbortError')throw new Error('SHARED_WRITE_LOCK_UNAVAILABLE');throw error;}}
  db.onversionchange=()=>db.close();const writable=canLock&&db.version===1;
  async function readHead(){const tx=db.transaction(['meta','snapshots'],'readonly'),done=completed(tx),meta=await request(tx.objectStore('meta').get('active'));const record=meta?.datasetId?await request(tx.objectStore('snapshots').get(meta.datasetId)):undefined;await done;return {meta,record};}
  if(writable)await locks.request(databaseName+'-write',{mode:'exclusive'},async()=>{const fresh=await seal(createSharedDataset({namespace})),tx=db.transaction(['meta','snapshots'],'readwrite'),done=completed(tx),metaStore=tx.objectStore('meta'),active=metaStore.get('active');active.onsuccess=()=>{if(!active.result){const count=tx.objectStore('snapshots').count();count.onsuccess=()=>{if(count.result===0){tx.objectStore('snapshots').put(fresh);metaStore.put({key:'active',datasetId:fresh.datasetId,generation:0});}};}};await done;});
  const adapter={
    readHead,
    async get(datasetId){const tx=db.transaction('snapshots','readonly'),done=completed(tx),record=await request(tx.objectStore('snapshots').get(datasetId));await done;return record;},
    async all(){const tx=db.transaction(['meta','snapshots'],'readonly'),done=completed(tx),metaPromise=request(tx.objectStore('meta').get('active')),recordsPromise=request(tx.objectStore('snapshots').getAll()),[meta,records]=await Promise.all([metaPromise,recordsPromise]);await done;return {meta,records};},
    async putStage(record){const tx=db.transaction('stages','readwrite'),done=completed(tx);tx.objectStore('stages').put(record);await done;},
    async getStage(stageId){const tx=db.transaction('stages','readonly'),done=completed(tx),record=await request(tx.objectStore('stages').get(stageId));await done;return record;},
    async activation(stageId){const tx=db.transaction('meta','readonly'),done=completed(tx),marker=await request(tx.objectStore('meta').get('activated-stage:'+stageId));await done;return marker;},
    async commit(before,record,{kind,stageId,options}){const tx=db.transaction(['meta','snapshots'],'readwrite'),done=completed(tx);let conflict;const metaStore=tx.objectStore('meta'),snapshotStore=tx.objectStore('snapshots'),active=metaStore.get('active');active.onsuccess=()=>{const compare=current=>{try{requireCondition(sameHead({meta:active.result,record:current},before),'SHARED_DATASET_CONFLICT');injectedFailure(options);}catch(error){conflict=error;tx.abort();return;}snapshotStore.put(record);if(kind!=='execute')metaStore.put({key:'active',datasetId:record.datasetId,generation:generation(before)+1});if(kind==='activate')metaStore.put({key:'activated-stage:'+stageId,datasetId:record.datasetId});};if(active.result?.datasetId){const current=snapshotStore.get(active.result.datasetId);current.onsuccess=()=>compare(current.result);}else compare(undefined);};try{await done;}catch(error){throw conflict||error;}},
    close(){db.close();},
  };
  return controller(adapter,{namespace,locks,databaseName,writable});
}


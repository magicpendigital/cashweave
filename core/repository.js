import { clone, digest } from './identity.js';
import { createDataset, validateSnapshot, withOptionalCollections } from './model.js';
import { prepareCommand, VALIDATED_SNAPSHOT } from './commands.js';

async function bindStage(stage,current,mode){
  if(!['new','replace'].includes(mode))throw new Error('INVALID_RESTORE_MODE');
  validateSnapshot(stage.snapshot);
  if(stage.snapshot.datasetId===current.datasetId)throw new Error('ACTIVATION_REQUIRES_DISTINCT_DATASET');
  if(stage.snapshot.namespace!==current.namespace)throw new Error('ACTIVATION_NAMESPACE_MISMATCH');
  if(typeof stage.rawBackup!=='string'||await digest(stage.rawBackup)!==stage.sourceFingerprint||stage.backupDigest!==stage.sourceFingerprint)throw new Error('STAGE_FINGERPRINT_MISMATCH');
  return {...clone(stage),activationBinding:{datasetId:current.datasetId,revision:current.revision,namespace:current.namespace,currencyCode:current.profile.defaultCurrencyCode,mode,stageId:stage.id,fingerprint:stage.sourceFingerprint,targetDatasetId:stage.snapshot.datasetId,targetNamespace:stage.snapshot.namespace,targetCurrencyCode:stage.snapshot.profile.defaultCurrencyCode}};
}
function checkActivation(stage,current,options){
  const binding=stage.activationBinding;
  if(!binding||options.expectedDatasetId!==binding.datasetId||options.expectedRevision!==binding.revision||current.datasetId!==binding.datasetId||current.revision!==binding.revision)throw new Error('ACTIVATION_DATASET_REVISION_CONFLICT');
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
  let snapshot = withOptionalCollections(clone(validateSnapshot(initial))), queue = Promise.resolve();
  const stages = new Map(), archived = new Map(), activated = new Map();
  const atomic = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  return {
    readsValidated: true, // readSnapshot() always returns a snapshot that passed validateSnapshot; callers need not re-validate.
    async readSnapshot() { return clone(snapshot); },
    runAtomicCommand(command, expectedRevision, options = {}) { return atomic(async () => { const prepared = await prepareCommand(snapshot, command, expectedRevision, { ...options, [VALIDATED_SNAPSHOT]: true }); if (options.failBeforeCommit) throw new Error('SIMULATED_COMMIT_FAILURE'); snapshot = prepared.snapshot; return clone(prepared.result); }); },
    async stageRestore(stage,{mode='new'}={}) { stages.set(stage.id,await bindStage(stage,snapshot,mode)); return stage.id; },
    async readStage(stageId) { const stage = stages.get(stageId); if (!stage) throw new Error('UNKNOWN_STAGE'); return clone(stage); },
    activateStage(stageId, { expectedDatasetId, expectedRevision, confirm = false, backupAcknowledged = false, mode = 'new', failBeforeCommit = false } = {}) { return atomic(async () => {
      const stage = stages.get(stageId);
      if (!stage?.activationAllowed || !confirm || !backupAcknowledged) throw new Error('STAGE_CONFIRMATION_REQUIRED');
      if (!['new','replace'].includes(mode)) throw new Error('INVALID_RESTORE_MODE');
      if(activated.has(stage.sourceFingerprint)){checkReplay(stage,snapshot,{expectedDatasetId,expectedRevision,mode},activated.get(stage.sourceFingerprint));return clone(snapshot);}
      checkActivation(stage,snapshot,{expectedDatasetId,expectedRevision,mode});
      validateSnapshot(stage.snapshot);
      if (failBeforeCommit) throw new Error('SIMULATED_COMMIT_FAILURE');
      archived.set(snapshot.datasetId, clone(snapshot)); snapshot = withOptionalCollections(clone(stage.snapshot));
      activated.set(stage.sourceFingerprint,snapshot.datasetId);
      return clone(snapshot);
    }); },
    async rollback(datasetId) { return atomic(() => { const previous = archived.get(datasetId); if (!previous) throw new Error('UNKNOWN_ROLLBACK_DATASET'); archived.set(snapshot.datasetId,clone(snapshot)); snapshot = clone(previous); return clone(snapshot); }); },
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
  const listeners = new Set(); if (channel) channel.onmessage = event => listeners.forEach(fn => fn(event.data));
  const announce = state => { const message = { datasetId:state.datasetId, revision:state.revision }; channel?.postMessage(message); listeners.forEach(fn => fn(message)); };
  {
    const fresh = createDataset({ ...profile, namespace }), tx = db.transaction(['meta','snapshots'],'readwrite'), done = completed(tx), meta = tx.objectStore('meta');
    const get = meta.get('active'); get.onsuccess = () => { if (!get.result) { tx.objectStore('snapshots').put(fresh); meta.put({ key:'active', datasetId:fresh.datasetId }); } };
    await done;
  }
  // datasetId:revision this instance last fully validated or committed itself. Any other stored state (first open,
  // another tab's write, rollback) is fully validated on read; revisions are unique per dataset because commits
  // compare-and-set the revision inside the transaction.
  let verified = '';
  const key = state => state.datasetId + ':' + state.revision;
  async function readSnapshot({ revalidate = false } = {}) {
    const tx = db.transaction(['meta','snapshots'],'readonly'), done = completed(tx);
    const active = await request(tx.objectStore('meta').get('active'));
    const snapshot = await request(tx.objectStore('snapshots').get(active.datasetId)); await done;
    if (revalidate || !snapshot || key(snapshot) !== verified) { validateSnapshot(snapshot); verified = key(snapshot); }
    return withOptionalCollections(snapshot); // IndexedDB get already yields a private structured clone.
  }
  return {
    readsValidated: true,
    readSnapshot,
    async runAtomicCommand(command, expectedRevision, options = {}) {
      const before = await readSnapshot(), prepared = await prepareCommand(before,command,expectedRevision,{...options,[VALIDATED_SNAPSHOT]:true});
      if (prepared.replay) return clone(prepared.result);
      // Async hashing/calculation completes before opening the transaction; no transaction awaits unrelated promises.
      const tx = db.transaction(['meta','snapshots'],'readwrite'), done = completed(tx); let conflict, receipt = prepared.result, committed = true;
      const active = tx.objectStore('meta').get('active');
      active.onsuccess = () => {
        if (active.result.datasetId !== before.datasetId) { conflict = new Error('DATASET_CHANGED'); tx.abort(); return; }
        const current = tx.objectStore('snapshots').get(before.datasetId);
        current.onsuccess = () => {
          if (current.result.revision !== before.revision) {
            const existing = current.result.receipts.find(r => r.commandId === command.commandId);
            if (existing?.payloadHash === prepared.result.payloadHash) { receipt = existing; committed = false; return; }
            conflict = new Error('REVISION_CONFLICT'); tx.abort(); return;
          }
          if (options.failBeforeCommit) { conflict = new Error('SIMULATED_COMMIT_FAILURE'); tx.abort(); return; }
          tx.objectStore('snapshots').put(prepared.snapshot);
        };
      };
      try { await done; } catch (error) { throw conflict || error; }
      if (committed) { verified = key(prepared.snapshot); announce(prepared.snapshot); } return clone(receipt);
    },
    async stageRestore(stage,{mode='new'}={}) { const bound=await bindStage(stage,await readSnapshot(),mode);const tx = db.transaction('stages','readwrite'), done = completed(tx); tx.objectStore('stages').put(bound); await done; return stage.id; },
    async readStage(stageId) { const tx = db.transaction('stages','readonly'), done = completed(tx); const stage = await request(tx.objectStore('stages').get(stageId)); await done; if (!stage) throw new Error('UNKNOWN_STAGE'); return clone(stage); },
    async activateStage(stageId, { expectedDatasetId, expectedRevision, confirm = false, backupAcknowledged = false, mode = 'new', failBeforeCommit = false } = {}) {
      if (!['new','replace'].includes(mode)) throw new Error('INVALID_RESTORE_MODE');
      const read = db.transaction('stages','readonly'), readDone = completed(read), stage = await request(read.objectStore('stages').get(stageId)); await readDone;
      if (!stage?.activationAllowed || !confirm || !backupAcknowledged) throw new Error('STAGE_CONFIRMATION_REQUIRED');
      validateSnapshot(stage.snapshot);
      const replacement = withOptionalCollections(clone(stage.snapshot));
      const tx = db.transaction(['stages','meta','snapshots'],'readwrite'), done = completed(tx); let conflict, activated = replacement;
      const active = tx.objectStore('meta').get('active');
      active.onsuccess = () => { const current = tx.objectStore('snapshots').get(active.result.datasetId); current.onsuccess = () => {
        const marker = tx.objectStore('meta').get(`activated:${stage.sourceFingerprint}`);
        marker.onsuccess = () => {
          if (marker.result) {try{checkReplay(stage,current.result,{expectedDatasetId,expectedRevision,mode},marker.result.datasetId);}catch(error){conflict=error;tx.abort();return;}activated = current.result; return; }
          try{checkActivation(stage,current.result,{expectedDatasetId,expectedRevision,mode});}catch(error){conflict=error;tx.abort();return;}
          if (failBeforeCommit) { conflict = new Error('SIMULATED_COMMIT_FAILURE'); tx.abort(); return; }
          tx.objectStore('meta').put({ key:`rollback:${replacement.datasetId}`, datasetId:current.result.datasetId });
          tx.objectStore('snapshots').put(replacement);
          tx.objectStore('meta').put({ key:'active',datasetId:replacement.datasetId });
          tx.objectStore('meta').put({ key:`activated:${stage.sourceFingerprint}`,datasetId:replacement.datasetId });
          tx.objectStore('stages').put({ ...stage, activatedAtUtc:new Date().toISOString() });
        };
      }; };
      try { await done; } catch (error) { throw conflict || error; }
      if (activated === replacement) verified = key(replacement);
      announce(activated); return clone(activated);
    },
    async rollback(datasetId) {
      const tx = db.transaction(['meta','snapshots'],'readwrite'), done = completed(tx); let restored, conflict;
      const previous = tx.objectStore('snapshots').get(datasetId);
      previous.onsuccess = () => { if (!previous.result) { conflict = new Error('UNKNOWN_ROLLBACK_DATASET'); tx.abort(); return; } restored = previous.result; tx.objectStore('meta').put({ key:'active',datasetId }); };
      try { await done; } catch (error) { throw conflict || error; } announce(restored); return clone(restored);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { channel?.close(); db.close(); },
  };
}

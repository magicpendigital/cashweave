import { canonical, clone, digest, id } from './identity.js';
import { SHARED_MAX_BYTES, validateSharedSnapshot, validateSharedSnapshotAsync } from './shared-schema.js';

const FORMAT='cash-weave-shared-backup';
function payload(snapshot,exportedAtUtc){return {formatId:FORMAT,backupVersion:1,schemaVersion:1,datasetId:snapshot.datasetId,currencyCode:'VND',exportedAtUtc,entities:clone(snapshot)};}
export function sharedBackupByteLength(snapshot){return new TextEncoder().encode(canonical({...payload(snapshot,'2000-01-01T00:00:00.000Z'),checksum:'0'.repeat(64)})).length;}
export function assertSharedWriteSize(before,next){const bytes=sharedBackupByteLength(next);if(bytes<=SHARED_MAX_BYTES||bytes<sharedBackupByteLength(before))return;throw new Error('SHARED_BACKUP_TOO_LARGE');}
function parse(raw){if(typeof raw!=='string'||new TextEncoder().encode(raw).length>SHARED_MAX_BYTES)throw new Error('SHARED_BACKUP_TOO_LARGE');let result;try{result=JSON.parse(raw);}catch{throw new Error('SHARED_INVALID_BACKUP_JSON');}if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('SHARED_INVALID_BACKUP_FORMAT');return result;}
export function inspectSharedBackup(raw){
  const value=parse(raw),recovery=['cash-weave-shared-recovery','cash-weave-shared-recovery-part'].includes(value.formatId);
  if(value.formatId!==FORMAT&&!recovery)throw new Error('SHARED_INVALID_BACKUP_FORMAT');
  if(value.schemaVersion>1||value.backupVersion>1)throw new Error('SHARED_FUTURE_SCHEMA_READ_ONLY');
  if(recovery)return {kind:'shared-recovery',recoveryOnly:true};
  if(value.schemaVersion!==1||value.backupVersion!==1||Object.keys(value).some(key=>!['formatId','backupVersion','schemaVersion','datasetId','currencyCode','exportedAtUtc','entities','checksum'].includes(key))||typeof value.checksum!=='string'||!/^[a-f0-9]{64}$/.test(value.checksum)||typeof value.exportedAtUtc!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.exportedAtUtc)||!Number.isFinite(new Date(value.exportedAtUtc).getTime())||new Date(value.exportedAtUtc).toISOString()!==value.exportedAtUtc)throw new Error('SHARED_INVALID_BACKUP_FORMAT');
  return {kind:'shared',datasetId:value.datasetId,schemaVersion:1};
}
export async function exportSharedSnapshot(snapshot){const captured=clone(snapshot);await validateSharedSnapshotAsync(captured);const content=payload(captured,new Date().toISOString()),raw=canonical({...content,checksum:await digest(content)});if(new TextEncoder().encode(raw).length>SHARED_MAX_BYTES)throw new Error('SHARED_BACKUP_TOO_LARGE');return raw;}
export async function stageSharedRestore(raw,{namespace='personal',onProgress}={}){
  inspectSharedBackup(raw);const value=parse(raw);if(value.formatId!==FORMAT)throw new Error('SHARED_RECOVERY_ARCHIVE_READ_ONLY');
  const {checksum,...content}=value;if(await digest(content)!==checksum)throw new Error('SHARED_BACKUP_CHECKSUM_MISMATCH');
  await validateSharedSnapshotAsync(value.entities,{onProgress});if(value.datasetId!==value.entities.datasetId||value.currencyCode!=='VND')throw new Error('SHARED_BACKUP_DATASET_MISMATCH');
  if(value.entities.namespace!==namespace)throw new Error('SHARED_NAMESPACE_MISMATCH');
  const snapshot=clone(value.entities);snapshot.datasetId=id();const fingerprint=await digest(raw);
  return {id:id(),sourceFingerprint:fingerprint,backupDigest:fingerprint,rawBackup:raw,snapshot,activationAllowed:true,report:{sourceDatasetId:value.entities.datasetId,revision:snapshot.revision,name:snapshot.space?.name||null,names:clone(snapshot.names),entries:snapshot.space?.entries.length||0,bills:snapshot.space?.bills.length||0,plans:snapshot.space?.plans.length||0,closes:snapshot.space?.closes.length||0},createdAtUtc:new Date().toISOString()};
}
export async function validateSharedStage(stage,namespace){
  const captured=clone(stage);
  if(!captured?.activationAllowed||typeof captured.rawBackup!=='string'||await digest(captured.rawBackup)!==captured.sourceFingerprint||captured.backupDigest!==captured.sourceFingerprint)throw new Error('SHARED_STAGE_FINGERPRINT_MISMATCH');
  const verified=await stageSharedRestore(captured.rawBackup,{namespace});verified.snapshot.datasetId=captured.snapshot.datasetId;
  validateSharedSnapshot(captured.snapshot,{replay:false});
  if(canonical(verified.snapshot)!==canonical(captured.snapshot)||canonical(verified.report)!==canonical(captured.report))throw new Error('SHARED_STAGE_SNAPSHOT_MISMATCH');return captured;
}
// Recovery JSON remains available even when an old/corrupt snapshot cannot be
// validated or exceeds the supported restore limit. It is never activatable.
// JSON-incompatible corrupt IDB values are retained in an explicit graph. It
// preserves cycles, undefined, nonfinite numbers, BigInt and binary/blob bytes;
// it is an archival encoding, never an activatable financial snapshot.
async function recoveryGraph(value){
  const seen=new Map(),nodes=[];
  async function visit(item){
    if(item===null||typeof item==='string'||typeof item==='boolean')return {value:item};
    if(typeof item==='number')return {number:Number.isNaN(item)?'NaN':item===Infinity?'Infinity':item===-Infinity?'-Infinity':Object.is(item,-0)?'-0':String(item)};
    if(typeof item==='undefined')return {undefined:true};if(typeof item==='bigint')return {bigint:String(item)};
    if(seen.has(item))return {ref:seen.get(item)};const index=nodes.length;seen.set(item,index);nodes.push(null);let node;
    const hex=bytes=>Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
    if(item instanceof Date)node={type:'Date',time:Number.isNaN(item.getTime())?'NaN':String(item.getTime())};
    else if(item instanceof RegExp)node={type:'RegExp',source:item.source,flags:item.flags,lastIndex:item.lastIndex};
    else if(item instanceof ArrayBuffer)node={type:'ArrayBuffer',hex:hex(new Uint8Array(item))};
    else if(ArrayBuffer.isView(item))node={type:item.constructor.name,buffer:await visit(item.buffer),byteOffset:item.byteOffset,byteLength:item.byteLength,...(typeof item.length==='number'?{length:item.length}:{})};
    else if(typeof Blob!=='undefined'&&item instanceof Blob)node={type:typeof File!=='undefined'&&item instanceof File?'File':'Blob',mime:item.type,name:typeof item.name==='string'?item.name:null,lastModified:typeof item.lastModified==='number'?item.lastModified:null,hex:hex(new Uint8Array(await item.arrayBuffer()))};
    else if(item instanceof Map){const entries=[];for(const [key,value]of item)entries.push([await visit(key),await visit(value)]);node={type:'Map',entries};}
    else if(item instanceof Set){const values=[];for(const value of item)values.push(await visit(value));node={type:'Set',values};}
    else if(item instanceof Error)node={type:'Error',name:item.name,message:item.message,stack:item.stack||'',cause:await visit(item.cause)};
    else{const entries=[];for(const key of Object.keys(item))entries.push([key,await visit(item[key])]);node={type:Array.isArray(item)?'Array':'Object',...(Array.isArray(item)?{length:item.length}:{}),entries};}
    nodes[index]=node;return {ref:index};
  }
  return {encoding:'cash-weave-structured-clone-graph-v1',root:await visit(value),nodes};
}
function plainJson(value,seen=new Set()){
  if(value===null||['string','boolean'].includes(typeof value))return true;if(typeof value==='number')return Number.isFinite(value)&&!Object.is(value,-0);if(typeof value!=='object'||seen.has(value))return false;
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return false;
  seen.add(value);if(Array.isArray(value)&&Object.keys(value).length!==value.length)return false;for(const key of Object.keys(value))if(!plainJson(value[key],seen))return false;return true;
}
export async function exportSharedRecovery(snapshot){const captured=clone(snapshot),content={formatId:'cash-weave-shared-recovery',schemaVersion:1,recoveryOnly:true,datasetId:typeof captured?.datasetId==='string'?captured.datasetId:null,exportedAtUtc:new Date().toISOString(),entities:plainJson(captured)?captured:await recoveryGraph(captured)};return canonical({...content,checksum:await digest(content)});}
export async function exportSharedRecoveryFiles(snapshot){
  const raw=await exportSharedRecovery(snapshot);if(new TextEncoder().encode(raw).length<=SHARED_MAX_BYTES)return [{name:'cash-weave-shared-recovery.json',text:raw}];
  const archiveId=await digest(raw),chunkUnits=1024*1024,count=Math.ceil(raw.length/chunkUnits),totalBytes=new TextEncoder().encode(raw).length,files=[];
  for(let n=0;n<count;n++){const payload=raw.slice(n*chunkUnits,(n+1)*chunkUnits),text=canonical({formatId:'cash-weave-shared-recovery-part',schemaVersion:1,recoveryOnly:true,archiveId,index:n+1,count,totalBytes,payload,partChecksum:await digest(payload)});if(new TextEncoder().encode(text).length>SHARED_MAX_BYTES)throw new Error('SHARED_RECOVERY_PART_TOO_LARGE');files.push({name:`cash-weave-shared-recovery.part-${n+1}-of-${count}.json`,text});}return files;
}

import { clone, digest, id, canonical } from './identity.js';
import { createDataset, record, validateSnapshot, accountBalance, poolSummary, COLLECTIONS } from './model.js';
import { minor, checked, money, CURRENCY_TABLE_VERSION } from './money.js';
import { requireDate } from './calendar.js';
import { normalizeState } from '../state-schema.js';
import { calculateBalances } from '../ledger.js';
import { MAX_BACKUP_FILE_BYTES, MAX_PORTABLE_BACKUP_BYTES } from './backup-policy.js';
import { recoveryGraph, plainJson } from './recovery-values.js';

const MAX_BYTES = MAX_BACKUP_FILE_BYTES;
const PART_BYTES = 2 * 1024 * 1024;
export const MAX_BACKUP_PARTS = 64;
export { MAX_PORTABLE_BACKUP_BYTES };
const MAX_ARCHIVE_PARTS = 4096;
const PART_FORMAT = 'cash-weave-backup-part';
const byteLength = text => new TextEncoder().encode(text).length;
function parseJson(raw, maxBytes = MAX_BYTES) {
  if (typeof raw !== 'string' || byteLength(raw) > maxBytes) throw new Error('BACKUP_TOO_LARGE');
  let parsed; try { parsed = JSON.parse(raw); } catch { throw new Error('INVALID_BACKUP_JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_BACKUP_FORMAT');
  return parsed;
}
function legacyPayload(parsed) {
  const enveloped = parsed.format === 'mach-tien-backup';
  if (enveloped && parsed.backupVersion !== 2) throw new Error(parsed.backupVersion > 2 ? 'FUTURE_SCHEMA_READ_ONLY' : 'RESTORE_SCHEMA_UNSUPPORTED');
  const source = enveloped ? parsed.state : parsed;
  if (source?.version > 2 || source?.schemaVersion > 3) throw new Error('FUTURE_SCHEMA_READ_ONLY');
  return { state:normalizeState(source), sourceVersion:source.version, enveloped };
}
function inspectPart(parsed) {
  if (parsed.partVersion !== 1 || typeof parsed.recoveryOnly !== 'boolean' || !/^[0-9a-f]{64}$/.test(parsed.bundleId) || !/^[0-9a-f]{64}$/.test(parsed.chunkSha256) || !Number.isSafeInteger(parsed.index) || !Number.isSafeInteger(parsed.count) || parsed.count < 2 || parsed.count > (parsed.recoveryOnly ? MAX_ARCHIVE_PARTS : MAX_BACKUP_PARTS) || parsed.index < 1 || parsed.index > parsed.count || !Number.isSafeInteger(parsed.totalBytes) || parsed.totalBytes <= MAX_BYTES || (parsed.totalBytes > MAX_PORTABLE_BACKUP_BYTES && !parsed.recoveryOnly) || parsed.count !== Math.ceil(parsed.totalBytes/PART_BYTES) || typeof parsed.dataBase64 !== 'string' || parsed.dataBase64.length > 4 * Math.ceil(PART_BYTES / 3) || parsed.dataBase64.length%4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(parsed.dataBase64)) throw new Error('INVALID_BACKUP_PART');
  return { kind:'multipart',bundleId:parsed.bundleId,index:parsed.index,count:parsed.count,totalBytes:parsed.totalBytes,recoveryOnly:parsed.recoveryOnly,archiveReason:parsed.archiveReason||null };
}
// Identification never activates data. Legacy source records remain available for
// explicit opening-date mapping or the separate compatibility workspace.
export function inspectBackup(raw) {
  const parsed = parseJson(raw);
  if (parsed.formatId === PART_FORMAT) return inspectPart(parsed);
  if (parsed.formatId === 'cash-weave-recovery-archive') return {kind:'recovery-archive',recoveryOnly:true,archiveReason:'INVALID_SNAPSHOT',datasetId:parsed.datasetId};
  if (parsed.formatId === 'mach-tien-export') {
    if (parsed.schemaVersion !== 3) throw new Error(parsed.schemaVersion > 3 ? 'FUTURE_SCHEMA_READ_ONLY' : 'RESTORE_SCHEMA_UNSUPPORTED');
    return { kind:'v3',schemaVersion:3,datasetId:parsed.datasetId };
  }
  const legacy = legacyPayload(parsed);
  return { kind:'legacy',...legacy,accounts:clone(legacy.state.accounts),requiresOpeningDates:true };
}
async function snapshotExportRaw(snapshot) {
  validateSnapshot(snapshot);
  const payload = { formatId:'mach-tien-export',schemaVersion:3,appVersion:'next-mvp-checkpoint-1',exportedAtUtc:new Date().toISOString(),datasetId:snapshot.datasetId,currencyTableVersion:CURRENCY_TABLE_VERSION,entities:clone(snapshot) };
  return canonical({ ...payload,checksum:await digest(payload) });
}
export async function exportSnapshot(snapshot) {
  const result = await snapshotExportRaw(snapshot);
  if (byteLength(result) > MAX_BYTES) throw new Error('BACKUP_TOO_LARGE');
  return result;
}
function toBase64(bytes) { let binary = ''; for (let n=0;n<bytes.length;n+=32768) binary += String.fromCharCode(...bytes.subarray(n,n+32768)); return btoa(binary); }
export async function exportSnapshotFiles(snapshot) {
  const raw = await snapshotExportRaw(snapshot), bytes = new TextEncoder().encode(raw);
  if (bytes.length <= MAX_BYTES) return [{name:`cash-weave-${snapshot.datasetId}.json`,text:raw}];
  return splitBackupFiles(raw,bytes,bytes.length>MAX_PORTABLE_BACKUP_BYTES,'RESTORE_SIZE_LIMIT');
}
// Emergency archival remains available when normal validation cannot read the
// active profile. Its format explicitly cannot be activated as a valid backup.
export async function exportRecoverySnapshotFiles(snapshot) {
  snapshot=clone(snapshot);
  const payload={formatId:'cash-weave-recovery-archive',archiveVersion:1,archivedAtUtc:new Date().toISOString(),datasetId:typeof snapshot?.datasetId==='string'?snapshot.datasetId:null,entities:plainJson(snapshot)?snapshot:await recoveryGraph(snapshot)};
  const raw=canonical({...payload,checksum:await digest(payload)}),bytes=new TextEncoder().encode(raw);
  if(bytes.length<=MAX_BYTES)return [{name:`cash-weave-${snapshot.datasetId}.recovery.json`,text:raw}];
  return splitBackupFiles(raw,bytes,true,'INVALID_SNAPSHOT');
}
async function splitBackupFiles(raw,bytes,recoveryOnly,archiveReason) {
  const bundleId = await digest(raw), count = Math.ceil(bytes.length / PART_BYTES), files = [];
  if(count>MAX_ARCHIVE_PARTS)throw new Error('BACKUP_ARCHIVE_TOO_LARGE');
  for (let n=0;n<count;n++) {
    const dataBase64 = toBase64(bytes.subarray(n*PART_BYTES,(n+1)*PART_BYTES));
    const text = canonical({formatId:PART_FORMAT,partVersion:1,bundleId,index:n+1,count,totalBytes:bytes.length,recoveryOnly,archiveReason:recoveryOnly?archiveReason:null,chunkSha256:await digest(dataBase64),dataBase64});
    if (byteLength(text) > MAX_BYTES) throw new Error('BACKUP_PART_TOO_LARGE');
    files.push({name:`cash-weave-${bundleId.slice(0,12)}.part-${String(n+1).padStart(3,'0')}-of-${String(count).padStart(3,'0')}.json`,text});
  }
  return files;
}
export async function stageRestoreFiles(rawTexts, options = {}) {
  if(Array.isArray(rawTexts)&&rawTexts.length===1&&inspectBackup(rawTexts[0]).kind==='v3')return stageRestoreRaw(rawTexts[0],options,MAX_BYTES);
  if(Array.isArray(rawTexts)&&rawTexts.length){const inspected=inspectBackup(rawTexts[0]);if(inspected.recoveryOnly)throw new Error(inspected.archiveReason==='INVALID_SNAPSHOT'?'BACKUP_RECOVERY_ARCHIVE_READ_ONLY':'BACKUP_RECOVERY_ARCHIVE_EXCEEDS_RESTORE_LIMIT');}
  if (!Array.isArray(rawTexts) || rawTexts.length < 2 || rawTexts.length > MAX_BACKUP_PARTS) throw new Error('BACKUP_PARTS_INCOMPLETE');
  const parts = rawTexts.map(raw => { const parsed=parseJson(raw); if(parsed.formatId!==PART_FORMAT)throw new Error('INVALID_BACKUP_PART'); inspectPart(parsed);return parsed; });
  const first = parts[0], seen = new Set();
  for (const part of parts) {
    if (part.bundleId !== first.bundleId || part.count !== first.count || part.totalBytes !== first.totalBytes) throw new Error('BACKUP_PART_SET_MISMATCH');
    if (seen.has(part.index)) throw new Error('BACKUP_PART_DUPLICATE');
    seen.add(part.index);
  }
  if (parts.length !== first.count) throw new Error('BACKUP_PARTS_INCOMPLETE');
  const chunks = []; let actualBytes=0;
  for (const part of parts.sort((a,b)=>a.index-b.index)) {
    if (await digest(part.dataBase64) !== part.chunkSha256) throw new Error('BACKUP_PART_CHECKSUM_MISMATCH');
    const binary = atob(part.dataBase64), chunk = Uint8Array.from(binary,c=>c.charCodeAt(0));
    if (!chunk.length || chunk.length > PART_BYTES) throw new Error('INVALID_BACKUP_PART');
    actualBytes += chunk.length; if (actualBytes > first.totalBytes) throw new Error('BACKUP_PART_SIZE_MISMATCH'); chunks.push(chunk);
  }
  if (actualBytes !== first.totalBytes) throw new Error('BACKUP_PART_SIZE_MISMATCH');
  const bytes = new Uint8Array(actualBytes); let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let raw;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('INVALID_BACKUP_UTF8');}
  if (await digest(raw) !== first.bundleId) throw new Error('BACKUP_CHECKSUM_MISMATCH');
  return stageRestoreRaw(raw,options,MAX_PORTABLE_BACKUP_BYTES);
}
export async function stageRestore(raw, options = {}) { return stageRestoreRaw(raw,options,MAX_BYTES); }
export async function validateRecoveryRestoreStage(stage,namespace){
  const verified=await stageRestoreRaw(stage.rawBackup,{namespace},MAX_PORTABLE_BACKUP_BYTES),target=stage.snapshot?.datasetId;
  verified.snapshot.datasetId=target;verified.snapshot.profile.datasetId=target;
  for(const collection of COLLECTIONS)for(const entity of verified.snapshot[collection])entity.datasetId=target;
  if(canonical(verified.snapshot)!==canonical(stage.snapshot)||canonical(verified.report)!==canonical(stage.report))throw new Error('STAGE_SNAPSHOT_MISMATCH');
}
async function stageRestoreRaw(raw, { namespace = 'personal' } = {}, maxBytes) {
  const parsed = parseJson(raw,maxBytes);
  if (parsed.schemaVersion !== 3) throw new Error(parsed.schemaVersion > 3 ? 'FUTURE_SCHEMA_READ_ONLY' : 'RESTORE_SCHEMA_UNSUPPORTED');
  if (parsed.formatId !== 'mach-tien-export' || parsed.currencyTableVersion !== CURRENCY_TABLE_VERSION) throw new Error('INVALID_BACKUP_FORMAT');
  const { checksum,...payload } = parsed;
  if (await digest(payload) !== checksum) throw new Error('BACKUP_CHECKSUM_MISMATCH');
  validateSnapshot(parsed.entities);
  if (parsed.datasetId !== parsed.entities.datasetId) throw new Error('BACKUP_DATASET_MISMATCH');
  if (parsed.entities.namespace === 'sandbox' && namespace === 'personal') throw new Error('SANDBOX_IMPORT_REQUIRES_SEPARATE_NAMESPACE');
  const snapshot = clone(parsed.entities), datasetId = id();
  snapshot.datasetId = datasetId; snapshot.profile.datasetId = datasetId;
  for (const collection of COLLECTIONS) for (const entity of snapshot[collection]) entity.datasetId = datasetId;
  return { id:id(),sourceFingerprint:await digest(raw),backupDigest:await digest(raw),snapshot,activationAllowed:true,report:{ sourceDatasetId:parsed.entities.datasetId, accounts:parsed.entities.accounts.length,postings:parsed.entities.postings.length,operations:parsed.entities.operations.length,plans:parsed.entities.occurrences.length },createdAtUtc:new Date().toISOString(),rawBackup:raw };
}

export async function stageLegacyMigration(raw, { backupAcknowledged = false, namespace = 'personal', openingDates = {}, timezoneId = 'Asia/Ho_Chi_Minh', locale = 'vi-VN' } = {}) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('LEGACY_DATA_TOO_LARGE');
  const fingerprint = await digest(raw), stage = { id:id(),sourceFingerprint:fingerprint,backupDigest:fingerprint,rawBackup:raw,activationAllowed:false,blockers:[],quarantine:[],mapping:[],report:{},createdAtUtc:new Date().toISOString() };
  if (!backupAcknowledged) stage.blockers.push('EXPORT_OR_EXPLICIT_BACKUP_ACK_REQUIRED');
  let parsed, old;
  try { parsed = JSON.parse(raw); } catch { stage.blockers.push('CORRUPT_JSON'); stage.quarantine.push({ path:'$',reason:'CORRUPT_JSON',raw }); return stage; }
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)){stage.blockers.push('LEGACY_VALIDATION_FAILED');stage.quarantine.push({path:'$',reason:'LEGACY_ROOT_MUST_BE_OBJECT',record:parsed});return stage;}
  if (parsed.version > 2 || parsed.schemaVersion > 3) { stage.blockers.push('FUTURE_SCHEMA_READ_ONLY'); return stage; }
  let sourceVersion;
  try { const source=legacyPayload(parsed);old=source.state;sourceVersion=source.sourceVersion; } catch (error) { stage.blockers.push(error.message==='FUTURE_SCHEMA_READ_ONLY' ? error.message : 'LEGACY_VALIDATION_FAILED'); stage.quarantine.push({ path:'$',reason:error.message,record:clone(parsed) }); return stage; }
  if(Array.isArray(old.transactionCorrections)&&old.transactionCorrections.length)stage.blockers.push('LEGACY_TRANSACTION_CORRECTIONS_REQUIRES_COMPATIBILITY');
  if (old.accounts.some(a => a.type !== 'cash') || old.cards.length || old.assets.length || old.transactions.some(t => t.kind === 'investment')) stage.blockers.push('LEGACY_CREDIT_OR_INVESTMENT_REQUIRES_COMPATIBILITY_MAPPING');
  for (const account of old.accounts) {
    try { requireDate(openingDates[account.id]); } catch { stage.blockers.push(`OPENING_EFFECTIVE_DATE_REQUIRED:${account.id}`); }
    if (openingDates[account.id] && old.transactions.some(t => [t.accountId,t.fromAccountId,t.toAccountId].includes(account.id) && t.date < openingDates[account.id])) stage.blockers.push(`TRANSACTION_BEFORE_SELECTED_OPENING:${account.id}`);
  }
  if (stage.blockers.some(b => b !== 'EXPORT_OR_EXPLICIT_BACKUP_ACK_REQUIRED')) return stage;
  const state = createDataset({namespace,locale,timezoneId,currencyCode:'VND'}), now = stage.createdAtUtc;
  const add = (collection, fields) => { const result = record(state,fields,now); state[collection].push(result); return result; };
  const mapping = new Map(), map = (kind, originalId, newId) => { mapping.set(`${kind}:${originalId}`,newId); stage.mapping.push({ kind,originalId,newId }); return newId; }, get = (kind,originalId) => mapping.get(`${kind}:${originalId}`);
  const pool = add('budgetPools',{currencyCode:'VND',name:'VND'});
  for (const account of old.accounts) {
    const next = add('accounts',{name:account.name,type:'BANK',currencyCode:'VND',includeInBudget:true,budgetPoolId:pool.id,archivedAtUtc:null,legacyRecord:clone(account)}); map('account',account.id,next.id);
    const operation = add('operations',{operationType:'OPENING',commandId:`migration:${fingerprint}:opening:${account.id}`,effectiveLocalDate:openingDates[account.id],memo:'Legacy opening; effective date confirmed',committedAtUtc:now});
    const posting = add('postings',{operationId:operation.id,accountId:next.id,currencyCode:'VND',signedAmountMinor:String(account.openingBalance),reportingOrigin:'OPENING',effectiveLocalDate:openingDates[account.id],stableOrder:0});
    if (account.openingBalance > 0) add('fundingSources',{budgetPoolId:pool.id,sourcePostingId:posting.id,currencyCode:'VND',eligibleAmountMinor:posting.signedAmountMinor});
  }
  const categoryMap = new Map();
  for (const tx of old.transactions) {
    const type = tx.kind.toUpperCase(), operation = add('operations',{operationType:type,commandId:`migration:${fingerprint}:${tx.id}`,effectiveLocalDate:tx.date,memo:tx.note || tx.category || '',committedAtUtc:now,legacyRecord:clone(tx)}); map('operation',tx.id,operation.id);
    let categoryId = '';
    if (tx.category && ['INCOME','EXPENSE'].includes(type)) { const key = type + ':' + tx.category; if (!categoryMap.has(key)) categoryMap.set(key,add('categories',{name:tx.category,direction:type,archivedAtUtc:null}).id); categoryId = categoryMap.get(key); }
    const legs = type === 'TRANSFER' ? [{accountId:get('account',tx.fromAccountId),signedAmountMinor:String(-tx.amount)},{accountId:get('account',tx.toAccountId),signedAmountMinor:String(tx.amount)}] : [{accountId:get('account',tx.accountId),signedAmountMinor:String(type === 'INCOME' ? tx.amount : -tx.amount)}];
    legs.forEach((leg,stableOrder) => {
      const posting = add('postings',{...leg,operationId:operation.id,currencyCode:'VND',reportingOrigin:type,effectiveLocalDate:tx.date,stableOrder,...(categoryId ? {categoryId} : {})});
      if (type !== 'TRANSFER') map('posting',tx.id,posting.id);
      if (type === 'INCOME') map('source',tx.id,add('fundingSources',{budgetPoolId:pool.id,sourcePostingId:posting.id,currencyCode:'VND',eligibleAmountMinor:posting.signedAmountMinor}).id);
    });
  }
  for (const plan of old.plans) {
    if (plan.settledAmount) { stage.blockers.push(`LEGACY_SETTLEMENT_MAPPING_REQUIRED:${plan.id}`); continue; }
    const occurrence = add('occurrences',{title:plan.label,direction:plan.kind.toUpperCase(),currencyCode:'VND',dueLocalDate:plan.date,originalDueLocalDate:plan.date,expectedAmountMinor:String(plan.amount),expectedAccountId:get('account',plan.accountId),closure:'OPEN',closureHistory:[],legacyRecord:clone(plan)}); map('plan',plan.id,occurrence.id);
  }
  for (const fund of old.budgeting.funds) map('envelope',fund.id,add('envelopes',{name:fund.name,budgetPoolId:pool.id,currencyCode:'VND',archivedAtUtc:null,legacyAccountPlanId:fund.accountId || '',legacyRecord:clone(fund)}).id);
  for (const template of old.budgeting.templates) {
    stage.blockers.push(`LEGACY_TEMPLATE_ENVELOPE_MAPPING_REQUIRED:${template.id}`);
    const t = add('templates',{name:template.name,archivedAtUtc:null,currentVersionId:'',legacyRecord:clone(template)}); map('template',template.id,t.id);
    // Keep legacy rule snapshots verbatim; account hints never become transfers.
    const v = add('templateVersions',{templateId:t.id,versionNumber:1,currencyCode:'VND',calculationMode:'FIXED_THEN_REMAINDER',fixedScope:'PER_APPLICATION',shortagePolicy:'PARTIAL_BY_PRIORITY',leftoverPolicy:'UNASSIGNED',legacyRows:clone(template.rows),lines:[],migrationNeedsEnvelopeMapping:true}); t.currentVersionId = v.id;
  }
  for (const allocation of old.budgeting.allocations) {
    const sourceId = get('source',allocation.incomeId), total = allocation.lines.reduce((sum,line) => sum + BigInt(line.amount),0n);
    const app = add('allocationApplications',{commandId:`migration:${fingerprint}:allocation:${allocation.id}`,currencyCode:'VND',budgetPoolId:pool.id,allocationEffectiveLocalDate:allocation.date,templateId:get('template',allocation.templateId) || null,templateVersionSnapshotId:null,sourceConsumption:[{sourceId,signedAmountMinor:checked(total)}],fixedContributions:[],frozenInput:{legacyRuleSnapshot:allocation.ruleSnapshot == null ? null : clone(allocation.ruleSnapshot)},calculationVersion:'legacy-v2-preserved',cycleKey:'',applicationGroupId:id(),confirmedAtUtc:now,legacyRecord:clone(allocation)}); map('allocation',allocation.id,app.id);
    for (const line of allocation.lines) add('allocationEntries',{applicationId:app.id,envelopeId:get('envelope',line.fundId),signedAmountMinor:String(line.amount),sourceAttribution:[{sourceId,signedAmountMinor:String(line.amount)}]});
    add('allocationEntries',{applicationId:app.id,envelopeId:null,signedAmountMinor:checked(-total),sourceAttribution:[{sourceId,signedAmountMinor:checked(-total)}]});
  }
  for (const link of old.budgeting.expenseLinks) { const tx = old.transactions.find(t => t.id === link.transactionId); add('spendLinks',{expensePostingId:get('posting',link.transactionId),envelopeId:get('envelope',link.fundId),signedAmountMinor:String(tx.amount),effectiveLocalDate:tx.date,createdByCommandId:`migration:${fingerprint}:spend:${tx.id}`}); }
  state.profile.onboardingCompletedAtUtc = now; state.profile.revision = 1; state.revision = 1;
  const before = calculateBalances(old), accountReconciliation = old.accounts.map(a => ({originalId:a.id,beforeMinor:String(before.accounts[a.id]),afterMinor:accountBalance(state,get('account',a.id))}));
  stage.report = { accountsBefore:old.accounts.length,accountsAfter:state.accounts.length,transactionsBefore:old.transactions.length,operationsAfter:state.operations.length,postingsAfter:state.postings.length,accountReconciliation,plansBefore:old.plans.length,plansAfter:state.occurrences.length,allocationsBefore:old.budgeting.allocations.length,allocationsAfter:state.allocationApplications.length,pool:poolSummary(state,pool.id),legacyJournalPreservedInRawBackup:true };
  if (accountReconciliation.some(a => a.beforeMinor !== a.afterMinor)) stage.blockers.push('ACCOUNT_TOTAL_RECONCILIATION_FAILED');
  add('migrations',{fromVersion:sourceVersion,toVersion:3,sourceFingerprint:fingerprint,backupDigest:fingerprint,validationReport:clone(stage.report),committedAtUtc:null,legacyKey:'financial-assistant-prototype-v1'});
  // Records created before revision is set have revision 1; migration record uses current revision.
  state.migrations.at(-1).revision = state.revision;
  try { validateSnapshot(state); } catch (error) { stage.blockers.push('MIGRATED_INVARIANT_FAILED'); stage.quarantine.push({path:'$',reason:error.message,record:clone(parsed)}); }
  stage.snapshot = state; stage.activationAllowed = stage.blockers.length === 0;
  return stage;
}

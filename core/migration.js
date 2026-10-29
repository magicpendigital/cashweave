import { clone, digest, id, canonical } from './identity.js';
import { createDataset, record, validateSnapshot, accountBalance, poolSummary, COLLECTIONS, withOptionalCollections } from './model.js';
import { minor, checked, money, CURRENCY_TABLE_VERSION } from './money.js';
import { requireDate } from './calendar.js';
import { normalizeState } from '../state-schema.js';
import { calculateBalances } from '../ledger.js';

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024; // Matches mobile/backup-bridge.js and LocalBackupPlugin.MAX_BYTES.
const MAX_BYTES = MAX_BACKUP_BYTES;
export async function exportSnapshot(snapshot) {
  validateSnapshot(snapshot);
  const payload = { formatId:'mach-tien-export',schemaVersion:3,appVersion:'next-mvp-checkpoint-1',exportedAtUtc:new Date().toISOString(),datasetId:snapshot.datasetId,currencyTableVersion:CURRENCY_TABLE_VERSION,entities:clone(snapshot) };
  const result = canonical({ ...payload,checksum:await digest(payload) });
  if (new TextEncoder().encode(result).length > MAX_BYTES) throw new Error('BACKUP_TOO_LARGE');
  return result;
}
export async function stageRestore(raw, { namespace = 'personal' } = {}) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('BACKUP_TOO_LARGE');
  let parsed; try { parsed = JSON.parse(raw); } catch { throw new Error('INVALID_BACKUP_JSON'); }
  if (parsed.schemaVersion !== 3) throw new Error(parsed.schemaVersion > 3 ? 'FUTURE_SCHEMA_READ_ONLY' : 'RESTORE_SCHEMA_UNSUPPORTED');
  if (parsed.formatId !== 'mach-tien-export' || parsed.currencyTableVersion !== CURRENCY_TABLE_VERSION) throw new Error('INVALID_BACKUP_FORMAT');
  const { checksum,...payload } = parsed;
  if (await digest(payload) !== checksum) throw new Error('BACKUP_CHECKSUM_MISMATCH');
  validateSnapshot(parsed.entities);
  if (parsed.datasetId !== parsed.entities.datasetId) throw new Error('BACKUP_DATASET_MISMATCH');
  if (parsed.entities.namespace === 'sandbox' && namespace === 'personal') throw new Error('SANDBOX_IMPORT_REQUIRES_SEPARATE_NAMESPACE');
  const snapshot = clone(parsed.entities), datasetId = id();
  withOptionalCollections(snapshot); // Pre-valuation backups restore with empty collections.
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
  try { old = normalizeState(parsed); } catch (error) { stage.blockers.push('LEGACY_VALIDATION_FAILED'); stage.quarantine.push({ path:'$',reason:error.message,record:clone(parsed) }); return stage; }
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
  add('migrations',{fromVersion:parsed.version,toVersion:3,sourceFingerprint:fingerprint,backupDigest:fingerprint,validationReport:clone(stage.report),committedAtUtc:null,legacyKey:'financial-assistant-prototype-v1'});
  // Records created before revision is set have revision 1; migration record uses current revision.
  state.migrations.at(-1).revision = state.revision;
  try { validateSnapshot(state); } catch (error) { stage.blockers.push('MIGRATED_INVARIANT_FAILED'); stage.quarantine.push({path:'$',reason:error.message,record:clone(parsed)}); }
  stage.snapshot = state; stage.activationAllowed = stage.blockers.length === 0;
  return stage;
}

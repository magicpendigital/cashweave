import { id, clone,canonical } from './identity.js';
import { money, minor, checked, sum, CURRENCY_TABLE_VERSION } from './money.js';
import { requireTimezone, requireDate,monthlyDate } from './calendar.js';
function requireUtc(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||Number.isNaN(Date.parse(value)))throw new Error('INVALID_UTC_METADATA');requireDate(value.slice(0,10));}

export const COLLECTIONS = Object.freeze(['accounts', 'categories', 'budgetPools', 'envelopes', 'operations', 'postings', 'planSeries', 'planRevisions', 'occurrences', 'planExceptions', 'settlements', 'templates', 'templateVersions', 'fundingSources', 'allocationApplications', 'allocationEntries', 'allocationCycles', 'spendLinks', 'receipts', 'audit', 'migrations']);
export function createDataset({ namespace = 'personal', locale = 'vi-VN', timezoneId = 'Asia/Ho_Chi_Minh', currencyCode = 'VND' } = {}) {
  if (!['personal', 'sandbox', 'staging'].includes(namespace)) throw new Error('INVALID_NAMESPACE');
  money(currencyCode, '0'); requireTimezone(timezoneId); new Intl.NumberFormat(locale).format(0);
  const datasetId = id(), now = new Date().toISOString();
  return { schemaVersion: 3, datasetId, namespace, revision: 0, currencyTableVersion: CURRENCY_TABLE_VERSION,
    profile: { id: id(), datasetId, createdAtUtc: now, updatedAtUtc: now, revision: 0, locale, timezoneId, defaultCurrencyCode: currencyCode, schemaVersion: 3, onboardingCompletedAtUtc: null },
    ...Object.fromEntries(COLLECTIONS.map(key => [key, []])) };
}
export function record(state, fields, now, recordId = id()) {
  return { ...fields, id: recordId, datasetId: state.datasetId, createdAtUtc: now, updatedAtUtc: now, revision: state.revision + 1 };
}
export function entity(state, collection, entityId) {
  const result = state[collection].find(item => item.id === entityId);
  if (!result) throw new Error(`UNKNOWN_${collection.toUpperCase()}`);
  return result;
}
export function accountBalance(state, accountId, endExclusive = '9999-12-31') {
  entity(state, 'accounts', accountId);
  return sum(state.postings.filter(p => p.accountId === accountId && p.effectiveLocalDate < endExclusive).map(p => p.signedAmountMinor));
}
export function envelopeBalance(state, envelopeId, endExclusive = '9999-12-31') {
  entity(state, 'envelopes', envelopeId);
  const allocated = state.allocationEntries.filter(e => e.envelopeId === envelopeId && entity(state, 'allocationApplications', e.applicationId).allocationEffectiveLocalDate < endExclusive).map(e => e.signedAmountMinor);
  const spent = state.spendLinks.filter(e => e.envelopeId === envelopeId && e.effectiveLocalDate < endExclusive).map(e => checked(-minor(e.signedAmountMinor)));
  return sum([...allocated, ...spent]);
}
export function poolSummary(state, poolId, endExclusive = '9999-12-31') {
  const pool = entity(state, 'budgetPools', poolId);
  const poolCash = sum(state.accounts.filter(a => a.budgetPoolId === poolId && a.includeInBudget).map(a => accountBalance(state, a.id, endExclusive)));
  const envelopeAvailable = sum(state.envelopes.filter(e => e.budgetPoolId === poolId).map(e => envelopeBalance(state, e.id, endExclusive)));
  return { currencyCode: pool.currencyCode, poolCash, envelopeAvailable, unassigned: checked(minor(poolCash) - minor(envelopeAvailable)) };
}
export function sourceCapacity(state, sourceId, cutoffExclusive = '9999-12-31') {
  const source = entity(state, 'fundingSources', sourceId), posting = entity(state, 'postings', source.sourcePostingId);
  const unavailable = posting.effectiveLocalDate >= cutoffExclusive || state.postings.some(p => p.reversesPostingId === posting.id && p.effectiveLocalDate < cutoffExclusive);
  const consumed = state.allocationApplications.filter(app=>app.allocationEffectiveLocalDate<cutoffExclusive).reduce((total, app) => total + app.sourceConsumption.filter(c => c.sourceId === sourceId).reduce((n, c) => n + minor(c.signedAmountMinor), 0n), 0n);
  return { eligible: unavailable ? '0' : source.eligibleAmountMinor, consumed: checked(consumed), remaining: checked((unavailable ? 0n : minor(source.eligibleAmountMinor)) - consumed) };
}
function assertChronologicalCapacity(events, capacityAtDate, code) {
  const daily=new Map();
  for(const event of events)daily.set(event.date,(daily.get(event.date)||0n)+minor(event.amountMinor));
  let net=0n;
  for(const date of [...daily.keys()].sort()){net+=daily.get(date);if(net<0n||net>capacityAtDate(date))throw new Error(code);}
}
export function planSummary(state, occurrenceId, cutoffExclusive = '9999-12-31') {
  const occurrence = entity(state, 'occurrences', occurrenceId);
  const netSettled = sum(state.settlements.filter(s => s.planOccurrenceId === occurrenceId && s.effectiveLocalDate < cutoffExclusive).map(s => s.signedAmountMinor));
  const history = (occurrence.closureHistory || []).filter(h => h.effectiveLocalDate < cutoffExclusive).sort((a, b) => a.effectiveLocalDate.localeCompare(b.effectiveLocalDate) || a.atUtc.localeCompare(b.atUtc));
  const closure = history.length ? history.at(-1).closure : 'OPEN';
  const finalized = closure !== 'OPEN';
  const remainder = minor(occurrence.expectedAmountMinor) - minor(netSettled);
  return { ...clone(occurrence), closure, netSettled, openRemaining: finalized || remainder < 0n ? '0' : checked(remainder), variance: checked(minor(netSettled) - minor(occurrence.expectedAmountMinor)) };
}
export function validateSnapshot(state) {
  canonical(state); // Exportability is part of validity; undefined/function/BigInt fields cannot activate.
  if (state?.schemaVersion !== 3 || !Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error('INVALID_SCHEMA');
  money(state.profile.defaultCurrencyCode, '0'); requireTimezone(state.profile.timezoneId); new Intl.NumberFormat(state.profile.locale).format(0);
  if (!['personal', 'sandbox', 'staging'].includes(state.namespace) || state.profile.datasetId !== state.datasetId) throw new Error('INVALID_DATASET');
  requireUtc(state.profile.createdAtUtc);requireUtc(state.profile.updatedAtUtc);if(state.profile.onboardingCompletedAtUtc)requireUtc(state.profile.onboardingCompletedAtUtc);
  const allIds = new Set();
  for (const collection of COLLECTIONS) {
    if (!Array.isArray(state[collection]) || state[collection].length > 100000) throw new Error('INVALID_COLLECTION');
    for (const item of state[collection]) {
      if (typeof item.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id) || allIds.has(item.id) || item.datasetId !== state.datasetId) throw new Error('INVALID_RECORD_ID');
      allIds.add(item.id);
      requireUtc(item.createdAtUtc);requireUtc(item.updatedAtUtc);
      if (!Number.isSafeInteger(item.revision) || item.revision > state.revision || item.revision < 0) throw new Error('INVALID_RECORD_REVISION');
    }
  }
  for (const account of state.accounts) {
    money(account.currencyCode, '0');
    if (!['CASH', 'BANK'].includes(account.type) || !account.name?.trim()) throw new Error('INVALID_ACCOUNT');
    if (account.budgetPoolId && entity(state, 'budgetPools', account.budgetPoolId).currencyCode !== account.currencyCode) throw new Error('POOL_CURRENCY_MISMATCH');
    if(typeof account.includeInBudget!=='boolean'||account.includeInBudget&&!account.budgetPoolId)throw new Error('INVALID_ACCOUNT_BUDGET_MEMBERSHIP');
  }
  for (const envelope of state.envelopes) if (entity(state, 'budgetPools', envelope.budgetPoolId).currencyCode !== envelope.currencyCode) throw new Error('ENVELOPE_CURRENCY_MISMATCH');
  for (const pool of state.budgetPools) money(pool.currencyCode,'0');
  for (const category of state.categories) if (!['INCOME','EXPENSE'].includes(category.direction) || !category.name?.trim()) throw new Error('INVALID_CATEGORY');
  const commandIds = new Set(), reversedOperations = new Set(), reversedPostings = new Set();
  for (const operation of state.operations) {
    if (!['INCOME','EXPENSE','TRANSFER','OPENING','ADJUSTMENT','REVERSAL'].includes(operation.operationType)) throw new Error('INVALID_OPERATION_TYPE');
    requireDate(operation.effectiveLocalDate);
    const legs = state.postings.filter(p => p.operationId === operation.id);
    if (!legs.length) throw new Error('OPERATION_WITHOUT_POSTINGS');
    if (operation.operationType === 'TRANSFER' && (legs.length !== 2 || legs[0].currencyCode !== legs[1].currencyCode || legs[0].accountId === legs[1].accountId || sum(legs.map(p => p.signedAmountMinor)) !== '0')) throw new Error('UNBALANCED_TRANSFER');
    if (operation.operationType !== 'TRANSFER' && operation.operationType !== 'REVERSAL' && legs.length !== 1) throw new Error('INVALID_POSTING_COUNT');
    if (operation.operationType !== 'REVERSAL' && legs.some(p => p.reportingOrigin !== operation.operationType)) throw new Error('OPERATION_ORIGIN_MISMATCH');
    if (operation.operationType === 'REVERSAL') {
      const original = entity(state, 'operations', operation.reversalOfOperationId);
      if (original.operationType === 'REVERSAL' || reversedOperations.has(original.id)) throw new Error('DUPLICATE_REVERSAL');
      reversedOperations.add(original.id);
      const originals = state.postings.filter(p => p.operationId === original.id);
      if (originals.length !== legs.length || legs.some(p => !originals.some(o => p.reversesPostingId === o.id && p.accountId === o.accountId && p.signedAmountMinor === checked(-minor(o.signedAmountMinor)) && p.reportingOrigin === o.reportingOrigin))) throw new Error('INVALID_REVERSAL');
    }
  }
  for (const posting of state.postings) {
    const account = entity(state, 'accounts', posting.accountId), operation = entity(state, 'operations', posting.operationId);
    money(posting.currencyCode, posting.signedAmountMinor); requireDate(posting.effectiveLocalDate);
    if (account.currencyCode !== posting.currencyCode || operation.effectiveLocalDate !== posting.effectiveLocalDate) throw new Error('POSTING_MISMATCH');
    if (!['INCOME','EXPENSE','TRANSFER','OPENING','ADJUSTMENT'].includes(posting.reportingOrigin)) throw new Error('INVALID_REPORTING_ORIGIN');
    if (posting.categoryId && entity(state, 'categories', posting.categoryId).direction !== posting.reportingOrigin) throw new Error('CATEGORY_DIRECTION_MISMATCH');
    if (posting.reversesPostingId) { entity(state, 'postings', posting.reversesPostingId); if (reversedPostings.has(posting.reversesPostingId)) throw new Error('DUPLICATE_REVERSAL'); reversedPostings.add(posting.reversesPostingId); }
    else if ((posting.reportingOrigin === 'INCOME' && minor(posting.signedAmountMinor) <= 0n) || (posting.reportingOrigin === 'EXPENSE' && minor(posting.signedAmountMinor) >= 0n)) throw new Error('POSTING_SIGN_MISMATCH');
  }
  for (const receipt of state.receipts) { if (commandIds.has(receipt.commandId) || !/^[0-9a-f]{64}$/.test(receipt.payloadHash) || receipt.committedRevision > state.revision) throw new Error('DUPLICATE_COMMAND'); commandIds.add(receipt.commandId); }
  const occurrenceKeys = new Set();
  for (const occurrence of state.occurrences) {
    money(occurrence.currencyCode, occurrence.expectedAmountMinor); requireDate(occurrence.dueLocalDate); requireDate(occurrence.originalDueLocalDate);
    if (minor(occurrence.expectedAmountMinor) <= 0n || !['INCOME','EXPENSE'].includes(occurrence.direction) || !['OPEN','FINALIZED','CANCELLED'].includes(occurrence.closure)) throw new Error('INVALID_PLAN');
    if (occurrence.seriesId) { entity(state, 'planSeries', occurrence.seriesId); const key = occurrence.seriesId + ':' + occurrence.occurrenceKey; if (occurrenceKeys.has(key)) throw new Error('DUPLICATE_OCCURRENCE'); occurrenceKeys.add(key); }
    if(occurrence.expectedAccountId&&entity(state,'accounts',occurrence.expectedAccountId).currencyCode!==occurrence.currencyCode)throw new Error('PLAN_ACCOUNT_CURRENCY_MISMATCH');
    if(occurrence.revisionSnapshotId&&entity(state,'planRevisions',occurrence.revisionSnapshotId).seriesId!==occurrence.seriesId)throw new Error('PLAN_REVISION_REFERENCE_MISMATCH');
    if(!Array.isArray(occurrence.closureHistory))throw new Error('INVALID_CLOSURE_HISTORY');
    for(const event of occurrence.closureHistory){requireDate(event.effectiveLocalDate);requireUtc(event.atUtc);if(!['OPEN','FINALIZED','CANCELLED'].includes(event.closure))throw new Error('INVALID_CLOSURE_HISTORY');}
    if(occurrence.closureHistory.length){const last=occurrence.closureHistory.at(-1);if(last.closure!==occurrence.closure||last.effectiveLocalDate!==occurrence.closureEffectiveLocalDate)throw new Error('CLOSURE_STATE_MISMATCH');}
    else if(occurrence.closure!=='OPEN'||occurrence.closureEffectiveLocalDate)throw new Error('CLOSURE_STATE_MISMATCH');
  }
  for(const series of state.planSeries){money(series.currencyCode,'0');requireDate(series.anchorLocalDate);requireDate(series.activeFromDate);if(series.untilDate)requireDate(series.untilDate);requireTimezone(series.timezoneId);monthlyDate(series.activeFromDate.slice(0,7),series.monthDay);if(series.recurrence!=='MONTHLY'||series.interval!==1||!['INCOME','EXPENSE'].includes(series.direction))throw new Error('INVALID_PLAN_SERIES');if(series.defaultAccountId&&entity(state,'accounts',series.defaultAccountId).currencyCode!==series.currencyCode)throw new Error('PLAN_ACCOUNT_CURRENCY_MISMATCH');}
  for(const revision of state.planRevisions){const series=entity(state,'planSeries',revision.seriesId);monthlyDate(revision.validFromOccurrenceKey,series.monthDay);if(minor(revision.amountMinor)<=0n)throw new Error('INVALID_PLAN_REVISION_AMOUNT');}
  for(const exception of state.planExceptions){const occurrence=entity(state,'occurrences',exception.occurrenceId);if(exception.seriesId&&entity(state,'planSeries',exception.seriesId).id!==occurrence.seriesId)throw new Error('INVALID_PLAN_EXCEPTION_REFERENCE');if(exception.kind==='RESCHEDULE')requireDate(exception.dueLocalDate);else if(exception.kind==='OVERRIDE'){if(minor(exception.amountMinor)<=0n)throw new Error('INVALID_PLAN_OVERRIDE');}else if(exception.kind!=='SKIP')throw new Error('INVALID_PLAN_EXCEPTION');}
  for (const link of state.settlements) {
    const occurrence = entity(state, 'occurrences', link.planOccurrenceId), posting = entity(state, 'postings', link.ledgerPostingId);
    requireDate(link.effectiveLocalDate); minor(link.signedAmountMinor);
    if (posting.reversesPostingId || occurrence.direction !== posting.reportingOrigin || occurrence.currencyCode !== posting.currencyCode || link.currencyCode !== posting.currencyCode || link.effectiveLocalDate < posting.effectiveLocalDate) throw new Error('INVALID_SETTLEMENT');
    if (link.reversalOfLinkId) { const original = entity(state, 'settlements', link.reversalOfLinkId); if (original.reversalOfLinkId || original.ledgerPostingId !== link.ledgerPostingId || original.planOccurrenceId !== link.planOccurrenceId || link.signedAmountMinor !== checked(-minor(original.signedAmountMinor))) throw new Error('INVALID_LINK_REVERSAL'); }
    else if (minor(link.signedAmountMinor) <= 0n) throw new Error('INVALID_SETTLEMENT_AMOUNT');
  }
  for (const collection of ['settlements','spendLinks']) {
    const reversed = new Set();
    for (const link of state[collection]) if (link.reversalOfLinkId) {
      const original = entity(state,collection,link.reversalOfLinkId);
      if (original.reversalOfLinkId || reversed.has(original.id) || link.signedAmountMinor !== checked(-minor(original.signedAmountMinor)) || link.effectiveLocalDate < original.effectiveLocalDate) throw new Error('INVALID_LINK_REVERSAL');
      if (collection === 'spendLinks' && (link.expensePostingId !== original.expensePostingId || link.envelopeId !== original.envelopeId)) throw new Error('INVALID_LINK_REVERSAL');
      reversed.add(original.id);
    }
  }
  for (const posting of state.postings) {
    const linked = BigInt(sum(state.settlements.filter(s => s.ledgerPostingId === posting.id).map(s => s.signedAmountMinor)));
    const magnitude = minor(posting.signedAmountMinor) < 0n ? -minor(posting.signedAmountMinor) : minor(posting.signedAmountMinor);
    if (linked < 0n || linked > magnitude || (reversedPostings.has(posting.id) && linked !== 0n)) throw new Error('SETTLEMENT_CAPACITY_EXCEEDED');
    const reversing=state.postings.find(p=>p.reversesPostingId===posting.id);
    const events=state.settlements.filter(s=>s.ledgerPostingId===posting.id).map(s=>({date:s.effectiveLocalDate,amountMinor:s.signedAmountMinor}));
    if(reversing)events.push({date:reversing.effectiveLocalDate,amountMinor:'0'});
    assertChronologicalCapacity(events,date=>date<posting.effectiveLocalDate||reversing&&date>=reversing.effectiveLocalDate?0n:magnitude,'SETTLEMENT_HISTORICAL_CAPACITY_EXCEEDED');
  }
  for (const source of state.fundingSources) {
    const posting = entity(state, 'postings', source.sourcePostingId), pool = entity(state, 'budgetPools', source.budgetPoolId);
    if (!['INCOME','OPENING'].includes(posting.reportingOrigin) || posting.reversesPostingId || posting.currencyCode !== source.currencyCode || pool.currencyCode !== source.currencyCode || minor(source.eligibleAmountMinor) <= 0n || minor(source.eligibleAmountMinor) > minor(posting.signedAmountMinor)) throw new Error('INVALID_FUNDING_SOURCE');
    if(entity(state,'accounts',posting.accountId).budgetPoolId!==pool.id||!entity(state,'accounts',posting.accountId).includeInBudget||state.fundingSources.filter(s=>s.sourcePostingId===posting.id).length!==1)throw new Error('INVALID_FUNDING_SOURCE_MEMBERSHIP');
    const capacity = sourceCapacity(state, source.id); if (minor(capacity.consumed) < 0n || minor(capacity.remaining) < 0n) throw new Error('SOURCE_CAPACITY_EXCEEDED');
    const reversing=state.postings.find(p=>p.reversesPostingId===posting.id);
    const events=state.allocationApplications.flatMap(app=>app.sourceConsumption.filter(c=>c.sourceId===source.id).map(c=>({date:app.allocationEffectiveLocalDate,amountMinor:c.signedAmountMinor})));
    if(reversing)events.push({date:reversing.effectiveLocalDate,amountMinor:'0'});
    assertChronologicalCapacity(events,date=>date<posting.effectiveLocalDate||reversing&&date>=reversing.effectiveLocalDate?0n:minor(source.eligibleAmountMinor),'SOURCE_HISTORICAL_CAPACITY_EXCEEDED');
  }
  for (const app of state.allocationApplications) {
    const entries = state.allocationEntries.filter(e => e.applicationId === app.id);
    if (!entries.length || sum(entries.map(e => e.signedAmountMinor)) !== '0') throw new Error('UNBALANCED_ALLOCATION');
    requireDate(app.allocationEffectiveLocalDate);
    const consumed = sum(app.sourceConsumption.map(c => { const s = entity(state, 'fundingSources', c.sourceId); if (s.budgetPoolId !== app.budgetPoolId || s.currencyCode !== app.currencyCode) throw new Error('SOURCE_POOL_MISMATCH'); return c.signedAmountMinor; }));
    const assigned = sum(entries.filter(e => e.envelopeId).map(e => e.signedAmountMinor));
    if (consumed !== assigned) throw new Error('ALLOCATION_CONSUMPTION_MISMATCH');
    if (entity(state,'budgetPools',app.budgetPoolId).currencyCode !== app.currencyCode) throw new Error('ALLOCATION_POOL_MISMATCH');
    if(app.templateId)entity(state,'templates',app.templateId);
    if(app.templateVersionSnapshotId){
      const version=entity(state,'templateVersions',app.templateVersionSnapshotId),frozen=app.frozenInput?.templateVersion;
      // Restore rebases entity dataset ownership, while the historical frozen input keeps its provenance.
      const content=value=>{const {datasetId,...rest}=value;return rest;};
      if(version.templateId!==app.templateId||!frozen||canonical(content(frozen))!==canonical(content(version)))throw new Error('ALLOCATION_TEMPLATE_REFERENCE_MISMATCH');
    }
    for (const entry of entries) {
      if (entry.envelopeId && entity(state, 'envelopes', entry.envelopeId).budgetPoolId !== app.budgetPoolId) throw new Error('ALLOCATION_POOL_MISMATCH');
      if (sum(entry.sourceAttribution.map(c => c.signedAmountMinor)) !== entry.signedAmountMinor) throw new Error('SOURCE_ATTRIBUTION_MISMATCH');
      for (const attribution of entry.sourceAttribution) if (!app.sourceConsumption.some(c => c.sourceId === attribution.sourceId)) throw new Error('UNKNOWN_ATTRIBUTION_SOURCE');
      if (!app.reversalOfApplicationId && entry.envelopeId && minor(entry.signedAmountMinor) < 0n) throw new Error('ALLOCATION_SIGN_MISMATCH');
    }
    if (!app.reversalOfApplicationId && app.sourceConsumption.some(c => minor(c.signedAmountMinor) < 0n)) throw new Error('ALLOCATION_CONSUMPTION_SIGN');
  }
  for(const entry of state.allocationEntries){const app=entity(state,'allocationApplications',entry.applicationId);minor(entry.signedAmountMinor);if(entry.envelopeId){const envelope=entity(state,'envelopes',entry.envelopeId);if(envelope.budgetPoolId!==app.budgetPoolId||envelope.currencyCode!==app.currencyCode)throw new Error('ALLOCATION_ENTRY_CURRENCY_MISMATCH');}}
  for(const cycle of state.allocationCycles){entity(state,'templates',cycle.templateId);if(entity(state,'budgetPools',cycle.budgetPoolId).currencyCode!==cycle.currencyCode||cycle.scope!=='CALENDAR_MONTH')throw new Error('INVALID_ALLOCATION_CYCLE');monthlyDate(cycle.cycleKey,1);for(const target of cycle.targetSnapshot){if(target.type!=='FIXED'||minor(target.fixedAmountMinor)<0n)throw new Error('INVALID_CYCLE_TARGET');entity(state,'envelopes',target.envelopeId);}}
  const reversedApps = new Set();
  for (const app of state.allocationApplications) if (app.reversalOfApplicationId) {
    const original = entity(state,'allocationApplications',app.reversalOfApplicationId);
    if (original.reversalOfApplicationId || reversedApps.has(original.id) || original.budgetPoolId !== app.budgetPoolId || app.sourceConsumption.length !== original.sourceConsumption.length || app.sourceConsumption.some(c => !original.sourceConsumption.some(o => o.sourceId === c.sourceId && c.signedAmountMinor === checked(-minor(o.signedAmountMinor))))) throw new Error('INVALID_ALLOCATION_REVERSAL');
    reversedApps.add(original.id);
  }
  const fixedNet=new Map(),groupSnapshots=new Map();
  for(const app of [...state.allocationApplications].sort((a,b)=>a.allocationEffectiveLocalDate.localeCompare(b.allocationEffectiveLocalDate)||a.revision-b.revision||a.id.localeCompare(b.id))){
    if(!app.frozenInput?.templateVersion)continue; // Legacy records retain their original accounting without invented rules.
    const version=app.frozenInput.templateVersion;
    let frozen=version;
    if(version.fixedScope==='PER_APPLICATION'){
      if(!groupSnapshots.has(app.applicationGroupId)&&!app.reversalOfApplicationId)groupSnapshots.set(app.applicationGroupId,version);
      frozen=groupSnapshots.get(app.applicationGroupId);
      if(!frozen||frozen.templateId!==app.templateId)throw new Error('INVALID_CONTINUATION_GROUP');
    }
    for(const contribution of app.fixedContributions){
      const line=frozen.lines.find(l=>l.type==='FIXED'&&l.stableLineKey===contribution.stableLineKey);
      if(!line)throw new Error('INVALID_FIXED_CONTRIBUTION');
      const key=app.templateId+':'+app.cycleKey+':'+contribution.stableLineKey,previous=fixedNet.get(key)||0n,amount=minor(contribution.signedAmountMinor),target=minor(line.fixedAmountMinor);
      if(amount>0n&&amount>(target>previous?target-previous:0n)||previous+amount<0n)throw new Error('FIXED_HISTORICAL_TARGET_EXCEEDED');
      fixedNet.set(key,previous+amount);
    }
  }
  for (const template of state.templates) if (entity(state,'templateVersions',template.currentVersionId).templateId !== template.id) throw new Error('INVALID_TEMPLATE_REFERENCE');
  const versionKeys = new Set();
  for (const version of state.templateVersions) {
    entity(state,'templates',version.templateId); money(version.currencyCode,'0');
    const key = version.templateId + ':' + version.versionNumber;
    if (versionKeys.has(key) || !Number.isSafeInteger(version.versionNumber) || version.versionNumber < 1 || !['PER_APPLICATION','CALENDAR_MONTH'].includes(version.fixedScope)) throw new Error('INVALID_TEMPLATE_VERSION');
    versionKeys.add(key);
    if (version.migrationNeedsEnvelopeMapping) continue;
    if (!Array.isArray(version.lines) || !version.lines.length || !['BLOCK','PARTIAL_BY_PRIORITY'].includes(version.shortagePolicy) || !['UNASSIGNED','ENVELOPE'].includes(version.leftoverPolicy)) throw new Error('INVALID_TEMPLATE_VERSION');
    let bps = 0; const keys = new Set();
    for (const line of version.lines) {
      if (entity(state,'envelopes',line.envelopeId).currencyCode !== version.currencyCode || keys.has(line.stableLineKey) || !line.stableLineKey || !Number.isSafeInteger(line.priority)) throw new Error('INVALID_TEMPLATE_LINE'); keys.add(line.stableLineKey);
      if (line.type === 'FIXED') { if (minor(line.fixedAmountMinor) < 0n || line.percentageBps !== undefined) throw new Error('INVALID_FIXED_LINE'); }
      else if (line.type === 'PERCENT') { if (!Number.isInteger(line.percentageBps) || line.percentageBps < 0 || line.percentageBps > 10000 || line.fixedAmountMinor !== undefined) throw new Error('INVALID_PERCENT_LINE'); bps += line.percentageBps; }
      else throw new Error('INVALID_TEMPLATE_LINE');
    }
    if (bps > 10000) throw new Error('PERCENT_OVER_100');
    if (version.leftoverPolicy === 'ENVELOPE' && entity(state,'envelopes',version.leftoverEnvelopeId).currencyCode !== version.currencyCode) throw new Error('INVALID_LEFTOVER_ENVELOPE');
  }
  for (const link of state.spendLinks) {
    const posting = entity(state, 'postings', link.expensePostingId), envelope = entity(state, 'envelopes', link.envelopeId);
    if (posting.reportingOrigin !== 'EXPENSE' || posting.reversesPostingId || posting.currencyCode !== envelope.currencyCode) throw new Error('INVALID_SPEND_LINK');
    const account=entity(state,'accounts',posting.accountId);if(!account.includeInBudget||account.budgetPoolId!==envelope.budgetPoolId)throw new Error('OFF_BUDGET_SPEND_LINK_BLOCKED');
    requireDate(link.effectiveLocalDate); minor(link.signedAmountMinor);
    if (!link.reversalOfLinkId && minor(link.signedAmountMinor) <= 0n || link.effectiveLocalDate < posting.effectiveLocalDate) throw new Error('INVALID_SPEND_LINK_AMOUNT');
  }
  for (const posting of state.postings) {
    const assigned = BigInt(sum(state.spendLinks.filter(s => s.expensePostingId === posting.id).map(s => s.signedAmountMinor)));
    if (assigned < 0n || assigned > -minor(posting.signedAmountMinor) && posting.reportingOrigin === 'EXPENSE') throw new Error('SPEND_CAPACITY_EXCEEDED');
    if(posting.reportingOrigin==='EXPENSE'){
      const reversing=state.postings.find(p=>p.reversesPostingId===posting.id),events=state.spendLinks.filter(s=>s.expensePostingId===posting.id).map(s=>({date:s.effectiveLocalDate,amountMinor:s.signedAmountMinor}));
      if(reversing)events.push({date:reversing.effectiveLocalDate,amountMinor:'0'});
      assertChronologicalCapacity(events,date=>date<posting.effectiveLocalDate||reversing&&date>=reversing.effectiveLocalDate?0n:-minor(posting.signedAmountMinor),'SPEND_HISTORICAL_CAPACITY_EXCEEDED');
    }
  }
  return state;
}

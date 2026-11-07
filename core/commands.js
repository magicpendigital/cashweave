import { clone, digest, id } from './identity.js';
import { money, minor, positive, checked } from './money.js';
import { requireDate, requireTimezone, todayInTimezone, monthlyDate } from './calendar.js';
import { record, entity, validateSnapshot, sourceCapacity, poolSummary, envelopeBalance, planSummary, requireLocale, openingBalanceSummary } from './model.js';
import { previewAllocationV3, calculateAllocation } from './allocation.js';

const name = value => { if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error('INVALID_NAME'); return value.trim(); };
function writableAccount(state, accountId) { const account = entity(state, 'accounts', accountId); if (account.archivedAtUtc) throw new Error('ACCOUNT_ARCHIVED'); return account; }
function appendOperation(state, input, commandId, now) {
  const date = requireDate(input.effectiveLocalDate);
  if (date > todayInTimezone(state.profile.timezoneId, new Date(now))) throw new Error('ACTUAL_DATE_IN_FUTURE');
  const operation = record(state, { operationType: input.operationType, commandId, effectiveLocalDate: date, memo: String(input.memo || '').slice(0, 2000), committedAtUtc: now, ...(input.reversalOfOperationId ? { reversalOfOperationId: input.reversalOfOperationId } : {}), ...(input.replacementForOperationId ? { replacementForOperationId: input.replacementForOperationId } : {}), ...(input.adjustmentForOperationId ? { adjustmentForOperationId: input.adjustmentForOperationId } : {}), reason: String(input.reason || '').slice(0, 500) }, now);
  const legs = input.legs.map((leg, stableOrder) => {
    const account = writableAccount(state, leg.accountId); money(account.currencyCode, leg.signedAmountMinor);
    return record(state, { ...leg, operationId: operation.id, currencyCode: account.currencyCode, effectiveLocalDate: date, stableOrder }, now);
  });
  state.operations.push(operation); state.postings.push(...legs);
  for (const posting of legs) {
    const account = entity(state, 'accounts', posting.accountId);
    if ((['INCOME','OPENING'].includes(posting.reportingOrigin) || posting.reportingOrigin === 'ADJUSTMENT' && operation.adjustmentForOperationId) && !posting.reversesPostingId && minor(posting.signedAmountMinor) > 0n && account.includeInBudget) state.fundingSources.push(record(state, { budgetPoolId: account.budgetPoolId, sourcePostingId: posting.id, currencyCode: posting.currencyCode, eligibleAmountMinor: posting.signedAmountMinor }, now));
  }
  return { operation, legs };
}
function createAccount(state, input, commandId, now) {
  money(input.currencyCode, input.openingAmountMinor); requireDate(input.openingEffectiveLocalDate);
  if (!['CASH','BANK'].includes(input.accountType)) throw new Error('INVALID_ACCOUNT_TYPE');
  let pool = state.budgetPools.find(p => p.currencyCode === input.currencyCode);
  if (!pool) { pool = record(state, { currencyCode: input.currencyCode, name: input.currencyCode }, now); state.budgetPools.push(pool); }
  const account = record(state, { name: name(input.name), type: input.accountType, currencyCode: input.currencyCode, includeInBudget: input.includeInBudget !== false, budgetPoolId: pool.id, archivedAtUtc: null }, now);
  state.accounts.push(account);
  const result = appendOperation(state, { operationType: 'OPENING', effectiveLocalDate: input.openingEffectiveLocalDate, memo: 'Opening balance', legs: [{ accountId: account.id, signedAmountMinor: input.openingAmountMinor, reportingOrigin: 'OPENING' }] }, commandId, now);
  return [account.id, result.operation.id];
}
function linkSettlement(state, input, commandId, now) {
  const occurrence = entity(state, 'occurrences', input.planOccurrenceId), posting = entity(state, 'postings', input.ledgerPostingId);
  if (occurrence.closure !== 'OPEN' || posting.reversesPostingId || state.postings.some(p => p.reversesPostingId === posting.id)) throw new Error('PLAN_OR_POSTING_CLOSED');
  positive(input.amountMinor); requireDate(input.effectiveLocalDate);
  const link = record(state, { planOccurrenceId: occurrence.id, ledgerPostingId: posting.id, signedAmountMinor: input.amountMinor, currencyCode: posting.currencyCode, direction: occurrence.direction, effectiveLocalDate: input.effectiveLocalDate, createdByCommandId: commandId }, now);
  state.settlements.push(link); return link.id;
}
function reverseLink(state, collection, linkId, commandId, effectiveLocalDate, now) {
  const original = entity(state, collection, linkId);
  if (original.reversalOfLinkId || state[collection].some(l => l.reversalOfLinkId === original.id)) throw new Error('LINK_ALREADY_REVERSED');
  requireDate(effectiveLocalDate);
  if (effectiveLocalDate < original.effectiveLocalDate) throw new Error('REVERSAL_BEFORE_LINK');
  const reversed = record(state, { ...original, signedAmountMinor: checked(-minor(original.signedAmountMinor)), effectiveLocalDate, reversalOfLinkId: original.id, createdByCommandId: commandId }, now);
  state[collection].push(reversed); return reversed.id;
}
function reverseOperation(state, operationId, input, commandId, now) {
  const original = entity(state, 'operations', operationId);
  if (original.operationType === 'REVERSAL' || state.operations.some(o => o.reversalOfOperationId === original.id)) throw new Error('OPERATION_ALREADY_REVERSED');
  if (original.operationType === 'OPENING' && state.operations.some(operation => operation.adjustmentForOperationId === original.id && !state.operations.some(reversal => reversal.reversalOfOperationId === operation.id))) throw new Error('UNDO_OPENING_CORRECTIONS_FIRST');
  requireDate(input.effectiveLocalDate);
  if (input.effectiveLocalDate < original.effectiveLocalDate) throw new Error('REVERSAL_BEFORE_OPERATION');
  const originals = state.postings.filter(p => p.operationId === original.id);
  for (const posting of originals) for (const source of state.fundingSources.filter(s => s.sourcePostingId === posting.id)) if (minor(sourceCapacity(state, source.id).consumed) > 0n) throw new Error('UNDO_ALLOCATIONS_FIRST');
  if (original.adjustmentForOperationId) {
    const posting = originals[0], account = entity(state, 'accounts', posting.accountId);
    if (minor(posting.signedAmountMinor) > 0n && account.includeInBudget && minor(poolSummary(state, account.budgetPoolId).unassigned) - minor(posting.signedAmountMinor) < 0n) throw new Error('OPENING_CORRECTION_BUDGET_DEFICIT');
  }
  for (const posting of originals) {
    for (const link of state.settlements.filter(l => l.ledgerPostingId === posting.id && !l.reversalOfLinkId && !state.settlements.some(r => r.reversalOfLinkId === l.id))) reverseLink(state, 'settlements', link.id, commandId, input.effectiveLocalDate, now);
    for (const link of state.spendLinks.filter(l => l.expensePostingId === posting.id && !l.reversalOfLinkId && !state.spendLinks.some(r => r.reversalOfLinkId === l.id))) reverseLink(state, 'spendLinks', link.id, commandId, input.effectiveLocalDate, now);
  }
  return appendOperation(state, { operationType: 'REVERSAL', reversalOfOperationId: original.id, reason: input.reason, effectiveLocalDate: input.effectiveLocalDate, legs: originals.map(p => ({ accountId: p.accountId, signedAmountMinor: checked(-minor(p.signedAmountMinor)), reportingOrigin: p.reportingOrigin, ...(p.categoryId ? { categoryId: p.categoryId } : {}), reversesPostingId: p.id })) }, commandId, now).operation.id;
}
function livePostingLinks(state, collection, field, postingId) {
  const reversed = new Set(state[collection].filter(link => link.reversalOfLinkId).map(link => link.reversalOfLinkId));
  return state[collection].filter(link => link[field] === postingId && !link.reversalOfLinkId && !reversed.has(link.id));
}
function correctionLinks(state, originalPosting, input, amount) {
  const requested = input.linkReconciliation;
  if (requested !== undefined && (!requested || typeof requested !== 'object' || Array.isArray(requested) || Object.keys(requested).some(key => !['settlements','spendLinks'].includes(key)))) throw new Error('INVALID_CORRECTION_RECONCILIATION');
  return Object.fromEntries([['settlements','ledgerPostingId'],['spendLinks','expensePostingId']].map(([collection, field]) => {
    const live = livePostingLinks(state, collection, field, originalPosting.id);
    const choices = requested?.[collection];
    if (choices !== undefined && (!Array.isArray(choices) || choices.length !== live.length || new Set(choices.map(choice => choice?.linkId)).size !== live.length)) throw new Error('INVALID_CORRECTION_RECONCILIATION');
    const links = live.map(link => {
      const choice = choices === undefined ? { amountMinor: link.signedAmountMinor } : choices.find(item => item?.linkId === link.id);
      if (!choice || minor(choice.amountMinor) < 0n) throw new Error('INVALID_CORRECTION_RECONCILIATION');
      return { link, amountMinor: choice.amountMinor };
    });
    if (links.reduce((total, choice) => total + minor(choice.amountMinor), 0n) > amount) throw new Error('CORRECTION_LINK_RECONCILIATION_REQUIRED');
    return [collection, links];
  }));
}
function appendCorrectedLinks(state, choices, posting, effectiveLocalDate, commandId, now) {
  const ids = [];
  for (const [collection, links] of Object.entries(choices)) for (const { link, amountMinor } of links) {
    if (amountMinor === '0') continue; // Explicitly dropping an association is recorded in the command receipt and reversal history.
    const field = collection === 'settlements' ? 'ledgerPostingId' : 'expensePostingId';
    const replacement = record(state, { ...link, [field]: posting.id, signedAmountMinor: amountMinor, effectiveLocalDate: link.effectiveLocalDate > effectiveLocalDate ? link.effectiveLocalDate : effectiveLocalDate, createdByCommandId: commandId, correctionOfLinkId: link.id }, now);
    state[collection].push(replacement); ids.push(replacement.id);
  }
  return ids;
}
function appendOccurrence(state, input, now) {
  positive(input.expectedAmountMinor); money(input.currencyCode, input.expectedAmountMinor); requireDate(input.dueLocalDate);
  if (!['INCOME','EXPENSE'].includes(input.direction)) throw new Error('INVALID_PLAN_DIRECTION');
  if (input.expectedAccountId && writableAccount(state, input.expectedAccountId).currencyCode !== input.currencyCode) throw new Error('PLAN_ACCOUNT_CURRENCY_MISMATCH');
  const occurrence = record(state, { ...input, title: name(input.title), originalDueLocalDate: input.originalDueLocalDate || input.dueLocalDate, closure: 'OPEN', closureHistory: [] }, now);
  state.occurrences.push(occurrence); return occurrence.id;
}
function generateOccurrences(state, seriesId, monthKeys, now) {
  const series = entity(state, 'planSeries', seriesId); if (series.archivedAtUtc) throw new Error('SERIES_ARCHIVED');
  if (!Array.isArray(monthKeys) || monthKeys.length > 120) throw new Error('INVALID_RECURRENCE_RANGE');
  const result = [];
  for (const monthKey of monthKeys) {
    const date = monthlyDate(monthKey, series.monthDay);
    if (date < series.activeFromDate || series.untilDate && date > series.untilDate) continue;
    const existing = state.occurrences.find(o => o.seriesId === seriesId && o.occurrenceKey === monthKey);
    if (existing) { result.push(existing.id); continue; }
    const revision = state.planRevisions.filter(r => r.seriesId === seriesId && r.validFromOccurrenceKey <= monthKey).sort((a, b) => b.validFromOccurrenceKey.localeCompare(a.validFromOccurrenceKey) || b.revision - a.revision)[0];
    if (!revision) throw new Error('MISSING_PLAN_REVISION');
    result.push(appendOccurrence(state, { seriesId, occurrenceKey: monthKey, revisionSnapshotId: revision.id, title: series.title, direction: series.direction, currencyCode: series.currencyCode, dueLocalDate: date, expectedAmountMinor: revision.amountMinor, expectedAccountId: series.defaultAccountId || '' }, now));
  }
  return result;
}
function saveTemplate(state, input, now) {
  money(input.currencyCode, '0');
  if (!['PER_APPLICATION','CALENDAR_MONTH'].includes(input.fixedScope)) throw new Error('INVALID_FIXED_SCOPE');
  let template = input.templateId ? entity(state, 'templates', input.templateId) : null;
  if (template?.archivedAtUtc) throw new Error('TEMPLATE_ARCHIVED');
  if (!template) { template = record(state, { name: name(input.name), archivedAtUtc: null, currentVersionId: '' }, now); state.templates.push(template); }
  else template.name = name(input.name);
  const lines = input.lines.map(line => ({ ...clone(line), stableLineKey: line.stableLineKey || id() }));
  for (const line of lines) { const envelope=entity(state,'envelopes',line.envelopeId); if(envelope.archivedAtUtc)throw new Error('ENVELOPE_ARCHIVED');if(envelope.currencyCode!==input.currencyCode)throw new Error('TEMPLATE_CURRENCY_MISMATCH'); }
  calculateAllocation('1', lines, input);
  if(input.leftoverPolicy==='ENVELOPE'&&entity(state,'envelopes',input.leftoverEnvelopeId).archivedAtUtc)throw new Error('ENVELOPE_ARCHIVED');
  const version = record(state, { templateId: template.id, versionNumber: state.templateVersions.filter(v => v.templateId === template.id).length + 1, currencyCode: input.currencyCode, calculationMode: 'FIXED_THEN_REMAINDER', shortagePolicy: input.shortagePolicy || 'BLOCK', leftoverPolicy: input.leftoverPolicy || 'UNASSIGNED', leftoverEnvelopeId: input.leftoverEnvelopeId || '', fixedScope: input.fixedScope, lines }, now);
  state.templateVersions.push(version); template.currentVersionId = version.id; template.updatedAtUtc = now; template.revision = state.revision + 1;
  return [template.id, version.id];
}
function commitAllocation(state, preview, input, commandId, now) {
  if (!preview.result.allowed || minor(preview.result.consumptionMinor) <= 0n) throw new Error('ALLOCATION_BLOCKED');
  const version = preview.templateVersion, pool = entity(state, 'budgetPools', input.budgetPoolId);
  let left = minor(preview.result.consumptionMinor);
  const consumption = input.sourceIds.map(sourceId => { const capacity = minor(sourceCapacity(state, sourceId).remaining), amount = capacity < left ? capacity : left; left -= amount; return { sourceId, signedAmountMinor: checked(amount) }; }).filter(c => c.signedAmountMinor !== '0');
  if (left !== 0n || minor(poolSummary(state, pool.id).unassigned) < minor(preview.result.consumptionMinor)) throw new Error('INSUFFICIENT_SOURCE_OR_UNASSIGNED');
  const applicationGroupId = input.applicationGroupId || id();
  const app = record(state, { commandId, currencyCode: pool.currencyCode, budgetPoolId: pool.id, allocationEffectiveLocalDate: input.allocationEffectiveLocalDate, templateId: version.templateId, templateVersionSnapshotId: version.id, frozenInput: clone(preview), calculationVersion: 'fixed-remainder-largest-remainder-1', cycleKey: version.fixedScope === 'PER_APPLICATION' ? applicationGroupId : preview.cycleKey, applicationGroupId, sourceConsumption: consumption, fixedContributions: preview.result.lines.filter(l => l.type === 'FIXED').map(l => ({ stableLineKey: l.stableLineKey, signedAmountMinor: l.amountMinor })), confirmedAtUtc: now }, now);
  state.allocationApplications.push(app);
  const byEnvelope = new Map();
  for (const line of preview.result.lines) byEnvelope.set(line.envelopeId, (byEnvelope.get(line.envelopeId) || 0n) + minor(line.amountMinor));
  const capacities = consumption.map(c => ({sourceId:c.sourceId,remaining:minor(c.signedAmountMinor)}));
  for (const [envelopeId, amount] of byEnvelope) if (amount > 0n) {
    let remaining = amount; const attribution = [];
    for (const capacity of capacities) { const take = capacity.remaining < remaining ? capacity.remaining : remaining; if (take > 0n) attribution.push({sourceId:capacity.sourceId,signedAmountMinor:checked(take)}); remaining -= take; capacity.remaining -= take; }
    state.allocationEntries.push(record(state, { applicationId: app.id, envelopeId, signedAmountMinor: checked(amount), sourceAttribution: attribution }, now));
  }
  state.allocationEntries.push(record(state, { applicationId: app.id, envelopeId: null, signedAmountMinor: checked(-minor(preview.result.consumptionMinor)), sourceAttribution: consumption.map(c => ({...c,signedAmountMinor:checked(-minor(c.signedAmountMinor))})) }, now));
  if (version.fixedScope === 'CALENDAR_MONTH' && !state.allocationCycles.some(c => c.templateId === version.templateId && c.cycleKey === preview.cycleKey)) state.allocationCycles.push(record(state, { templateId: version.templateId, currencyCode: version.currencyCode, budgetPoolId: pool.id, scope: version.fixedScope, cycleKey: preview.cycleKey, targetSnapshot: clone(version.lines.filter(l => l.type === 'FIXED')) }, now));
  return [app.id];
}

export async function prepareCommand(snapshot, command, expectedRevision, { now = new Date().toISOString() } = {}) {
  // Capture caller-owned input before asynchronous hashing or calculation.
  command=clone(command);snapshot=clone(snapshot);
  validateSnapshot(snapshot);
  if (!command?.commandId || typeof command.commandId !== 'string' || !command.type || !command.input) throw new Error('INVALID_COMMAND');
  const payloadHash = await digest(command), old = snapshot.receipts.find(r => r.commandId === command.commandId);
  if (old) { if (old.payloadHash !== payloadHash) throw new Error('IDEMPOTENCY_CONFLICT'); return { snapshot: clone(snapshot), result: clone(old), replay: true, baseRevision: snapshot.revision }; }
  if (snapshot.revision !== expectedRevision) throw new Error('REVISION_CONFLICT');
  const state = clone(snapshot), input = clone(command.input), { commandId, type } = command;
  let resultIds = [];
  switch (type) {
    case 'onboard':
      if (state.profile.onboardingCompletedAtUtc || state.accounts.length) throw new Error('ALREADY_ONBOARDED');
      money(input.currencyCode,'0');
      if (input.locale !== undefined) state.profile.locale = requireLocale(input.locale);
      if (input.timezoneId !== undefined) state.profile.timezoneId = requireTimezone(input.timezoneId);
      state.profile.defaultCurrencyCode = input.currencyCode;
      resultIds = createAccount(state, input, commandId, now); state.profile.onboardingCompletedAtUtc = now; state.profile.updatedAtUtc = now; state.profile.revision = state.revision + 1; break;
    case 'addAccount': resultIds = createAccount(state, input, commandId, now); break;
    case 'correctOpeningBalance': {
      if (typeof input.reason !== 'string' || !input.reason.trim()) throw new Error('CORRECTION_REASON_REQUIRED');
      const account = writableAccount(state, input.accountId), opening = openingBalanceSummary(state, account.id);
      money(account.currencyCode, input.openingAmountMinor); requireDate(input.effectiveLocalDate);
      if (input.effectiveLocalDate < opening.lastEffectiveLocalDate) throw new Error('OPENING_CORRECTION_BEFORE_HISTORY');
      const difference = minor(input.openingAmountMinor) - minor(opening.correctedOpeningAmountMinor);
      if (difference === 0n) throw new Error('OPENING_BALANCE_UNCHANGED');
      if (difference < 0n && account.includeInBudget && minor(poolSummary(state, account.budgetPoolId).unassigned) + difference < 0n) throw new Error('OPENING_CORRECTION_BUDGET_DEFICIT');
      const adjustment = appendOperation(state, { operationType: 'ADJUSTMENT', adjustmentForOperationId: opening.openingOperationId, effectiveLocalDate: input.effectiveLocalDate, memo: input.memo || '', reason: input.reason, legs: [{ accountId: account.id, signedAmountMinor: checked(difference), reportingOrigin: 'ADJUSTMENT' }] }, commandId, now);
      resultIds = [adjustment.operation.id, adjustment.legs[0].id]; break;
    }
    case 'updateAccount':
    case 'updateCategory':
    case 'updateEnvelope': {
      const collection={updateAccount:'accounts',updateCategory:'categories',updateEnvelope:'envelopes'}[type];
      const target=entity(state,collection,input.entityId);
      target.name=name(input.name);target.updatedAtUtc=now;target.revision=state.revision+1;
      resultIds=[target.id];break;
    }
    case 'archiveEntity': {
      if(!['accounts','categories','envelopes'].includes(input.collection)||typeof input.archived!=='boolean')throw new Error('INVALID_ARCHIVE_REQUEST');
      const target=entity(state,input.collection,input.entityId);
      target.archivedAtUtc=input.archived?now:null;target.updatedAtUtc=now;target.revision=state.revision+1;
      resultIds=[target.id];break;
    }
    case 'addCategory': { if (!['INCOME','EXPENSE'].includes(input.direction)) throw new Error('INVALID_CATEGORY_DIRECTION'); const category = record(state, { name: name(input.name), direction: input.direction, archivedAtUtc: null }, now); state.categories.push(category); resultIds = [category.id]; break; }
    case 'addEnvelope': { const pool = entity(state, 'budgetPools', input.budgetPoolId); const envelope = record(state, { name: name(input.name), budgetPoolId: pool.id, currencyCode: pool.currencyCode, archivedAtUtc: null }, now); state.envelopes.push(envelope); resultIds = [envelope.id]; break; }
    case 'recordActual': {
      if(input.categoryId){const category=entity(state,'categories',input.categoryId);if(category.archivedAtUtc)throw new Error('CATEGORY_ARCHIVED');if(category.direction!==input.operationType)throw new Error('CATEGORY_DIRECTION_MISMATCH');}
      const amount = positive(input.amountMinor); let legs;
      if (input.operationType === 'TRANSFER') { const from = writableAccount(state, input.fromAccountId), to = writableAccount(state, input.toAccountId); if (from.id === to.id || from.currencyCode !== to.currencyCode) throw new Error('INVALID_TRANSFER_ACCOUNTS'); legs = [{ accountId: from.id, signedAmountMinor: checked(-amount), reportingOrigin: 'TRANSFER' }, { accountId: to.id, signedAmountMinor: checked(amount), reportingOrigin: 'TRANSFER' }]; }
      else { if (!['INCOME','EXPENSE'].includes(input.operationType)) throw new Error('INVALID_ACTUAL_TYPE'); legs = [{ accountId: input.accountId, signedAmountMinor: checked(input.operationType === 'INCOME' ? amount : -amount), reportingOrigin: input.operationType, ...(input.categoryId ? { categoryId: input.categoryId } : {}) }]; }
      const operation = appendOperation(state, { ...input, legs }, commandId, now); resultIds = [operation.operation.id, ...operation.legs.map(p => p.id)];
      if (input.settlement) resultIds.push(linkSettlement(state, { ...input.settlement, ledgerPostingId: operation.legs[0].id, effectiveLocalDate: input.effectiveLocalDate }, commandId, now));
      break;
    }
    case 'reverseOperation': resultIds = [reverseOperation(state, input.operationId, input, commandId, now)]; break;
    case 'replaceOperation': {
      if (typeof input.reason !== 'string' || !input.reason.trim()) throw new Error('CORRECTION_REASON_REQUIRED');
      const original = entity(state, 'operations', input.operationId);
      if (!['INCOME','EXPENSE'].includes(original.operationType)) throw new Error('REPLACEMENT_TYPE_NOT_SUPPORTED');
      if (input.memo !== undefined && typeof input.memo !== 'string') throw new Error('INVALID_MEMO');
      const posting = state.postings.find(p => p.operationId === original.id), amount = positive(input.amountMinor);
      const accountId = input.accountId || posting.accountId;
      if (writableAccount(state, accountId).currencyCode !== posting.currencyCode) throw new Error('CORRECTION_CURRENCY_MISMATCH');
      const choices = correctionLinks(state, posting, input, amount);
      resultIds = [reverseOperation(state, original.id, input, commandId, now)];
      const replacement = appendOperation(state, { operationType: original.operationType, effectiveLocalDate: input.effectiveLocalDate, replacementForOperationId: original.id, memo: input.memo === undefined ? original.memo : input.memo, reason: input.reason, legs: [{ accountId, signedAmountMinor: checked(original.operationType === 'INCOME' ? amount : -amount), reportingOrigin: posting.reportingOrigin, ...(posting.categoryId ? { categoryId: posting.categoryId } : {}) }] }, commandId, now);
      resultIds.push(replacement.operation.id, ...appendCorrectedLinks(state, choices, replacement.legs[0], input.effectiveLocalDate, commandId, now)); break;
    }
    case 'createPlan': resultIds = [appendOccurrence(state, { title: input.title, direction: input.direction, currencyCode: input.currencyCode, dueLocalDate: input.dueLocalDate, expectedAmountMinor: input.expectedAmountMinor, expectedAccountId: input.expectedAccountId || '' }, now)]; break;
    case 'createMonthlyPlan': {
      requireDate(input.anchorLocalDate); money(input.currencyCode, input.amountMinor); positive(input.amountMinor);
      if (!['INCOME','EXPENSE'].includes(input.direction)) throw new Error('INVALID_PLAN_DIRECTION');
      const series = record(state, { title: name(input.title), direction: input.direction, currencyCode: input.currencyCode, defaultAccountId: input.expectedAccountId || '', recurrence: 'MONTHLY', interval: 1, monthDay: input.monthDay, anchorLocalDate: input.anchorLocalDate, activeFromDate: input.anchorLocalDate, endPolicy: 'CLAMP_TO_LAST_DAY', timezoneId: state.profile.timezoneId, untilDate: input.untilDate || '', archivedAtUtc: null }, now);
      state.planSeries.push(series); state.planRevisions.push(record(state, { seriesId: series.id, validFromOccurrenceKey: input.anchorLocalDate.slice(0,7), amountMinor: input.amountMinor }, now));
      resultIds = [series.id, ...generateOccurrences(state, series.id, input.monthKeys || [input.anchorLocalDate.slice(0,7)], now)]; break;
    }
    case 'generateOccurrences': resultIds = generateOccurrences(state, input.seriesId, input.monthKeys, now); break;
    case 'setSeriesUntilDate': {
      const series = entity(state,'planSeries',input.seriesId);
      if(input.untilDate!==null){requireDate(input.untilDate);if(input.untilDate<series.activeFromDate)throw new Error('SERIES_END_BEFORE_START');}
      series.untilDate=input.untilDate;series.updatedAtUtc=now;series.revision=state.revision+1;resultIds=[series.id];break;
    }
    case 'revisePlan': {
      const occurrence = entity(state,'occurrences',input.occurrenceId); positive(input.expectedAmountMinor);
      if (occurrence.closure !== 'OPEN' || minor(planSummary(state, occurrence.id).netSettled) !== 0n) throw new Error('SETTLED_PLAN_REVISION_BLOCKED');
      const exception = record(state,{occurrenceId:occurrence.id,seriesId:occurrence.seriesId || null,occurrenceKey:occurrence.occurrenceKey || occurrence.id,kind:'OVERRIDE',previousAmountMinor:occurrence.expectedAmountMinor,amountMinor:input.expectedAmountMinor},now);
      state.planExceptions.push(exception); occurrence.expectedAmountMinor = input.expectedAmountMinor; occurrence.updatedAtUtc = now; occurrence.revision = state.revision + 1; resultIds = [exception.id,occurrence.id]; break;
    }
    case 'revisePlanSeries': {
      const series = entity(state,'planSeries',input.seriesId); positive(input.amountMinor); monthlyDate(input.validFromOccurrenceKey,series.monthDay);
      const revision = record(state,{seriesId:series.id,validFromOccurrenceKey:input.validFromOccurrenceKey,amountMinor:input.amountMinor},now); state.planRevisions.push(revision);
      for (const occurrence of state.occurrences.filter(o => o.seriesId === series.id && o.occurrenceKey >= input.validFromOccurrenceKey && o.closure === 'OPEN' && minor(planSummary(state, o.id).netSettled) === 0n)) { occurrence.expectedAmountMinor = input.amountMinor; occurrence.revisionSnapshotId = revision.id; occurrence.updatedAtUtc = now; occurrence.revision = state.revision + 1; }
      resultIds = [revision.id]; break;
    }
    case 'reschedulePlan': { const occurrence = entity(state, 'occurrences', input.occurrenceId); if (occurrence.closure !== 'OPEN') throw new Error('PLAN_CLOSED'); requireDate(input.dueLocalDate); state.planExceptions.push(record(state, { occurrenceId: occurrence.id, seriesId: occurrence.seriesId || null, occurrenceKey: occurrence.occurrenceKey || occurrence.id, kind: 'RESCHEDULE', dueLocalDate: input.dueLocalDate }, now)); occurrence.dueLocalDate = input.dueLocalDate; occurrence.updatedAtUtc = now; occurrence.revision = state.revision + 1; resultIds = [occurrence.id]; break; }
    case 'closePlan': { const occurrence = entity(state, 'occurrences', input.occurrenceId); if (!['OPEN','FINALIZED','CANCELLED'].includes(input.closure)) throw new Error('INVALID_CLOSURE'); requireDate(input.effectiveLocalDate); occurrence.closure = input.closure; occurrence.finalizationReason = String(input.reason || '').slice(0,500); occurrence.closureEffectiveLocalDate = input.effectiveLocalDate; occurrence.closureHistory.push({ closure: input.closure, effectiveLocalDate: input.effectiveLocalDate, atUtc: now, reason: occurrence.finalizationReason }); occurrence.updatedAtUtc = now; occurrence.revision = state.revision + 1; resultIds = [occurrence.id]; break; }
    case 'linkSettlement': resultIds = [linkSettlement(state, input, commandId, now)]; break;
    case 'unlinkSettlement': resultIds = [reverseLink(state, 'settlements', input.linkId, commandId, input.effectiveLocalDate, now)]; break;
    case 'saveTemplate': resultIds = saveTemplate(state, input, now); break;
    case 'confirmAllocation': {
      const { previewHash, ...request } = input; const preview = await previewAllocationV3(snapshot, request);
      if (preview.previewHash !== previewHash) throw new Error('PREVIEW_STALE'); resultIds = commitAllocation(state, preview, request, commandId, now); break;
    }
    case 'reverseAllocation': {
      const original = entity(state, 'allocationApplications', input.applicationId);
      if (original.reversalOfApplicationId || state.allocationApplications.some(a => a.reversalOfApplicationId === original.id)) throw new Error('ALLOCATION_ALREADY_REVERSED');
      requireDate(input.effectiveLocalDate);
      if (input.effectiveLocalDate < original.allocationEffectiveLocalDate) throw new Error('REVERSAL_BEFORE_ALLOCATION');
      // Per-envelope consequences must be explicitly acknowledged; no expense is removed.
      const deficits = state.allocationEntries.filter(e => e.applicationId === original.id && e.envelopeId).filter(e => minor(envelopeBalance(state, e.envelopeId)) < minor(e.signedAmountMinor));
      if (deficits.length && input.acknowledgeDeficit !== true) throw new Error('ALLOCATION_UNDO_DEFICIT_CONFIRM_REQUIRED');
      const app = record(state, { ...original, commandId, allocationEffectiveLocalDate: input.effectiveLocalDate, reversalOfApplicationId: original.id, sourceConsumption: original.sourceConsumption.map(c => ({ ...c, signedAmountMinor: checked(-minor(c.signedAmountMinor)) })), fixedContributions: original.fixedContributions.map(c => ({ ...c, signedAmountMinor: checked(-minor(c.signedAmountMinor)) })), confirmedAtUtc: now }, now);
      state.allocationApplications.push(app);
      for (const entry of state.allocationEntries.filter(e => e.applicationId === original.id)) state.allocationEntries.push(record(state, { ...entry, applicationId: app.id, signedAmountMinor: checked(-minor(entry.signedAmountMinor)),sourceAttribution:entry.sourceAttribution.map(c => ({...c,signedAmountMinor:checked(-minor(c.signedAmountMinor))})) }, now)); resultIds = [app.id]; break;
    }
    case 'linkExpense': {
      const posting = entity(state, 'postings', input.expensePostingId), envelope = entity(state, 'envelopes', input.envelopeId);
      if(envelope.archivedAtUtc)throw new Error('ENVELOPE_ARCHIVED');
      positive(input.amountMinor); if (posting.reportingOrigin !== 'EXPENSE' || posting.reversesPostingId || state.postings.some(p => p.reversesPostingId === posting.id)) throw new Error('INVALID_EXPENSE_POSTING');
      requireDate(input.effectiveLocalDate); if (input.effectiveLocalDate < posting.effectiveLocalDate) throw new Error('LINK_BEFORE_POSTING');
      if (minor(envelopeBalance(state, envelope.id)) < minor(input.amountMinor)) throw new Error('ENVELOPE_INSUFFICIENT');
      const link = record(state, { expensePostingId: posting.id, envelopeId: envelope.id, signedAmountMinor: input.amountMinor, effectiveLocalDate: input.effectiveLocalDate, createdByCommandId: commandId }, now); state.spendLinks.push(link); resultIds = [link.id]; break;
    }
    default: throw new Error('UNKNOWN_COMMAND');
  }
  const receipt = record(state, { commandId, payloadHash, resultIds, committedRevision: state.revision + 1 }, now);
  state.receipts.push(receipt); state.audit.push(record(state, { commandId, type, resultIds, atUtc: now }, now)); state.revision++;
  validateSnapshot(state);
  return { snapshot: state, result: receipt, replay: false, baseRevision: snapshot.revision };
}

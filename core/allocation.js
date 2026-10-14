import { minor, checked, positive } from './money.js';
import { entity, poolSummary, sourceCapacity } from './model.js';
import { digest, clone } from './identity.js';
import { requireDate,addDays } from './calendar.js';

export function fixedApplied(state, templateId, cycleKey, stableLineKey, applicationGroupId = '', cutoffExclusive = '9999-12-31') {
  return state.allocationApplications.filter(a => a.templateId === templateId && a.cycleKey === cycleKey && a.allocationEffectiveLocalDate < cutoffExclusive && (!applicationGroupId || a.applicationGroupId === applicationGroupId))
    .reduce((total, app) => total + (app.fixedContributions || []).filter(c => c.stableLineKey === stableLineKey).reduce((n, c) => n + minor(c.signedAmountMinor), 0n), 0n);
}
export function calculateAllocation(amountMinor, lines, { shortagePolicy = 'BLOCK', leftoverPolicy = 'UNASSIGNED', leftoverEnvelopeId = '', appliedByLine = {} } = {}) {
  const amount = positive(amountMinor);
  if (!['BLOCK','PARTIAL_BY_PRIORITY'].includes(shortagePolicy) || !['UNASSIGNED','ENVELOPE'].includes(leftoverPolicy)) throw new Error('INVALID_ALLOCATION_POLICY');
  if (!Array.isArray(lines) || !lines.length || lines.length > 100) throw new Error('INVALID_TEMPLATE_LINES');
  const stable = [...lines].sort((a, b) => a.priority - b.priority || a.stableLineKey.localeCompare(b.stableLineKey));
  const ids = new Set(); let bps = 0;
  for (const line of stable) {
    if (!line.envelopeId || !line.stableLineKey || ids.has(line.stableLineKey) || !Number.isSafeInteger(line.priority)) throw new Error('INVALID_TEMPLATE_LINE');
    ids.add(line.stableLineKey);
    if (line.type === 'FIXED') { if (minor(line.fixedAmountMinor) < 0n || line.percentageBps !== undefined) throw new Error('INVALID_FIXED_LINE'); }
    else if (line.type === 'PERCENT') {
      if (!Number.isInteger(line.percentageBps) || line.percentageBps < 0 || line.percentageBps > 10000 || line.fixedAmountMinor !== undefined) throw new Error('INVALID_PERCENT_LINE');
      bps += line.percentageBps;
    } else throw new Error('INVALID_LINE_TYPE');
  }
  if (bps > 10000) throw new Error('PERCENT_OVER_100');
  let remaining = amount, fixedRequested = 0n, fixedGranted = 0n;
  const results = stable.map(line => ({ ...clone(line), amountMinor: '0', roundingMinor: '0', targetRemainingMinor: '0' }));
  for (const line of results.filter(l => l.type === 'FIXED')) {
    const already = BigInt(appliedByLine[line.stableLineKey] || '0');
    const target = minor(line.fixedAmountMinor), need = target > already ? target - already : 0n;
    line.targetRemainingMinor = checked(need); fixedRequested += need;
    const granted = remaining < need ? remaining : need;
    line.amountMinor = checked(granted); remaining -= granted; fixedGranted += granted;
  }
  const shortage = fixedRequested > amount ? fixedRequested - amount : 0n;
  const remainder = amount - fixedGranted;
  const percentagePool = remainder * BigInt(bps) / 10000n;
  const percentages = results.filter(l => l.type === 'PERCENT');
  let percentageGranted = 0n;
  for (const line of percentages) { const product = remainder * BigInt(line.percentageBps); const granted = product / 10000n; line.amountMinor = checked(granted); line.fraction = product % 10000n; percentageGranted += granted; }
  const roundingOrder = [...percentages].sort((a, b) => a.fraction === b.fraction ? a.priority - b.priority || a.stableLineKey.localeCompare(b.stableLineKey) : a.fraction > b.fraction ? -1 : 1);
  for (let i = 0n; i < percentagePool - percentageGranted; i++) { const line = roundingOrder[Number(i)]; line.amountMinor = checked(minor(line.amountMinor) + 1n); line.roundingMinor = '1'; }
  for (const line of percentages) delete line.fraction;
  const leftover = amount - fixedGranted - percentagePool;
  if (leftoverPolicy === 'ENVELOPE') { if (!leftoverEnvelopeId) throw new Error('MISSING_LEFTOVER_ENVELOPE'); results.push({ stableLineKey: 'leftover', envelopeId: leftoverEnvelopeId, type: 'LEFTOVER', priority: Number.MAX_SAFE_INTEGER, amountMinor: checked(leftover), roundingMinor: '0' }); }
  const consumption = fixedGranted + percentagePool + (leftoverPolicy === 'ENVELOPE' ? leftover : 0n);
  return { allowed: shortage === 0n || shortagePolicy === 'PARTIAL_BY_PRIORITY', requestedAmountMinor: checked(amount), fixedRequestedMinor: checked(fixedRequested), fixedGrantedMinor: checked(fixedGranted), remainderMinor: checked(remainder), shortageMinor: checked(shortage), percentagePoolMinor: checked(percentagePool), leftoverMinor: checked(leftover), consumptionMinor: checked(consumption), lines: results };
}
export async function previewAllocationV3(state, input) {
  requireDate(input.allocationEffectiveLocalDate);
  let version = entity(state, 'templateVersions', input.templateVersionId);
  const template = entity(state, 'templates', version.templateId), pool = entity(state, 'budgetPools', input.budgetPoolId);
  if(version.fixedScope === 'PER_APPLICATION' && input.applicationGroupId){
    const original=state.allocationApplications.filter(a=>a.applicationGroupId===input.applicationGroupId&&!a.reversalOfApplicationId).sort((a,b)=>a.revision-b.revision)[0];
    if(!original||original.templateId!==template.id||original.budgetPoolId!==pool.id||!original.frozenInput?.templateVersion)throw new Error('INVALID_CONTINUATION_GROUP');
    version=clone(original.frozenInput.templateVersion);
  }
  if (version.currencyCode !== pool.currencyCode || template.archivedAtUtc) throw new Error('TEMPLATE_POOL_MISMATCH');
  if (!Array.isArray(input.sourceIds) || !input.sourceIds.length || new Set(input.sourceIds).size !== input.sourceIds.length) throw new Error('INVALID_SOURCE_SELECTION');
  const capacity = input.sourceIds.reduce((total, sourceId) => {
    const source = entity(state, 'fundingSources', sourceId), posting = entity(state, 'postings', source.sourcePostingId);
    if (source.budgetPoolId !== pool.id || posting.effectiveLocalDate > input.allocationEffectiveLocalDate) throw new Error('SOURCE_POOL_OR_DATE_MISMATCH');
    return total + minor(sourceCapacity(state, sourceId).remaining);
  }, 0n);
  const amount = positive(input.requestedAmountMinor), liquidity = minor(poolSummary(state, pool.id).unassigned);
  if (amount > capacity || amount > (liquidity > 0n ? liquidity : 0n)) throw new Error('INSUFFICIENT_SOURCE_OR_UNASSIGNED');
  const cutoff=addDays(input.allocationEffectiveLocalDate,1);
  const historicalCapacity=input.sourceIds.reduce((total,sourceId)=>total+minor(sourceCapacity(state,sourceId,cutoff).remaining),0n),historicalLiquidity=minor(poolSummary(state,pool.id,cutoff).unassigned);
  if(amount>historicalCapacity||amount>(historicalLiquidity>0n?historicalLiquidity:0n))throw new Error('INSUFFICIENT_HISTORICAL_SOURCE_OR_UNASSIGNED');
  const cycleKey = version.fixedScope === 'CALENDAR_MONTH' ? input.allocationEffectiveLocalDate.slice(0, 7) : (input.applicationGroupId || '');
  const appliedByLine = {};
  if (cycleKey) for (const line of version.lines.filter(l => l.type === 'FIXED')) appliedByLine[line.stableLineKey] = checked(fixedApplied(state, template.id, cycleKey, line.stableLineKey, version.fixedScope === 'PER_APPLICATION' ? input.applicationGroupId : '',cutoff));
  for (const line of version.lines) {
    const envelope = entity(state, 'envelopes', line.envelopeId);
    if (envelope.budgetPoolId !== pool.id || envelope.currencyCode !== version.currencyCode || envelope.archivedAtUtc) throw new Error('ENVELOPE_POOL_MISMATCH');
  }
  if(version.leftoverPolicy==='ENVELOPE'){const leftover=entity(state,'envelopes',version.leftoverEnvelopeId);if(leftover.budgetPoolId!==pool.id||leftover.archivedAtUtc)throw new Error('ENVELOPE_POOL_MISMATCH');}
  const result = calculateAllocation(input.requestedAmountMinor, version.lines, { ...version, appliedByLine });
  const frozen = { datasetId: state.datasetId, revision: state.revision, input: clone(input), templateVersion: clone(version), cycleKey, appliedByLine, result };
  return { ...frozen, previewHash: await digest(frozen) };
}

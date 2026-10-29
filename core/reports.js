import { clone, digest } from './identity.js';
import { checked, minor, sum, money } from './money.js';
import { daysInRange, requireDate, requireTimezone, addDays, todayInTimezone } from './calendar.js';
import { entity, planSummary, poolSummary, indexer, items, ACCOUNT_TYPES } from './model.js';

const domains = { ActualIncome: 'ACTUAL', ActualExpense: 'ACTUAL', CashBalanceAsOf: 'ACTUAL', CashChangeInPeriod: 'ACTUAL', PlannedOpenInPeriod: 'PLAN', EnvelopeAvailable: 'ALLOCATION', Unassigned: 'ALLOCATION', ForecastAsOf: 'FORECAST' };
export function reportDescriptor(state, input) {
  if (input.datasetId && input.datasetId !== state.datasetId) throw new Error('REPORT_DATASET_CONFLICT');
  if (!Object.hasOwn(domains, input.metricId)) throw new Error('UNKNOWN_METRIC');
  money(input.currencyCode, '0'); requireDate(input.startLocalDateInclusive); requireDate(input.endLocalDateExclusive); requireTimezone(input.timezoneId || state.profile.timezoneId);
  if (input.startLocalDateInclusive >= input.endLocalDateExclusive) throw new Error('INVALID_REPORT_PERIOD');
  const descriptor = { metricId: input.metricId, domain: domains[input.metricId], currencyCode: input.currencyCode, startLocalDateInclusive: input.startLocalDateInclusive, endLocalDateExclusive: input.endLocalDateExclusive, timezoneId: input.timezoneId || state.profile.timezoneId,
    accountIds: [...new Set(input.accountIds || [])].sort(), categoryIds: [...new Set(input.categoryIds || [])].sort(), envelopeIds: [...new Set(input.envelopeIds || [])].sort(), searchQuery: input.searchQuery || '', includeArchived: input.includeArchived !== false, statePolicy: input.statePolicy || 'NET', datasetRevision: input.datasetRevision ?? state.revision, datasetId: state.datasetId, sort: 'DATE_ASC_STABLE', grouping: input.grouping || 'day', budgetPoolId: input.budgetPoolId || '', anchorLocalDate: input.anchorLocalDate || input.startLocalDateInclusive };
  if (descriptor.datasetRevision !== state.revision) throw new Error('REPORT_REVISION_CONFLICT');
  if (!(descriptor.metricId === 'PlannedOpenInPeriod' ? ['NET','OPEN_INCOME','OPEN_EXPENSE'] : ['NET']).includes(descriptor.statePolicy) || !['day','month','year'].includes(descriptor.grouping)) throw new Error('UNSUPPORTED_REPORT_POLICY');
  if (typeof descriptor.searchQuery !== 'string') throw new Error('INVALID_SEARCH');
  for (const accountId of descriptor.accountIds) if (entity(state, 'accounts', accountId).currencyCode !== descriptor.currencyCode) throw new Error('REPORT_CURRENCY_MISMATCH');
  for (const categoryId of descriptor.categoryIds) entity(state, 'categories', categoryId);
  for (const envelopeId of descriptor.envelopeIds) if (entity(state, 'envelopes', envelopeId).currencyCode !== descriptor.currencyCode) throw new Error('REPORT_CURRENCY_MISMATCH');
  if (['CashBalanceAsOf','CashChangeInPeriod','EnvelopeAvailable','Unassigned','ForecastAsOf'].includes(descriptor.metricId) && (descriptor.searchQuery || descriptor.categoryIds.length)) throw new Error('FILTER_INVALID_FOR_BALANCE');
  if (descriptor.domain !== 'ALLOCATION' && descriptor.envelopeIds.length) throw new Error('FILTER_INVALID_FOR_METRIC');
  if (descriptor.domain === 'ALLOCATION' && descriptor.accountIds.length) throw new Error('BUDGET_REPORT_REQUIRES_POOL_SCOPE');
  if (['Unassigned','EnvelopeAvailable'].includes(descriptor.metricId)) {
    const pool = entity(state, 'budgetPools', descriptor.budgetPoolId);
    if (pool.currencyCode !== descriptor.currencyCode) throw new Error('REPORT_CURRENCY_MISMATCH');
    if (descriptor.metricId === 'Unassigned' && descriptor.envelopeIds.length) throw new Error('FILTER_INVALID_FOR_METRIC');
  }
  if (descriptor.metricId === 'PlannedOpenInPeriod' && descriptor.categoryIds.length) throw new Error('FILTER_INVALID_FOR_METRIC');
  requireDate(descriptor.anchorLocalDate);
  return descriptor;
}
const inPeriod = (date, d) => date >= d.startLocalDateInclusive && date < d.endLocalDateExclusive;
function accountInScope(state, accountId, d, get = (collection, entityId) => entity(state, collection, entityId)) { const account = get('accounts', accountId); return account.currencyCode === d.currencyCode && (!d.accountIds.length || d.accountIds.includes(account.id)) && (d.includeArchived || !account.archivedAtUtc); }
const byDate = (a, b) => a.effectiveLocalDate.localeCompare(b.effectiveLocalDate) || (a.stableOrder || 0) - (b.stableOrder || 0) || a.id.localeCompare(b.id);
export async function queryReport(state, input, { cursor = 0, pageSize = 100 } = {}) {
  const descriptor = reportDescriptor(state, input), d = descriptor, rows = [], excluded = {}, { get } = indexer(state);
  const push = (row, contribution) => rows.push({ ...clone(row), contributionMinor: checked(contribution) });
  const postings = state.postings.filter(p => p.effectiveLocalDate < d.endLocalDateExclusive && accountInScope(state, p.accountId, d, get));
  if (['ActualIncome','ActualExpense','CashChangeInPeriod','CashBalanceAsOf'].includes(d.metricId)) {
    const origin = d.metricId === 'ActualIncome' ? 'INCOME' : d.metricId === 'ActualExpense' ? 'EXPENSE' : '';
    if (d.metricId === 'CashBalanceAsOf') {
      const history = postings.filter(p => p.effectiveLocalDate < d.startLocalDateInclusive);
      if (history.length) push({ id: 'opening-before-range', rowType: 'OPENING_BEFORE_RANGE', effectiveLocalDate: d.startLocalDateInclusive, sourcePostingIds: history.map(p => p.id), stableOrder: -1 }, minor(sum(history.map(p => p.signedAmountMinor))));
    }
    for (const p of postings.filter(p => inPeriod(p.effectiveLocalDate, d))) {
      const operation = get('operations', p.operationId);
      const reason = origin && p.reportingOrigin !== origin ? 'origin' : d.categoryIds.length && !d.categoryIds.includes(p.categoryId) ? 'category' : d.searchQuery && !`${operation.memo} ${p.categoryId ? get('categories',p.categoryId).name : ''} ${get('accounts',p.accountId).name}`.toLocaleLowerCase(d.timezoneId ? state.profile.locale : 'en-US').includes(d.searchQuery.toLocaleLowerCase(state.profile.locale)) ? 'search' : '';
      if (reason) { excluded[reason] = (excluded[reason] || 0) + 1; continue; }
      push({ ...p, rowType: 'POSTING', memo: operation.memo, operationType: operation.operationType }, origin === 'EXPENSE' ? -minor(p.signedAmountMinor) : minor(p.signedAmountMinor));
    }
  } else if (d.metricId === 'PlannedOpenInPeriod') {
    for (const occurrence of state.occurrences.filter(o => o.currencyCode === d.currencyCode && inPeriod(o.dueLocalDate, d) && (d.includeArchived||!o.expectedAccountId||!entity(state,'accounts',o.expectedAccountId).archivedAtUtc) && (d.statePolicy === 'NET' || o.direction === d.statePolicy.slice(5)) && (!d.accountIds.length || d.accountIds.includes(o.expectedAccountId)))) {
      if (d.searchQuery && !occurrence.title.toLocaleLowerCase(state.profile.locale).includes(d.searchQuery.toLocaleLowerCase(state.profile.locale))) continue;
      const summary = planSummary(state, occurrence.id, d.endLocalDateExclusive);
      if (summary.openRemaining !== '0') push({ ...summary, rowType: 'PLAN', effectiveLocalDate: occurrence.dueLocalDate }, minor(summary.openRemaining));
    }
  } else if (['EnvelopeAvailable','Unassigned'].includes(d.metricId)) {
    const envelopes = state.envelopes.filter(e => e.budgetPoolId === d.budgetPoolId && (!d.envelopeIds.length || d.envelopeIds.includes(e.id)));
    if (d.metricId === 'Unassigned') for (const p of state.postings.filter(p => p.effectiveLocalDate < d.endLocalDateExclusive && get('accounts',p.accountId).budgetPoolId === d.budgetPoolId && get('accounts',p.accountId).includeInBudget)) push({ ...p, rowType: 'POOL_CASH' }, minor(p.signedAmountMinor));
    for (const e of state.allocationEntries.filter(e => e.envelopeId && envelopes.some(v => v.id === e.envelopeId))) {
      const app = get('allocationApplications', e.applicationId); if (app.allocationEffectiveLocalDate >= d.endLocalDateExclusive) continue;
      push({ ...e, effectiveLocalDate: app.allocationEffectiveLocalDate, rowType: 'ALLOCATION' }, minor(e.signedAmountMinor) * (d.metricId === 'Unassigned' ? -1n : 1n));
    }
    for (const link of state.spendLinks.filter(l => l.effectiveLocalDate < d.endLocalDateExclusive && envelopes.some(e => e.id === l.envelopeId))) push({ ...link, rowType: 'ENVELOPE_SPEND' }, minor(link.signedAmountMinor) * (d.metricId === 'Unassigned' ? 1n : -1n));
  } else if (d.metricId === 'ForecastAsOf') {
    for (const p of postings.filter(p => p.effectiveLocalDate <= d.anchorLocalDate)) push({ ...p, rowType: 'ANCHOR_ACTUAL' }, minor(p.signedAmountMinor));
    for (const occurrence of state.occurrences.filter(o => o.currencyCode === d.currencyCode && o.dueLocalDate > d.anchorLocalDate && o.dueLocalDate < d.endLocalDateExclusive && (d.includeArchived||!o.expectedAccountId||!entity(state,'accounts',o.expectedAccountId).archivedAtUtc) && (!d.accountIds.length || d.accountIds.includes(o.expectedAccountId)))) {
      const summary = planSummary(state, occurrence.id, addDays(d.anchorLocalDate,1));
      if (summary.openRemaining !== '0') push({ ...summary, effectiveLocalDate: occurrence.dueLocalDate, rowType: 'FORECAST_PLAN' }, minor(summary.openRemaining) * (occurrence.direction === 'INCOME' ? 1n : -1n));
    }
    excluded.overdue = state.occurrences.filter(o => o.currencyCode === d.currencyCode && o.dueLocalDate <= d.anchorLocalDate && planSummary(state, o.id, d.endLocalDateExclusive).openRemaining !== '0').length;
  }
  rows.sort(byDate);
  const totalMinor = sum(rows.map(r => r.contributionMinor)), groups = new Map();
  for (const row of rows) { const key = row.effectiveLocalDate.slice(0, d.grouping === 'year' ? 4 : d.grouping === 'month' ? 7 : 10); groups.set(key, checked((groups.has(key) ? minor(groups.get(key)) : 0n) + minor(row.contributionMinor))); }
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error('INVALID_PAGINATION');
  return { totalMinor, contributorRows: rows.slice(cursor,cursor + pageSize), groups: [...groups].map(([key, subtotalMinor]) => ({ key, subtotalMinor })), excludedSummary: excluded, descriptor: clone(d), descriptorHash: await digest(d), revision: state.revision, contributionCount: rows.length, paginationCursor: cursor + pageSize < rows.length ? cursor + pageSize : null };
}
export function dailyAccountTimeline(state, descriptor) {
  const d = reportDescriptor(state, { ...descriptor, metricId: 'CashBalanceAsOf' });
  const { get } = indexer(state), postings = state.postings.filter(p => p.effectiveLocalDate < d.endLocalDateExclusive && accountInScope(state,p.accountId,d,get)).sort(byDate);
  const opening = sum(postings.filter(p => p.effectiveLocalDate < d.startLocalDateInclusive).map(p => p.signedAmountMinor)); let balance = minor(opening);
  const byDay = new Map(); for (const p of postings) { const list = byDay.get(p.effectiveLocalDate); if (list) list.push(p); else byDay.set(p.effectiveLocalDate, [p]); }
  const days = daysInRange(d.startLocalDateInclusive,d.endLocalDateExclusive).map(date => { const rows = byDay.get(date) || []; const movement = sum(rows.map(p => p.signedAmountMinor)); balance += minor(movement); return { date, openingMinor: checked(balance - minor(movement)), movementMinor: movement, closingMinor: checked(balance), postingIds: rows.map(p => p.id) }; });
  return { descriptor: d, openingBeforeRangeMinor: opening, days, closingMinor: checked(balance), revision: state.revision };
}

// Net worth as of a local date (inclusive) for one currency. Ledger balances for every account; INVESTMENT accounts
// use their latest valuation <= date instead (falling back to the ledger balance). Spendable excludes INVESTMENT.
// stale: investment with no valuation yet, or whose latest valuation is more than staleDays before date.
export function netWorth(state, { date = todayInTimezone(state.profile.timezoneId), staleDays = 7, currencyCode = state.profile.defaultCurrencyCode } = {}) {
  requireDate(date); money(currencyCode, '0');
  if (!Number.isSafeInteger(staleDays) || staleDays < 0) throw new Error('INVALID_STALE_DAYS');
  const accounts = state.accounts.filter(a => a.currencyCode === currencyCode), ledger = new Map(accounts.map(a => [a.id, 0n])), latest = new Map();
  for (const v of items(state, 'valuations')) if (ledger.has(v.accountId) && v.date <= date && !(latest.get(v.accountId)?.date > v.date)) latest.set(v.accountId, v);
  const since = new Map(); // ledger movement on a valued investment account after its valuation date (transfers in/out keep net worth whole)
  for (const p of state.postings) if (ledger.has(p.accountId) && p.effectiveLocalDate <= date) { const n = minor(p.signedAmountMinor); ledger.set(p.accountId, ledger.get(p.accountId) + n); if (latest.has(p.accountId) && p.effectiveLocalDate > latest.get(p.accountId).date) since.set(p.accountId, (since.get(p.accountId) || 0n) + n); }
  const age = from => (Date.parse(date + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
  const rows = accounts.map(a => {
    const valuation = a.type === 'INVESTMENT' ? latest.get(a.id) : undefined;
    return { accountId: a.id, type: a.type, name: a.name, archived: Boolean(a.archivedAtUtc), includeInBudget: a.includeInBudget, valueMinor: valuation ? checked(minor(valuation.valueMinor) + (since.get(a.id) || 0n)) : checked(ledger.get(a.id)), sinceValuationMinor: valuation ? checked(since.get(a.id) || 0n) : '0', ledgerMinor: checked(ledger.get(a.id)), valuedAt: valuation ? valuation.date : null, valuationId: valuation ? valuation.id : null, stale: a.type === 'INVESTMENT' && (!valuation || age(valuation.date) > staleDays) };
  });
  const total = list => sum(list.map(r => r.valueMinor));
  return { date, currencyCode, staleDays, totalMinor: total(rows), spendableMinor: total(rows.filter(r => r.type !== 'INVESTMENT')), groups: ACCOUNT_TYPES.filter(type => rows.some(r => r.type === type)).map(type => ({ type, totalMinor: total(rows.filter(r => r.type === type)) })), accounts: rows, revision: state.revision };
}

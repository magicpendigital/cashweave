// Synthetic-only core write/report benchmark. No network, no real data, no dependencies.
// Usage: node scripts/bench-core.mjs [--sizes=1000,2000,5000,10000] [--runs=7] [--core=<dir containing core/*.js>]
// The seed is built with the public command API; bulk history replays the exact record shapes
// recordActual/linkExpense/linkSettlement produce (with receipts and audit) so a 10k dataset builds in seconds.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NOW = '2026-10-29T03:00:00.000Z';
export async function loadCore(base = root) {
  const at = file => import(pathToFileURL(join(base, 'core', file)).href);
  const [model, commands, reports, identity, allocation, repository] = await Promise.all(['model.js', 'commands.js', 'reports.js', 'identity.js', 'allocation.js', 'repository.js'].map(at));
  return { ...model, ...commands, ...reports, ...identity, ...allocation, ...repository };
}
const day = i => { const d = new Date(Date.UTC(2025, 0, 1) + (i % 640) * 86400000); return d.toISOString().slice(0, 10); };

export async function buildSynthetic(n, core) {
  let state = core.createDataset(), serial = 0;
  const run = async (type, input) => { const out = await core.prepareCommand(state, { commandId: `bench-seed-${++serial}`, type, input }, state.revision, { now: NOW }); state = out.snapshot; return out.result.resultIds; };
  await run('onboard', { name: 'Synthetic bank', accountType: 'BANK', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2025-01-01' });
  await run('addAccount', { name: 'Synthetic wallet', accountType: 'CASH', currencyCode: 'VND', openingAmountMinor: '0', openingEffectiveLocalDate: '2025-01-01' });
  const [bank, wallet] = state.accounts.map(a => a.id), pool = state.budgetPools[0].id;
  const [incomeCat] = await run('addCategory', { name: 'Synthetic salary', direction: 'INCOME' });
  const [expenseCat] = await run('addCategory', { name: 'Synthetic food', direction: 'EXPENSE' });
  const envelopes = [];
  for (const name of ['Needs', 'Savings', 'Learning', 'Fun']) envelopes.push((await run('addEnvelope', { name, budgetPoolId: pool }))[0]);
  const [, versionId] = await run('saveTemplate', { name: 'Synthetic split', currencyCode: 'VND', fixedScope: 'PER_APPLICATION', lines: envelopes.map((envelopeId, i) => ({ envelopeId, type: 'PERCENT', percentageBps: 2500, priority: i + 1 })) });
  await run('recordActual', { operationType: 'INCOME', accountId: bank, amountMinor: '1000000000000', effectiveLocalDate: '2025-01-01', categoryId: incomeCat });
  const request = { templateVersionId: versionId, budgetPoolId: pool, sourceIds: [state.fundingSources[0].id], requestedAmountMinor: '400000000000', allocationEffectiveLocalDate: '2025-01-01' };
  await run('confirmAllocation', { ...request, previewHash: (await core.previewAllocationV3(state, request)).previewHash });
  const [seriesId] = await run('createMonthlyPlan', { title: 'Synthetic rent', direction: 'EXPENSE', currencyCode: 'VND', amountMinor: '5000000', monthDay: 5, anchorLocalDate: '2025-01-05', expectedAccountId: bank, monthKeys: Array.from({ length: 21 }, (_, i) => `${2025 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`) });
  const plans = state.occurrences.filter(o => o.seriesId === seriesId);
  // Bulk history: same shapes as prepareCommand output, one revision per synthetic command.
  let at = NOW;
  const add = (collection, fields) => { const r = core.record(state, fields, at); state[collection].push(r); return r; };
  let made = state.operations.filter(o => o.operationType !== 'OPENING').length, k = 0;
  while (made < n) {
    const i = k++, date = day(i), commandId = `bench-bulk-${i}`, ids = [];
    at = new Date(Date.parse(date + 'T02:00:00.000Z') + i * 1000).toISOString();
    const kind = i % 10 === 0 ? 'INCOME' : i % 10 === 1 ? 'TRANSFER' : 'EXPENSE', amount = String(10000 + (i % 97) * 1000);
    const operation = add('operations', { operationType: kind, commandId, effectiveLocalDate: date, memo: `Synthetic ${kind.toLowerCase()} ${i}`, committedAtUtc: at, reason: '' });
    const legs = kind === 'TRANSFER' ? [[bank, '-' + amount, 'TRANSFER'], [wallet, amount, 'TRANSFER']] : [[i % 3 ? bank : wallet, kind === 'INCOME' ? amount : '-' + amount, kind]];
    ids.push(operation.id);
    legs.forEach(([accountId, signedAmountMinor, reportingOrigin], stableOrder) => {
      const posting = add('postings', { accountId, signedAmountMinor, reportingOrigin, ...(kind === 'INCOME' ? { categoryId: incomeCat } : kind === 'EXPENSE' ? { categoryId: expenseCat } : {}), operationId: operation.id, currencyCode: 'VND', effectiveLocalDate: date, stableOrder });
      ids.push(posting.id);
      if (kind === 'INCOME') add('fundingSources', { budgetPoolId: pool, sourcePostingId: posting.id, currencyCode: 'VND', eligibleAmountMinor: signedAmountMinor });
      if (kind === 'EXPENSE' && i % 3 === 0) ids.push(add('spendLinks', { expensePostingId: posting.id, envelopeId: envelopes[i % 4], signedAmountMinor: amount, effectiveLocalDate: date, createdByCommandId: commandId }).id);
      const plan = plans.find(p => p.dueLocalDate === date);
      if (kind === 'EXPENSE' && plan && !state.settlements.some(s => s.planOccurrenceId === plan.id)) ids.push(add('settlements', { planOccurrenceId: plan.id, ledgerPostingId: posting.id, signedAmountMinor: amount, currencyCode: 'VND', direction: 'EXPENSE', effectiveLocalDate: date, createdByCommandId: commandId }).id);
    });
    add('receipts', { commandId, payloadHash: (await core.digest({ commandId, type: 'recordActual', input: { i } })), resultIds: ids, committedRevision: state.revision + 1 });
    add('audit', { commandId, type: 'recordActual', resultIds: ids, atUtc: at });
    state.revision++; made++;
  }
  core.validateSnapshot(state);
  return { state, bank, wallet, expenseCat, envelopes, pool };
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function time(fn, runs) { const out = []; for (let i = 0; i < runs; i++) { const t = performance.now(); await fn(i); out.push(performance.now() - t); } return median(out); }
export async function benchWrite(fixture, core, runs = 7) {
  const { state, bank, expenseCat } = fixture; let n = 0;
  return time(() => core.prepareCommand(state, { commandId: `bench-write-${++n}`, type: 'recordActual', input: { operationType: 'EXPENSE', accountId: bank, amountMinor: '25000', effectiveLocalDate: '2026-10-15', categoryId: expenseCat } }, state.revision, { now: NOW }), runs);
}
// Application write path: repository.runAtomicCommand (validated private snapshot, one full validation per write).
export async function benchRepositoryWrite(fixture, core, runs = 7) {
  const { bank, expenseCat } = fixture, repo = core.createMemoryRepository(fixture.state); let n = 0, revision = fixture.state.revision;
  return time(async () => { await repo.runAtomicCommand({ commandId: `bench-repo-${++n}`, type: 'recordActual', input: { operationType: 'EXPENSE', accountId: bank, amountMinor: '25000', effectiveLocalDate: '2026-10-15', categoryId: expenseCat } }, revision++, { now: NOW }); }, runs);
}
async function main() {
  const arg = key => process.argv.find(a => a.startsWith(`--${key}=`))?.split('=').slice(1).join('=');
  const sizes = (arg('sizes') || '1000,2000,5000,10000').split(',').map(Number), runs = Number(arg('runs') || 7), core = await loadCore(arg('core') ? resolve(arg('core')) : root);
  const rows = [];
  for (const size of sizes) {
    const fixture = await buildSynthetic(size, core), { state } = fixture;
    const validate = await time(() => core.validateSnapshot(state), runs);
    const write = await benchWrite(fixture, core, runs), repoWrite = await benchRepositoryWrite(fixture, core, runs);
    const descriptor = metricId => ({ metricId, currencyCode: 'VND', startLocalDateInclusive: '2026-01-01', endLocalDateExclusive: '2026-11-01', datasetRevision: state.revision });
    const expense = await time(() => core.queryReport(state, descriptor('ActualExpense')), runs);
    const balance = await time(() => core.queryReport(state, descriptor('CashBalanceAsOf')), runs);
    const unassigned = await time(() => core.queryReport(state, { ...descriptor('Unassigned'), budgetPoolId: fixture.pool }), runs);
    rows.push({ tx: size, postings: state.postings.length, bytes: JSON.stringify(state).length, validateMs: +validate.toFixed(1), prepareCommandMs: +write.toFixed(1), repoWriteMs: +repoWrite.toFixed(1), reportExpenseMs: +expense.toFixed(1), reportBalanceMs: +balance.toFixed(1), reportUnassignedMs: +unassigned.toFixed(1) });
    console.log(JSON.stringify(rows.at(-1)));
  }
  console.table(rows);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

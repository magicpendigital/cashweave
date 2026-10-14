// Schema-neutral actual-ledger adapter; proposals/plans remain separate pending spec.
import { isValidDate } from './ledger.js';

export function normalizeLedgerQuery(input = {}) {
  const query = { from: input.from || '', to: input.to || '', accountId: input.accountId || '', kind: input.kind || 'all' };
  for (const key of ['from', 'to']) if (query[key] && !isValidDate(query[key])) throw new Error(`Invalid ${key} date`);
  if (query.from && query.to && query.from > query.to) throw new Error('Date range is reversed');
  if (!['all', 'income', 'expense', 'transfer', 'investment'].includes(query.kind)) throw new Error('Invalid transaction kind');
  if (typeof query.accountId !== 'string') throw new Error('Invalid account ID');
  return Object.freeze(query);
}

function accountMovement(tx, accountId) {
  if (tx.kind === 'income') return tx.accountId === accountId ? tx.amount : 0;
  if (tx.kind === 'expense') return tx.accountId === accountId ? -tx.amount : 0;
  if (tx.kind === 'transfer') return (tx.toAccountId === accountId ? tx.amount : 0) - (tx.fromAccountId === accountId ? tx.amount : 0);
  if (tx.kind === 'investment') return (tx.fromAccountId || tx.accountId) === accountId ? -tx.amount : 0;
  return 0;
}

// Overview cards and drilldown must consume this same result/subtotal.
export function queryActualLedger(state, input = {}) {
  const query = normalizeLedgerQuery(input);
  if (query.accountId && !state.accounts.some(a => a.id === query.accountId)) throw new Error('Unknown account');
  const rows = state.transactions.filter(tx => (!query.from || tx.date >= query.from) && (!query.to || tx.date <= query.to)
    && (query.kind === 'all' || tx.kind === query.kind)
    && (!query.accountId || accountMovement(tx, query.accountId) !== 0))
    .map(tx => ({ ...tx }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const subtotal = rows.reduce((sum, tx) => sum + tx.amount, 0);
  if (!Number.isSafeInteger(subtotal)) throw new Error('Subtotal exceeds safe integer range');
  return { query, rows, count: rows.length, subtotal };
}

export function accountTimeline(state, input) {
  const query = normalizeLedgerQuery(input);
  if (query.kind !== 'all') throw new Error('Account balance timeline requires all movement kinds');
  const account = state.accounts.find(a => a.id === query.accountId);
  if (!account) throw new Error('Unknown account');
  let opening = account.openingBalance;
  for (const tx of state.transactions) if (query.from && tx.date < query.from) opening += accountMovement(tx, account.id);
  let closing = opening;
  const result = queryActualLedger(state, query);
  const rows = result.rows.map(tx => {
    const movement = accountMovement(tx, account.id);
    closing += movement;
    if (!Number.isSafeInteger(closing)) throw new Error('Balance exceeds safe integer range');
    return { ...tx, movement, balance: closing };
  });
  if (!Number.isSafeInteger(opening)) throw new Error('Opening balance exceeds safe integer range');
  return { query, opening, rows, movementTotal: closing - opening, closing };
}

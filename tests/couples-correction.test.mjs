import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpace, applyCommand, summary } from '../couples.js';

const today = '2026-10-20';
const cmd = (state, actor, command) => applyCommand(state, actor, command, today);
function joined() {
  let state = cmd(createSpace(), 'A', { type: 'invite', invitee: 'B', token: 'fictional-local-consent', expires: '2026-10-31' });
  return cmd(state, 'B', { type: 'acceptInvite', token: 'fictional-local-consent', consent: true });
}
const entry = (state, actor, id, kind, amount, extra = {}) => cmd(state, actor, { type: 'addEntry', id, kind, amount, date: '2026-10-10', ...extra });
const correct = (state, entryId, id, amount, extra = {}, actor = 'A') => cmd(state, actor, { type: 'correctEntry', id, entryId, amount, date: '2026-10-10', reason: 'Fictional receipt rechecked', ...extra });
const voidEntry = (state, entryId, id, extra = {}, actor = 'A') => cmd(state, actor, { type: 'voidEntry', id, entryId, reason: 'Fictional duplicate removed', ...extra });
function rejectsUnchanged(state, action, pattern) {
  const before = structuredClone(state);
  assert.throws(action, pattern);
  assert.deepEqual(state, before, 'Rejected command changed input state');
}

test('correction preserves identity, attribution and omitted note with complete detached before/after history', () => {
  const original = entry(joined(), 'B', 'original', 'advance', 100, { note: 'Original fictional note' });
  const before = structuredClone(original);
  const revised = correct(original, 'original', 'event-1', 90, { date: '2026-10-11' });
  assert.deepEqual(original, before);
  assert.deepEqual(revised.entries[0], { ...original.entries[0], amount: 90, date: '2026-10-11', voided: false });
  assert.equal(revised.entries[0].actor, 'B');
  assert.deepEqual(revised.entryCorrections[0], { id: 'event-1', entryId: 'original', type: 'correctEntry', actor: 'A', at: today, reason: 'Fictional receipt rechecked', before: original.entries[0], after: revised.entries[0] });
  revised.entries[0].note = 'Independent effective-view mutation';
  assert.equal(revised.entryCorrections[0].after.note, 'Original fictional note');
  revised.entryCorrections[0].before.amount = 5;
  assert.equal(original.entries[0].amount, 100);
});

test('successive correction, void and explicit reactivation retain the complete continuous journal', () => {
  let state = entry(joined(), 'A', 'income', 'contribution', 100);
  state = correct(state, 'income', 'correct-1', 120, { note: 'First replacement' });
  state = correct(state, 'income', 'correct-2', 130, { note: 'Second replacement' }, 'B');
  state = voidEntry(state, 'income', 'void-1');
  assert.equal(summary(state, '2026-10').cash, 0);
  rejectsUnchanged(state, () => voidEntry(state, 'income', 'void-again'), /đã được hủy/);
  rejectsUnchanged(state, () => correct(state, 'income', 'reactivate-without-ack', 130), /xác nhận rõ/);
  state = correct(state, 'income', 'reactivate-1', 110, { reactivate: true, reason: 'Explicit fictional recovery' });
  assert.equal(summary(state, '2026-10').cash, 110);
  assert.equal(state.entries.length, 1);
  assert.equal(state.entryCorrections.length, 4);
  for (let index = 1; index < state.entryCorrections.length; index++) assert.deepEqual(state.entryCorrections[index].before, state.entryCorrections[index - 1].after);
  assert.equal(state.entryCorrections[0].before.amount, 100);
  assert.equal(state.entryCorrections[2].after.voided, true);
  assert.equal(state.entryCorrections[3].after.voided, false);
  assert.deepEqual(JSON.parse(JSON.stringify(state)).entryCorrections, state.entryCorrections);
});

test('editing cannot replace kind, original actor, bill or advance references', () => {
  let state = cmd(joined(), 'A', { type: 'addBill', id: 'bill', title: 'Fictional bill', amount: 100, due: '2026-10-20' });
  state = entry(state, 'B', 'advance', 'advance', 100, { billId: 'bill' });
  state = entry(state, 'A', 'funding', 'contribution', 100);
  state = entry(state, 'B', 'repayment', 'reimbursement', 40, { advanceId: 'advance' });
  for (const fields of [{ kind: 'expense' }, { actor: 'A' }, { billId: 'other-bill' }, { advanceId: 'other-advance' }]) rejectsUnchanged(state, () => correct(state, 'advance', 'event-change', 100, fields), /Giữ nguyên/);
  rejectsUnchanged(state, () => correct(state, 'repayment', 'change-reference', 40, { advanceId: 'other' }), /Giữ nguyên/);
  const next = correct(state, 'advance', 'event-valid', 90);
  assert.equal(next.entries.find(item => item.id === 'advance').billId, 'bill');
  assert.equal(next.entries.find(item => item.id === 'repayment').advanceId, 'advance');
});

test('lowering, delaying or voiding a used contribution cannot overdraw a historical prefix', () => {
  let state = entry(joined(), 'A', 'funding', 'contribution', 100);
  state = entry(state, 'B', 'spending', 'expense', 60, { date: '2026-10-11' });
  for (const action of [() => correct(state, 'funding', 'reduce', 59), () => correct(state, 'funding', 'delay', 100, { date: '2026-10-12' }), () => voidEntry(state, 'funding', 'void-used')]) rejectsUnchanged(state, action, /không đủ tiền/);
  rejectsUnchanged(state, () => correct(state, 'spending', 'outflow-before-cash', 60, { date: '2026-10-09' }), /không đủ tiền/);
  state = correct(state, 'spending', 'reduce-expense', 40, { date: '2026-10-11' });
  assert.equal(summary(state, '2026-10').cash, 60);
  state = voidEntry(state, 'spending', 'void-expense');
  state = voidEntry(state, 'funding', 'void-unused');
  assert.equal(summary(state, '2026-10').cash, 0);
  assert.equal(summary(state, '2026-10').spent, 0);
});

test('expense correction and void return bill capacity and cash; reactivation rechecks both', () => {
  let state = entry(joined(), 'A', 'funding', 'contribution', 100);
  state = cmd(state, 'A', { type: 'addBill', id: 'bill', title: 'Fictional utility', amount: 100, due: '2026-10-20' });
  state = entry(state, 'B', 'expense-1', 'expense', 60, { billId: 'bill' });
  state = correct(state, 'expense-1', 'reduce-expense', 40);
  let out = summary(state, '2026-10');
  assert.equal(out.cash, 60); assert.equal(out.spent, 40); assert.equal(out.bills[0].remaining, 60);
  state = entry(state, 'A', 'expense-2', 'expense', 60, { billId: 'bill' });
  state = voidEntry(state, 'expense-1', 'void-expense');
  out = summary(state, '2026-10');
  assert.equal(out.cash, 40); assert.equal(out.spent, 60); assert.equal(out.bills[0].paid, 60);
  rejectsUnchanged(state, () => correct(state, 'expense-1', 'overpaid-reactivation', 41, { reactivate: true }), /vượt phần hóa đơn/);
  state = correct(state, 'expense-1', 'reactivate-expense', 40, { reactivate: true });
  out = summary(state, '2026-10');
  assert.equal(out.cash, 0); assert.equal(out.spent, 100); assert.equal(out.bills[0].remaining, 0);
});

test('advance correction and void cannot orphan, predate or exceed live reimbursements', () => {
  let state = entry(joined(), 'A', 'funding', 'contribution', 1000);
  state = entry(state, 'B', 'advance', 'advance', 300);
  state = entry(state, 'B', 'reimbursement', 'reimbursement', 100, { advanceId: 'advance', date: '2026-10-12' });
  rejectsUnchanged(state, () => correct(state, 'advance', 'reduce-advance', 99), /vượt số ứng/);
  rejectsUnchanged(state, () => correct(state, 'advance', 'delay-advance', 300, { date: '2026-10-13' }), /không trước ngày ứng/);
  rejectsUnchanged(state, () => voidEntry(state, 'advance', 'void-live-advance'), /còn hoàn ứng/);
  rejectsUnchanged(state, () => correct(state, 'reimbursement', 'early-reimbursement', 100, { date: '2026-10-09' }), /không trước ngày ứng/);
  rejectsUnchanged(state, () => correct(state, 'reimbursement', 'large-reimbursement', 301, { date: '2026-10-12' }), /vượt số ứng/);
  state = voidEntry(state, 'reimbursement', 'void-reimbursement');
  let out = summary(state, '2026-10');
  assert.equal(out.cash, 1000); assert.equal(out.advances.B, 300); assert.equal(out.spent, 300);
  state = voidEntry(state, 'advance', 'void-advance');
  out = summary(state, '2026-10'); assert.equal(out.advances.B, 0); assert.equal(out.spent, 0);
  rejectsUnchanged(state, () => entry(state, 'B', 'orphan', 'reimbursement', 1, { advanceId: 'advance' }), /Chọn khoản ứng/);
  rejectsUnchanged(state, () => correct(state, 'reimbursement', 'orphan-reactivation', 100, { date: '2026-10-12', reactivate: true }), /còn hiệu lực/);
  state = correct(state, 'advance', 'reactivate-advance', 300, { reactivate: true });
  state = entry(state, 'B', 'new-reimbursement', 'reimbursement', 300, { advanceId: 'advance', date: '2026-10-12' });
  out = summary(state, '2026-10'); assert.equal(out.cash, 700); assert.equal(out.advances.B, 0); assert.equal(out.spent, 300);
});

test('reimbursement correction and void release advance capacity without double-counting spent', () => {
  let state = entry(joined(), 'A', 'funding', 'contribution', 200);
  state = entry(state, 'B', 'advance', 'advance', 100);
  state = entry(state, 'B', 'first', 'reimbursement', 60, { advanceId: 'advance' });
  state = entry(state, 'B', 'second', 'reimbursement', 40, { advanceId: 'advance' });
  rejectsUnchanged(state, () => correct(state, 'first', 'too-much', 61), /vượt số ứng/);
  state = correct(state, 'first', 'reduce', 30);
  let out = summary(state, '2026-10'); assert.equal(out.cash, 130); assert.equal(out.advances.B, 30); assert.equal(out.spent, 100);
  state = voidEntry(state, 'second', 'void-second');
  state = entry(state, 'B', 'replacement', 'reimbursement', 70, { advanceId: 'advance' });
  out = summary(state, '2026-10'); assert.equal(out.cash, 100); assert.equal(out.advances.B, 0); assert.equal(out.spent, 100);
});

test('original and replacement closed periods are protected; open edits invalidate only pending closes', () => {
  let state = entry(joined(), 'A', 'september', 'contribution', 100, { date: '2026-09-10' });
  state = cmd(state, 'A', { type: 'proposeClose', id: 'closed-september', month: '2026-09' });
  state = cmd(state, 'B', { type: 'approveClose', id: 'closed-september' });
  const closedBefore = structuredClone(state.closes[0]);
  state = entry(state, 'B', 'october', 'contribution', 50);
  state = cmd(state, 'A', { type: 'proposeClose', id: 'pending-october', month: '2026-10' });
  rejectsUnchanged(state, () => correct(state, 'september', 'closed-original', 100), /kỳ đã chốt/);
  rejectsUnchanged(state, () => voidEntry(state, 'september', 'closed-void'), /kỳ đã chốt/);
  rejectsUnchanged(state, () => correct(state, 'october', 'closed-replacement', 50, { date: '2026-09-20' }), /kỳ đã chốt/);
  state = correct(state, 'october', 'open-correction', 60);
  assert.deepEqual(state.closes, [closedBefore]);
  rejectsUnchanged(state, () => cmd(state, 'B', { type: 'approveClose', id: 'pending-october' }), /không còn/);
  assert.equal(summary(state, '2026-09').cash, closedBefore.snapshot.cash);
});

test('invalid corrections, duplicate event IDs and nonmember edits preserve the complete prior book', () => {
  let state = entry(joined(), 'A', 'funding', 'contribution', 100);
  state = correct(state, 'funding', 'event-used', 100);
  for (const reason of ['', '   ', 'x'.repeat(201), null]) rejectsUnchanged(state, () => correct(state, 'funding', 'reason-bad', 100, { reason }), /lý do/);
  for (const value of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER, '100']) rejectsUnchanged(state, () => correct(state, 'funding', 'amount-bad', value), /VND nguyên/);
  for (const date of ['2026-02-30', '2026-10-21', ['2026-10-10']]) rejectsUnchanged(state, () => correct(state, 'funding', 'date-bad', 100, { date }), /Ngày thay thế/);
  rejectsUnchanged(state, () => correct(state, 'funding', 'bad-note', 100, { note: 'x'.repeat(201) }), /Ghi chú/);
  rejectsUnchanged(state, () => correct(state, 'funding', 'bad-reactivate', 100, { reactivate: 'yes' }), /Xác nhận/);
  for (const id of ['funding', 'event-used']) rejectsUnchanged(state, () => correct(state, 'funding', id, 100), /Mã đã tồn tại/);
  rejectsUnchanged(state, () => voidEntry(state, 'missing', 'missing-event'), /Chọn giao dịch/);
  rejectsUnchanged(state, () => correct(state, 'funding', 'nonmember', 100, {}, 'C'), /chưa tham gia/);
});

test('voided entries are absent from future cash, bill and reimbursement capacities', () => {
  let state = entry(joined(), 'A', 'funding', 'contribution', 100);
  state = cmd(state, 'A', { type: 'addBill', id: 'bill', title: 'Fictional bill', amount: 100, due: '2026-10-20' });
  state = entry(state, 'B', 'advance', 'advance', 100, { billId: 'bill' });
  state = entry(state, 'B', 'reimbursement', 'reimbursement', 100, { advanceId: 'advance' });
  state = voidEntry(state, 'reimbursement', 'void-reimbursement');
  state = voidEntry(state, 'advance', 'void-advance');
  state = entry(state, 'A', 'new-expense', 'expense', 100, { billId: 'bill' });
  const current = summary(state, '2026-10'), next = summary(state, '2026-11');
  assert.equal(current.cash, 0); assert.equal(current.spent, 100); assert.equal(current.bills[0].paid, 100); assert.equal(current.advances.B, 0);
  assert.equal(next.cash, 0); assert.equal(next.spent, 0); assert.equal(next.advances.B, 0);
});

test('old spaces without correction history remain usable; aggregate overflow still fails atomically', () => {
  let state = joined(); delete state.entryCorrections;
  state = entry(state, 'A', 'old-compatible', 'contribution', 1);
  assert.deepEqual(state.entryCorrections, []);
  const large = joined();
  large.entries = Array.from({ length: 9007 }, (_, index) => ({ id: 'fictional-' + index, actor: 'A', kind: 'contribution', amount: 1_000_000_000_000, date: '2026-10-10', note: '' }));
  large.entries[0].amount = 1;
  large.entries.push({ id: 'tail', actor: 'B', kind: 'contribution', amount: 1_000_000_000_000, date: '2026-10-10', note: '' });
  rejectsUnchanged(large, () => correct(large, 'fictional-0', 'overflow-event', 1_000_000_000_000), /giới hạn/);
});

test('linear monthly validation retains per-month spending and combined outstanding-advance bounds', () => {
  const perEntry = 1_000_000_000_000;
  const historicalSpent = joined();
  historicalSpent.entries = Array.from({ length: 9008 }, (_, index) => ({ id: 'fictional-spent-' + index, actor: 'A', kind: 'advance', amount: perEntry, date: '2026-08-10', note: '' }));
  rejectsUnchanged(historicalSpent, () => cmd(historicalSpent, 'A', { type: 'setGoal', title: 'Fictional goal', target: 1 }), /giới hạn/);
  const combined = joined();
  combined.entries = Array.from({ length: 9008 }, (_, index) => ({ id: 'fictional-liability-' + index, actor: index < 4504 ? 'A' : 'B', kind: 'advance', amount: perEntry, date: index < 4504 ? '2026-08-10' : '2026-09-10', note: '' }));
  rejectsUnchanged(combined, () => cmd(combined, 'A', { type: 'setGoal', title: 'Fictional goal', target: 1 }), /giới hạn/);
  const oneActor = structuredClone(combined); for (const item of oneActor.entries) item.actor = 'A';
  rejectsUnchanged(oneActor, () => cmd(oneActor, 'A', { type: 'setGoal', title: 'Fictional goal', target: 1 }), /giới hạn/);
});

test('exact summary totals support safe backdated insertion order without transient Number overflow', () => {
  const state = joined(), perEntry = 1_000_000_000_000;
  state.entries = Array.from({ length: 9008 }, (_, index) => ({ id: 'fictional-exact-' + index, actor: 'A', kind: 'contribution', amount: perEntry, date: index < 4504 ? '2026-08-10' : '2026-09-10', note: '' }));
  state.entries.push({ id: 'fictional-backdated-outflow', actor: 'A', kind: 'expense', amount: perEntry, date: '2026-08-11', note: '' });
  const before = structuredClone(state);
  const next = cmd(state, 'A', { type: 'setGoal', title: 'Fictional exact goal', target: 1 });
  assert.deepEqual(state, before);
  const august = summary(next, '2026-08'), september = summary(next, '2026-09');
  assert.equal(august.cash, 4_503_000_000_000_000); assert.equal(august.spent, perEntry);
  assert.equal(september.cash, 9_007_000_000_000_000); assert.equal(september.spent, 0);
  assert.equal(september.contributions.A, 4_504_000_000_000_000);
  assert.doesNotThrow(() => JSON.stringify(september));
});

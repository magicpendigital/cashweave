// Synthetic DOM + real shared domain/repository contracts. Browser/native
// persistence, rendering and device lifecycle are exercised by separate gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSharedOfflineView } from '../ui/shared-offline-view.js';
import { createMemorySharedRepository } from '../core/shared-repository.js';
import { createSharedDataset } from '../core/shared-schema.js';
import { exportSharedSnapshot } from '../core/shared-backup.js';
import { summary } from '../couples.js';
import { nextHarness } from './next-ui-harness.mjs';

const clock = () => new Date('2026-10-20T10:00:00.000Z');
const creation = { 'shared-book-name': 'Synthetic offline home', 'shared-name-a': 'Synthetic A', 'shared-name-b': 'Synthetic B', 'shared-consent-a': 'yes', 'shared-consent-b': 'yes', 'shared-device-ack': 'yes' };
async function harness({ repository = createMemorySharedRepository(), onDownload = async () => ({ status: 'written' }), onReadBackup = null } = {}) {
  let view;
  const result = await nextHarness({ appFactory: async (root, options) => {
    view = createSharedOfflineView(options.document, { repositoryFactory: async () => repository, clock, onDownload, onReadBackup, FormData: options.browser.FormData });
    root.append(view.element); await view.readyPromise; return view;
  } });
  return { ...result, view, repository, create: () => view.submit('shared-create-form', creation), async entry(kind, amount, extra = {}) {
    await view.go('ledger');
    return view.submit('shared-entry-form', { 'shared-entry-kind': kind, 'shared-entry-amount': String(amount), 'shared-entry-date': '2026-10-20', 'shared-entry-note': 'Synthetic shared entry', ...extra });
  } };
}

test('blank local shared creation requires all three acknowledgements and carries no fake invitation', async () => {
  const h = await harness();
  assert.equal(h.view.snapshot().space, null);
  assert.match(h.text(), /Tạo sổ chung trống/);
  assert.match(h.text(), /không xác thực danh tính/);
  assert.doesNotMatch(h.text(), /MOI-DEMO|Mã lời mời|danh tính đã xác minh/);
  assert.equal((await h.view.submit('shared-create-form', { ...creation, 'shared-consent-b': false })).ok, false);
  assert.equal(h.view.snapshot().space, null);
  assert.equal((await h.create()).ok, true);
  assert.deepEqual(h.view.snapshot().space.members, ['A', 'B']);
  assert.deepEqual(h.view.snapshot().names, { A: 'Synthetic A', B: 'Synthetic B' });
  assert.equal(h.view.snapshot().space.entries.length, 0);
  const ids = h.root.querySelectorAll('[id]').map(node => node.id);
  assert.equal(ids.length, new Set(ids).size);
  h.view.close();
});

test('shared UI records contributions, expenses, advances and reimbursement without double-counting', async () => {
  const h = await harness(); await h.create();
  assert.equal((await h.entry('contribution', 1000)).ok, true);
  h.view.setActor('B'); assert.equal((await h.entry('advance', 300)).ok, true);
  const advance = h.view.snapshot().space.entries.find(entry => entry.kind === 'advance');
  h.view.setActor('A'); assert.equal((await h.entry('expense', 200)).ok, true);
  h.view.setActor('B'); assert.equal((await h.entry('reimbursement', 100, { 'shared-entry-advance': advance.id })).ok, true);
  const state = h.view.snapshot(), totals = summary(state.space, '2026-10');
  assert.equal(totals.cash, 700); assert.equal(totals.spent, 500); assert.equal(totals.advances.B, 200);
  const reopened = await harness({ repository: createMemorySharedRepository({ initialSnapshot: state }) });
  assert.equal(reopened.view.snapshot().space.entries.length, 4);
  assert.match(reopened.text(), /Synthetic offline home/);
  assert.doesNotMatch(reopened.text(), /Tạo sổ chung trống/);
  h.view.close(); reopened.view.close();
});

test('pending shared commits consume Back and block navigation, actor switching and duplicate submit', async () => {
  const repository = createMemorySharedRepository();
  const execute = repository.execute.bind(repository); let release;
  repository.execute = (...args) => new Promise((resolve, reject) => { release = () => execute(...args).then(resolve, reject); });
  const h = await harness({ repository });
  const pending = h.create();
  assert.equal(h.view.isBusy(), true); assert.equal(h.view.back(), true);
  assert.equal(await h.view.go('data'), false); assert.equal(h.view.setActor('B'), false);
  assert.equal((await h.create()).busy, true); assert.equal(h.view.snapshot().space, null);
  release(); await pending;
  assert.equal(h.view.isBusy(), false); assert.equal(h.view.back(), false);
  assert.equal(h.view.snapshot().space.entries.length, 0); h.view.close();
});

test('closing while startup reads are pending closes the repository and never installs a late subscription', async () => {
  for (const delayAt of ['snapshot', 'recovery']) {
    let release, closedCount = 0, subscriptionCount = 0, view;
    const delayed = new Promise(resolve => { release = resolve; });
    const repository = { writable: true, async readSnapshot() { if (delayAt === 'snapshot') await delayed; return createSharedDataset(); }, async listRecoveryDatasets() { if (delayAt === 'recovery') await delayed; return []; }, subscribe() { subscriptionCount++; return () => {}; }, close() { closedCount++; } };
    await nextHarness({ appFactory: async (root, options) => { view = createSharedOfflineView(options.document, { repositoryFactory: async () => repository, clock }); root.append(view.element); return view; } });
    assert.equal(view.isBusy(), true); view.close(); assert.equal(closedCount, 0);
    release(); await view.readyPromise;
    assert.equal(view.isBusy(), false); assert.equal(closedCount, 1); assert.equal(subscriptionCount, 0);
  }
});

test('refresh retries a failed repository open without creating a temporary book', async () => {
  const backing = createMemorySharedRepository(); let attempts = 0, view;
  await nextHarness({ appFactory: async (root, options) => {
    view = createSharedOfflineView(options.document, { repositoryFactory: async () => { if (++attempts === 1) throw new Error('SHARED_INDEXEDDB_UNAVAILABLE'); return backing; }, clock }); root.append(view.element); await view.readyPromise; return view;
  } });
  assert.equal(view.snapshot(), null);
  assert.equal((await view.refresh()).ok, true); assert.equal(attempts, 2); assert.equal(view.snapshot().space, null);
  assert.equal((await view.submit('shared-create-form', creation)).ok, true); view.close();
});

test('stale commit failure preserves confirmed state, switches to read-only and recovers through reload', async () => {
  const h = await harness(); await h.create(); const before = h.view.snapshot();
  const execute = h.repository.execute.bind(h.repository);
  h.repository.execute = async () => { throw new Error('SHARED_REVISION_CONFLICT'); };
  assert.equal((await h.entry('contribution', 100)).ok, false);
  assert.deepEqual(h.view.snapshot(), before);
  assert.match(h.text(), /Chế độ chỉ đọc/); assert.match(h.text(), /Chưa ghi đè/);
  assert.doesNotMatch(h.text(), /Đã lưu thay đổi/);
  h.repository.execute = execute; await h.view.refresh();
  assert.equal((await h.entry('contribution', 100)).ok, true);
  assert.equal(summary(h.view.snapshot().space, '2026-10').cash, 100); h.view.close();
});

test('lost commit acknowledgement keeps last confirmed UI state and reload reveals exactly one persisted command', async () => {
  const h = await harness(); await h.create(); const before = h.view.snapshot();
  const execute = h.repository.execute.bind(h.repository);
  h.repository.execute = async (...args) => { await execute(...args); throw new Error('SHARED_WRITE_NOT_CONFIRMED'); };
  assert.equal((await h.entry('contribution', 25)).ok, false);
  assert.deepEqual(h.view.snapshot(), before); assert.match(h.text(), /Chế độ chỉ đọc/);
  assert.doesNotMatch(h.text(), /Đã lưu thay đổi/);
  assert.equal((await h.entry('contribution', 25)).ok, false);
  h.repository.execute = execute; await h.view.refresh();
  assert.equal(h.view.snapshot().space.entries.length, 1);
  assert.equal(summary(h.view.snapshot().space, '2026-10').cash, 25); h.view.close();
});

test('unavailable safe lock leaves an existing shared book read-only and still allows confirmed export', async () => {
  const source = await harness(); await source.create(); await source.entry('contribution', 30);
  const h = await harness({ repository: createMemorySharedRepository({ initialSnapshot: source.view.snapshot(), locks: null }) });
  assert.match(h.text(), /Chế độ chỉ đọc/); await h.view.go('ledger');
  assert.equal(h.get('shared-entry-form').querySelector('button').disabled, true);
  assert.equal((await h.entry('contribution', 40)).ok, false);
  assert.equal(summary(h.view.snapshot().space, '2026-10').cash, 30);
  await h.view.go('data'); await h.button('Xuất bản sao sổ chung').click();
  assert.match(h.text(), /Đã xác nhận lưu bản sao/); source.view.close(); h.view.close();
});

test('shared bills and goals remain separate from cash funding and count partial payment once', async () => {
  const h = await harness(); await h.create(); await h.view.go('bills');
  assert.equal((await h.view.submit('shared-bill-form', { 'shared-bill-title': 'Synthetic electricity', 'shared-bill-amount': '100', 'shared-bill-due': '2026-10-20' })).ok, true);
  const bill = h.view.snapshot().space.bills[0];
  assert.equal((await h.view.submit('shared-goal-form', { 'shared-goal-title': 'Synthetic goal', 'shared-goal-target': '200' })).ok, true);
  h.view.setActor('B'); await h.entry('advance', 60, { 'shared-entry-bill': bill.id });
  const totals = summary(h.view.snapshot().space, '2026-10');
  assert.equal(totals.cash, 0); assert.equal(totals.spent, 60); assert.equal(totals.bills[0].remaining, 40);
  assert.equal(h.view.snapshot().space.goal.target, 200); h.view.close();
});

test('budget ratio approval and period close explicitly record the second local label', async () => {
  const h = await harness(); await h.create(); await h.entry('contribution', 1000); await h.view.go('agreement');
  assert.equal((await h.view.submit('shared-plan-form', { 'shared-plan-month': '2026-10', 'shared-plan-budget': '101', 'shared-plan-mode': 'ratio', 'shared-plan-a': '60', 'shared-plan-b': '40', 'shared-plan-ack': 'yes' })).ok, true);
  const plan = h.view.snapshot().space.plans[0];
  assert.equal(plan.status, 'pending'); h.view.setActor('B');
  assert.equal((await h.view.submit('shared-approve-plan-' + plan.id, { ['shared-plan-confirm-' + plan.id]: 'yes' })).ok, true);
  assert.deepEqual(summary(h.view.snapshot().space, '2026-10').plan.expected, [60, 41]);
  h.view.setActor('A'); await h.view.go('close');
  await h.view.submit('shared-close-form', { 'shared-close-month': '2026-10', 'shared-close-ack': 'yes' });
  const close = h.view.snapshot().space.closes[0]; h.view.setActor('B');
  assert.equal((await h.view.submit('shared-approve-close-' + close.id, { ['shared-close-confirm-' + close.id]: 'yes' })).ok, true);
  assert.equal(h.view.snapshot().space.closes[0].status, 'closed');
  await h.view.go('ledger'); await h.root.querySelectorAll('button').find(node => node.textContent.startsWith('Xem khoản ')).click();
  assert.match(h.text(), /Khoản thuộc kỳ đã chốt/);
  assert.equal(h.get('shared-correct-form'), null); assert.equal(h.get('shared-void-form'), null);
  const before = h.view.snapshot(); assert.equal((await h.entry('expense', 10)).ok, false); assert.deepEqual(h.view.snapshot(), before); h.view.close();
});

test('valid stored domain IDs with CSS punctuation remain usable through registered form references', async () => {
  const h = await harness(); await h.create();
  const planId = 'plan:fixture.part [synthetic]';
  await h.repository.execute({ commandId: crypto.randomUUID(), actor: 'A', type: 'proposePlan', today: '2026-10-20', input: { id: planId, month: '2026-10', mode: 'fixed', budget: 100, values: [50, 50] } }, h.view.snapshot().revision);
  await h.view.refresh(); await h.view.go('agreement'); h.view.setActor('B');
  assert.equal((await h.view.submit('shared-approve-plan-' + planId, { ['shared-plan-confirm-' + planId]: 'yes' })).ok, true);
  assert.equal(h.view.snapshot().space.plans[0].status, 'active'); h.view.close();
});

test('ordinary shared corrections preserve original attribution, keep void history and require explicit reactivation', async () => {
  const h = await harness(); await h.create(); await h.entry('contribution', 1000); await h.entry('expense', 200);
  const original = h.view.snapshot().space.entries.find(entry => entry.kind === 'expense');
  h.view.setActor('B');
  await h.root.querySelectorAll('button').find(node => node.textContent.startsWith('Xem khoản ') && node.textContent.includes('Chi từ quỹ')).click();
  assert.match(h.text(), /nhãn gốc Synthetic A \(A\)/);
  assert.equal((await h.view.submit('shared-correct-form', { 'shared-correct-amount': '150', 'shared-correct-date': '2026-10-20', 'shared-correct-note': 'Corrected synthetic note', 'shared-correct-reason': 'Synthetic receipt correction' })).ok, true);
  let state = h.view.snapshot(), corrected = state.space.entries.find(entry => entry.id === original.id);
  assert.equal(corrected.actor, 'A'); assert.equal(corrected.kind, 'expense'); assert.equal(corrected.amount, 150);
  assert.equal(state.space.entryCorrections[0].actor, 'B'); assert.equal(state.space.entryCorrections[0].before.amount, 200);
  assert.match(h.text(), /Synthetic receipt correction/); assert.equal(summary(state.space, '2026-10').spent, 150);
  assert.equal((await h.view.submit('shared-void-form', { 'shared-void-reason': 'Synthetic duplicate receipt' })).ok, false);
  assert.equal(h.view.snapshot().space.entryCorrections.length, 1);
  assert.equal((await h.view.submit('shared-void-form', { 'shared-void-reason': 'Synthetic duplicate receipt', 'shared-void-ack': 'yes' })).ok, true);
  assert.equal(summary(h.view.snapshot().space, '2026-10').spent, 0); assert.match(h.text(), /Synthetic duplicate receipt/);
  assert.equal(h.get('shared-void-form'), null);
  const correction = { 'shared-correct-amount': '175', 'shared-correct-date': '2026-10-20', 'shared-correct-note': 'Reactivated receipt', 'shared-correct-reason': 'Synthetic restored receipt' };
  assert.equal((await h.view.submit('shared-correct-form', correction)).ok, false);
  assert.equal(h.view.snapshot().space.entries.find(entry => entry.id === original.id).voided, true);
  assert.equal((await h.view.submit('shared-correct-form', { ...correction, 'shared-correct-reactivate': 'yes' })).ok, true);
  state = h.view.snapshot(); assert.equal(state.space.entryCorrections.length, 3); assert.equal(summary(state.space, '2026-10').spent, 175);
  assert.equal(state.space.entries.find(entry => entry.id === original.id).actor, 'A');
  assert.equal(h.view.back(), true); assert.match(h.text(), /Giao dịch tháng đang xem/);
  const reopened = await harness({ repository: createMemorySharedRepository({ initialSnapshot: state }) }); await reopened.view.go('ledger');
  await reopened.root.querySelectorAll('button').find(node => node.textContent.startsWith('Xem khoản ') && node.textContent.includes('Chi từ quỹ')).click();
  assert.match(reopened.text(), /Synthetic duplicate receipt/); assert.match(reopened.text(), /Synthetic restored receipt/);
  h.view.close(); reopened.view.close();
});

test('voiding a reimbursed advance fails atomically and leaves linked payments intact', async () => {
  const h = await harness(); await h.create(); await h.entry('contribution', 1000); h.view.setActor('B'); await h.entry('advance', 200);
  const advance = h.view.snapshot().space.entries.find(entry => entry.kind === 'advance');
  await h.entry('reimbursement', 100, { 'shared-entry-advance': advance.id });
  await h.root.querySelectorAll('button').find(node => node.textContent.startsWith('Xem khoản ') && node.textContent.includes('Ứng tiền riêng')).click();
  const before = h.view.snapshot();
  assert.equal((await h.view.submit('shared-void-form', { 'shared-void-reason': 'Synthetic linked advance', 'shared-void-ack': 'yes' })).ok, false);
  assert.deepEqual(h.view.snapshot(), before); assert.doesNotMatch(h.text(), /Chế độ chỉ đọc/); h.view.close();
});

test('browser download requested, native cancel and failed file writes never claim a saved backup', async () => {
  let result = { status: 'requested' };
  const h = await harness({ onDownload: async () => result }); await h.create(); await h.view.go('data');
  await h.button('Xuất bản sao sổ chung').click(); assert.match(h.text(), /Chưa xác nhận tệp đã được lưu/); assert.doesNotMatch(h.text(), /Đã xác nhận lưu bản sao/);
  result = { status: 'cancelled' }; await h.button('Xuất bản sao sổ chung').click(); assert.match(h.text(), /Đã hủy lưu tệp/); assert.doesNotMatch(h.text(), /Đã xác nhận lưu bản sao/);
  result = { status: 'failed' }; await h.button('Xuất bản sao sổ chung').click(); assert.doesNotMatch(h.text(), /Đã xác nhận lưu bản sao/);
  result = { status: 'written' }; await h.button('Xuất bản sao sổ chung').click(); assert.match(h.text(), /Đã xác nhận lưu bản sao/); h.view.close();
});

test('cancelled or oversized local shared import never stages or changes the current book', async () => {
  let selected = null;
  const h = await harness({ onReadBackup: async () => selected }); await h.create();
  const before = h.view.snapshot(); await h.view.go('data');
  assert.equal((await h.view.submit('shared-import-form', {})).ok, true);
  assert.match(h.text(), /Đã hủy chọn bản sao/); assert.equal(h.get('shared-activate-form'), null);
  selected = { size: 5 * 1024 * 1024 + 1, text: 'not read' };
  assert.equal((await h.view.submit('shared-import-form', {})).ok, false);
  assert.deepEqual(h.view.snapshot(), before); assert.equal(h.get('shared-activate-form'), null);
  assert.doesNotMatch(h.text(), /Đã kích hoạt/); h.view.close();
});

test('browser file import captures the selected file before the pending render replaces its control', async () => {
  const source = await harness(); await source.create(); await source.entry('contribution', 99);
  const raw = await exportSharedSnapshot(source.view.snapshot());
  const h = await harness(); await h.create(); await h.view.go('data');
  h.get('shared-backup-file').files = [{ size: new TextEncoder().encode(raw).length, text: async () => raw }];
  assert.equal((await h.view.submit('shared-import-form', {})).ok, true);
  assert.match(h.text(), /Bản xem trước khôi phục/); assert.equal(summary(h.view.snapshot().space, '2026-10').cash, 0);
  h.view.back(); assert.equal(h.get('shared-activate-form'), null); source.view.close(); h.view.close();
});

test('shared restore requires preview and two acknowledgements and reloads retained rollback metadata in a new controller', async () => {
  const source = await harness(); await source.create(); await source.entry('contribution', 55);
  const raw = await exportSharedSnapshot(source.view.snapshot());
  const backing = createMemorySharedRepository();
  // This synthetic adapter stays open across UI controller replacement. The
  // real-browser IDB gate separately closes and reopens the database itself.
  const retained = { ...backing, close() {} };
  const h = await harness({ repository: retained, onReadBackup: async () => ({ text: raw, size: new TextEncoder().encode(raw).length }) }); await h.create(); await h.entry('contribution', 100);
  const original = h.view.snapshot(); await h.view.go('data');
  assert.equal((await h.view.submit('shared-import-form', {})).ok, true);
  assert.equal(h.view.snapshot().datasetId, original.datasetId);
  assert.match(h.text(), /Bản xem trước khôi phục/);
  assert.equal((await h.view.submit('shared-activate-form', { 'shared-restore-backup-ack': 'yes' })).ok, false);
  assert.equal(h.view.snapshot().datasetId, original.datasetId);
  assert.equal((await h.view.submit('shared-activate-form', { 'shared-restore-backup-ack': 'yes', 'shared-restore-replace-ack': 'yes' })).ok, true);
  assert.notEqual(h.view.snapshot().datasetId, original.datasetId);
  assert.equal(summary(h.view.snapshot().space, '2026-10').cash, 55);
  // Re-open the controller against the same repository: UI recovery state is
  // obtained from stored metadata, never lastDatasetId held by the old view.
  h.view.close(); const reopened = await harness({ repository: h.repository }); await reopened.view.go('data');
  await reopened.button('Chọn phục hồi bản này').click();
  assert.equal((await reopened.view.submit('shared-rollback-form', { 'shared-rollback-backup-ack': 'yes', 'shared-rollback-ack': 'yes' })).ok, true);
  assert.equal(reopened.view.snapshot().datasetId, original.datasetId);
  assert.equal(summary(reopened.view.snapshot().space, '2026-10').cash, 100);
  source.view.close(); reopened.view.close(); backing.close();
});

test('corrupt active shared storage offers recovery export and binds rollback to its raw metadata', async () => {
  const valid = createSharedDataset(); const future = { ...createSharedDataset(), schemaVersion: 9, revision: 99 };
  let active = future, exported, rollbackOptions;
  const repository = { writable: true, async readSnapshot() { if (active === future) throw new Error('SHARED_FUTURE_SCHEMA_READ_ONLY'); return structuredClone(active); }, async listRecoveryDatasets() { return [{ datasetId: future.datasetId, revision: 99, active: active === future, valid: false, name: 'Future synthetic archive', entries: 0 }, { datasetId: valid.datasetId, revision: 0, active: active === valid, valid: true, name: 'Valid synthetic archive', entries: 0 }]; }, async readRecoverySnapshot(key) { return structuredClone(key === future.datasetId ? future : valid); }, async rollback(key, options) { assert.equal(key, valid.datasetId); rollbackOptions = options; active = valid; return structuredClone(valid); }, close() {} };
  const h = await harness({ repository, onDownload: async raw => { exported = JSON.parse(raw); return { status: 'written' }; } });
  assert.equal(h.view.snapshot(), null); assert.match(h.text(), /Chế độ chỉ đọc/);
  const futureRow = h.root.querySelectorAll('article').find(node => node.textContent.includes('Future synthetic archive'));
  await futureRow.querySelector('button').click(); assert.equal(exported.recoveryOnly, true); assert.equal(exported.entities.schemaVersion, 9);
  await h.button('Chọn phục hồi bản này').click();
  assert.equal((await h.view.submit('shared-rollback-form', { 'shared-rollback-backup-ack': 'yes', 'shared-rollback-ack': 'yes' })).ok, true);
  assert.equal(rollbackOptions.expectedDatasetId, future.datasetId); assert.equal(rollbackOptions.expectedRevision, 99);
  assert.equal(h.view.snapshot().datasetId, valid.datasetId); h.view.close();
});

test('a first and only corrupt shared dataset can stage an external valid backup with a separate recovery acknowledgement', async () => {
  const source = await harness(); await source.create(); await source.entry('contribution', 77);
  const raw = await exportSharedSnapshot(source.view.snapshot()), corrupt = { ...createSharedDataset(), schemaVersion: 9, revision: 99 };
  let restored = null, staged, stageOptions, activationOptions;
  const repository = { writable: true, async readSnapshot() { if (!restored) throw new Error('SHARED_FUTURE_SCHEMA_READ_ONLY'); return structuredClone(restored); }, async listRecoveryDatasets() { return [{ datasetId: corrupt.datasetId, revision: 99, active: !restored, valid: false, name: 'Only corrupt synthetic archive' }, ...(restored ? [{ datasetId: restored.datasetId, revision: restored.revision, active: true, valid: true, name: restored.space.name }] : [])]; }, async stageRestore(candidate, options) { staged = structuredClone(candidate); stageOptions = options; return candidate.id; }, async activateStage(stageId, options) { assert.equal(stageId, staged.id); activationOptions = options; restored = structuredClone(staged.snapshot); return structuredClone(restored); }, close() {} };
  const h = await harness({ repository, onReadBackup: async () => ({ text: raw }) });
  assert.equal(h.view.snapshot(), null); assert.match(h.text(), /Chế độ chỉ đọc/);
  assert.equal((await h.view.submit('shared-import-form', {})).ok, true); assert.deepEqual(stageOptions, { recovery: true });
  assert.ok(!h.get('shared-activate-form').querySelector('button').disabled);
  const acknowledgements = { 'shared-restore-backup-ack': 'yes', 'shared-restore-replace-ack': 'yes' };
  assert.equal((await h.view.submit('shared-activate-form', acknowledgements)).ok, false); assert.equal(h.view.snapshot(), null);
  assert.equal((await h.view.submit('shared-activate-form', { ...acknowledgements, 'shared-restore-recovery-ack': 'yes' })).ok, true);
  assert.equal(activationOptions.expectedDatasetId, corrupt.datasetId); assert.equal(activationOptions.expectedRevision, 99); assert.equal(activationOptions.recoveryConfirmation, true);
  assert.equal(summary(h.view.snapshot().space, '2026-10').cash, 77); assert.doesNotMatch(h.text(), /Chế độ chỉ đọc/);
  assert.match(h.text(), /Only corrupt synthetic archive/); h.view.close(); source.view.close();
});

test('oversized recovery is bounded and sequential; cancelling a part never claims the complete archive was saved', async () => {
  const raw = { ...createSharedDataset(), schemaVersion: 9, opaqueFutureData: 'x'.repeat(6 * 1024 * 1024) };
  const written = [];
  const repository = { writable: false, async readSnapshot() { throw new Error('SHARED_FUTURE_SCHEMA_READ_ONLY'); }, async listRecoveryDatasets() { return [{ datasetId: raw.datasetId, revision: 0, active: true, valid: false, name: 'Oversize synthetic archive' }]; }, async readRecoverySnapshot() { return structuredClone(raw); }, close() {} };
  const h = await harness({ repository, onDownload: async (text, name) => { written.push({ text, name }); return { status: written.length === 1 ? 'written' : 'cancelled' }; } });
  await h.button('Xuất bản phục hồi').click();
  assert.equal(written.length, 2);
  for (const file of written) { assert.ok(new TextEncoder().encode(file.text).length <= 5 * 1024 * 1024); assert.equal(JSON.parse(file.text).recoveryOnly, true); assert.match(file.name, /part-\d+-of-\d+\.json$/); }
  assert.match(h.text(), /chưa xác nhận lưu đủ các phần/); assert.doesNotMatch(h.text(), /Đã xác nhận lưu \d+ tệp phục hồi/); h.view.close();
});

test('production shared UI source uses safe DOM and injected persistence/file capabilities only', async () => {
  const source = await readFile(new URL('../ui/shared-offline-view.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|indexedDB|\.Capacitor|\.fetch\(|innerHTML|<iframe|acceptInvite|MOI-DEMO/);
  assert.match(source, /repositoryFactory\(\)/); assert.match(source, /isBusy:/);
});

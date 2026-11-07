// Synthetic regressions for caller-owned objects crossing async boundaries.
// These tests do not read saves or imply native/browser persistence acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCommand } from '../core/commands.js';
import { createDataset, accountBalance, validateSnapshot } from '../core/model.js';
import { createMemoryRepository } from '../core/repository.js';
import { digest } from '../core/identity.js';

const now = '2026-10-20T01:00:00.000Z';
const opening = commandId => ({ commandId, type: 'onboard', input: {
  name: 'Synthetic captured account', accountType: 'BANK', currencyCode: 'VND',
  openingAmountMinor: '100', openingEffectiveLocalDate: '2026-09-01'
} });

test('prepareCommand captures command and snapshot before hashing, and its receipt describes the stored opening', async () => {
  const snapshot = createDataset(), originalSnapshot = structuredClone(snapshot);
  const command = opening('synthetic-direct-capture'), original = structuredClone(command);
  const pending = prepareCommand(snapshot, command, snapshot.revision, { now });
  command.commandId = 'synthetic-caller-replaced-id';
  command.input.openingAmountMinor = '1000';
  command.input.name = 'Synthetic caller replacement';
  snapshot.revision = 99;
  snapshot.profile.locale = [];
  snapshot.receipts.push({ commandId: original.commandId, payloadHash: 'caller injected' });

  const prepared = await pending, stored = prepared.snapshot;
  assert.equal(prepared.replay, false);
  assert.equal(stored.revision, originalSnapshot.revision + 1);
  assert.equal(stored.profile.locale, originalSnapshot.profile.locale);
  assert.equal(stored.accounts[0].name, original.input.name);
  assert.equal(accountBalance(stored, stored.accounts[0].id), '100');
  assert.equal(stored.postings[0].signedAmountMinor, '100');
  assert.equal(prepared.result.commandId, original.commandId);
  assert.equal(prepared.result.payloadHash, await digest(original));
  assert.notEqual(prepared.result.payloadHash, await digest(command));
  assert.equal(stored.receipts.length, 1);
  assert.doesNotThrow(() => validateSnapshot(stored));

  const replay = await prepareCommand(stored, original, -1, { now });
  assert.equal(replay.replay, true);
  assert.deepEqual(replay.snapshot, stored);
  await assert.rejects(prepareCommand(stored, { ...original, input: { ...original.input, openingAmountMinor: '1000' } }, stored.revision, { now }), /IDEMPOTENCY_CONFLICT/);
});

test('memory repository captures a queued command and option values before its first await', async () => {
  const repository = createMemoryRepository(), before = await repository.readSnapshot();
  const command = opening('synthetic-memory-capture'), original = structuredClone(command);
  const options = { now, failBeforeCommit: false };
  const pending = repository.runAtomicCommand(command, before.revision, options);
  command.commandId = 'synthetic-queued-replacement';
  command.type = 'unknown-caller-replacement';
  command.input.openingAmountMinor = '1000';
  options.now = '2027-01-01T01:00:00.000Z';
  options.failBeforeCommit = true;

  const receipt = await pending, stored = await repository.readSnapshot();
  assert.equal(accountBalance(stored, stored.accounts[0].id), '100');
  assert.equal(stored.operations[0].commandId, original.commandId);
  assert.equal(stored.operations[0].committedAtUtc, now);
  assert.equal(receipt.payloadHash, await digest(original));
  assert.equal(receipt.commandId, original.commandId);
  const replay = await repository.runAtomicCommand(original, before.revision, { now });
  assert.deepEqual(replay, receipt);
  assert.deepEqual(await repository.readSnapshot(), stored);
});

test('mutating a queued abort option cannot turn a rejected income into a save; its original retry commits once', async () => {
  const repository = createMemoryRepository(), initial = await repository.readSnapshot();
  await repository.runAtomicCommand(opening('synthetic-abort-onboard'), initial.revision, { now });
  const before = await repository.readSnapshot();
  const command = { commandId: 'synthetic-captured-abort', type: 'recordActual', input: {
    operationType: 'INCOME', accountId: before.accounts[0].id, amountMinor: '20', effectiveLocalDate: '2026-10-10'
  } }, original = structuredClone(command), options = { now, failBeforeCommit: true };
  const pending = repository.runAtomicCommand(command, before.revision, options);
  command.input.amountMinor = '200';
  options.failBeforeCommit = false;
  await assert.rejects(pending, /SIMULATED_COMMIT_FAILURE/);
  assert.deepEqual(await repository.readSnapshot(), before);

  const receipt = await repository.runAtomicCommand(original, before.revision, { now });
  const saved = await repository.readSnapshot();
  assert.equal(accountBalance(saved, saved.accounts[0].id), '120');
  assert.equal(receipt.payloadHash, await digest(original));
  assert.equal(saved.receipts.filter(value => value.commandId === original.commandId).length, 1);
  assert.deepEqual(await repository.runAtomicCommand(original, before.revision, { now }), receipt);
  assert.deepEqual(await repository.readSnapshot(), saved);
});

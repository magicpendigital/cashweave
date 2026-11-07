import { canonical } from './identity.js';
import { CURRENCY_TABLE_VERSION } from './money.js';

export const MAX_BACKUP_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_PORTABLE_BACKUP_BYTES = 64 * 1024 * 1024;
// This is the exact envelope shape used by migration.js, with fixed-length
// timestamp and checksum placeholders. No asynchronous hash is needed to guard
// the write transaction, and native files retain their separate 5 MiB cap.
export function backupByteLength(snapshot) {
  return new TextEncoder().encode(canonical({formatId:'mach-tien-export',schemaVersion:3,appVersion:'next-mvp-checkpoint-1',exportedAtUtc:'2000-01-01T00:00:00.000Z',datasetId:snapshot.datasetId,currencyTableVersion:CURRENCY_TABLE_VERSION,entities:snapshot,checksum:'0'.repeat(64)})).length;
}
export function assertBackupWriteSize(before, after) {
  const afterBytes = backupByteLength(after);
  if (afterBytes <= MAX_PORTABLE_BACKUP_BYTES) return;
  // Older oversized datasets retain their read/export path and may shrink.
  if (afterBytes < backupByteLength(before)) return;
  throw new Error('BACKUP_RESTORE_LIMIT_EXCEEDED');
}

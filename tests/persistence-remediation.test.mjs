import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, validateSnapshot } from '../core/model.js';
import { createMemoryRepository } from '../core/repository.js';
import { digest } from '../core/identity.js';
import { inspectBackup, exportSnapshot, exportSnapshotFiles, exportRecoverySnapshotFiles, stageRestore, stageRestoreFiles, stageLegacyMigration } from '../core/migration.js';
import { backupByteLength, assertBackupWriteSize, MAX_PORTABLE_BACKUP_BYTES, MAX_BACKUP_FILE_BYTES } from '../core/backup-policy.js';

const legacy = () => ({version:2,accounts:[{id:'bank',name:'Synthetic legacy bank',type:'cash',openingBalance:100}],cards:[],assets:[],transactions:[{id:'income',kind:'income',amount:50,date:'2026-10-01',accountId:'bank',note:'Preserve note'}],plans:[],settings:{buffer:0},budgeting:{templates:[],funds:[],allocations:[],expenseLinks:[]},activity:[],undoPoint:null});
const activation = snapshot => ({expectedDatasetId:snapshot.datasetId,expectedRevision:snapshot.revision,confirm:true,backupAcknowledged:true});

test('CW-03: legacy envelope and v1/v2 direct files are inspected and explicitly mapped, preserving exact backup bytes',async()=>{
  for (const version of [1,2]) {
    const old=legacy();old.version=version;if(version===1){delete old.budgeting;delete old.activity;delete old.undoPoint;}
    for(const enveloped of [false,true]) {
      const raw=JSON.stringify(enveloped?{format:'mach-tien-backup',backupVersion:2,exportedAt:'2026-10-01T00:00:00.000Z',state:old}:old),inspection=inspectBackup(raw);
      assert.equal(inspection.kind,'legacy');assert.equal(inspection.enveloped,enveloped);assert.equal(inspection.sourceVersion,version);assert.equal(inspection.state.transactions[0].note,'Preserve note');
      const missing=await stageLegacyMigration(raw,{backupAcknowledged:true});assert.equal(missing.activationAllowed,false);assert.ok(missing.blockers.includes('OPENING_EFFECTIVE_DATE_REQUIRED:bank'));
      const unacknowledged=await stageLegacyMigration(raw,{openingDates:{bank:'2026-09-01'}});assert.equal(unacknowledged.activationAllowed,false);
      const stage=await stageLegacyMigration(raw,{backupAcknowledged:true,openingDates:{bank:'2026-09-01'}});assert.equal(stage.activationAllowed,true);assert.equal(stage.rawBackup,raw);assert.equal(stage.sourceFingerprint,await digest(raw));assert.equal(stage.report.accountReconciliation[0].afterMinor,'150');assert.equal(stage.snapshot.migrations[0].fromVersion,version);
    }
  }
});

test('CW-03: unsupported legacy credit, assets, settlements and template rules remain explicit migration blockers',async()=>{
  const old=legacy();old.accounts.push({id:'credit',name:'Synthetic credit',type:'credit',openingBalance:-20});old.cards.push({id:'card',name:'Synthetic card',accountId:'credit',limit:100,statementDay:1,dueDay:15});
  const raw=JSON.stringify({format:'mach-tien-backup',backupVersion:2,state:old});
  const stage=await stageLegacyMigration(raw,{backupAcknowledged:true,openingDates:{bank:'2026-09-01',credit:'2026-09-01'}});
  assert.equal(stage.activationAllowed,false);assert.ok(stage.blockers.includes('LEGACY_CREDIT_OR_INVESTMENT_REQUIRES_COMPATIBILITY_MAPPING'));assert.equal(stage.rawBackup,raw);assert.deepEqual(inspectBackup(raw).state.cards,old.cards);
  assert.throws(()=>inspectBackup(JSON.stringify({format:'mach-tien-backup',backupVersion:99,state:old})),/FUTURE_SCHEMA/);
});

test('legacy correction history is preserved in compatibility records and blocks lossy v3 migration',async()=>{
  const old=legacy();old.transactionCorrections=[{id:'correction-1',transactionId:'income',at:'2026-10-20T00:00:00.000Z',reason:'Synthetic correction',before:{amount:60},after:{amount:50}}];
  const raw=JSON.stringify({format:'mach-tien-backup',backupVersion:2,state:old});
  assert.deepEqual(inspectBackup(raw).state.transactionCorrections,old.transactionCorrections);
  const stage=await stageLegacyMigration(raw,{backupAcknowledged:true,openingDates:{bank:'2026-09-01'}});assert.equal(stage.activationAllowed,false);assert.ok(stage.blockers.includes('LEGACY_TRANSACTION_CORRECTIONS_REQUIRES_COMPATIBILITY'));assert.equal(stage.rawBackup,raw);
});

test('CW-07: a fresh stage restores the same backup after rollback while activated and stale stages stay protected',async()=>{
  const repo=createMemoryRepository(),before=await repo.readSnapshot(),raw=await exportSnapshot(createDataset()),first=await stageRestore(raw),stale=await stageRestore(raw);
  await repo.stageRestore(first);await repo.stageRestore(stale);
  const active=await repo.activateStage(first.id,activation(before));assert.deepEqual(await repo.activateStage(first.id,activation(before)),active);
  await assert.rejects(repo.activateStage(stale.id,activation(before)),/REVISION_CONFLICT/);
  await repo.rollback(before.datasetId,{expectedDatasetId:active.datasetId,expectedRevision:active.revision,confirm:true});
  await assert.rejects(repo.activateStage(first.id,activation(before)),/ALREADY_ACTIVATED_OTHER_DATASET/);
  await assert.rejects(repo.activateStage(stale.id,activation(before)),/REVISION_CONFLICT/);
  const fresh=await stageRestore(raw);await repo.stageRestore(fresh);const restored=await repo.activateStage(fresh.id,activation(before));assert.equal(restored.datasetId,fresh.snapshot.datasetId);assert.notEqual(restored.datasetId,active.datasetId);
  await assert.rejects(repo.rollback(before.datasetId,{expectedDatasetId:'stale',expectedRevision:0,confirm:true}),/ROLLBACK_DATASET_REVISION_CONFLICT/);assert.deepEqual(await repo.readSnapshot(),restored);
  const summaries=await repo.listRecoveryDatasets();assert.equal(summaries.filter(s=>s.active).length,1);assert.ok(summaries.some(s=>s.datasetId===before.datasetId&&s.valid&&!s.active));assert.deepEqual(await repo.readRecoverySnapshot(before.datasetId),before);
  await assert.rejects(repo.rollback(before.datasetId,{...activation(restored),failBeforeCommit:true}),/SIMULATED_COMMIT_FAILURE/);assert.deepEqual(await repo.readSnapshot(),restored);
});

test('CW-05: a valid >5 MiB snapshot exports bounded portable parts and restores exactly with reordered files',async()=>{
  const snapshot=createDataset();snapshot.retainedSyntheticData='Dữ liệu giả 🧾 '.repeat(300000);validateSnapshot(snapshot);
  await assert.rejects(exportSnapshot(snapshot),/BACKUP_TOO_LARGE/);
  const files=await exportSnapshotFiles(snapshot);assert.ok(files.length>1);assert.ok(files.every(f=>Buffer.byteLength(f.text)<=MAX_BACKUP_FILE_BYTES));
  const metadata=files.map(f=>inspectBackup(f.text));assert.ok(metadata.every(m=>m.kind==='multipart'&&!m.recoveryOnly));assert.equal(metadata[0].count,files.length);
  const restored=await stageRestoreFiles(files.map(f=>f.text).reverse());assert.equal(restored.activationAllowed,true);assert.equal(restored.snapshot.retainedSyntheticData,snapshot.retainedSyntheticData);assert.equal(restored.report.sourceDatasetId,snapshot.datasetId);
  assert.equal(Buffer.byteLength(restored.rawBackup),metadata[0].totalBytes);
  await assert.rejects(stageRestore(files[0].text),/RESTORE_SCHEMA_UNSUPPORTED/);
  await assert.rejects(stageRestoreFiles(files.slice(1).map(f=>f.text)),/PARTS_INCOMPLETE/);
  await assert.rejects(stageRestoreFiles([files[0].text,files[0].text,...files.slice(2).map(f=>f.text)]),/PART_DUPLICATE/);
  const changed=JSON.parse(files[0].text);changed.bundleId='0'.repeat(64);await assert.rejects(stageRestoreFiles([JSON.stringify(changed),...files.slice(1).map(f=>f.text)]),/PART_SET_MISMATCH/);
  const corrupt=JSON.parse(files[0].text);corrupt.dataBase64=(corrupt.dataBase64[0]==='A'?'B':'A')+corrupt.dataBase64.slice(1);await assert.rejects(stageRestoreFiles([JSON.stringify(corrupt),...files.slice(1).map(f=>f.text)]),/PART_CHECKSUM_MISMATCH/);
  const wrongSize=files.map(f=>{const p=JSON.parse(f.text);p.totalBytes++;return JSON.stringify(p);});await assert.rejects(stageRestoreFiles(wrongSize),/PART_SIZE_MISMATCH/);
  const badBase64=JSON.parse(files[0].text);badBase64.dataBase64='====';assert.throws(()=>inspectBackup(JSON.stringify(badBase64)),/INVALID_BACKUP_PART/);
});

test('CW-05: write policy covers exact export envelope and prevents growth beyond portable restore cap while allowing reduction',async()=>{
  const normal=createDataset(),single=await exportSnapshot(normal);assert.equal(backupByteLength(normal),Buffer.byteLength(single));
  const oversized={...normal,retainedSyntheticData:'x'.repeat(MAX_PORTABLE_BACKUP_BYTES)};
  assert.throws(()=>assertBackupWriteSize(normal,oversized),/BACKUP_RESTORE_LIMIT_EXCEEDED/);
  assert.throws(()=>assertBackupWriteSize(oversized,oversized),/BACKUP_RESTORE_LIMIT_EXCEEDED/);
  assert.doesNotThrow(()=>assertBackupWriteSize({...oversized,retainedSyntheticData:oversized.retainedSyntheticData+'longer'},oversized));
  assert.doesNotThrow(()=>assertBackupWriteSize(oversized,normal));
});

test('CW-06: invalid snapshot emergency archive keeps original profile without becoming an activatable backup',async()=>{
  const snapshot=createDataset();snapshot.profile.locale=[];
  const [file]=await exportRecoverySnapshotFiles(snapshot);assert.equal(inspectBackup(file.text).kind,'recovery-archive');assert.deepEqual(JSON.parse(file.text).entities.profile.locale,[]);
  await assert.rejects(stageRestore(file.text),/RESTORE_SCHEMA_UNSUPPORTED/);
  snapshot.retainedSyntheticData='x'.repeat(5*1024*1024);
  const files=await exportRecoverySnapshotFiles(snapshot);assert.ok(files.length>1);assert.ok(files.every(f=>inspectBackup(f.text).recoveryOnly));assert.ok(files.every(f=>Buffer.byteLength(f.text)<=MAX_BACKUP_FILE_BYTES));
  await assert.rejects(stageRestoreFiles(files.map(f=>f.text)),/BACKUP_RECOVERY_ARCHIVE_READ_ONLY/);
});

// Distinguish rejected external files from failures of the current shared store.
import test from 'node:test';
import assert from 'node:assert/strict';
import {nextHarness} from './next-ui-harness.mjs';
import {createMemorySharedRepository} from '../core/shared-repository.js';
import {createDataset} from '../core/model.js';
import {exportSnapshot} from '../core/migration.js';
import {exportSharedSnapshot,exportSharedRecovery,inspectSharedBackup} from '../core/shared-backup.js';
import {digest} from '../core/identity.js';
const creation={'shared-book-name':'QA import home','shared-name-a':'QA A','shared-name-b':'QA B','shared-consent-a':'yes','shared-consent-b':'yes','shared-device-ack':'yes'};
const file=text=>({text,size:Buffer.byteLength(text)});
async function fixture(){
  const repository=createMemorySharedRepository();let selected;
  const h=await nextHarness({appOptions:{sharedRepositoryFactory:async()=>repository,onReadBackup:async()=>selected}});
  await h.app.go('shared');const view=h.app.sharedController();await view.readyPromise;await view.submit('shared-create-form',creation);await view.go('data');
  return {...h,view,repository,select:value=>{selected=value;}};
}
const personal=await exportSnapshot(createDataset());
test('personal or unknown backup formats are not misclassified as a newer shared schema',()=>{
  for(const raw of [personal,JSON.stringify({formatId:'unknown',schemaVersion:999,backupVersion:999})])assert.throws(()=>inspectSharedBackup(raw),/SHARED_INVALID_BACKUP_FORMAT/);
});

for(const kind of ['personal','future-shared','recovery-only','journal-mismatch'])test('rejecting '+kind+' input preserves a healthy writable shared book',async()=>{
  const h=await fixture();try{
    const before=h.view.snapshot();let raw;
    if(kind==='personal')raw=personal;
    else if(kind==='recovery-only')raw=await exportSharedRecovery(before);
    else {
      const value=JSON.parse(await exportSharedSnapshot(before));
      if(kind==='future-shared')value.schemaVersion=2;
      else value.entities.names.A='Altered name outside journal';
      const {checksum,...payload}=value;value.checksum=await digest(payload);raw=JSON.stringify(value);
    }
    h.select(file(raw));assert.equal((await h.view.submit('shared-import-form',{})).ok,false);
    assert.deepEqual(h.view.snapshot(),before);assert.ok(!h.get('shared-activate-form'));
    assert.doesNotMatch(h.text(),/Chế độ chỉ đọc/);
    if(kind==='personal')assert.match(h.text(),/bản sao sổ chung/);
    await h.view.go('ledger');assert.equal((await h.view.submit('shared-entry-form',{'shared-entry-kind':'contribution','shared-entry-amount':'10','shared-entry-date':'2026-10-20','shared-entry-note':'QA after rejection'})).ok,true);
    assert.equal(h.view.snapshot().space.entries.length,1);
  }finally{h.app.close();}
});

test('a real repository failure after file validation still locks writing until verified refresh',async()=>{
  const h=await fixture();try{
    const before=h.view.snapshot();h.select(file(await exportSharedSnapshot(before)));
    const stage=h.repository.stageRestore.bind(h.repository);
    h.repository.stageRestore=async()=>{throw new Error('SHARED_JOURNAL_STATE_MISMATCH');};
    assert.equal((await h.view.submit('shared-import-form',{})).ok,false);assert.match(h.text(),/Chế độ chỉ đọc/);assert.deepEqual(h.view.snapshot(),before);
    await h.view.go('ledger');assert.equal((await h.view.submit('shared-entry-form',{'shared-entry-kind':'contribution','shared-entry-amount':'10','shared-entry-date':'2026-10-20'})).ok,false);
    h.repository.stageRestore=stage;await h.view.refresh();assert.doesNotMatch(h.text(),/Chế độ chỉ đọc/);
  }finally{h.app.close();}
});

test('a future active repository is still read-only and cannot create a replacement book',async()=>{
  const repository=createMemorySharedRepository();repository.readSnapshot=async()=>{throw new Error('SHARED_FUTURE_SCHEMA_READ_ONLY');};
  const h=await nextHarness({appOptions:{sharedRepositoryFactory:async()=>repository}});
  try{await h.app.go('shared');const view=h.app.sharedController();await view.readyPromise;assert.equal(view.snapshot(),null);assert.match(h.text(),/Chế độ chỉ đọc/);assert.ok(!h.get('shared-create-form'));}finally{h.app.close();}
});

test('rejecting a file cannot unlock an existing read-only repository',async()=>{
  const source=await fixture(),before=source.view.snapshot();source.app.close();
  const repository=createMemorySharedRepository({initialSnapshot:before,locks:null});
  const value=JSON.parse(await exportSharedSnapshot(before));value.schemaVersion=2;
  const h=await nextHarness({appOptions:{sharedRepositoryFactory:async()=>repository,onReadBackup:async()=>file(JSON.stringify(value))}});
  try{
    await h.app.go('shared');const view=h.app.sharedController();await view.readyPromise;await view.go('data');
    assert.match(h.text(),/Chế độ chỉ đọc/);await view.submit('shared-import-form',{});
    assert.match(h.text(),/Chế độ chỉ đọc/);assert.equal(repository.writable,false);assert.deepEqual(view.snapshot(),before);
    await view.go('ledger');assert.equal((await view.submit('shared-entry-form',{'shared-entry-kind':'contribution','shared-entry-amount':'10','shared-entry-date':'2026-10-20'})).ok,false);
  }finally{h.app.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createDataset} from '../core/model.js';
import {exportSnapshot,exportSnapshotFiles} from '../core/migration.js';
import {exportSharedSnapshot} from '../core/shared-backup.js';
import {nextHarness} from './next-ui-harness.mjs';

const initial=createDataset(),valid=await exportSnapshot(initial),file=text=>({text,size:Buffer.byteLength(text)});
test('a cancelled or invalid replacement selection discards the previous personal activation preview',async()=>{
  for(const replacement of [null,file('{broken')]){
    let next=file(valid);const h=await nextHarness({initial,appOptions:{onReadBackup:async()=>next}});
    try{
      await h.app.go('data');const before=h.app.snapshot();await h.submit('restore-form',{});
      assert.ok(h.get('activate-stage-form'));
      next=replacement;await h.submit('restore-form',{});
      assert.ok(!h.get('activate-stage-form'),'old personal preview must be removed');assert.deepEqual(h.app.snapshot(),before);
    }finally{h.app.close();}
  }
});

test('a new personal preview requires fresh confirmations instead of reusing the previous form draft',async()=>{
  const h=await nextHarness({initial,appOptions:{onReadBackup:async()=>file(valid)}});
  try{
    await h.app.go('data');await h.submit('restore-form',{});
    await h.submit('activate-stage-form',{backupAck:'yes'});
    await h.submit('restore-form',{});
    const acknowledgement=h.get('activate-stage-form').querySelector('[name="backupAck"]');
    assert.notEqual(acknowledgement.checked,true);
  }finally{h.app.close();}
});

test('complete native multipart preview replaces selection progress without changing the active book',async()=>{
  const large=structuredClone(initial);large.retainedSyntheticData='Q'.repeat(5_600_000);
  const selected=await exportSnapshotFiles(large);
  const h=await nextHarness({initial,appOptions:{onReadBackup:async()=>file(selected.shift().text)}});
  try{
    await h.app.go('data');const before=h.app.snapshot();await h.submit('restore-form',{});
    assert.ok(h.get('activate-stage-form'));assert.equal(h.get('feedback').textContent,'');
    assert.deepEqual(h.app.snapshot(),before);
  }finally{h.app.close();}
});

test('failed or cancelled replacement imports discard the old shared preview and its confirmations',async()=>{
  for(const replacement of [null,file('{broken')]){
    let next;const h=await nextHarness({appOptions:{onReadBackup:async()=>next}});
    try{
      await h.app.go('shared');const view=h.app.sharedController();await view.readyPromise;
      await view.submit('shared-create-form',{'shared-book-name':'QA book','shared-name-a':'QA A','shared-name-b':'QA B','shared-consent-a':'yes','shared-consent-b':'yes','shared-device-ack':'yes'});
      const before=view.snapshot();next=file(await exportSharedSnapshot(before));
      await view.go('data');assert.equal((await view.submit('shared-import-form',{})).ok,true);
      assert.ok(h.get('shared-activate-form'));
      await view.submit('shared-activate-form',{'shared-restore-backup-ack':'yes'});
      next=replacement;await view.submit('shared-import-form',{});
      assert.ok(!h.get('shared-activate-form'),'old shared preview must be removed');assert.deepEqual(view.snapshot(),before);
      next=file(await exportSharedSnapshot(before));await view.submit('shared-import-form',{});
      assert.notEqual(h.get('shared-activate-form').querySelector('[name="shared-restore-backup-ack"]').checked,true);
    }finally{h.app.close();}
  }
});

test('a personal stage completing after navigation cannot reinstall an old preview',async()=>{
  let signal,release;
  const entered=new Promise(resolve=>{signal=resolve;}),held=new Promise(resolve=>{release=resolve;});
  const h=await nextHarness({initial,appOptions:{onReadBackup:async()=>file(valid)}});
  try{
    await h.app.go('data');const repo=h.repositories.get('personal'),original=repo.stageRestore.bind(repo);
    repo.stageRestore=async(...args)=>{await original(...args);signal();await held;};
    const pending=h.submit('restore-form',{});await entered;await h.app.go('help');release();await pending;
    assert.equal(h.app.currentRoute(),'help');await h.app.go('data');
    assert.ok(!h.get('activate-stage-form'),'late staging must not restore a discarded preview');
  }finally{release?.();h.app.close();}
});

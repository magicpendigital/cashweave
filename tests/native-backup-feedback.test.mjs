// Synthetic native-adapter/UI contracts. Device and file-provider QC is separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeBackupAdapter} from '../mobile/backup-bridge.js';
import {createDataset} from '../core/model.js';
import {exportSnapshot,exportSnapshotFiles} from '../core/migration.js';
import {nextHarness} from './next-ui-harness.mjs';

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function notices(){let current='Đã lưu bản sao JSON vào vị trí bạn chọn.';const history=[];return {show(text,error=false){current=text;history.push({text,error});},clear(){current='';history.push({cleared:true});},current:()=>current,history};}

test('a new native read clears the previous saved claim before the picker completes',async()=>{
  const pending=deferred(),status=notices();
  const io=createNativeBackupAdapter({openJson:()=>pending.promise},status.show,status.clear);
  const reading=io.onReadBackup();assert.equal(status.current(),'');
  pending.resolve({text:'{}',bytes:2});assert.deepEqual(await reading,{text:'{}',size:2});
  assert.equal(status.current(),'','reading bytes does not claim backup validation or activation');
});

test('a new write clears the previous saved claim and acknowledges only the completed write',async()=>{
  const pending=deferred(),status=notices();
  const io=createNativeBackupAdapter({saveJson:()=>pending.promise},status.show,status.clear);
  const writing=io.onDownload('{}','qa.json');assert.equal(status.current(),'');
  pending.resolve({saved:true,bytes:2});assert.equal((await writing).status,'written');
  assert.match(status.current(),/^Đã lưu bản sao JSON/);
});

test('an overlapping native request keeps the busy warning and does not clear another operation',async()=>{
  const pending=deferred(),status=notices();let reads=0;
  const io=createNativeBackupAdapter({saveJson:()=>pending.promise,openJson:async()=>{reads++;return {cancelled:true};}},status.show,status.clear);
  const writing=io.onDownload('{}','qa.json');await io.onReadBackup();
  assert.equal(reads,0);assert.match(status.current(),/Đang chọn hoặc lưu tệp/);
  assert.equal(status.history.filter(n=>n.cleared).length,1);
  pending.resolve({cancelled:true});await writing;
  await io.onReadBackup();assert.equal(reads,1);assert.match(status.current(),/Đã hủy chọn/);
});

const initial=createDataset(),valid=await exportSnapshot(initial);
const future=JSON.parse(valid);future.schemaVersion=999;
const checksum=JSON.parse(valid);checksum.checksum='0'.repeat(64);
for(const [name,raw,expected] of [
  ['future schema',JSON.stringify(future),/phiên bản dữ liệu mới hơn/],
  ['checksum mismatch',JSON.stringify(checksum),/Không xác minh được tính toàn vẹn/],
  ['invalid JSON','{broken',/không phải bản sao JSON hợp lệ/]
])test('native '+name+' rejection explains the file problem and keeps the active book',async()=>{
  const status=notices(),io=createNativeBackupAdapter({openJson:async()=>({text:raw,bytes:Buffer.byteLength(raw)})},status.show,status.clear);
  const h=await nextHarness({initial,appOptions:{onReadBackup:io.onReadBackup}});
  try{
    await h.app.go('data');const before=h.app.snapshot();await h.submit('restore-form',{});
    assert.equal(status.current(),'');assert.match(h.get('feedback').textContent,expected);
    assert.match(h.get('feedback').textContent,/sổ đang dùng|Sổ hiện tại/);
    assert.equal(h.get('activate-stage-form'),null);assert.deepEqual(h.app.snapshot(),before);
  }finally{h.app.close();}
});

test('duplicate native multipart selection reports the backup problem and cannot activate it',async()=>{
  const large=structuredClone(initial);large.retainedSyntheticData='Q'.repeat(5_600_000);
  const parts=await exportSnapshotFiles(large),selected=[parts[0],parts[0],parts[2]];
  const h=await nextHarness({initial,appOptions:{onReadBackup:async()=>{const file=selected.shift();return {text:file.text,size:Buffer.byteLength(file.text)};}}});
  try{
    await h.app.go('data');const before=h.app.snapshot();await h.submit('restore-form',{});
    assert.match(h.get('feedback').textContent,/Không thể xác nhận đủ bộ sao lưu/);
    assert.equal(h.get('activate-stage-form'),null);assert.deepEqual(h.app.snapshot(),before);
  }finally{h.app.close();}
});

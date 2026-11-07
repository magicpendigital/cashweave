// Real DOM + IndexedDB, with a synthetic native file adapter. No device SAF claim.
import {createNextApp} from '../ui/app.js';
import {createNativeBackupAdapter} from '../mobile/backup-bridge.js';
import {exportSnapshot,exportSnapshotFiles} from '../core/migration.js';
import {exportSharedSnapshot} from '../core/shared-backup.js';
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
export async function verifyBackupFeedbackBrowserUi(){
  const checks=[],root=document.createElement('div'),notice=document.createElement('div');
  root.id='next-app';notice.id='native-feedback';document.body.replaceChildren(notice,root);
  let selected=[];
  const adapter=createNativeBackupAdapter({
    saveJson:async({text})=>({saved:true,bytes:new TextEncoder().encode(text).length}),
    openJson:async()=>{const text=selected.shift();return text===null?{cancelled:true}:{text,bytes:new TextEncoder().encode(text).length};}
  },text=>{notice.textContent=text;},()=>notice.replaceChildren());
  const app=await createNextApp(root,{namespace:'sandbox',...adapter});
  try{
    if(!app.snapshot().profile.onboardingCompletedAtUtc){await app.go('create');await app.submit('onboard-form',{locale:'vi-VN',currencyCode:'VND',timezoneId:'Asia/Ho_Chi_Minh',name:'Synthetic feedback bank',accountType:'BANK',opening:'100',openingDate:'2026-10-01'});}
    await app.go('data');const before=JSON.stringify(app.snapshot()),valid=await exportSnapshot(app.snapshot());
    await adapter.onDownload(valid,'qa.json');assert(notice.textContent.startsWith('Đã lưu'),'synthetic confirmed write must show its result');
    const future=JSON.parse(valid);future.schemaVersion=999;selected=[JSON.stringify(future)];await app.submit('restore-form',{});
    assert(!notice.textContent&&!document.getElementById('activate-stage-form')&&document.getElementById('feedback').textContent.includes('phiên bản dữ liệu mới hơn'),'future backup rejection must clear the previous native saved claim');checks.push('future backup message and stale native claim cleared');
    selected=[valid];await app.submit('restore-form',{});await app.submit('activate-stage-form',{backupAck:'yes'});
    selected=[valid];await app.submit('restore-form',{});
    assert(!document.querySelector('#activate-stage-form [name="backupAck"]').checked,'new preview must require a fresh acknowledgement');checks.push('personal preview confirmations reset');
    const corrupt=JSON.parse(valid);corrupt.checksum='0'.repeat(64);selected=[JSON.stringify(corrupt)];await app.submit('restore-form',{});
    assert(!document.getElementById('activate-stage-form')&&document.getElementById('feedback').textContent.includes('tính toàn vẹn'),'invalid replacement must remove old activation preview');checks.push('invalid replacement removes previous personal preview');
    const large=app.snapshot();large.retainedSyntheticData='Q'.repeat(5_600_000);selected=(await exportSnapshotFiles(large)).map(f=>f.text);
    await app.submit('restore-form',{});assert(document.getElementById('activate-stage-form')&&!document.getElementById('feedback').textContent,'complete multipart must replace progress with the preview');checks.push('multipart completion clears progress');
    selected=[null];await app.submit('restore-form',{});
    assert(!document.getElementById('activate-stage-form')&&notice.textContent.includes('Đã hủy chọn'),'cancelled replacement must discard the old preview');checks.push('cancelled replacement removes personal preview');
    assert(JSON.stringify(app.snapshot())===before,'preview and rejected imports must leave the active financial records exact');checks.push('personal book unchanged after preview/rejection/cancel');
    await app.go('shared');const shared=app.sharedController();await shared.readyPromise;
    if(!shared.snapshot().space)await shared.submit('shared-create-form',{'shared-book-name':'Synthetic feedback home','shared-name-a':'QA A','shared-name-b':'QA B','shared-consent-a':'yes','shared-consent-b':'yes','shared-device-ack':'yes'});
    const sharedBefore=JSON.stringify(shared.snapshot()),sharedRaw=await exportSharedSnapshot(shared.snapshot());await shared.go('data');
    selected=[sharedRaw];await shared.submit('shared-import-form',{});await shared.submit('shared-activate-form',{'shared-restore-backup-ack':'yes'});
    selected=['{broken'];await shared.submit('shared-import-form',{});
    assert(!document.getElementById('shared-activate-form'),'failed replacement must remove shared preview');
    const futureShared=JSON.parse(sharedRaw);futureShared.schemaVersion=2;
    selected=[JSON.stringify(futureShared)];await shared.submit('shared-import-form',{});
    assert(!document.getElementById('shared-activate-form')&&!root.textContent.includes('Chế độ chỉ đọc'),'rejected future file cannot make a healthy store read-only');
    await shared.go('ledger');assert(!document.querySelector('#shared-entry-form button[type="submit"]').disabled,'healthy store must still allow ordinary writes after input rejection');
    await shared.go('data');checks.push('rejected future shared file leaves healthy store writable');
    selected=[sharedRaw];await shared.submit('shared-import-form',{});
    assert(!document.querySelector('#shared-activate-form [name="shared-restore-backup-ack"]').checked,'shared preview must require a fresh acknowledgement');
    assert(JSON.stringify(shared.snapshot())===sharedBefore,'shared preview changes must not mutate the active shared book');checks.push('shared replacement preview and fresh confirmations');
    await app.go('data');return {passed:checks.length,checks,scope:'Real DOM and IndexedDB in isolated Edge; native picker simulated, no activation'};
  }finally{app.close();}
}

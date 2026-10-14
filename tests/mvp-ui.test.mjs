import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './ui-harness.mjs';
import { localDate } from '../ledger.js';
import { exportBackup } from '../storage.js';
const storageKey = 'financial-assistant-prototype-v1';
const tx = (kind = 'income', amount = '20000000') => ({ kind, amount, date: localDate(), accountId: 'bank-main', note: 'Synthetic UI', category: 'Test' });
const plain = obj => JSON.parse(JSON.stringify(obj));
function preview(app, { mode = 'template', template = 'builtin-503020', amount = '20000000' } = {}) {
  app.get('amount').value = amount;
  app.get('allocation-mode').value = mode;
  app.api.beginAllocationEditor(template);
  app.api.showAllocationPreview();
}

test('new personal allocation/data views render alongside intact old shell', () => {
  const app = harness();
  app.api.setView('allocations');
  assert.match(app.get('view').innerHTML, /Phân bổ sau/);
  assert.match(app.get('view').innerHTML, /Chỉ học · chưa triển khai/);
  assert.match(app.get('view').innerHTML, /Dùng cho khoản thu mới/);
  app.api.setView('data');
  assert.match(app.get('view').innerHTML, /plaintext/);
  assert.match(app.get('view').innerHTML, /Web Locks/);
});

test('income defaults to record-only; ordinary expense needs no template or fund', async () => {
  const app = harness(); app.api.openTransactionModal();
  assert.equal(app.get('allocation-mode').value, 'none');
  const before = app.api.getState().transactions.length;
  await app.submit('transaction-form', tx());
  assert.equal(app.api.getState().transactions.length, before + 1);
  assert.equal(app.api.getState().budgeting.allocations.length, 0);
  app.api.openTransactionModal(); await app.change('kind', 'expense');
  assert.match(app.get('transaction-fields').innerHTML, /Không gắn quỹ · ghi chi bình thường/);
  await app.submit('transaction-form', tx('expense', '50000'));
  assert.equal(app.api.getState().transactions.length, before + 2);
  assert.equal(app.api.getState().budgeting.expenseLinks.length, 0);
});

test('template use requires preview; numeric basis and fixed repeat warning displayed', async () => {
  const app = harness(); app.api.openTransactionModal('builtin-fixed');
  app.get('amount').value = '20000000';
  const before = plain(app.api.getState());
  await app.submit('transaction-form', { ...tx(), 'allocation-mode': 'template' });
  assert.deepEqual(plain(app.api.getState()), before);
  assert.match(app.get('form-error').innerHTML, /Xem trước phép chia/);
  app.api.showAllocationPreview();
  const html = app.get('allocation-preview').innerHTML;
  assert.match(html, /14\.000\.000/); assert.match(html, /50% × 14\.000\.000/); assert.match(html, /đợt thứ hai/); assert.match(html, /mỗi lần áp dụng/);
  await app.submit('transaction-form', { ...tx(), 'allocation-mode': 'template' });
  assert.equal(app.api.getState().transactions.length, before.transactions.length + 1);
  assert.equal(app.api.getState().budgeting.allocations.length, 1);
});

test('changed amount invalidates reviewed preview and cannot silently apply', async () => {
  const app = harness(); app.api.openTransactionModal(); preview(app);
  app.get('amount').value = '21000000';
  await app.submit('transaction-form', { ...tx('income','21000000'), 'allocation-mode':'template' });
  assert.equal(app.api.getState().budgeting.allocations.length, 0);
  assert.match(app.get('form-error').innerHTML, /Xem trước/);
});

test('custom partial allocation can allocate remainder later without duplicate income', async () => {
  const app = harness(); app.api.openTransactionModal();
  preview(app, { mode: 'custom' });
  app.api.getDraft().rows = [{ name:'UI purpose', kind:'fixed', value:5000000, accountId:'' }];
  app.api.showAllocationPreview();
  const before = app.api.getState().transactions.length;
  await app.submit('transaction-form', { ...tx(), 'allocation-mode':'custom' });
  const incomeId = app.api.getState().transactions.at(-1).id;
  app.api.openLaterAllocation(incomeId);
  assert.equal(app.get('allocation-amount').value, '15000000');
  app.get('allocation-mode').value = 'custom'; app.api.beginAllocationEditor();
  app.api.getDraft().rows = [{ name:'UI purpose', kind:'remainder', value:0, accountId:'' }]; app.api.showAllocationPreview();
  await app.submit('allocation-form', {}, { incomeId });
  assert.equal(app.api.getState().transactions.length, before + 1);
  assert.equal(app.api.getState().budgeting.allocations.length, 2);
  assert.equal(app.api.getState().budgeting.funds.length, 1);
  assert.equal(app.api.getState().budgeting.allocations.at(-1).lines[0].amount,15000000);
});

test('copy customization persists without changing builtin and survives reload', async () => {
  const app = harness(); app.api.openTemplateEditor('builtin-503020');
  app.api.getDraft().rows[0].value = 40;
  await app.submit('template-form', { templateName:'My synthetic template' });
  const saved = app.api.getState().budgeting.templates[0];
  assert.equal(saved.rows[0].value,40);
  const reloaded = harness({ values: app.values });
  assert.equal(reloaded.api.getState().budgeting.templates[0].name,'My synthetic template');
  reloaded.api.openTemplateEditor('builtin-503020');
  assert.equal(reloaded.api.getDraft().rows[0].value,50);
});

test('linked expense remains one transaction and overspend rejects atomically', async () => {
  const app = harness(); app.api.openTransactionModal(); preview(app);
  await app.submit('transaction-form', { ...tx(), 'allocation-mode':'template' });
  const fundId = app.api.getState().budgeting.funds[0].id;
  const before = app.api.getState().transactions.length;
  app.api.openTransactionModal();
  await app.submit('transaction-form', { ...tx('expense','50000'), 'expense-fund':fundId });
  assert.equal(app.api.getState().transactions.length,before+1);
  assert.equal(app.api.getState().budgeting.expenseLinks.length,1);
  const saved = plain(app.api.getState()); app.api.openTransactionModal();
  await app.submit('transaction-form', { ...tx('expense','20000000'), 'expense-fund':fundId });
  assert.deepEqual(plain(app.api.getState()),saved);
});

test('save failure leaves state and modal unchanged with no success toast', async () => {
  const app = harness({ failWrite:true }); app.api.openTransactionModal();
  const before = plain(app.api.getState());
  await app.submit('transaction-form',tx());
  assert.deepEqual(plain(app.api.getState()),before);
  assert.ok(app.get('transaction-form'));
  assert.match(app.get('form-error').innerHTML,/QuotaExceeded/);
  assert.equal(app.values.has(storageKey),false);
  assert.equal(app.get('toast-root').innerHTML,'');
});

test('reentrant submit while write awaits lock does not save twice or overwrite', async () => {
  let release;
  const app = harness({ lockRequest: (name, options, callback) => new Promise(resolve => { release = () => resolve(callback()); }) });
  app.api.openTransactionModal(); const before = app.api.getState().transactions.length;
  const first = app.submit('transaction-form',tx());
  await app.submit('transaction-form',tx('income','30000000'));
  assert.match(app.get('form-error').innerHTML,/Đang lưu/);
  assert.equal(app.api.getState().transactions.length,before);
  release(); await first;
  assert.equal(app.api.getState().transactions.length,before+1);
  assert.equal(app.api.getState().transactions.at(-1).amount,20000000);
});

test('missing Web Locks leaves app read-only with export still available', async () => {
  const app = harness({locks:false}); app.api.openTransactionModal();
  const before = plain(app.api.getState()); await app.submit('transaction-form',tx());
  assert.deepEqual(plain(app.api.getState()),before);
  assert.match(app.get('form-error').innerHTML,/Web Locks/);
  app.api.downloadCurrentBackup(); assert.deepEqual(app.downloads,['mach-tien-backup.json']);
});

test('restore validates preview and requires export plus acknowledgement plus replace confirmation', async () => {
  const app = harness(); const original = plain(app.api.getState());
  const imported = plain(original); imported.transactions = []; imported.budgeting = {templates:[],funds:[],allocations:[],expenseLinks:[]}; imported.undoPoint=null;
  app.api.openRestoreModal(); app.get('restore-file').files = [{size:1000,text:async()=>exportBackup(imported)}];
  await app.api.previewRestore(app.get('restore-form'));
  assert.match(app.get('restore-preview').innerHTML,/Bản sao hợp lệ/);
  await app.api.confirmRestore(); assert.deepEqual(plain(app.api.getState()),original);
  app.api.downloadCurrentBackup(); app.get('restore-ack').checked=true;
  await app.api.confirmRestore();
  assert.equal(app.api.getState().transactions.length,0);
  await app.api.performUndo(); assert.deepEqual(plain(app.api.getState().transactions),original.transactions);
});

test('malformed restore never overwrites current state and can be retried', async () => {
  const app = harness(); const before=plain(app.api.getState()); app.api.openRestoreModal();
  app.get('restore-file').files=[{size:9,text:async()=>'{broken'}];
  await app.submit('restore-form',{});
  assert.match(app.get('form-error').innerHTML,/JSON/);
  assert.deepEqual(plain(app.api.getState()),before);
});

test('zero-row CSV does not consume newest undo point', async () => {
  const app=harness(); app.api.openTransactionModal(); await app.submit('transaction-form',tx());
  const before=plain(app.api.getState()); await app.click('import-csv');
  app.get('csv-text').value='bad\nrow';
  await app.submit('import-form',{});
  assert.deepEqual(plain(app.api.getState()),before);
  assert.match(app.get('import-result').innerHTML,/Đã nhập <strong>0/);
});

test('restore export acknowledgement is invalid after another saved mutation', async () => {
  const app=harness(); const imported=plain(app.api.getState());
  app.api.openRestoreModal(); app.get('restore-file').files=[{size:1000,text:async()=>exportBackup(imported)}];
  await app.api.previewRestore(app.get('restore-form')); app.api.downloadCurrentBackup(); app.get('restore-ack').checked=true;
  const changed=plain(app.api.getState()); changed.settings.buffer+=100;
  await app.api.persistAndRender(changed,'Synthetic intervening change');
  await app.api.confirmRestore();
  assert.equal(app.api.getState().settings.buffer,changed.settings.buffer);
  assert.match(app.get('form-error').innerHTML,/xuất bản sao/);
});

test('account mutation also remains unchanged on failed save', async () => {
  const app=harness({failWrite:true}); await app.click('add-account'); const before=plain(app.api.getState());
  await app.submit('account-form',{name:'Synthetic new bank',type:'cash',openingBalance:'10'});
  assert.deepEqual(plain(app.api.getState()),before);
  assert.ok(app.get('account-form')); assert.match(app.get('form-error').innerHTML,/QuotaExceeded/);
});

test('new blank template supports row edits, adding and removing rows before local save', async () => {
  const app=harness(); app.api.openTemplateEditor();
  await app.change('budget-name-0','Custom future purpose');
  await app.change('budget-kind-0','remainder');
  assert.equal(app.api.getDraft().rows[0].value,0);
  await app.click('add-budget-row'); assert.equal(app.api.getDraft().rows.length,2);
  await app.click('remove-budget-row',{index:'1'}); assert.equal(app.api.getDraft().rows.length,1);
  await app.submit('template-form',{templateName:'From scratch'});
  assert.equal(app.api.getState().budgeting.templates[0].rows[0].kind,'remainder');
});

test('allocation preview escapes fund names and account names', () => {
  const app=harness(); app.api.openTransactionModal(); preview(app,{mode:'custom'});
  app.api.getDraft().rows=[{name:'<img src=x onerror=alert(1)>',kind:'remainder',value:0,accountId:''}];
  app.api.showAllocationPreview();
  assert.doesNotMatch(app.get('allocation-preview').innerHTML,/<img/);
  assert.match(app.get('allocation-preview').innerHTML,/&lt;img/);
});

test('closing CSV modal cancels a delayed file read before any write', async () => {
  const app=harness(); await app.click('import-csv'); const before=plain(app.api.getState());
  let release; app.get('csv-file').files=[{size:100,text:()=>new Promise(resolve=>{release=resolve;})}];
  const pending=app.submit('import-form',{}); app.api.closeModal();
  release(`date,kind,amount,accountId,note\n${localDate()},income,99,bank-main,Delayed CSV`); await pending;
  assert.deepEqual(plain(app.api.getState()),before); assert.equal(app.values.has(storageKey),false);
});

test('new restore read wins and old delayed read cannot overwrite its preview', async () => {
  const app=harness(); app.api.openRestoreModal();
  const first=plain(app.api.getState()); const second=plain(first); second.transactions=[];
  let release; app.get('restore-file').files=[{size:100,text:()=>new Promise(resolve=>{release=resolve;})}];
  const pending=app.api.previewRestore(app.get('restore-form'));
  app.get('restore-file').files=[{size:100,text:async()=>exportBackup(second)}];
  await app.api.previewRestore(app.get('restore-form'));
  const preview=app.get('restore-preview').innerHTML;
  release(exportBackup(first)); await pending;
  assert.equal(app.get('restore-preview').innerHTML,preview);
  app.api.downloadCurrentBackup(); app.get('restore-ack').checked=true; await app.api.confirmRestore();
  assert.equal(app.api.getState().transactions.length,0);
});

test('file origin always shows direct-file caveat even when Web Locks API exists', () => {
  const app=harness({protocol:'file:'});
  assert.equal(app.get('file-origin-notice').hidden,false);
  app.api.setView('data'); assert.equal(app.get('file-origin-notice').hidden,false);
  const local=harness(); assert.equal(local.get('file-origin-notice').hidden,true);
});

test('Web Locks SecurityError rejects write without state mutation or success toast', async () => {
  const app=harness({protocol:'file:',lockRequest:async()=>{ const error=new Error('Opaque origin denied'); error.name='SecurityError'; throw error; }});
  app.api.openTransactionModal(); const before=plain(app.api.getState());
  await app.submit('transaction-form',tx());
  assert.deepEqual(plain(app.api.getState()),before);
  assert.equal(app.values.has(storageKey),false);
  assert.ok(app.get('transaction-form'));
  assert.match(app.get('form-error').innerHTML,/Chế độ chỉ đọc/);
  assert.match(app.get('form-error').innerHTML,/npm start/);
  assert.equal(app.get('toast-root').innerHTML,'');
});

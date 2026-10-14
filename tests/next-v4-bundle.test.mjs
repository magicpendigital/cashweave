import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {nextHarness} from './next-ui-harness.mjs';
import {reviewArtifactUrl} from '../scripts/review-output.mjs';
test('standalone V4 executes persistent expense, searchable ledger and independently upcoming plans',async()=>{
 const html=await readFile(reviewArtifactUrl('mach-tien-next-review.html'),'utf8'),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const context=vm.createContext({crypto:webcrypto,structuredClone,TextEncoder,Intl,Date,console});vm.runInContext(script,context);
 const h=await nextHarness({appFactory:context.__machTienReview.createNextApp});await h.app.go('create');await h.submit('onboard-form',{locale:'vi-VN',currencyCode:'VND',timezoneId:'Asia/Ho_Chi_Minh',name:'Synthetic V4 bundle',accountType:'BANK',opening:'1.000',openingDate:'2026-10-01'});
 const accountId=h.app.snapshot().accounts[0].id;await h.get('quick-expense').click();assert.equal(h.get('transaction-form-operationType').value,'EXPENSE');assert.equal(h.get('transaction-form-toAccountId'),null);await h.submit('transaction-form',{operationType:'EXPENSE',accountId,amount:'65',date:'2026-10-31',memo:'Synthetic bundled lunch'});
 await h.app.go('transactions');await h.submit('ledger-filter-form',{query:'bundled lunch',type:'EXPENSE'});assert.ok(h.text().includes('Synthetic bundled lunch'));assert.equal(h.get('ledger-count').textContent.endsWith(': 1'),true);
 await h.app.go('plans/new');await h.submit('plan-form',{title:'Synthetic bundled future rent',direction:'EXPENSE',amount:'200',due:'2026-11-05',accountId,recurrence:'NONE'});await h.app.go('overview');assert.ok(h.text().includes('Synthetic bundled future rent'));assert.equal(h.app.snapshot().operations.filter(o=>o.operationType==='EXPENSE').length,1);h.app.close();
});

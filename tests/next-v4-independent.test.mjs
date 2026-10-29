import test from 'node:test';
import assert from 'node:assert/strict';
import { nextHarness } from './next-ui-harness.mjs';
import { accountBalance, sourceCapacity, planSummary, validateSnapshot } from '../core/model.js';
import { translator } from '../ui/i18n.js';

const t = translator();
async function ready() {
  const h = await nextHarness();
  await h.app.go('create');
  await h.submit('onboard-form', { locale:'vi-VN', currencyCode:'VND', timezoneId:'Asia/Ho_Chi_Minh', name:'Independent bank', accountType:'BANK', opening:'1000', openingDate:'2026-09-01' });
  return h;
}
async function actual(h, { type='INCOME', amount='100', date='2026-10-20', memo='Independent receipt', accountId=h.app.snapshot().accounts[0].id, categoryId='' }={}) {
  await h.app.go('transactions/new');
  await h.submit('transaction-form', { operationType:type, accountId, amount, date, memo, categoryId });
  return h.app.snapshot().operations.at(-1);
}
async function plan(h, title, due, amount='100') {
  await h.app.go('plans/new');
  await h.submit('plan-form', {title, due, direction:'EXPENSE', amount, accountId:h.app.snapshot().accounts[0].id, recurrence:'NONE'});
  return h.app.snapshot().occurrences.at(-1).id;
}
function ledgerLinks(h) { return h.root.querySelectorAll('a').filter(n => /^#transactions\/[0-9a-f-]+$/.test(n.getAttribute('href') || '')); }

test('independent V4: account/date/query/type scope survives ledger detail and Back without financial mutation', async () => {
  const h = await ready();
  try {
    const bank = h.app.snapshot().accounts[0].id;
    await h.app.perform('addAccount', {name:'Independent wallet',accountType:'CASH',currencyCode:'VND',openingAmountMinor:'0',openingEffectiveLocalDate:'2026-09-01'});
    const wallet = h.app.snapshot().accounts[1].id;
    await actual(h,{type:'EXPENSE',amount:'10',date:'2026-09-20',memo:'needle before window'});
    const target = await actual(h,{type:'EXPENSE',amount:'20',memo:'Needle chosen debit'});
    await actual(h,{type:'INCOME',amount:'30',memo:'needle credit'});
    await actual(h,{type:'EXPENSE',amount:'40',accountId:wallet,memo:'needle other account'});
    await actual(h,{type:'EXPENSE',amount:'50',memo:'unrelated debit'});
    const before = h.app.snapshot();
    await h.app.go('transactions');
    await h.submit('period-form',{from:'2026-10-01',through:'2026-10-31',currencyCode:'VND',accountId:bank});
    await h.submit('ledger-filter-form',{query:'NEEDLE',type:'EXPENSE'});
    assert.equal(h.get('ledger-count').textContent,t('resultsCount')+': 1');
    const links = ledgerLinks(h);
    assert.equal(links.length,1);
    assert.equal(links[0].getAttribute('href'),'#transactions/'+target.id);
    await links[0].click();
    assert.equal(h.app.currentRoute(),'transactions/'+target.id);
    await h.app.goBack();
    assert.equal(h.app.currentRoute(),'transactions');
    assert.equal(h.get('ledger-filter-form-query').value,'NEEDLE');
    assert.equal(h.get('ledger-filter-form-type').value,'EXPENSE');
    assert.equal(h.get('period-form-accountId').value,bank);
    assert.equal(h.get('ledger-count').textContent,t('resultsCount')+': 1');
    await h.button(t('clearFilters')).click();
    assert.equal(h.get('ledger-count').textContent,t('resultsCount')+': 3');
    assert.deepEqual(h.app.snapshot(),before);
  } finally {h.app.close();}
});

test('independent V4: persistent expense action carries account context and transfer change retains draft but clears category', async () => {
  const h = await ready();
  try {
    const bank=h.app.snapshot().accounts[0].id;
    await h.app.perform('addAccount',{name:'Independent pocket',accountType:'CASH',currencyCode:'VND',openingAmountMinor:'0',openingEffectiveLocalDate:'2026-09-01'});
    const pocket=h.app.snapshot().accounts[1].id;
    await h.app.perform('addCategory',{name:'Independent expense category',direction:'EXPENSE'});
    await h.app.perform('addCategory',{name:'Independent income category',direction:'INCOME'});
    const expenseCategory=h.app.snapshot().categories[0].id;
    for(const route of ['overview','transactions','plans','templates','help','data','history']) {
      await h.app.go(route);
      assert.ok(h.get('quick-expense'),route);
    }
    await h.app.go('accounts/'+pocket);
    await h.get('quick-expense').click();
    assert.equal(h.get('transaction-form-operationType').value,'EXPENSE');
    assert.equal(h.get('transaction-form-accountId').value,pocket);
    assert.equal(h.get('transaction-form-toAccountId'),null);
    assert.deepEqual(h.root.querySelectorAll('[data-category]').map(n=>n.getAttribute('data-category')),[expenseCategory]);
    await h.root.querySelector('[data-category]').click();
    assert.equal(h.get('transaction-form-categoryId').value,expenseCategory);
    assert.equal(h.root.querySelector('[data-category]').getAttribute('aria-pressed'),'true');
    h.setForm('transaction-form',{amount:'75',memo:'Draft transfer survives',date:'2026-10-25',categoryId:expenseCategory,operationType:'TRANSFER'});
    await h.get('transaction-form-operationType').dispatch('change');
    assert.ok(h.get('transaction-form-toAccountId'));
    assert.equal(h.get('transaction-form-amount').value,'75');
    assert.equal(h.get('transaction-form-memo').value,'Draft transfer survives');
    assert.equal(h.get('transaction-form-categoryId'),null);
    assert.ok(h.text().includes(t('transferHint')));
    await h.root.querySelector('[data-operation-type="EXPENSE"]').click();
    assert.equal(h.get('transaction-form-toAccountId'),null);
    assert.equal(h.get('transaction-form-categoryId').value,'');
    assert.equal(h.get('transaction-form-amount').value,'75');
    const before=h.app.snapshot();
    await h.submit('transaction-form',{operationType:'EXPENSE',accountId:pocket,amount:'75',memo:'Independent cash debit',date:'2026-10-25',categoryId:expenseCategory});
    const after=h.app.snapshot();
    assert.equal(after.operations.length,before.operations.length+1);
    assert.equal(after.revision,before.revision+1);
    assert.equal(accountBalance(after,bank),'1000');
    assert.equal(accountBalance(after,pocket),'-75');
    validateSnapshot(after);
  } finally {h.app.close();}
});

test('independent V4: home always shows current unpaid obligations; Kế hoạch scopes keep overdue, upcoming and period apart', async () => {
  const h=await ready();
  try {
    const overdue=await plan(h,'Independent overdue','2026-10-20');
    await plan(h,'Independent imminent','2026-11-05');
    await plan(h,'Independent distant','2027-01-05');
    const finalized=await plan(h,'Independent finalized','2026-10-25');
    await h.app.go('plans/'+finalized);
    await h.button(t('finalize')).click();
    const before=h.app.snapshot();
    await h.app.go('transactions');
    await h.submit('period-form',{from:'2026-09-01',through:'2026-09-30',currencyCode:'VND',accountId:''});
    await h.app.go('overview');
    assert.ok(h.text().includes('Independent overdue'));
    assert.ok(h.text().includes('Independent imminent'));
    assert.ok(!h.text().includes('Independent distant'));
    assert.ok(!h.text().includes('Independent finalized'));
    await h.app.go('plans');
    assert.ok(h.text().includes('Independent distant'));
    assert.ok(h.text().includes(t('overdueSection')));
    await h.submit('plan-scope-form',{visibility:'overdue'});
    assert.ok(h.text().includes('Independent overdue'));
    assert.ok(!h.text().includes('Independent imminent'));
    await h.submit('plan-scope-form',{visibility:'upcoming'});
    assert.ok(!h.text().includes('Independent overdue'));
    assert.ok(h.text().includes('Independent imminent'));
    await h.submit('plan-scope-form',{visibility:'period'});
    assert.ok(!h.text().includes('Independent overdue'));
    assert.ok(!h.text().includes('Independent imminent'));
    assert.equal(planSummary(h.app.snapshot(),overdue).openRemaining,'100');
    assert.deepEqual(h.app.snapshot(),before);
  } finally {h.app.close();}
});
test('independent V4: specific receipt proposal cannot borrow other capacity; changed proposal is invalid until previewed again',async()=>{
  const h=await ready();
  try {
    const receipt=await actual(h,{amount:'80',memo:'Independent small receipt',date:'2026-10-26'});
    await actual(h,{amount:'500',memo:'Independent unrelated receipt'});
    await h.app.go('templates');
    await h.submit('envelope-form',{name:'Independent purpose'});
    const envelope=h.app.snapshot().envelopes[0].id;
    await h.app.go('templates/new');
    await h.submit('template-form',{name:'Independent fixed template',fixedScope:'PER_APPLICATION',shortagePolicy:'PARTIAL_BY_PRIORITY',leftoverPolicy:'UNASSIGNED',leftoverEnvelopeId:'','envelope-0':envelope,'kind-0':'FIXED','value-0':'200'});
    const snapshot=h.app.snapshot(),version=snapshot.templates[0].currentVersionId;
    const posting=snapshot.postings.find(p=>p.operationId===receipt.id);
    const source=snapshot.fundingSources.find(s=>s.sourcePostingId===posting.id);
    await h.app.go('transactions/'+receipt.id);
    await h.button(t('setAsideReceipt')).click();
    await h.app.go('allocations/new/'+version);
    assert.equal(h.get('allocation-form-sourceId').value,source.id);
    assert.ok(h.text().includes('Independent small receipt'));
    assert.ok(h.text().includes('Independent bank'));
    assert.ok(h.text().includes('2026-10-26'));
    const before=h.app.snapshot();
    await h.submit('allocation-form',{sourceId:source.id,amount:'81',date:'2026-10-31'});
    assert.ok(h.root.querySelector('[role="alert"]'));
    assert.equal(h.get('allocation-confirm'),null);
    assert.deepEqual(h.app.snapshot(),before);
    await h.submit('allocation-form',{sourceId:source.id,amount:'60',date:'2026-10-31'});
    assert.ok(h.get('allocation-confirm'));
    assert.deepEqual(h.app.snapshot(),before);
    h.get('allocation-form-amount').value='70';
    await h.get('allocation-form-amount').dispatch('input');
    assert.equal(h.get('allocation-confirm').disabled,true);
    await h.get('allocation-confirm').click();
    assert.deepEqual(h.app.snapshot(),before);
    await h.submit('allocation-form',{sourceId:source.id,amount:'70',date:'2026-10-31'});
    await h.get('allocation-confirm').click();
    const after=h.app.snapshot();
    assert.equal(sourceCapacity(after,source.id).remaining,'10');
    assert.equal(after.operations.length,before.operations.length);
    assert.equal(after.postings.length,before.postings.length);
    assert.equal(accountBalance(after,after.accounts[0].id),accountBalance(before,before.accounts[0].id));
    assert.equal(after.allocationApplications.length,1);
    validateSnapshot(after);
  } finally {h.app.close();}
});

test('independent V4: timeline links carry operation memo and signed amount to original detail', async()=>{
  const h=await ready();
  try {
    const income=await actual(h,{memo:'Independent traceable salary',amount:'123',date:'2026-10-15'});
    const expense=await actual(h,{type:'EXPENSE',memo:'Independent traceable fare',amount:'23',date:'2026-10-15'});
    const before=h.app.snapshot();
    await h.app.go('accounts/'+before.accounts[0].id+'/timeline');
    const links=ledgerLinks(h);
    const credit=links.find(n=>n.getAttribute('href')==='#transactions/'+income.id);
    const debit=links.find(n=>n.getAttribute('href')==='#transactions/'+expense.id);
    assert.ok(credit.textContent.includes('Independent traceable salary'));
    assert.ok(credit.textContent.includes(t('income')));
    assert.ok(credit.textContent.includes('123'));
    assert.ok(debit.textContent.includes('Independent traceable fare'));
    assert.ok(debit.textContent.includes('-23'));
    await debit.click();
    assert.equal(h.app.currentRoute(),'transactions/'+expense.id);
    assert.ok(h.get('reverse-form'));
    await h.app.goBack();
    assert.equal(h.app.currentRoute(),'accounts/'+before.accounts[0].id+'/timeline');
    assert.deepEqual(h.app.snapshot(),before);
  } finally {h.app.close();}
});

test('independent V4: allocation from a specific receipt rejects an incompatible currency template instead of selecting other money',async()=>{
  const h=await ready();
  try {
    const receipt=await actual(h,{amount:'80',memo:'Independent VND source'});
    await h.app.perform('addAccount',{name:'Independent dollars',accountType:'CASH',currencyCode:'USD',openingAmountMinor:'10000',openingEffectiveLocalDate:'2026-09-01'});
    await h.app.go('transactions');
    await h.submit('period-form',{from:'2026-10-01',through:'2026-10-31',currencyCode:'USD',accountId:''});
    await h.app.go('templates');
    await h.submit('envelope-form',{name:'Independent dollar purpose'});
    const envelope=h.app.snapshot().envelopes[0].id;
    await h.app.go('templates/new');
    await h.submit('template-form',{name:'Independent dollar template',fixedScope:'PER_APPLICATION',shortagePolicy:'PARTIAL_BY_PRIORITY',leftoverPolicy:'UNASSIGNED',leftoverEnvelopeId:'','envelope-0':envelope,'kind-0':'FIXED','value-0':'10'});
    const before=h.app.snapshot(),version=before.templates[0].currentVersionId;
    await h.app.go('transactions/'+receipt.id);
    await h.button(t('setAsideReceipt')).click();
    await h.app.go('allocations/new/'+version);
    // A receipt-specific entry must either reject this template or explicitly preserve
    // the receipt selection; it cannot silently fall back to unrelated USD funds.
    assert.equal(h.get('allocation-form'),null);
    assert.ok(h.text().includes(t('receiptUnavailable')));
    await h.app.go('recipes');
    const use=h.button(t('useTemplate'));
    assert.equal(use.disabled,true);
    await h.button(t('chooseOtherSources')).click();
    await h.app.go('allocations/new/'+version);
    assert.ok(h.get('allocation-form'));
    assert.equal(h.get('allocation-form-sourceId').value,'all');
    assert.deepEqual(h.app.snapshot(),before);
  } finally {h.app.close();}
});

test('independent V4: locked receipt cannot be replaced through submitted form values and exhausted receipt cannot silently fall back',async()=>{
  const h=await ready();
  try {
    const receipt=await actual(h,{amount:'80',memo:'Independent exhaustible receipt'});
    await h.app.go('templates');
    await h.submit('envelope-form',{name:'Independent locked purpose'});
    const envelope=h.app.snapshot().envelopes[0].id;
    await h.app.go('templates/new');
    await h.submit('template-form',{name:'Independent lock template',fixedScope:'PER_APPLICATION',shortagePolicy:'PARTIAL_BY_PRIORITY',leftoverPolicy:'UNASSIGNED',leftoverEnvelopeId:'','envelope-0':envelope,'kind-0':'FIXED','value-0':'200'});
    const before=h.app.snapshot(),version=before.templates[0].currentVersionId;
    const posting=before.postings.find(p=>p.operationId===receipt.id);
    const source=before.fundingSources.find(s=>s.sourcePostingId===posting.id);
    await h.app.go('transactions/'+receipt.id);
    await h.button(t('setAsideReceipt')).click();
    await h.app.go('allocations/new/'+version);
    assert.deepEqual(h.get('allocation-form-sourceId').children.map(n=>n.value),[source.id]);
    await h.submit('allocation-form',{sourceId:'all',amount:'100',date:'2026-10-31'});
    assert.equal(h.get('allocation-confirm'),null);
    assert.deepEqual(h.app.snapshot(),before);
    await h.submit('allocation-form',{sourceId:source.id,amount:'80',date:'2026-10-31'});
    await h.get('allocation-confirm').click();
    const after=h.app.snapshot();
    assert.equal(sourceCapacity(after,source.id).remaining,'0');
    await h.app.go('allocations/new/'+version);
    assert.equal(h.get('allocation-form'),null);
    assert.ok(h.text().includes(t('receiptUnavailable')));
    assert.deepEqual(h.app.snapshot(),after);
  }finally {h.app.close();}
});

test('independent V4: unassigned money is whole-currency on Home and Hũ regardless of a ledger account filter',async()=>{
  const h=await ready();
  try {
    const bank=h.app.snapshot().accounts[0].id;
    await h.app.perform('addAccount',{name:'Independent pool pocket',accountType:'CASH',currencyCode:'VND',openingAmountMinor:'0',openingEffectiveLocalDate:'2026-09-01'});
    const pocket=h.app.snapshot().accounts[1].id;
    await actual(h,{amount:'200',date:'2026-09-10',accountId:pocket,memo:'September pocket source'});
    await actual(h,{amount:'300',date:'2026-10-10',memo:'October bank source'});
    const before=h.app.snapshot();
    await h.app.go('transactions');
    await h.submit('period-form',{from:'2026-09-01',through:'2026-09-30',currencyCode:'VND',accountId:bank});
    await h.app.go('overview');
    assert.ok(h.root.querySelector('[data-suggest="allocate"]').textContent.includes('1.500'));
    await h.app.go('funds');
    assert.match(h.root.querySelector('[data-amount="unassigned"]').textContent,/^1\.500\s₫$/);
    assert.ok(h.text().includes(t('fundsIntro')));
    assert.deepEqual(h.app.snapshot(),before);
  }finally{h.app.close();}
});
test('independent V4: category-only search retrieves posting category and remains available after category archive',async()=>{
  const h=await ready();
  try {
    await h.app.perform('addCategory',{name:'Independent distinctive category',direction:'EXPENSE'});
    const category=h.app.snapshot().categories[0].id;
    const target=await actual(h,{type:'EXPENSE',categoryId:category,amount:'30',memo:'Generic debit memo'});
    await actual(h,{type:'EXPENSE',amount:'20',memo:'Different generic debit'});
    const before=h.app.snapshot();
    assert.equal(before.operations.find(o=>o.id===target.id).categoryId,undefined);
    assert.equal(before.postings.find(p=>p.operationId===target.id).categoryId,category);
    await h.app.go('transactions');
    await h.submit('ledger-filter-form',{query:'DISTINCTIVE',type:'EXPENSE'});
    assert.equal(h.get('ledger-count').textContent,t('resultsCount')+': 1');
    assert.equal(ledgerLinks(h)[0].getAttribute('href'),'#transactions/'+target.id);
    assert.ok(h.text().includes('Independent distinctive category'));
    assert.deepEqual(h.app.snapshot(),before);
    await h.app.perform('archiveEntity',{collection:'categories',entityId:category,archived:true});
    const archived=h.app.snapshot();
    await h.app.go('transactions');
    assert.equal(h.get('ledger-filter-form-query').value,'DISTINCTIVE');
    assert.equal(h.get('ledger-count').textContent,t('resultsCount')+': 1');
    assert.equal(ledgerLinks(h)[0].getAttribute('href'),'#transactions/'+target.id);
    assert.deepEqual(h.app.snapshot(),archived);
  }finally{h.app.close();}
});

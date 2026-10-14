import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransaction, calculateBalances, importTransactionsCsv, localDate } from '../ledger.js';
import { BUILTIN_TEMPLATES, previewAllocation, saveBudgetTemplate, getBudgetSummary, applyIncomeAllocation, createIncomeWithAllocation, linkBudgetExpense } from '../budgeting.js';
import { normalizeState } from '../state-schema.js';
const base = () => normalizeState({ version: 1, demo: true, accounts: [{ id: 'main', name: 'Main', type: 'cash', openingBalance: 0 }, { id: 'save', name: 'Save', type: 'cash', openingBalance: 0 }, { id: 'card', name: 'Card', type: 'credit', openingBalance: 0 }], cards: [], assets: [], plans: [], transactions: [], settings: { buffer: 0 } });
const income = (amount = 20_000_000, id = 'income1') => ({ id, kind: 'income', date: localDate(), amount, accountId: 'main', category: 'Lương', note: 'Dữ liệu giả' });
const custom = (name, amount, accountId = '') => ({ name, amount, accountId });
const rule = (name, kind, value) => ({ name, kind, value, accountId: '' });
const option = (state, amount = 20_000_000, index = 0, operationId = 'op1') => ({ lines: previewAllocation(amount, BUILTIN_TEMPLATES[index].rows, state).lines, label: BUILTIN_TEMPLATES[index].name, ruleSnapshot: BUILTIN_TEMPLATES[index].rows, operationId });

test('five core methods preserve exact synthetic sums', () => {
 const expected = [[10000000,6000000,4000000],[11000000,2000000,2000000,2000000,2000000,1000000],[6000000,4000000,1000000,2000000,3000000,4000000],[3000000,17000000],[6000000,7000000,4200000,2800000]];
 BUILTIN_TEMPLATES.forEach((t,i)=>assert.deepEqual(previewAllocation(20_000_000,t.rows,base()).lines.map(l=>l.amount),expected[i]));
});
test('fixed applies every run and preview exposes numeric percentage basis', () => {
 const full=previewAllocation(20_000_000,BUILTIN_TEMPLATES[4].rows,base());assert.equal(full.base,14_000_000);assert.match(full.lines[1].rule,/14\.000\.000/);assert.match(full.lines[0].rule,/mỗi lần áp dụng/);
 const low=previewAllocation(5_000_000,BUILTIN_TEMPLATES[4].rows,base());assert.equal(low.shortage,1_000_000);assert.deepEqual(low.lines.map(l=>l.amount),[5_000_000,0,0,0]);
});
test('rounding conserves 999 amounts for each builtin', () => {
 for(let n=1;n<1000;n++) for(const t of BUILTIN_TEMPLATES){const p=previewAllocation(n,t.rows,base());assert.equal(p.lines.reduce((s,l)=>s+l.amount,0)+p.unallocated,n);}
});
test('decimal percentages use integer arithmetic and reject invalid precision', () => {
 assert.equal(previewAllocation(10000,[rule('A','percent',33.33)],base()).lines[0].amount,3333);
 assert.throws(()=>previewAllocation(100,[rule('A','percent',33.333)],base()),/hai chữ/);
 assert.throws(()=>previewAllocation(100,[rule('A','percent',60),rule('B','percent',50)],base()),/100%/);
 assert.throws(()=>previewAllocation(100,[rule('A','fixed',-1)],base()));
 assert.throws(()=>previewAllocation(100,[rule('A','remainder',0),rule('B','remainder',0)],base()));
});
test('template copy immutable and safe account mapping validation', () => {
 const s=base(), original=JSON.stringify(BUILTIN_TEMPLATES);const next=saveBudgetTemplate(s,{name:'Của tôi',rows:BUILTIN_TEMPLATES[0].rows});next.budgeting.templates[0].rows[0].value=40;
 assert.equal(s.budgeting.templates.length,0);assert.equal(JSON.stringify(BUILTIN_TEMPLATES),original);
 assert.throws(()=>saveBudgetTemplate(s,{name:'X',rows:[{...rule('A','percent',100),accountId:'card'}]}),/tài khoản tiền/);
 assert.throws(()=>saveBudgetTemplate(s,{name:'X',rows:[rule('A','percent',50),rule('a','percent',50)]}),/trùng/);
});
test('record-only then partial and remaining allocation never duplicate income', () => {
 let s=createTransaction(base(),income());s=applyIncomeAllocation(s,{incomeId:'income1',lines:[custom('A',5_000_000)],label:'Một phần',operationId:'part1'});
 assert.equal(getBudgetSummary(s).incomes[0].remaining,15_000_000);
 s=applyIncomeAllocation(s,{incomeId:'income1',lines:[custom('A',15_000_000)],label:'Phần còn',operationId:'part2'});
 assert.equal(s.transactions.length,1);assert.equal(calculateBalances(s).liquidCash,20_000_000);assert.equal(getBudgetSummary(s).funds[0].balance,20_000_000);
 assert.throws(()=>applyIncomeAllocation(s,{incomeId:'income1',lines:[custom('A',1)]}),/vượt phần/);
});
test('operation ID rejects repeated partial allocation before source exhaustion', () => {
 let s=createTransaction(base(),income());const opts={incomeId:'income1',lines:[custom('A',1_000_000)],operationId:'same'};s=applyIncomeAllocation(s,opts);
 assert.throws(()=>applyIncomeAllocation(s,opts),/đã được ghi/);assert.equal(getBudgetSummary(s).totalAllocated,1_000_000);
});
test('record plus allocation is pure and atomic on invalid allocation', () => {
 const s=base();assert.throws(()=>createIncomeWithAllocation(s,income(),{lines:[custom('A',21_000_000)]}),/vượt phần/);assert.equal(s.transactions.length,0);
 const next=createIncomeWithAllocation(s,income(),option(s));assert.equal(next.transactions.length,1);assert.equal(calculateBalances(next).liquidCash,20_000_000);assert.equal(getBudgetSummary(next).totalRemaining,20_000_000);
});
test('purpose account mapping does not transfer money', () => {
 const next=createIncomeWithAllocation(base(),income(),{lines:[custom('Tiết kiệm',20_000_000,'save')],label:'Liên kết'});
 assert.equal(calculateBalances(next).accounts.main,20_000_000);assert.equal(calculateBalances(next).accounts.save,0);assert.equal(next.budgeting.funds[0].accountId,'save');
});
test('same purpose cannot silently split when account mapping changes', () => {
 let s=createIncomeWithAllocation(base(),income(),{lines:[custom('Dài hạn',10_000_000,'save')]});
 assert.throws(()=>applyIncomeAllocation(s,{incomeId:'income1',lines:[custom('Dài hạn',1_000_000,'main')]}),/liên kết khác/);assert.equal(s.budgeting.funds.length,1);
});
test('ordinary expense without allocating is preserved and generates informative warning', () => {
 let s=createTransaction(base(),income());s=createTransaction(s,{id:'e',kind:'expense',date:localDate(),amount:1_000_000,accountId:'main'});
 assert.equal(calculateBalances(s).liquidCash,19_000_000);assert.equal(getBudgetSummary(s).funds.length,0);assert.match(getBudgetSummary(s).warnings[0],/chưa gắn quỹ/);
});
test('linked cash expense subtracts one transaction and one fund allocation balance', () => {
 let s=createIncomeWithAllocation(base(),income(),{lines:[custom('A',20_000_000)]});const id=s.budgeting.funds[0].id;
 s=createTransaction(s,{id:'e',kind:'expense',date:localDate(),amount:200_000,accountId:'main'});s=linkBudgetExpense(s,'e',id);
 assert.equal(calculateBalances(s).liquidCash,19_800_000);assert.equal(getBudgetSummary(s).funds[0].balance,19_800_000);assert.equal(s.transactions.length,2);
 assert.throws(()=>linkBudgetExpense(s,'e',id),/đã được gắn/);
});
test('credit expense plus card payment does not consume fund twice', () => {
 let s=createIncomeWithAllocation(base(),income(),{lines:[custom('A',20_000_000)]});const id=s.budgeting.funds[0].id;
 s=createTransaction(s,{id:'card-exp',kind:'expense',date:localDate(),amount:1_000_000,accountId:'card'});s=linkBudgetExpense(s,'card-exp',id);
 assert.equal(getBudgetSummary(s).cashAvailable,0);
 s=createTransaction(s,{id:'pay',kind:'transfer',date:localDate(),amount:1_000_000,fromAccountId:'main',toAccountId:'card'});
 assert.equal(getBudgetSummary(s).funds[0].balance,19_000_000);assert.equal(calculateBalances(s).liquidCash,19_000_000);assert.throws(()=>linkBudgetExpense(s,'pay',id),/Chỉ giao dịch chi/);
});
test('historical income cannot fund money already spent and unlinked overspending warns', () => {
 let s=createTransaction(base(),income());s=createTransaction(s,{id:'e',kind:'expense',date:localDate(),amount:19_000_000,accountId:'main'});
 assert.throws(()=>applyIncomeAllocation(s,{incomeId:'income1',lines:[custom('A',20_000_000)]}),/Nguồn tiền hiện tại/);
 s=applyIncomeAllocation(s,{incomeId:'income1',lines:[custom('A',1_000_000)]});s=createTransaction(s,{id:'e2',kind:'expense',date:localDate(),amount:500_000,accountId:'main'});
 assert(getBudgetSummary(s).warnings.some(w=>w.includes('vượt tiền')));
});
test('CSV duplicate income stays single and does not trigger allocation', () => {
 let s=createTransaction(base(),income());const csv=`date,kind,amount,accountId,category,note\n${localDate()},income,20000000,main,Lương,Dữ liệu giả`;
 const result=importTransactionsCsv(s,csv);assert.equal(result.imported,0);assert.equal(result.duplicates.length,1);assert.equal(result.state.transactions.length,1);assert.equal(result.state.budgeting.allocations.length,0);
});
test('edited or deleted allocated income rejected by schema validation', () => {
 let s=createIncomeWithAllocation(base(),income(),option(base()));let broken=structuredClone(s);broken.transactions=[];assert.throws(()=>normalizeState(broken),/mất nguồn/);
 broken=structuredClone(s);broken.transactions[0].amount=1;assert.throws(()=>normalizeState(broken),/tổng phân bổ/);
});
test('orphan expense link, overfund spend and duplicate event rejected by validation', () => {
 let s=createIncomeWithAllocation(base(),income(),{lines:[custom('A',1_000_000)]});let broken=structuredClone(s);broken.budgeting.expenseLinks=[{transactionId:'missing',fundId:broken.budgeting.funds[0].id}];assert.throws(()=>normalizeState(broken),/liên kết chi/);
 broken=structuredClone(s);broken.budgeting.allocations.push(structuredClone(broken.budgeting.allocations[0]));assert.throws(()=>normalizeState(broken),/ID/);
 s=createTransaction(s,{id:'e',kind:'expense',date:localDate(),amount:2_000_000,accountId:'main'});assert.throws(()=>linkBudgetExpense(s,'e',s.budgeting.funds[0].id),/không đủ/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpace,applyCommand as cmd,summary} from '../couples.js';
function joined(){let s=createSpace();s=cmd(s,'A',{type:'invite',invitee:'B',token:'fictional-demo',expires:'2026-10-31'});return cmd(s,'B',{type:'acceptInvite',token:'fictional-demo',consent:true});}
const entry=(s,actor,id,kind,amount,extra={})=>cmd(s,actor,{type:'addEntry',id,kind,amount,date:'2026-10-10',...extra});
test('explicit consent, intended invitee, expiry, revocation and exactly two members',()=>{
 let s=cmd(createSpace(),'A',{type:'invite',invitee:'B',token:'demo',expires:'2026-10-20'});
 assert.throws(()=>cmd(s,'C',{type:'acceptInvite',token:'demo',consent:true}));
 assert.throws(()=>cmd(s,'B',{type:'acceptInvite',token:'demo',consent:false}));
 assert.throws(()=>cmd(s,'B',{type:'acceptInvite',token:'demo',consent:true},'2026-10-21'));
 s=cmd(s,'A',{type:'revokeInvite'});assert.throws(()=>cmd(s,'B',{type:'acceptInvite',token:'demo',consent:true}));
 assert.throws(()=>cmd(joined(),'A',{type:'invite',invitee:'C',token:'demo',expires:'2026-10-20'}));
});
test('membership required and original state immutable',()=>{const s=joined();assert.throws(()=>entry(s,'C','x','contribution',10));const next=entry(s,'A','x','contribution',10);assert.equal(s.entries.length,0);assert.equal(next.entries.length,1);assert.throws(()=>entry(createSpace(),'A','x','contribution',10));});
test('fixed or ratio plans have no implicit equal split, require two and future changes',()=>{
 let s=joined();assert.throws(()=>cmd(s,'A',{type:'proposePlan',id:'p',month:'2026-10',budget:100}));
 s=cmd(s,'A',{type:'proposePlan',id:'p',month:'2026-10',budget:101,mode:'ratio',values:[60,40]});
 assert.equal(summary(s,'2026-10').budget,0);s=cmd(s,'A',{type:'approvePlan',id:'p'});assert.equal(summary(s,'2026-10').budget,0);
 s=cmd(s,'B',{type:'approvePlan',id:'p'});assert.deepEqual(summary(s,'2026-10').plan.expected,[60,41]);
 assert.throws(()=>cmd(s,'A',{type:'proposePlan',id:'p2',month:'2026-10',budget:100,mode:'fixed',values:[70,30]}));
 s=cmd(s,'A',{type:'proposePlan',id:'p2',month:'2026-11',budget:100,mode:'fixed',values:[70,30]});s=cmd(s,'B',{type:'approvePlan',id:'p2'});assert.equal(summary(s,'2026-10').budget,101);assert.equal(summary(s,'2026-11').budget,100);
});
test('contribution, advance and reimbursement never double count spending',()=>{
 let s=entry(joined(),'A','in','contribution',1000);s=entry(s,'B','advance','advance',300);s=entry(s,'A','expense','expense',200);s=entry(s,'B','repay','reimbursement',100,{advanceId:'advance'});
 let out=summary(s,'2026-10');assert.equal(out.spent,500);assert.equal(out.cash,700);assert.equal(out.advances.B,200);assert.equal(out.goalAvailable,500);
 assert.throws(()=>entry(s,'A','wrong','reimbursement',100,{advanceId:'advance'}));assert.throws(()=>entry(s,'B','over','reimbursement',201,{advanceId:'advance'}));
 s=entry(s,'B','rest','reimbursement',200,{advanceId:'advance'});out=summary(s,'2026-10');assert.equal(out.spent,500);assert.equal(out.cash,500);assert.equal(out.advances.B,0);
});
test('bill balance tracks partial payments, blocks overpay and reimbursement link',()=>{
 let s=cmd(joined(),'A',{type:'addBill',id:'bill',title:'Điện',amount:100,due:'2026-10-20'});s=entry(s,'B','advance','advance',60,{billId:'bill'});assert.equal(summary(s,'2026-10').bills[0].remaining,40);
 assert.throws(()=>entry(s,'B','over','advance',41,{billId:'bill'}));s=entry(s,'B','rest','advance',40,{billId:'bill'});assert.equal(summary(s,'2026-10').bills[0].remaining,0);
});
test('reject duplicate commands, invalid dates, unsafe values, future transactions and overdraft',()=>{
 let s=entry(joined(),'A','in','contribution',100);for(const amount of [0,-1,1.5,Number.MAX_SAFE_INTEGER,NaN])assert.throws(()=>entry(s,'A','bad','expense',amount));
 assert.throws(()=>entry(s,'A','in','contribution',100));for(const date of ['2026-02-30','2026-13-10','bad','2026-10-20'])assert.throws(()=>entry(s,'A','date','expense',10,{date}));
 assert.throws(()=>entry(s,'A','over','expense',101));assert.throws(()=>entry(s,'A','back','expense',1,{date:'2026-10-09'}));
});
test('closing requires both approvals, invalidates stale confirmation and carries balances once',()=>{
 let s=entry(joined(),'A','in','contribution',100);s=entry(s,'B','a','advance',20);s=cmd(s,'A',{type:'proposeClose',id:'close',month:'2026-10'});s=cmd(s,'A',{type:'approveClose',id:'close'});assert.equal(s.closes[0].status,'pending');
 s=entry(s,'A','in2','contribution',10);assert.throws(()=>cmd(s,'B',{type:'approveClose',id:'close'}));
 s=cmd(s,'A',{type:'proposeClose',id:'close2',month:'2026-10'});s=cmd(s,'B',{type:'approveClose',id:'close2'});assert.equal(s.closes[0].status,'closed');assert.equal(summary(s,'2026-11').cash,110);assert.equal(summary(s,'2026-11').advances.B,20);assert.equal(summary(s,'2026-11').spent,0);
 assert.throws(()=>entry(s,'A','late','expense',1));assert.throws(()=>entry(s,'A','past','expense',1,{date:'2026-09-10'}));
});
test('future rule changes cannot activate late and active plans invalidate pending closes',()=>{
 let s=joined();s=cmd(s,'A',{type:'proposePlan',id:'p',month:'2026-10',mode:'fixed',budget:100,values:[80,20]});s=cmd(s,'A',{type:'proposeClose',id:'c',month:'2026-10'});s=cmd(s,'B',{type:'approvePlan',id:'p'});assert.throws(()=>cmd(s,'B',{type:'approveClose',id:'c'}));
 s=cmd(s,'A',{type:'proposePlan',id:'p2',month:'2026-11',mode:'fixed',budget:100,values:[70,30]});assert.throws(()=>cmd(s,'B',{type:'approvePlan',id:'p2'},'2026-11-15'));
});
test('malformed month types rejected and aggregate overflow cannot silently lose VND',()=>{
 const s=joined();assert.throws(()=>summary(s,['2026-10']));assert.throws(()=>cmd(s,'A',{type:'proposePlan',id:'p',month:['2026-10'],mode:'fixed',budget:100,values:[80,20]}));
 const big=joined();big.entries=Array.from({length:9007},(_,i)=>({id:`a${i}`,actor:'A',kind:'contribution',amount:1_000_000_000_000,date:'2026-10-01'}));assert.throws(()=>entry(big,'A','overflow','contribution',1_000_000_000_000),/giới hạn/);assert.equal(big.entries.length,9007);
});
test('two pending initial plans cannot bypass future-only approval',()=>{
 let s=joined();for(const [id,month] of [['p','2026-10'],['q','2026-11']])s=cmd(s,'A',{type:'proposePlan',id,month,mode:'fixed',budget:100,values:[80,20]});s=cmd(s,'B',{type:'approvePlan',id:'p'});assert.throws(()=>cmd(s,'B',{type:'approvePlan',id:'q'},'2026-11-15'));
});
test('backdated records cannot overflow historical monthly totals',()=>{
 const s=joined();s.entries=Array.from({length:9007},(_,i)=>[{id:'c'+i,actor:'A',kind:'contribution',amount:1e12,date:'2026-09-10'},{id:'e'+i,actor:'A',kind:'expense',amount:1e12,date:'2026-09-10'}]).flat();assert.throws(()=>entry(s,'A','overflow','contribution',1e12,{date:'2026-09-10'}),/giới hạn/);assert.equal(s.entries.length,18014);
});

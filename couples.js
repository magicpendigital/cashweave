/** Pure, immutable demo domain. NOT an authorization/security boundary.
 * Production must derive actor from verified authentication and commit under a DB lock.
 * Integer VND only; personal ledger deliberately absent from this state.
 */
const fail = message => { throw new Error(message); };
const check = (ok, message) => { if (!ok) fail(message); };
const amount = n => Number.isSafeInteger(n) && n > 0 && n <= 1_000_000_000_000;
const monthOK = x => typeof x==='string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(x);
const dateOK = x => { if(typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x))return false;const d=new Date(x+'T00:00:00Z');return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===x; };
const text = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 200;
const add = (a,b) => { const n=a+b;check(Number.isSafeInteger(n),'Tổng tiền vượt giới hạn tính toán an toàn.');return n; };
const clone = x => structuredClone(x);
const both = (s,a) => s.members.length === 2 && s.members.every(x=>a.includes(x));
const closed = (s,m) => s.closes.some(c=>c.month>=m && c.status==='closed');
const newId = (s,id) => check(text(id) && ![...s.entries,...s.bills,...s.plans,...s.closes].some(x=>x.id===id),'Mã đã tồn tại hoặc không hợp lệ.');
export function createSpace({id='demo-space',owner='A',name='Nhà mình'}={}) {
 check(text(id)&&text(owner)&&text(name),'Thông tin không gian không hợp lệ.');
 return {version:1,id,name,members:[owner],invite:null,plans:[],entries:[],bills:[],goal:null,closes:[],revision:0};
}
export function summary(s,month) {
 check(monthOK(month),'Tháng không hợp lệ.');
 const entries=s.entries.filter(e=>e.date.slice(0,7)<=month);
 let cash=0,spent=0;
 const contributions=Object.fromEntries(s.members.map(x=>[x,0]));
 const advances=Object.fromEntries(s.members.map(x=>[x,0]));
 for(const e of entries){
  if(e.kind==='contribution') {cash=add(cash,e.amount);if(e.date.startsWith(month))contributions[e.actor]=add(contributions[e.actor],e.amount);}
  if(e.kind==='expense'){cash=add(cash,-e.amount);if(e.date.startsWith(month))spent=add(spent,e.amount);}
  if(e.kind==='advance'){advances[e.actor]=add(advances[e.actor],e.amount);if(e.date.startsWith(month))spent=add(spent,e.amount);}
  if(e.kind==='reimbursement'){cash=add(cash,-e.amount);advances[e.actor]=add(advances[e.actor],-e.amount);}
 }
 const plan=s.plans.filter(p=>p.status==='active'&&p.month<=month).sort((a,b)=>b.month.localeCompare(a.month))[0]||null;
 const budget=plan?.budget||0;
 const bills=s.bills.filter(b=>b.due.startsWith(month)).map(b=>{
  const paid=entries.filter(e=>e.billId===b.id).reduce((n,e)=>add(n,e.amount),0);
  return {...b,paid,remaining:b.amount-paid};
 });
 const liability=Object.values(advances).reduce((n,v)=>add(n,v),0);
 return {cash,spent,contributions,advances,budget,remaining:budget-spent,goalAvailable:Math.max(0,cash-liability),bills,plan};
}
export function applyCommand(state,actor,c,today='2026-10-15') {
 check(dateOK(today),'Ngày hệ thống không hợp lệ.');
 check(c && typeof c==='object','Lệnh không hợp lệ.');
 const s=clone(state),current=today.slice(0,7);
 if(c.type==='acceptInvite'){
  check(s.invite&&s.invite.invitee===actor&&s.invite.token===c.token,'Lời mời không hợp lệ.');
  check(today<=s.invite.expires,'Lời mời đã hết hạn.');
  check(c.consent===true,'Cần đồng ý rõ ràng về phạm vi chia sẻ.');
  check(!s.members.includes(actor)&&s.members.length===1,'Không gian chỉ dành cho hai người.');
  s.members.push(actor); s.invite=null;
 }else{
  check(s.members.includes(actor),'Bạn chưa tham gia không gian này.');
  if(c.type==='invite'){
   check(s.members.length===1&&text(c.invitee)&&!s.members.includes(c.invitee),'Không thể mời thành viên này.');
   check(text(c.token)&&dateOK(c.expires)&&c.expires>=today,'Thông tin lời mời không hợp lệ.');
   s.invite={invitee:c.invitee,token:c.token,expires:c.expires};
  }else if(c.type==='revokeInvite'){s.invite=null;
  }else{
   check(s.members.length===2,'Cần hai người đồng ý tham gia trước.');
   if(c.type==='proposePlan'){
    newId(s,c.id);check(monthOK(c.month)&&c.month>=current&&!closed(s,c.month),'Kỳ áp dụng không hợp lệ.');
    check(!s.plans.some(p=>p.status==='active')||c.month>current,'Thay đổi chỉ áp dụng từ tháng tương lai.');
    check(!s.plans.some(p=>p.status==='active'&&p.month===c.month),'Tháng này đã có thỏa thuận được chốt.');
    check(amount(c.budget)&&Array.isArray(c.values)&&c.values.length===2,'Nhập ngân sách và hai phần đóng góp.');
    check(c.values.every(v=>Number.isSafeInteger(v)&&v>=0),'Phần đóng góp phải là số nguyên không âm.');
    check((c.mode==='fixed'&&c.values[0]+c.values[1]===c.budget)||(c.mode==='ratio'&&c.values[0]+c.values[1]===100),'Số tiền phải bằng ngân sách hoặc tỷ lệ phải bằng 100%.');
    // A new proposal replaces unapproved terms, never already-active history.
    s.plans=s.plans.filter(p=>p.status==='active'||p.month!==c.month);
    const expected=c.mode==='fixed'?[...c.values]:[Math.floor(c.budget*c.values[0]/100),c.budget-Math.floor(c.budget*c.values[0]/100)];
    s.plans.push({id:c.id,month:c.month,mode:c.mode,budget:c.budget,values:[...c.values],expected,isChange:s.plans.some(p=>p.status==='active'),approvals:[actor],status:'pending'});
   }else if(c.type==='approvePlan'){
    const p=s.plans.find(p=>p.id===c.id);check(p&&p.status==='pending','Không có đề xuất đang chờ.');
    check(((p.isChange||s.plans.some(other=>other.status==='active'))?p.month>current:p.month>=current)&&!closed(s,p.month),'Đề xuất đã quá kỳ áp dụng.');
    if(!p.approvals.includes(actor))p.approvals.push(actor);
    if(both(s,p.approvals)){p.status='active';s.closes=s.closes.filter(x=>x.status==='closed');}
   }else if(c.type==='addEntry'){
    newId(s,c.id);check(amount(c.amount),'Số tiền phải là VND nguyên dương, trong giới hạn.');
    check(dateOK(c.date)&&c.date<=today&&!closed(s,c.date.slice(0,7)),'Ngày giao dịch không hợp lệ hoặc kỳ đã chốt.');
    check(['contribution','expense','advance','reimbursement'].includes(c.kind),'Loại giao dịch không hợp lệ.');
    check(c.note===undefined||typeof c.note==='string'&&c.note.length<=200,'Ghi chú tối đa 200 ký tự.');
    if(c.kind==='reimbursement'){
     const a=s.entries.find(e=>e.id===c.advanceId&&e.kind==='advance'&&e.actor===actor);
     check(a&&a.date<=c.date,'Chọn khoản ứng trước của chính người nhận hoàn.');
     const repaid=s.entries.filter(e=>e.advanceId===c.advanceId).reduce((n,e)=>add(n,e.amount),0);
     check(c.amount<=a.amount-repaid,'Hoàn trả vượt số ứng trước còn lại.');
    }else check(!c.advanceId,'Chỉ hoàn ứng mới tham chiếu khoản ứng trước.');
    if(c.billId){
     check(['expense','advance'].includes(c.kind),'Chỉ chi chung hoặc ứng trước mới thanh toán hóa đơn.');
     const bill=s.bills.find(b=>b.id===c.billId);check(bill,'Hóa đơn không tồn tại.');
     const paid=s.entries.filter(e=>e.billId===bill.id).reduce((n,e)=>add(n,e.amount),0);
     check(c.amount<=bill.amount-paid,'Thanh toán vượt phần hóa đơn còn lại.');
    }
    if(['expense','reimbursement'].includes(c.kind)){
     // Check every chronological prefix so a backdated outflow cannot overdraw history.
     const timeline=[...s.entries,{date:c.date,kind:c.kind,amount:c.amount}].sort((a,b)=>a.date.localeCompare(b.date));
     let cash=0;for(const e of timeline){if(e.kind==='contribution')cash=add(cash,e.amount);if(['expense','reimbursement'].includes(e.kind))cash=add(cash,-e.amount);check(cash>=0,'Quỹ chung không đủ tiền tại ngày giao dịch.');}
    }
    s.entries.push({id:c.id,actor,kind:c.kind,amount:c.amount,date:c.date,note:c.note||'',...(c.billId?{billId:c.billId}:{}),...(c.advanceId?{advanceId:c.advanceId}:{})});
    s.closes=s.closes.filter(x=>x.status==='closed');
   }else if(c.type==='addBill'){
    newId(s,c.id);check(text(c.title)&&amount(c.amount)&&dateOK(c.due)&&!closed(s,c.due.slice(0,7)),'Hóa đơn không hợp lệ hoặc kỳ đã chốt.');
    s.bills.push({id:c.id,title:c.title,amount:c.amount,due:c.due});s.closes=s.closes.filter(x=>x.status==='closed');
   }else if(c.type==='setGoal'){
    check(text(c.title)&&amount(c.target),'Mục tiêu không hợp lệ.');s.goal={title:c.title,target:c.target};
   }else if(c.type==='proposeClose'){
    newId(s,c.id);check(monthOK(c.month)&&c.month<=current&&!closed(s,c.month),'Kỳ chốt không hợp lệ.');
    s.closes=s.closes.filter(x=>x.status==='closed');
    s.closes.push({id:c.id,month:c.month,snapshot:summary(s,c.month),approvals:[actor],status:'pending'});
   }else if(c.type==='approveClose'){
    const close=s.closes.find(x=>x.id===c.id);check(close&&close.status==='pending','Số liệu đã thay đổi hoặc không còn bản chốt đang chờ.');
    if(!close.approvals.includes(actor))close.approvals.push(actor);
    if(both(s,close.approvals))close.status='closed';
   }else fail('Lệnh không được hỗ trợ.');
  }
 }
 for(const month of new Set([current,...s.entries.map(e=>e.date.slice(0,7))]))summary(s,month); // Validate affected historical totals too.
 s.revision+=1;return s;
}

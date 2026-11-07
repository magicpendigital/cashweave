/** Pure, immutable shared-book domain. A/B are local attribution labels, not authentication.
 * The persistence wrapper owns locking and the replayable command journal.
 * Integer VND only; personal ledger deliberately absent from this state.
 */
const fail = message => { throw new Error(message); };
const check = (ok, message) => { if (!ok) fail(message); };
const amount = n => Number.isSafeInteger(n) && n > 0 && n <= 1_000_000_000_000;
const monthOK = x => typeof x==='string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(x);
const dateOK = x => { if(typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x))return false;const d=new Date(x+'T00:00:00Z');return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===x; };
const text = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 200;
const add = (a,b) => { const n=a+b;check(Number.isSafeInteger(n),'Tổng tiền vượt giới hạn tính toán an toàn.');return n; };
const safeTotal = n => { check(n>=-BigInt(Number.MAX_SAFE_INTEGER)&&n<=BigInt(Number.MAX_SAFE_INTEGER),'Tổng tiền vượt giới hạn tính toán an toàn.');return Number(n); };
const clone = x => structuredClone(x);
const both = (s,a) => s.members.length === 2 && s.members.every(x=>a.includes(x));
const closed = (s,m) => s.closes.some(c=>c.month>=m && c.status==='closed');
const newId = (s,id) => check(text(id) && ![...s.entries,...s.bills,...s.plans,...s.closes,...(s.entryCorrections||[])].some(x=>x.id===id),'Mã đã tồn tại hoặc không hợp lệ.');
const liveEntries = s => s.entries.filter(entry=>entry.voided!==true);
function validateMonthlyTotals(entries,members) {
 const buckets=new Map();
 for(const entry of entries){
  const month=entry.date.slice(0,7);
  if(!buckets.has(month))buckets.set(month,{spent:0n,contributions:Object.fromEntries(members.map(actor=>[actor,0n])),advanceDelta:Object.fromEntries(members.map(actor=>[actor,0n]))});
  const bucket=buckets.get(month),value=BigInt(entry.amount);
  if(entry.kind==='contribution')bucket.contributions[entry.actor]+=value;
  if(entry.kind==='expense'||entry.kind==='advance')bucket.spent+=value;
  if(entry.kind==='advance')bucket.advanceDelta[entry.actor]+=value;
  if(entry.kind==='reimbursement')bucket.advanceDelta[entry.actor]-=value;
 }
 const outstanding=Object.fromEntries(members.map(actor=>[actor,0n]));
 for(const month of [...buckets.keys()].sort()){
  const bucket=buckets.get(month);safeTotal(bucket.spent);let liability=0n;
  for(const actor of members){
   safeTotal(bucket.contributions[actor]);outstanding[actor]+=bucket.advanceDelta[actor];
   check(outstanding[actor]>=0n,'Hoàn trả vượt số ứng trước còn lại.');safeTotal(outstanding[actor]);liability+=outstanding[actor];
  }
  safeTotal(liability);
 }
}
function validateEntries(s,today) {
 const ids=new Set();
 for(const entry of s.entries){
  check(entry&&text(entry.id)&&!ids.has(entry.id),'Mã giao dịch đã tồn tại hoặc không hợp lệ.');ids.add(entry.id);
  check(entry.voided===undefined||typeof entry.voided==='boolean','Trạng thái hủy giao dịch không hợp lệ.');
 }
 const entries=liveEntries(s),byId=new Map(entries.map(entry=>[entry.id,entry])),bills=new Map(s.bills.map(bill=>[bill.id,bill])),billPaid=new Map(),repaid=new Map();
 for(const entry of entries){
  check(s.members.includes(entry.actor)&&['contribution','expense','advance','reimbursement'].includes(entry.kind),'Người ghi hoặc loại giao dịch không hợp lệ.');
  check(amount(entry.amount),'Số tiền phải là VND nguyên dương, trong giới hạn.');
  check(dateOK(entry.date)&&entry.date<=today,'Ngày giao dịch không hợp lệ hoặc ở tương lai.');
  check(entry.note===undefined||typeof entry.note==='string'&&entry.note.length<=200,'Ghi chú tối đa 200 ký tự.');
  if(entry.kind==='reimbursement'){
   const advance=byId.get(entry.advanceId);
   check(advance&&advance.kind==='advance'&&advance.actor===entry.actor&&advance.date<=entry.date,'Hoàn ứng phải gắn khoản ứng trước còn hiệu lực, cùng người nhận và không trước ngày ứng.');
   repaid.set(advance.id,add(repaid.get(advance.id)||0,entry.amount));
  }else check(!entry.advanceId,'Chỉ hoàn ứng mới tham chiếu khoản ứng trước.');
  if(entry.billId){
   check(['expense','advance'].includes(entry.kind),'Chỉ chi chung hoặc ứng trước mới thanh toán hóa đơn.');
   const bill=bills.get(entry.billId);check(bill&&amount(bill.amount),'Hóa đơn không tồn tại hoặc không hợp lệ.');
   billPaid.set(bill.id,add(billPaid.get(bill.id)||0,entry.amount));
  }
 }
 for(const [id,total] of repaid)check(total<=byId.get(id).amount,'Hoàn trả vượt số ứng trước còn lại.');
 for(const [id,total] of billPaid)check(total<=bills.get(id).amount,'Thanh toán vượt phần hóa đơn còn lại.');
 // Validate every chronological prefix after any edit, including reducing or
 // moving a contribution. Checking only the edited outflow would miss these.
 let cash=0;
 for(const entry of [...entries].sort((a,b)=>a.date.localeCompare(b.date))){
  if(entry.kind==='contribution')cash=add(cash,entry.amount);
  if(['expense','reimbursement'].includes(entry.kind))cash=add(cash,-entry.amount);
  check(cash>=0,'Quỹ chung không đủ tiền tại ngày giao dịch.');
 }
 // Check every reported historical month with one entry scan and sorted
 // month buckets, rather than rescanning the whole book for every month.
 validateMonthlyTotals(entries,s.members);
}
export function createSpace({id='demo-space',owner='A',name='Nhà mình'}={}) {
 check(text(id)&&text(owner)&&text(name),'Thông tin không gian không hợp lệ.');
 return {version:1,id,name,members:[owner],invite:null,plans:[],entries:[],entryCorrections:[],bills:[],goal:null,closes:[],revision:0};
}
export function summary(s,month) {
 check(monthOK(month),'Tháng không hợp lệ.');
 const entries=liveEntries(s).filter(e=>e.date.slice(0,7)<=month);
 let cash=0n,spent=0n;
 const contributions=Object.fromEntries(s.members.map(x=>[x,0n]));
 const advances=Object.fromEntries(s.members.map(x=>[x,0n]));
 for(const e of entries){
  const value=BigInt(e.amount);
  if(e.kind==='contribution') {cash+=value;if(e.date.startsWith(month))contributions[e.actor]+=value;}
  if(e.kind==='expense'){cash-=value;if(e.date.startsWith(month))spent+=value;}
  if(e.kind==='advance'){advances[e.actor]+=value;if(e.date.startsWith(month))spent+=value;}
  if(e.kind==='reimbursement'){cash-=value;advances[e.actor]-=value;}
 }
 const plan=s.plans.filter(p=>p.status==='active'&&p.month<=month).sort((a,b)=>b.month.localeCompare(a.month))[0]||null;
 const budget=plan?.budget||0;
 const bills=s.bills.filter(b=>b.due.startsWith(month)).map(b=>{
  const paid=safeTotal(entries.filter(e=>e.billId===b.id).reduce((n,e)=>n+BigInt(e.amount),0n));
  return {...b,paid,remaining:b.amount-paid};
 });
 const liability=Object.values(advances).reduce((n,v)=>n+v,0n);safeTotal(liability);
 const goalAvailable=cash-liability;
 return {cash:safeTotal(cash),spent:safeTotal(spent),contributions:Object.fromEntries(Object.entries(contributions).map(([actor,value])=>[actor,safeTotal(value)])),advances:Object.fromEntries(Object.entries(advances).map(([actor,value])=>[actor,safeTotal(value)])),budget,remaining:safeTotal(BigInt(budget)-spent),goalAvailable:goalAvailable>0n?safeTotal(goalAvailable):0,bills,plan};
}
export function applyCommand(state,actor,c,today='2026-10-15') {
 check(dateOK(today),'Ngày hệ thống không hợp lệ.');
 check(c && typeof c==='object','Lệnh không hợp lệ.');
 const s=clone(state),current=today.slice(0,7);
 if(s.entryCorrections===undefined)s.entryCorrections=[];
 check(Array.isArray(s.entryCorrections),'Lịch sử sửa giao dịch không hợp lệ.');
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
     const a=liveEntries(s).find(e=>e.id===c.advanceId&&e.kind==='advance'&&e.actor===actor);
     check(a&&a.date<=c.date,'Chọn khoản ứng trước của chính người nhận hoàn.');
     const repaid=liveEntries(s).filter(e=>e.advanceId===c.advanceId).reduce((n,e)=>add(n,e.amount),0);
     check(c.amount<=a.amount-repaid,'Hoàn trả vượt số ứng trước còn lại.');
    }else check(!c.advanceId,'Chỉ hoàn ứng mới tham chiếu khoản ứng trước.');
    if(c.billId){
     check(['expense','advance'].includes(c.kind),'Chỉ chi chung hoặc ứng trước mới thanh toán hóa đơn.');
     const bill=s.bills.find(b=>b.id===c.billId);check(bill,'Hóa đơn không tồn tại.');
     const paid=liveEntries(s).filter(e=>e.billId===bill.id).reduce((n,e)=>add(n,e.amount),0);
     check(c.amount<=bill.amount-paid,'Thanh toán vượt phần hóa đơn còn lại.');
    }
    if(['expense','reimbursement'].includes(c.kind)){
     // Check every chronological prefix so a backdated outflow cannot overdraw history.
     const timeline=[...liveEntries(s),{date:c.date,kind:c.kind,amount:c.amount}].sort((a,b)=>a.date.localeCompare(b.date));
     let cash=0;for(const e of timeline){if(e.kind==='contribution')cash=add(cash,e.amount);if(['expense','reimbursement'].includes(e.kind))cash=add(cash,-e.amount);check(cash>=0,'Quỹ chung không đủ tiền tại ngày giao dịch.');}
    }
    s.entries.push({id:c.id,actor,kind:c.kind,amount:c.amount,date:c.date,note:c.note||'',...(c.billId?{billId:c.billId}:{}),...(c.advanceId?{advanceId:c.advanceId}:{})});
    s.closes=s.closes.filter(x=>x.status==='closed');
   }else if(c.type==='correctEntry'||c.type==='voidEntry'){
    newId(s,c.id);check(text(c.reason),'Cần lý do sửa hoặc hủy tối đa 200 ký tự.');
    const index=s.entries.findIndex(entry=>entry.id===c.entryId),before=s.entries[index];
    check(before,'Chọn giao dịch cần sửa hoặc hủy.');
    check(dateOK(before.date)&&!closed(s,before.date.slice(0,7)),'Không sửa hoặc hủy giao dịch thuộc kỳ đã chốt.');
    for(const key of ['kind','actor','billId','advanceId'])check(!Object.hasOwn(c,key)||c[key]===before[key],'Giữ nguyên loại, người ghi, hóa đơn và khoản ứng trước khi sửa.');
    let after;
    if(c.type==='voidEntry'){
     check(before.voided!==true,'Giao dịch đã được hủy.');
     check(before.kind!=='advance'||!liveEntries(s).some(entry=>entry.kind==='reimbursement'&&entry.advanceId===before.id),'Chưa hủy khoản ứng trước khi còn hoàn ứng có hiệu lực.');
     after={...before,voided:true};
    }else{
     check(amount(c.amount),'Số tiền phải là VND nguyên dương, trong giới hạn.');
     check(dateOK(c.date)&&c.date<=today&&!closed(s,c.date.slice(0,7)),'Ngày thay thế không hợp lệ, ở tương lai hoặc kỳ đã chốt.');
     check(c.note===undefined||typeof c.note==='string'&&c.note.length<=200,'Ghi chú tối đa 200 ký tự.');
     check(c.reactivate===undefined||typeof c.reactivate==='boolean','Xác nhận mở lại giao dịch không hợp lệ.');
     check(before.voided!==true||c.reactivate===true,'Cần xác nhận rõ để mở lại giao dịch đã hủy.');
     after={...before,amount:c.amount,date:c.date,note:c.note===undefined?before.note||'':c.note,voided:false};
    }
    s.entries[index]=after;
    s.entryCorrections.push({id:c.id,entryId:before.id,type:c.type,actor,at:today,reason:c.reason.trim(),before:clone(before),after:clone(after)});
    s.closes=s.closes.filter(close=>close.status==='closed');
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
 validateEntries(s,today);
 s.revision+=1;return s;
}

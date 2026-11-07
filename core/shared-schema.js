import { createSpace, applyCommand, summary } from '../couples.js';
import { canonical, clone, id } from './identity.js';

export const SHARED_MAX_BYTES = 5 * 1024 * 1024;
export const SHARED_MAX_COMMANDS = 10000;
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=200;
const date=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;};
const utc=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&date(value.slice(0,10))&&Number.isFinite(new Date(value).getTime())&&new Date(value).toISOString()===value;
const actor=value=>value==='A'||value==='B';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function requireCondition(condition,code){if(!condition)throw new Error(code);}
function keys(value,allowed,required=allowed){requireCondition(object(value),'SHARED_INVALID_OBJECT');requireCondition(Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key)),'SHARED_INVALID_FIELDS');}
function names(value){keys(value,['A','B']);requireCondition(text(value.A)&&text(value.B),'SHARED_INVALID_MEMBER_NAMES');}
const money=value=>Number.isSafeInteger(value)&&value>0&&value<=1_000_000_000_000;
const month=value=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
function safeAdd(a,b){const result=a+b;requireCondition(Number.isSafeInteger(result),'SHARED_UNSAFE_TOTAL');return result;}
function approvals(value){requireCondition(Array.isArray(value)&&value.length>=1&&value.length<=2&&new Set(value).size===value.length&&value.every(actor),'SHARED_INVALID_APPROVALS');}
function entryShape(entry){
  keys(entry,['id','actor','kind','amount','date','note','billId','advanceId','voided'],['id','actor','kind','amount','date','note']);
  requireCondition(text(entry.id)&&actor(entry.actor)&&['contribution','expense','advance','reimbursement'].includes(entry.kind)&&money(entry.amount)&&date(entry.date)&&typeof entry.note==='string'&&entry.note.length<=200,'SHARED_INVALID_ENTRY');
  if(Object.hasOwn(entry,'voided'))requireCondition(typeof entry.voided==='boolean','SHARED_INVALID_ENTRY');
  for(const key of ['billId','advanceId'])if(Object.hasOwn(entry,key))requireCondition(text(entry[key]),'SHARED_INVALID_REFERENCE');
  requireCondition(entry.kind==='reimbursement'?text(entry.advanceId):!Object.hasOwn(entry,'advanceId'),'SHARED_INVALID_REFERENCE');
  requireCondition(!entry.billId||['expense','advance'].includes(entry.kind),'SHARED_INVALID_REFERENCE');
}
function planShape(plan){
  keys(plan,['id','month','mode','budget','values','expected','isChange','approvals','status']);
  requireCondition(text(plan.id)&&month(plan.month)&&money(plan.budget)&&['fixed','ratio'].includes(plan.mode)&&Array.isArray(plan.values)&&plan.values.length===2&&plan.values.every(v=>Number.isSafeInteger(v)&&v>=0)&&Array.isArray(plan.expected)&&plan.expected.length===2&&plan.expected.every(v=>Number.isSafeInteger(v)&&v>=0)&&typeof plan.isChange==='boolean'&&['pending','active'].includes(plan.status),'SHARED_INVALID_PLAN');
  requireCondition(plan.values[0]+plan.values[1]===(plan.mode==='fixed'?plan.budget:100),'SHARED_INVALID_PLAN');
  const first=plan.mode==='fixed'?plan.values[0]:Math.floor(plan.budget*plan.values[0]/100);
  requireCondition(plan.expected[0]===first&&plan.expected[1]===plan.budget-first,'SHARED_INVALID_PLAN');approvals(plan.approvals);requireCondition((plan.status==='active')===(plan.approvals.length===2),'SHARED_INVALID_APPROVALS');
}
function billShape(bill,summaryBill=false){keys(bill,['id','title','amount','due',...(summaryBill?['paid','remaining']:[])],['id','title','amount','due',...(summaryBill?['paid','remaining']:[])]);requireCondition(text(bill.id)&&text(bill.title)&&money(bill.amount)&&date(bill.due),'SHARED_INVALID_BILL');if(summaryBill)requireCondition(Number.isSafeInteger(bill.paid)&&bill.paid>=0&&bill.remaining===bill.amount-bill.paid&&bill.remaining>=0,'SHARED_INVALID_BILL');}
function summaryShape(value){
  keys(value,['cash','spent','contributions','advances','budget','remaining','goalAvailable','bills','plan']);
  for(const key of ['cash','spent','budget','remaining','goalAvailable'])requireCondition(Number.isSafeInteger(value[key]),'SHARED_INVALID_CLOSE_SNAPSHOT');
  requireCondition(value.cash>=0&&value.spent>=0&&value.budget>=0&&value.goalAvailable>=0&&value.remaining===value.budget-value.spent,'SHARED_INVALID_CLOSE_SNAPSHOT');
  for(const key of ['contributions','advances']){keys(value[key],['A','B']);requireCondition(Object.values(value[key]).every(n=>Number.isSafeInteger(n)&&n>=0),'SHARED_INVALID_CLOSE_SNAPSHOT');}
  requireCondition(Array.isArray(value.bills),'SHARED_INVALID_CLOSE_SNAPSHOT');value.bills.forEach(bill=>billShape(bill,true));if(value.plan!==null)planShape(value.plan);
}
// This linear structural/reference pass runs on every stored read, independently
// of the corruption capsule. Historical command semantics are additionally
// replayed for all untrusted files, never inferred from an unkeyed checksum.
function spaceShape(space,today){
  const ids=new Set(),bills=new Map(),entries=new Map(),paid=new Map(),repaid=new Map(),timeline=[];
  const unique=value=>{requireCondition(!ids.has(value.id),'SHARED_DUPLICATE_ENTITY');ids.add(value.id);};
  for(const bill of space.bills){billShape(bill);unique(bill);bills.set(bill.id,bill);}
  for(const plan of space.plans){planShape(plan);unique(plan);}
  for(const entry of space.entries){entryShape(entry);unique(entry);entries.set(entry.id,entry);if(!entry.voided){requireCondition(entry.date<=today,'SHARED_INVALID_ENTRY_DATE');timeline.push(entry);}}
  let cash=0;for(const entry of timeline){
    if(entry.advanceId){const advance=entries.get(entry.advanceId);requireCondition(advance&&!advance.voided&&advance.kind==='advance'&&advance.actor===entry.actor&&advance.date<=entry.date,'SHARED_INVALID_REFERENCE');repaid.set(advance.id,safeAdd(repaid.get(advance.id)||0,entry.amount));}
    if(entry.billId){requireCondition(bills.has(entry.billId),'SHARED_INVALID_REFERENCE');paid.set(entry.billId,safeAdd(paid.get(entry.billId)||0,entry.amount));}
  }
  for(const [key,total]of paid)requireCondition(total<=bills.get(key).amount,'SHARED_BILL_OVERPAID');
  for(const [key,total]of repaid)requireCondition(total<=entries.get(key).amount,'SHARED_ADVANCE_OVERPAID');
  for(const entry of timeline.sort((a,b)=>a.date.localeCompare(b.date))){if(entry.kind==='contribution')cash=safeAdd(cash,entry.amount);if(['expense','reimbursement'].includes(entry.kind))cash=safeAdd(cash,-entry.amount);requireCondition(cash>=0,'SHARED_NEGATIVE_CASH');}
  if(space.goal!==null){keys(space.goal,['title','target']);requireCondition(text(space.goal.title)&&money(space.goal.target),'SHARED_INVALID_GOAL');}
  for(const close of space.closes){keys(close,['id','month','snapshot','approvals','status']);requireCondition(text(close.id)&&month(close.month)&&['pending','closed'].includes(close.status),'SHARED_INVALID_CLOSE');unique(close);approvals(close.approvals);requireCondition((close.status==='closed')===(close.approvals.length===2),'SHARED_INVALID_APPROVALS');summaryShape(close.snapshot);}
  for(const correction of space.entryCorrections||[]){keys(correction,['id','entryId','type','actor','at','reason','before','after']);requireCondition(text(correction.id)&&entries.has(correction.entryId)&&['correctEntry','voidEntry'].includes(correction.type)&&actor(correction.actor)&&date(correction.at)&&text(correction.reason),'SHARED_INVALID_CORRECTION');unique(correction);entryShape(correction.before);entryShape(correction.after);requireCondition(correction.before.id===correction.entryId&&correction.after.id===correction.entryId&&['id','kind','actor','billId','advanceId'].every(key=>correction.before[key]===correction.after[key]),'SHARED_INVALID_CORRECTION');}
}

export function createSharedDataset({namespace='personal',now=new Date().toISOString()}={}){
  requireCondition(['personal','sandbox'].includes(namespace),'SHARED_INVALID_NAMESPACE');requireCondition(utc(now),'SHARED_INVALID_UTC');
  return {schemaVersion:1,datasetId:id(),namespace,revision:0,currencyCode:'VND',createdAtUtc:now,updatedAtUtc:now,space:null,names:null,journal:[],receipts:[]};
}
export function validateSharedCommand(command){
  canonical(command);keys(command,['commandId','type','actor','today','input']);
  requireCondition(uuid(command.commandId),'SHARED_INVALID_COMMAND_ID');requireCondition(actor(command.actor),'SHARED_INVALID_ACTOR');requireCondition(date(command.today),'SHARED_INVALID_DATE');
  const input=command.input;
  if(command.type==='create'){
    keys(input,['name','names','consentA','consentB','sharedDeviceAck']);names(input.names);requireCondition(text(input.name),'SHARED_INVALID_NAME');
    requireCondition(input.consentA===true&&input.consentB===true&&input.sharedDeviceAck===true,'SHARED_LOCAL_CONSENT_REQUIRED');
  }else{
    const fields={proposePlan:['id','month','mode','budget','values'],approvePlan:['id'],addEntry:['id','kind','amount','date','note','billId','advanceId'],addBill:['id','title','amount','due'],setGoal:['title','target'],proposeClose:['id','month'],approveClose:['id'],correctEntry:['id','entryId','amount','date','note','reason','reactivate'],voidEntry:['id','entryId','reason']};
    requireCondition(Object.hasOwn(fields,command.type),'SHARED_COMMAND_UNSUPPORTED');
    keys(input,fields[command.type],command.type==='addEntry'?['id','kind','amount','date']:command.type==='correctEntry'?['id','entryId','amount','date','reason']:fields[command.type]);
    if(Object.hasOwn(input,'reactivate'))requireCondition(typeof input.reactivate==='boolean','SHARED_INVALID_REACTIVATION');
    // All finance and chronology validation stays in the existing pure domain.
    // Strict keys prevent unknown backup fields from silently disappearing.
  }
  return command;
}
function applyJournalCommand(space,command){
  if(command.type==='create'){
    requireCondition(space===null,'SHARED_BOOK_ALREADY_CREATED');
    // Both local users consented on this one device. A/B are attribution labels;
    // these internal domain calls do not authenticate or send an invitation.
    let next=createSpace({id:command.commandId,owner:'A',name:command.input.name});
    const token='local-consent:'+command.commandId;
    next=applyCommand(next,'A',{type:'invite',invitee:'B',token,expires:command.today},command.today);
    return applyCommand(next,'B',{type:'acceptInvite',token,consent:true},command.today);
  }
  requireCondition(space!==null,'SHARED_BOOK_NOT_CREATED');
  return applyCommand(space,command.actor,{type:command.type,...command.input},command.today);
}
function validateEnvelope(snapshot){
  canonical(snapshot);
  if(snapshot?.schemaVersion>1)throw new Error('SHARED_FUTURE_SCHEMA_READ_ONLY');
  keys(snapshot,['schemaVersion','datasetId','namespace','revision','currencyCode','createdAtUtc','updatedAtUtc','space','names','journal','receipts']);
  requireCondition(snapshot.schemaVersion===1&&uuid(snapshot.datasetId)&&['personal','sandbox'].includes(snapshot.namespace),'SHARED_INVALID_SCHEMA');
  requireCondition(snapshot.currencyCode==='VND','SHARED_INVALID_CURRENCY');requireCondition(utc(snapshot.createdAtUtc)&&utc(snapshot.updatedAtUtc),'SHARED_INVALID_UTC');
  requireCondition(Array.isArray(snapshot.journal)&&Array.isArray(snapshot.receipts)&&snapshot.journal.length<=SHARED_MAX_COMMANDS&&snapshot.journal.length===snapshot.receipts.length&&snapshot.revision===snapshot.journal.length,'SHARED_INVALID_REVISION');
  let memberNames=null;const commands=new Set();
  for(let n=0;n<snapshot.journal.length;n++){
    const entry=snapshot.journal[n];keys(entry,['command','committedAtUtc']);requireCondition(utc(entry.committedAtUtc),'SHARED_INVALID_UTC');validateSharedCommand(entry.command);
    requireCondition(!commands.has(entry.command.commandId),'SHARED_DUPLICATE_COMMAND');commands.add(entry.command.commandId);
    requireCondition((n===0)===(entry.command.type==='create'),'SHARED_INVALID_CREATION_JOURNAL');
    const receipt=snapshot.receipts[n];keys(receipt,['commandId','payloadCanonical','committedRevision']);
    requireCondition(receipt.commandId===entry.command.commandId&&receipt.payloadCanonical===canonical(entry.command)&&receipt.committedRevision===n+1,'SHARED_RECEIPT_MISMATCH');
    if(n===0)memberNames=clone(entry.command.input.names);
  }
  requireCondition(canonical(snapshot.names)===canonical(memberNames),'SHARED_JOURNAL_STATE_MISMATCH');
  if(snapshot.revision===0)requireCondition(snapshot.space===null,'SHARED_JOURNAL_STATE_MISMATCH');
  else{
    keys(snapshot.space,['version','id','name','members','invite','plans','entries','bills','goal','closes','revision','entryCorrections'],['version','id','name','members','invite','plans','entries','bills','goal','closes','revision']);
    requireCondition(snapshot.space.version===1&&snapshot.space.id===snapshot.journal[0].command.commandId&&snapshot.space.name===snapshot.journal[0].command.input.name&&canonical(snapshot.space.members)==='["A","B"]'&&snapshot.space.invite===null&&snapshot.space.revision===snapshot.revision+1,'SHARED_INVALID_SPACE');
    for(const collection of ['plans','entries','bills','closes'])requireCondition(Array.isArray(snapshot.space[collection])&&snapshot.space[collection].length<=SHARED_MAX_COMMANDS,'SHARED_INVALID_SPACE_COLLECTION');
    if(snapshot.space.entryCorrections!==undefined)requireCondition(Array.isArray(snapshot.space.entryCorrections)&&snapshot.space.entryCorrections.length<=SHARED_MAX_COMMANDS,'SHARED_INVALID_SPACE_COLLECTION');
    spaceShape(snapshot.space,snapshot.journal.at(-1).command.today);
  }
  requireCondition(snapshot.updatedAtUtc===(snapshot.journal.length?snapshot.journal.at(-1).committedAtUtc:snapshot.createdAtUtc),'SHARED_INVALID_UPDATED_AT');
  return snapshot;
}
function replayStep(space,command){try{return applyJournalCommand(space,command);}catch(error){throw new Error('SHARED_JOURNAL_REPLAY_FAILED:'+error.message);}}
export function validateSharedSnapshot(snapshot,{replay=true}={}){
  validateEnvelope(snapshot);if(replay){let space=null;for(const entry of snapshot.journal)space=replayStep(space,entry.command);requireCondition(canonical(snapshot.space)===canonical(space),'SHARED_JOURNAL_STATE_MISMATCH');}return snapshot;
}
export async function validateSharedSnapshotAsync(snapshot,{onProgress}={}){
  validateEnvelope(snapshot);let space=null,lastYield=performance.now();
  for(let n=0;n<snapshot.journal.length;n++){
    space=replayStep(space,snapshot.journal[n].command);
    if((n+1)%100===0||performance.now()-lastYield>=12){if(typeof onProgress==='function')onProgress({completed:n+1,total:snapshot.journal.length});await new Promise(resolve=>setTimeout(resolve,0));lastYield=performance.now();}
  }
  requireCondition(canonical(snapshot.space)===canonical(space),'SHARED_JOURNAL_STATE_MISMATCH');return snapshot;
}
// The repository calls this only with its already validated, cloned snapshot.
// Induction through applyCommand avoids replaying all old commands twice/write.
export function prepareSharedExecution(before,command,expectedRevision,{now=new Date().toISOString()}={}){
  validateSharedCommand(command);requireCondition(utc(now),'SHARED_INVALID_UTC');
  const payloadCanonical=canonical(command),existing=before.receipts.find(receipt=>receipt.commandId===command.commandId);
  if(existing){requireCondition(existing.payloadCanonical===payloadCanonical,'SHARED_COMMAND_ID_REUSED');return {snapshot:clone(before),replay:true};}
  requireCondition(expectedRevision===before.revision,'SHARED_REVISION_CONFLICT');requireCondition(before.journal.length<SHARED_MAX_COMMANDS,'SHARED_HISTORY_LIMIT');
  const next=clone(before);next.space=applyJournalCommand(next.space,command);if(command.type==='create')next.names=clone(command.input.names);
  next.revision++;next.updatedAtUtc=now;next.journal.push({command:clone(command),committedAtUtc:now});next.receipts.push({commandId:command.commandId,payloadCanonical,committedRevision:next.revision});
  return {snapshot:next,replay:false};
}
export function sharedSummary(snapshot,month){validateSharedSnapshot(snapshot);return snapshot.space?summary(snapshot.space,month):null;}

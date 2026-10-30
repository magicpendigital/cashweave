import { minor, sum } from '../../core/money.js';
import { addDays } from '../../core/calendar.js';
import { entity, poolSummary } from '../../core/model.js';
import { reportDescriptor } from '../../core/reports.js';
import { netWorthOf } from './assets.js';
import { gettingStartedCard } from './guide.js';

// Shared row pieces for Home and Kế hoạch: date badge, plan meta and the inline "Đã trả" action.
export function planRow(c,p,{compact=false}={}){
  const {h,t,fmt,fill,today,daysBetween,action,go,link}=c,overdue=p.dueLocalDate<today(),partial=minor(p.netSettled)>0n,expense=p.direction==='EXPENSE';
  const when=overdue?fill(t('overdueDays'),{n:daysBetween(p.dueLocalDate,today())}):p.dueLocalDate===today()?t('dueToday'):fill(t('daysLeft'),{n:daysBetween(today(),p.dueLocalDate)});
  const amount=(expense?'':'+')+fmt(partial?p.openRemaining:p.expectedAmountMinor,p.currencyCode),settled=partial?fill(t(expense?'paidSoFar':'receivedSoFar'),{amount:fmt(p.netSettled,p.currencyCode)}):'';
  const meta=compact?[amount,when].join(' · '):[overdue?when:c.shortDate(p.dueLocalDate),amount,settled].filter(Boolean).join(' · ');
  const label=partial?(expense?'payMore':'receiveMore'):(expense?'recordPayment':'recordReceipt');
  return h('div',{class:'plan-row'+(overdue?' overdue':''),'data-plan':p.id},
    compact?h('div',{class:'date-badge'+(overdue?' warn':'')},h('small',{},'T'+Number(p.dueLocalDate.slice(5,7))),h('strong',{},p.dueLocalDate.slice(8,10))):null,
    h('div',{class:'row-main'},h('p',{class:'row-title'},link('plans/'+p.id,p.title),p.seriesId?h('span',{class:'tag'},t('repeatsMonthly')):null),h('p',{class:'row-meta'+(overdue?' warn-text':expense?'':' positive')},meta)),
    p.closure==='OPEN'&&minor(p.openRemaining)>0n?action(label,()=>go('transactions/new/'+p.id),false,{class:'button pay-button','data-pay':p.id}):h('span',{class:'tag'},t(p.closure==='FINALIZED'?'closureFinalized':p.closure==='CANCELLED'?'closureCancelled':'closureOpen')));
}
// Envelopes holding more than the in-budget cash: explain it and offer the fixes, never an allocate CTA.
export function overAllocatedCard(c,unassigned,currency){const {h,t,fill,fmt,action,go,ui}=c,state=c.state,latest=[...state.allocationApplications].filter(a=>!a.reversalOfApplicationId&&a.currencyCode===currency).sort((a,b)=>b.revision-a.revision)[0];return h('section',{class:'card warn-card','data-over-allocated':'true',role:'status'},h('p',{class:'warn-title','data-amount':'unassigned'},fill(t('overAllocated'),{amount:fmt(unassigned.replace('-',''),currency)})),h('p',{},t('overAllocatedHelp')),h('div',{class:'actions'},action('reviewExpenses',async()=>{ui.ledgerFilter={query:'',type:'EXPENSE'};ui.range={...ui.range,currencyCode:currency,accountId:''};await go('transactions');},false,{class:'button warn-button'}),latest?action('reviewAllocations',()=>go('allocations/'+latest.id),false,{class:'button text-button'}):null));}
export function operationSummary(c,operation,{accountId=''}={}){
  const {t}=c,state=c.state,postings=state.postings.filter(p=>p.operationId===operation.id&&(!accountId||p.accountId===accountId));
  const categories=[...new Set(postings.filter(p=>p.categoryId).map(p=>entity(state,'categories',p.categoryId).name))];
  const accounts=postings.map(p=>entity(state,'accounts',p.accountId).name);
  const transfer=operation.operationType==='TRANSFER'||operation.operationType==='REVERSAL'&&postings.length>1;
  const amount=transfer&&!accountId?postings.map(p=>minor(p.signedAmountMinor)).find(n=>n>0n)?.toString()||'0':sum(postings.map(p=>p.signedAmountMinor));
  const titleText=operation.operationType==='OPENING'?t('opening'):operation.memo||categories[0]||c.opLabel(operation);
  const meta=[categories.join(' / '),transfer&&!accountId?accounts.join(' → '):[...new Set(accounts)].join(' / ')].filter(Boolean).join(' · ');
  return {postings,categories,accounts,amount,title:titleText,meta,transfer,currency:postings[0]?.currencyCode};
}
export const toneOf=(operation,amount)=>operation.operationType==='TRANSFER'?'neutral':minor(amount)>0n?'positive':'';

// Screen 3 · Trang chủ answers: how much do I have, what is due, what money has no purpose yet.
export async function homeScreen(c){
  const {h,t,icon,fmt,fmtSigned,fill,today,currentMonth,memo,balance,report,link,action,go,run,ui,pendingPlans,weekday,shortDate,dayLabel,card}=c,state=c.state,currency=state.profile.defaultCurrencyCode,month=currentMonth(),end=addDays(today(),1);
  const accounts=state.accounts.filter(a=>a.currencyCode===currency),worth=netWorthOf(c,currency);
  const byType=new Map();for(const a of accounts.filter(a=>worth.spendableIds.has(a.id))){byType.set(a.type,(byType.get(a.type)||0n)+minor(balance(a.id)));}
  const describe=metricId=>reportDescriptor(state,{metricId,currencyCode:currency,startLocalDateInclusive:month+'-01',endLocalDateExclusive:end,accountIds:[],datasetRevision:state.revision});
  const [income,expense,cash]=await Promise.all([report(describe('ActualIncome')),report(describe('ActualExpense')),report(describe('CashBalanceAsOf'))]);
  const drill=(metricId,result)=>run(async()=>{ui.range={from:month+'-01',through:today(),accountId:'',currencyCode:currency};ui.activeReport=result.descriptor;ui.reportCursor=0;await go('reports/'+metricId);});
  const pool=state.budgetPools.find(p=>p.currencyCode===currency),unassigned=pool?memo('unassigned:'+pool.id,()=>poolSummary(state,pool.id,end).unassigned):'0';
  const due=pendingPlans({currency,accountId:''}).filter(p=>p.dueLocalDate<=addDays(today(),30)).slice(0,5);
  const replaced=memo('replaced',()=>new Set(state.operations.filter(o=>o.replacementForOperationId).map(o=>o.replacementForOperationId))),reversed=memo('reversed',()=>new Set(state.operations.filter(o=>o.reversalOfOperationId).map(o=>o.reversalOfOperationId)));
  const recent=memo('recent:'+currency,()=>state.operations.filter(o=>o.operationType!=='REVERSAL'&&!replaced.has(o.id)&&state.postings.some(p=>p.operationId===o.id&&p.currencyCode===currency)).sort((a,b)=>b.effectiveLocalDate.localeCompare(a.effectiveLocalDate)||(b.committedAtUtc||'').localeCompare(a.committedAtUtc||'')).slice(0,5));
  const others=[...new Set(state.accounts.map(a=>a.currencyCode))].filter(code=>code!==currency).map(code=>fmt(sum(state.accounts.filter(a=>a.currencyCode===code&&a.includeInBudget!==false).map(a=>balance(a.id))),code));
  const hidden=c.amountsHidden(),backup=c.backupStatus(),monthNo=Number(month.slice(5,7));
  const typeNames={BANK:'bankType',CASH:'cashType',E_WALLET:'eWalletType',INVESTMENT:'investmentType'};
  return [
    h('div',{class:'home-head'},h('div',{},h('p',{class:'muted'},weekday(today())+', '+shortDate(today())),h('h1',{},t('hello'))),h('button',{type:'button',class:'icon-button','aria-label':t(hidden?'showAmounts':'hideAmounts'),'aria-pressed':String(hidden),onClick:run(async()=>{c.setPrefs({hideAmounts:!hidden});await c.render();})},icon(hidden?'eyeOff':'eye'))),
    h('section',{class:'hero','aria-label':t('spendable')},
      h('button',{type:'button',class:'hero-main','data-metric':'cashBalance',onClick:drill('CashBalanceAsOf',cash)},h('span',{},t('spendable')),h('strong',{class:'num','data-amount':'spendable'},fmt(worth.spendableMinor,currency))),
      byType.size?h('p',{class:'hero-sub'},[...byType].map(([type,value])=>t(typeNames[type]||'account')+' '+fmt(value.toString(),currency)).join(' · ')):null,
      others.length?h('p',{class:'hero-sub'},t('otherCurrencies')+': '+others.join(' · ')):null,
      link('assets',[h('span',{},t('netWorthLink')),h('strong',{class:'num'},fmt(worth.totalMinor,currency)+' ›')],{class:'hero-link'}),
      h('div',{class:'hero-tiles'},
        h('button',{type:'button',class:'hero-tile','data-metric':'actualIncome',onClick:drill('ActualIncome',income)},h('span',{},t('incomeMonth')+' '+monthNo),h('strong',{class:'num','data-amount':'income'},fmtSigned(income.totalMinor,currency))),
        h('button',{type:'button',class:'hero-tile','data-metric':'actualExpense',onClick:drill('ActualExpense',expense)},h('span',{},t('expenseMonth')+' '+monthNo),h('strong',{class:'num','data-amount':'expense'},(minor(expense.totalMinor)>0n?'−':'')+fmt(expense.totalMinor,currency))))),
    gettingStartedCard(c),
    minor(unassigned)<0n?overAllocatedCard(c,unassigned,currency):minor(unassigned)>0n?link('allocate',[icon('split'),h('span',{class:'grow'},h('strong',{},fmt(unassigned,currency)+' '+t('unassignedSuggest')),' '+t('splitPrompt')),icon('chevron')],{class:'suggest','data-suggest':'allocate'}):null,
    backup.stale&&state.operations.length>1?h('section',{class:'card warn-card','data-backup-reminder':'home'},h('p',{class:'warn-title'},backup.days===null?t('backupNever'):fill(t('backupLast'),{n:backup.days})),h('p',{},t('backupWarn')),action('backupNow',c.exportBackup,false,{class:'button warn-button'})):null,
    h('section',{class:'card list-card'},h('div',{class:'section-heading'},h('h2',{},t('dueSoon')),link('plans',t('seeCalendar'),{class:'text-link'})),due.length?due.map(p=>planRow(c,p,{compact:true})):h('p',{class:'muted'},t('noUpcomingShort'))),
    h('section',{class:'card list-card'},h('div',{class:'section-heading'},h('h2',{},t('recent')),link('transactions',t('seeAll'),{class:'text-link'})),recent.length?recent.map(o=>{const s=operationSummary(c,o);return h('a',{href:'#transactions/'+o.id,class:'ledger-row'+(reversed.has(o.id)?' struck':''),onClick:run(()=>go('transactions/'+o.id))},h('span',{class:'row-icon '+(s.transfer?'neutral':minor(s.amount)>0n?'positive':'')},icon(s.transfer?'transfer':minor(s.amount)>0n?'income':'expense')),h('div',{class:'row-main'},h('p',{class:'row-title'},s.title),h('p',{class:'row-meta'},[o.effectiveLocalDate===today()?t('today'):shortDate(o.effectiveLocalDate),s.accounts.join(' → ')].join(' · '))),h('span',{class:'row-amount num '+toneOf(o,s.amount)},s.transfer?fmt(s.amount,s.currency):fmtSigned(s.amount,s.currency)));}):h('p',{class:'muted'},t('noRecent')))
  ];
}

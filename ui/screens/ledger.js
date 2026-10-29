import { minor, sum, EXPONENTS } from '../../core/money.js';
import { entity, planSummary } from '../../core/model.js';
import { operationSummary, toneOf } from './home.js';

const TYPE_CHIPS=[['','allTypes'],['EXPENSE','expenseShort'],['INCOME','incomeShort'],['TRANSFER','transferShort']];

// Screen 5 · Sổ: month picker, search, type chips, rows grouped by day, 50 rows per page.
export async function ledgerScreen(c){
  const {h,t,fmt,fmtSigned,fill,ui,run,go,form,input,field,action,link,filterSheet,rangeForm,periodLabel,dayLabel,report,descriptor,scopedPostings,formDrafts,document}=c,state=c.state,r=ui.range,f=ui.ledgerFilter,locale=state.profile.locale;
  const query=f.query.trim().toLocaleLowerCase(locale);
  const replaced=new Set(state.operations.filter(o=>o.replacementForOperationId).map(o=>o.replacementForOperationId)),reversed=new Set(state.operations.filter(o=>o.reversalOfOperationId).map(o=>o.reversalOfOperationId));
  const showAll=ui.showCorrections||f.type==='REVERSAL';let hiddenCorrections=0;
  const operations=state.operations.filter(o=>o.effectiveLocalDate>=r.from&&o.effectiveLocalDate<=r.through&&(!f.type||o.operationType===f.type)).sort((a,b)=>b.effectiveLocalDate.localeCompare(a.effectiveLocalDate)||(b.committedAtUtc||'').localeCompare(a.committedAtUtc||''));
  const rows=[];
  for(const o of operations){
    if(!scopedPostings(o).length)continue;
    const s=operationSummary(c,o,{accountId:r.accountId});
    if(query&&![o.memo||'',s.categories.join(' '),s.accounts.join(' ')].join(' ').toLocaleLowerCase(locale).includes(query))continue;
    if(!showAll&&(o.operationType==='REVERSAL'||replaced.has(o.id))){hiddenCorrections++;continue;}
    rows.push({o,s});
  }
  const [income,expense]=await Promise.all([report(descriptor('ActualIncome')),report(descriptor('ActualExpense'))]);
  const visible=rows.slice(0,ui.ledgerLimit),days=new Map();
  for(const row of visible){if(!days.has(row.o.effectiveLocalDate))days.set(row.o.effectiveLocalDate,[]);days.get(row.o.effectiveLocalDate).push(row);}
  const pickType=key=>run(async()=>{const typed=document.getElementById('ledger-filter-form-query')?.value;ui.ledgerFilter={query:typed??f.query,type:key};ui.ledgerLimit=50;formDrafts.delete('ledger-filter-form');await c.render();});
  const filters=form('ledger-filter-form',[h('div',{class:'search-box'},c.icon('search'),h('label',{for:'query',class:'sr-only'},t('ledgerSearch')),input('query','search',f.query,{placeholder:t('ledgerSearchHelp'),autocomplete:'off'}),input('type','hidden',f.type))],async values=>{ui.ledgerFilter={query:values.query||'',type:values.type||''};ui.ledgerLimit=50;formDrafts.delete('ledger-filter-form');await c.render();},'filterLedger',{class:'search-form'});
  const row=({o,s})=>{const tag=replaced.has(o.id)||o.replacementForOperationId?t('edited'):reversed.has(o.id)?t('cancelledTag'):'';return h('a',{href:'#transactions/'+o.id,class:'ledger-row'+(reversed.has(o.id)?' struck':''),onClick:run(()=>go('transactions/'+o.id))},h('div',{class:'row-main'},h('p',{class:'row-title'},s.title),h('p',{class:'row-meta'},s.meta||c.opLabel(o))),tag?h('span',{class:'tag tag-blue'},tag):null,h('span',{class:'row-amount num '+toneOf(o,s.amount)},s.transfer&&!r.accountId?fmt(s.amount,s.currency):fmtSigned(s.amount,s.currency)));};
  const filtered=!!(f.query||f.type);
  return [
    h('div',{class:'page-head row-head'},h('h1',{},t('transactions')),filterSheet(periodLabel(),rangeForm())),
    filters,
    h('div',{class:'chip-row',role:'group','aria-label':t('filterType')},TYPE_CHIPS.map(([key,label])=>h('button',{type:'button',class:'chip'+(f.type===key?' on':''),'aria-pressed':String(f.type===key),'data-type-filter':key||'ALL',onClick:pickType(key)},t(label)))),
    h('div',{class:'tiles'},h('div',{class:'tile'},h('span',{},t('received')),h('strong',{class:'num positive','data-amount':'received'},fmtSigned(income.totalMinor))),h('div',{class:'tile'},h('span',{},t('spent')),h('strong',{class:'num','data-amount':'spent'},(minor(expense.totalMinor)>0n?'−':'')+fmt(expense.totalMinor)))),
    h('div',{class:'list-tools'},h('p',{id:'ledger-count',class:'muted'},t('resultsCount')+': '+rows.length),filtered?action('clearFilters',async()=>{ui.ledgerFilter={query:'',type:''};ui.ledgerLimit=50;formDrafts.delete('ledger-filter-form');await c.render();},false,{class:'button text-button'}):null),
    rows.length?[...days].map(([date,items])=>{const spent=sum(items.filter(i=>i.o.operationType==='EXPENSE').map(i=>i.s.amount));return h('section',{class:'day-group'},h('div',{class:'day-head'},h('strong',{},dayLabel(date)),minor(spent)<0n?h('span',{class:'num muted'},fill(t('dayExpense'),{amount:fmt(spent.replace('-',''))})):null),h('div',{class:'card list-card'},items.map(row)));}):h('div',{class:'empty'},t(filtered?'noMatches':'noTransactions')),
    rows.length>visible.length?action('showMore',async()=>{ui.ledgerLimit+=50;await c.render();},false,{class:'button wide','data-show-more':'true'}):null,
    hiddenCorrections||ui.showCorrections?action(ui.showCorrections?'hideCorrections':'showCorrections',async()=>{ui.showCorrections=!ui.showCorrections;await c.render();},false,{class:'button text-button'}):null
  ];
}

function keypadPress(c,key,currency){
  const node=c.document.getElementById('transaction-form-amount');if(!node)return;
  const parts=new Intl.NumberFormat(c.state.profile.locale).formatToParts(11111.1),group=parts.find(p=>p.type==='group')?.value||'.',dec=parts.find(p=>p.type==='decimal')?.value||',',exponent=EXPONENTS[currency]||0;
  let raw=String(node.value||'').split(group).join('').replace(/\s/g,'');
  const [whole='',fraction]=raw.split(dec);
  if(key==='back')raw=raw.slice(0,-1);
  else if(key==='dec'){if(exponent>0&&fraction===undefined)raw=(whole||'0')+dec;}
  else if(fraction!==undefined){if(fraction.length+key.length<=exponent)raw+=key;}
  else if((whole+key).replace(/^0+/,'').length<=15)raw=whole||key!=='000'?whole+key:'';
  const [nextWhole='',nextFraction]=raw.split(dec),digits=nextWhole.replace(/\D/g,'').replace(/^0+(?=\d)/,''),grouped=digits.replace(/\B(?=(\d{3})+(?!\d))/g,group);
  node.value=nextFraction!==undefined?(grouped||'0')+dec+nextFraction:grouped;
}

// Screen 4 · Ghi nhanh: Chi/Thu/Chuyển, working keypad, category chips; "Đã trả" for a plan reuses it.
export function quickAddScreen(c,planId){
  const {h,t,fmt,fill,icon,ui,run,go,form,input,select,field,button,perform,today,toMinor,accountChoices,formDrafts,browser,document}=c,state=c.state;
  const plan=planId&&planId!=='expense'?entity(state,'occurrences',planId):null,summary=plan?planSummary(state,plan.id):null,draft=formDrafts.get('transaction-form');
  const direction=plan?.direction||draft?.operationType||'EXPENSE',currency=plan?.currencyCode||ui.range.currencyCode,choices=accountChoices(currency);
  const defaultAccount=plan?.expectedAccountId&&choices.some(([key])=>key===plan.expectedAccountId)?plan.expectedAccountId:choices.some(([key])=>key===ui.range.accountId)?ui.range.accountId:choices[0]?.[0];
  const formValues=()=>Object.fromEntries(new browser.FormData(document.getElementById('transaction-form')));
  const switchType=type=>run(async()=>{const values=formValues();if(values.operationType!==type){values.operationType=type;values.categoryId='';}formDrafts.set('transaction-form',values);await c.render();});
  const pickCategory=categoryId=>run(()=>{const hidden=document.getElementById('transaction-form-categoryId');if(!hidden)return;const next=hidden.value===categoryId?'':categoryId;hidden.value=next;for(const chip of document.getElementById('transaction-form').querySelectorAll('[data-category]')){const on=chip.getAttribute('data-category')===next;chip.setAttribute('aria-pressed',String(on));chip.setAttribute('class','chip'+(on?' on':''));}});
  const addCategory=run(async()=>{const name=document.getElementById('transaction-form-new-category')?.value||'',values=formValues();const receipt=await perform('addCategory',{name,direction});ui.addingCategory=false;formDrafts.set('transaction-form',{...values,categoryId:receipt.resultIds[0],'new-category':''});await c.render();});
  const categories=state.categories.filter(x=>!x.archivedAtUtc&&x.direction===direction),selectedCategory=draft?.categoryId||'';
  const sign=direction==='EXPENSE'?'−':direction==='INCOME'?'+':'';
  const exponent=EXPONENTS[currency]||0,keys=['1','2','3','4','5','6','7','8','9',exponent?'dec':'000','0','back'];
  const decimal=new Intl.NumberFormat(state.profile.locale).formatToParts(1.1).find(p=>p.type==='decimal')?.value||',';
  const segments=(plan?[[plan.direction]]:[['EXPENSE'],['INCOME'],['TRANSFER']]).map(([key])=>h('button',{type:'button',class:'seg'+(direction===key?' on':''),'aria-pressed':String(direction===key),'data-operation-type':key,onClick:switchType(key)},t(key==='EXPENSE'?'expenseShort':key==='INCOME'?'incomeShort':'transferShort')));
  return [
    plan?h('div',{class:'plan-context'},h('span',{class:'muted'},t('recordingFor')),h('strong',{},plan.title),h('span',{class:'num'},fmt(summary.openRemaining,currency)+' · '+c.shortDate(plan.dueLocalDate))):null,
    form('transaction-form',[
      h('div',{class:'segmented',role:'group','aria-label':t('transactionType')},segments),input('operationType','hidden',direction),
      h('div',{class:'amount-display '+(direction==='INCOME'?'positive':'')},h('label',{for:'amount',class:'sr-only'},t('amount')+' · '+currency),h('span',{class:'amount-sign','aria-hidden':'true'},sign),input('amount','text','',{required:true,inputmode:'none',autocomplete:'off',class:'amount-input',placeholder:'0'}),h('span',{class:'amount-unit'},currency)),
      h('p',{class:'muted center'},t(direction==='TRANSFER'?'transferHint':'chooseCategory')),
      direction==='TRANSFER'?null:[input('categoryId','hidden',selectedCategory),h('div',{class:'chip-row scroll',role:'group','aria-label':t('category')},categories.map(x=>h('button',{type:'button',class:'chip'+(selectedCategory===x.id?' on':''),'aria-pressed':String(selectedCategory===x.id),'data-category':x.id,onClick:pickCategory(x.id)},x.name)),ui.addingCategory?null:h('button',{type:'button',class:'chip dashed','data-add-category':'true',onClick:run(async()=>{formDrafts.set('transaction-form',formValues());ui.addingCategory=true;await c.render();})},t('addCategoryInline'))),
        ui.addingCategory?h('div',{class:'inline-add'},h('label',{for:'new-category',class:'sr-only'},t('categoryName')),input('new-category','text','',{maxlength:'80',placeholder:t('categoryName'),autocomplete:'off'}),button(t('add'),addCategory,true,{'data-confirm-category':'true'})):null],
      h('div',{class:'card form-rows'},
        field(t(direction==='TRANSFER'?'fromAccount':'account'),'accountId',select('accountId',choices,defaultAccount,{required:true})),
        direction==='TRANSFER'?field(t('toAccount'),'toAccountId',select('toAccountId',[['','—'],...choices])):null,
        field(t('date'),'date',input('date','date',today(),{required:true,max:today()})),
        field(t('note'),'memo',input('memo','text','',{maxlength:'500',placeholder:t('optional')}))),
      h('div',{class:'keypad','aria-label':t('amount')},keys.map(key=>h('button',{type:'button',class:'key','data-key':key,'aria-label':key==='back'?t('deleteDigit'):key==='dec'?decimal:key,onClick:()=>keypadPress(c,key,currency)},key==='back'?'⌫':key==='dec'?decimal:key)))
    ],async values=>{
      const account=entity(state,'accounts',values.accountId),amountMinor=toMinor(values.amount,account.currencyCode),transfer=values.operationType==='TRANSFER';
      const payload={operationType:values.operationType,amountMinor,effectiveLocalDate:values.date,memo:values.memo,...(values.categoryId&&!transfer?{categoryId:values.categoryId}:{}),...(transfer?{fromAccountId:values.accountId,toAccountId:values.toAccountId}:{accountId:values.accountId})};
      if(plan){if(values.operationType!==plan.direction)throw new Error('INVALID_PLAN_DIRECTION');payload.settlement={planOccurrenceId:plan.id,amountMinor};}
      const receipt=await perform('recordActual',payload);await go(plan?'plans/'+plan.id:'transactions/'+receipt.resultIds[0]);
    },'save',{wide:true,stickySubmit:true})];
}

// Transaction detail: one "Sửa" (reverse + replacement behind the scenes) and one "Huỷ".
export function transactionDetail(c,operationId){
  const {h,t,fmt,fmtSigned,link,action,form,input,select,field,card,notice,perform,go,today,toMinor,decimalInput,amountField,dateField,ui,sourceLabel,dayLabel}=c,state=c.state;
  const operation=entity(state,'operations',operationId),postings=state.postings.filter(p=>p.operationId===operationId),reversed=state.operations.some(o=>o.reversalOfOperationId===operationId);
  const replacement=state.operations.find(o=>o.replacementForOperationId===operationId),s=operationSummary(c,operation),currency=postings[0].currencyCode;
  const children=[h('div',{class:'page-head'},h('p',{class:'muted'},c.opLabel(operation)),h('h1',{},s.title)),
    h('section',{class:'card detail-card'},h('p',{class:'big-number num '+toneOf(operation,s.amount)},s.transfer?fmt(s.amount,currency):fmtSigned(s.amount,currency)),
      h('dl',{class:'facts'},h('dt',{},t('date')),h('dd',{},dayLabel(operation.effectiveLocalDate)+' · '+operation.effectiveLocalDate),s.categories.length?[h('dt',{},t('category')),h('dd',{},s.categories.join(' / '))]:null,operation.memo&&operation.operationType!=='OPENING'?[h('dt',{},t('note')),h('dd',{},operation.memo)]:null),
      h('ul',{class:'legs'},postings.map(p=>h('li',{},link('accounts/'+p.accountId+'/timeline',entity(state,'accounts',p.accountId).name),h('span',{class:'num'},fmt(p.signedAmountMinor,p.currencyCode))))),
      replacement?h('p',{class:'tag tag-blue'},link('transactions/'+replacement.id,t('edited')+' ›')):reversed?h('p',{class:'tag'},t('cancelledTag')):null,
      operation.replacementForOperationId?h('p',{class:'muted'},link('transactions/'+operation.replacementForOperationId,t('edited')+' · '+t('details'))):null,
      operation.reversalOfOperationId?h('p',{class:'muted'},link('transactions/'+operation.reversalOfOperationId,t('details'))):null)];
  if(operation.operationType==='INCOME'&&!reversed){const source=state.fundingSources.find(x=>x.sourcePostingId===postings[0].id);if(source)children.push(h('section',{class:'card suggest-card'},h('p',{},sourceLabel(source)),action('setAsideReceipt',async()=>{ui.receiptSourceId=source.id;ui.range.currencyCode=currency;await go('allocate');},true)));}
  const links=state.spendLinks.filter(l=>l.expensePostingId===postings[0].id&&!l.reversalOfLinkId&&!state.spendLinks.some(r=>r.reversalOfLinkId===l.id));
  if(!reversed&&['INCOME','EXPENSE'].includes(operation.operationType)){
    const amount=minor(s.amount)<0n?(-minor(s.amount)).toString():s.amount;
    children.push(h('details',{class:'card disclosure',open:!!c.formDrafts.get('correct-form')},h('summary',{},t('editTransaction')),form('correct-form',[amountField('amount',decimalInput(amount,currency),currency),dateField('date',operation.effectiveLocalDate),field(t('note'),'memo',input('memo','text',operation.memo||'',{maxlength:'500'})),field(t('account'),'accountId',select('accountId',c.accountChoices(currency),postings[0].accountId)),field(t('reason'),'reason',input('reason','text','',{maxlength:'200'})),links.length?h('label',{class:'checkbox'},input('dropSpendLinks','checkbox','yes'),h('span',{},t('dropSpendLinks'),h('small',{class:'muted'},' · '+t('dropSpendLinksHelp')))):null,h('p',{class:'muted'},t('correctionHelp'))],async values=>{const receipt=await perform('replaceOperation',{operationId,amountMinor:toMinor(values.amount,currency),effectiveLocalDate:values.date,memo:values.memo??operation.memo,...(values.accountId?{accountId:values.accountId}:{}),...(values.dropSpendLinks==='yes'?{spendLinks:[]}:{}),reason:values.reason?.trim()||t('defaultEditReason')});await go(receipt.resultIds[1]?'transactions/'+receipt.resultIds[1]:'transactions');},'correctOperation')));
  }
  if(operation.operationType==='EXPENSE'&&!reversed&&links.length){const amount=(-minor(s.amount)).toString();children.push(h('section',{class:'card','data-spend-links':'true'},h('h2',{},t('linkedEnvelopes')),h('ul',{class:'legs'},links.map(l=>h('li',{},h('span',{},entity(state,'envelopes',l.envelopeId).name),h('span',{class:'num'},fmt(l.signedAmountMinor,currency))))),h('p',{class:'muted'},t('unlinkEnvelopesHelp')),action('unlinkEnvelopes',async()=>{const receipt=await perform('replaceOperation',{operationId,amountMinor:amount,effectiveLocalDate:operation.effectiveLocalDate,memo:operation.memo,accountId:postings[0].accountId,spendLinks:[],reason:t('defaultUnlinkReason')});await go(receipt.resultIds[1]?'transactions/'+receipt.resultIds[1]:'transactions');},false,{'data-unlink-envelopes':'true'})));}
  if(operation.operationType==='EXPENSE'&&!reversed){const envelopes=state.envelopes.filter(e=>e.currencyCode===currency&&!e.archivedAtUtc);if(envelopes.length)children.push(h('details',{class:'card disclosure'},h('summary',{},t('linkEnvelope')),form('spend-link-form',[field(t('envelope'),'envelopeId',select('envelopeId',envelopes.map(e=>[e.id,e.name]),'',{required:true})),amountField('amount','',currency),dateField()],values=>perform('linkExpense',{expensePostingId:postings[0].id,envelopeId:values.envelopeId,amountMinor:toMinor(values.amount,currency),effectiveLocalDate:values.date},'transactions/'+operationId),'linkEnvelope')));}
  if(!reversed&&['INCOME','EXPENSE','TRANSFER'].includes(operation.operationType))children.push(h('details',{class:'card disclosure'},h('summary',{},t('cancelTransaction')),form('reverse-form',[h('p',{class:'muted'},t('cancelHelp')),dateField(),field(t('reason'),'reason',input('reason','text','',{maxlength:'200'}))],values=>perform('reverseOperation',{operationId,effectiveLocalDate:values.date,reason:values.reason?.trim()||t('defaultCancelReason')},'transactions'),'undoOperation')));
  return children;
}

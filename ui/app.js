import { openIndexedDbRepository } from '../core/repository.js';
import { minor, parseMoney, formatMinor, EXPONENTS } from '../core/money.js';
import { todayInTimezone, addDays } from '../core/calendar.js';
import { entity, accountBalance, planSummary, poolSummary, envelopeBalance, sourceCapacity, validateSnapshot, openingBalanceSummary } from '../core/model.js';
import { queryReport, reportDescriptor, dailyAccountTimeline } from '../core/reports.js';
import { previewAllocationV3 } from '../core/allocation.js';
import { exportSnapshotFiles, exportRecoverySnapshotFiles, stageRestoreFiles, inspectBackup, stageLegacyMigration, MAX_BACKUP_PARTS } from '../core/migration.js';
import { inspectCompatibilityBook, preserveCompatibilityBook } from '../compatibility.js';
import { id } from '../core/identity.js';
import { createSharedOfflineView } from './shared-offline-view.js';
import { openSharedRepository } from '../core/shared-repository.js';
import { translator, errorMessage } from './i18n.js';
import { dom } from './dom.js';

export const ROUTE_ALIASES = Object.freeze({dashboard:'overview',calendar:'plans',guide:'help',allocations:'templates',assets:'accounts','settings/data':'data','settings/accounts':'accounts','settings/profile':'data'});
export const resolveRoute = raw => { const route = String(raw || 'overview').replace(/^#\/?/,''); return ROUTE_ALIASES[route] || route; };
export async function createNextApp(root,{document = globalThis.document,browser = globalThis.window,repositoryFactory = options => openIndexedDbRepository(options),sharedRepositoryFactory = options => openSharedRepository(options),namespace = 'personal',clock = () => new Date(),legacyStorage = globalThis.localStorage,onDownload = null,onReadBackup = null,onOpenLegacy = null} = {}) {
  const {h,field,input,select,button,table,icon,viewTransition} = dom(document);
  const formHandlers=new Map(),formDrafts=new Map(),setupDrafts=new Map(),routeTrail=[];
  let feedbackRevision=0,backupFeedbackGeneration=0;
  let setupSubmission=null,needsReadRecovery=false,recoveryMode=false,filterReturnFocus=null,sharedView=null,activeFilterModal=null,appClosed=false;
  let ledgerFilter={query:'',type:''},planScope='pending',receiptSourceId='';
  const hasBook=()=>!!state?.profile.onboardingCompletedAtUtc&&state.accounts.length>0;
  const hasIncompleteBook=()=>!hasBook()&&(!!state?.profile.onboardingCompletedAtUtc||state?.accounts.length>0);
  const emptyRoutes=new Set(['start','create','help','data','data-review','recovery','shared']);
  let stagedExpectation=null,stageKind='',stageReadGeneration=0,reportCursor=0,forecastRange=null;
  let repo,state,t,route = 'overview',feedback = '',error = false,pendingWrite = null,allocationPreview = null,stage = null,legacyRaw = null,legacyExpectedRaw = null,ignoreLegacy = false,templateDraft = null,selectedSourceIds = [],activeReport = null,unsubscribe = null;
  const today = () => todayInTimezone(state?.profile.timezoneId || 'Asia/Ho_Chi_Minh',clock());
  const currentMonth = () => today().slice(0,7);
  const defaultPeriod=()=>({from:today().slice(0,7)+'-01',through:today(),accountId:'',currencyCode:state.profile.defaultCurrencyCode});
  let range = {from:todayInTimezone('Asia/Ho_Chi_Minh',clock()).slice(0,7)+'-01',through:todayInTimezone('Asia/Ho_Chi_Minh',clock()),accountId:'',currencyCode:'VND'};
  const fmt = (value,currency = range.currencyCode || state.profile.defaultCurrencyCode) => formatMinor(value,currency,state.profile.locale);
  const title = key => h('div',{class:'page-head'},h('h1',{},t(key)));
  const notice = (key,warning=false) => h('div',{class:'notice'+(warning?' warning':'')},t(key));
  const empty = () => h('div',{class:'empty'},t('empty'));
  const card = (...children) => h('section',{class:'card'},children);
  const actionRow = (...children) => h('div',{class:'actions'},children);
  const mobileOverlay=()=>browser?.matchMedia?.('(max-width:900px)').matches===true;
  function releaseFilterModal({returnFocus=false}={}){
    if(!activeFilterModal)return;
    const {panel,summary,inerted,overflow}=activeFilterModal;activeFilterModal=null;
    panel.removeAttribute?.('role');panel.removeAttribute?.('aria-modal');
    for(const [node,prior] of inerted)node.inert=prior;
    if(document.body.style)document.body.style.overflow=overflow;
    if(returnFocus)summary.focus?.();
  }
  function activateFilterModal(sheet,panel,summary){
    if(!sheet.open||!mobileOverlay()){if(activeFilterModal?.sheet===sheet)releaseFilterModal();return;}
    if(activeFilterModal?.sheet===sheet)return;
    releaseFilterModal();
    const inerted=[];let branch=sheet;
    while(branch.parentNode&&branch.parentNode!==document.documentElement){const parent=branch.parentNode;for(const sibling of Array.from(parent.children||[])){if(sibling!==branch&&sibling.tagName){inerted.push([sibling,!!sibling.inert]);sibling.inert=true;}}branch=parent;}
    const overflow=document.body.style?.overflow||'';
    activeFilterModal={sheet,panel,summary,inerted,overflow};
    panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
    if(document.body.style)document.body.style.overflow='hidden';
    panel.focus?.();
  }
  function closeFilterSheet(sheet,summary){sheet.open=false;sheet.removeAttribute?.('open');releaseFilterModal();summary?.focus?.();}
  function dismissFilters(){const sheet=Array.from(root.querySelectorAll('[data-filter-sheet]')).find(node=>node.open||node.getAttribute('open')!==null);if(!sheet)return false;closeFilterSheet(sheet,sheet.querySelector('summary'));return true;}
  function filterSheet(label,...children){
    const summary=h('summary',{class:'filter-chip'},icon('filter'),h('span',{},label),h('span',{'aria-hidden':'true'},'⌄'));
    const panel=h('section',{class:'filter-panel','aria-label':t('advancedFilters'),tabindex:'-1'},h('div',{class:'filter-panel-head'},h('h2',{},t('advancedFilters')),action('closeFilters',()=>closeFilterSheet(sheet,summary))),h('div',{class:'filter-feedback','data-filter-feedback':'true'}),children);
    const sheet=h('details',{class:'filter-sheet','data-filter-sheet':'true',onToggle:()=>{if(sheet.open){filterReturnFocus=summary;activateFilterModal(sheet,panel,summary);}else if(activeFilterModal?.sheet===sheet)releaseFilterModal({returnFocus:true});}},summary,panel);
    return sheet;
  }
  const periodLabel=()=>range.from+' → '+range.through+' · '+range.currencyCode+(range.accountId?' · '+entity(state,'accounts',range.accountId).name:'');
  function fail(cause) {feedback=errorMessage(cause,t);error=true;updateFeedback();return {error:cause.message};}
  function updateFeedback() { feedbackRevision++;const target=activeFilterModal?.panel.querySelector('[data-filter-feedback]')||document.getElementById('feedback');if(target){target.replaceChildren();if(feedback)target.append(h('div',{role:error?'alert':'status',class:'notice'+(error?' error':''),tabindex:error?'-1':null},feedback));if(error&&activeFilterModal)target.querySelector('[role="alert"]')?.focus?.();} }
  const run = fn => async event => {if(event?.preventDefault)event.preventDefault();try{return await fn(event);}catch(cause){return fail(cause);}};
  function link(next,label) {return h('a',{href:'#'+next,onClick:run(()=>go(next))},label);}
  function action(label,fn,primary=false,extra={}) {return button(t(label),run(fn),primary,{disabled:!!pendingWrite,...extra});}
  function form(formId,fields,submit,submitLabel='save') {
    const handler=run(async values=>{formDrafts.set(formId,values);return submit(values);});formHandlers.set(formId,handler);
    const node=h('form',{id:formId,onSubmit:run(event=>handler(Object.fromEntries(new browser.FormData(event.target))))},fields,h('div',{class:'actions'},h('button',{type:'submit',class:'button primary',disabled:!!pendingWrite||needsReadRecovery&&!formId.startsWith('recovery-')},t(submitLabel))));
    const draft=formDrafts.get(formId);
    node.querySelectorAll('[name]').forEach(control=>{if(draft&&Object.hasOwn(draft,control.name)&&control.type!=='file'){if(control.type==='checkbox')control.checked=draft[control.name]===control.value;else control.value=draft[control.name];}});
    node.querySelectorAll('[id]').forEach(control=>{control.id=formId+'-'+control.id;});
    node.querySelectorAll('label[for]').forEach(label=>label.setAttribute('for',formId+'-'+label.getAttribute('for')));
    return node;
  }
  const accountChoices = (currency=range.currencyCode) => state.accounts.filter(a=>a.currencyCode===currency&&!a.archivedAtUtc).map(a=>[a.id,a.name]);
  const amountField = (name='amount',value='',currency=range.currencyCode) => field(t('amount')+' · '+currency,name,input(name,'text',value,{required:true,inputmode:'decimal',autocomplete:'off'}),t('moneyInputHelp'));
  const dateField = (name='date',value=today()) => field(t('date'),name,input(name,'date',value,{required:true}));
  const toMinor = (text,currency=range.currencyCode,locale=state.profile.locale) => parseMoney(text,currency,locale).amountMinor;
  const decimalInput = (amount,currency=range.currencyCode) => {const exponent=EXPONENTS[currency],n=BigInt(amount),abs=n<0n?-n:n,scale=10n**BigInt(exponent),separator=new Intl.NumberFormat(state.profile.locale).formatToParts(1.1).find(p=>p.type==='decimal')?.value||'.';return (n<0n?'-':'')+(abs/scale).toString()+(exponent?separator+(abs%scale).toString().padStart(exponent,'0'):'');};
  function descriptor(metricId,extra={}) {return reportDescriptor(state,{metricId,currencyCode:range.currencyCode,startLocalDateInclusive:range.from,endLocalDateExclusive:addDays(range.through,1),accountIds:range.accountId?[range.accountId]:[],datasetRevision:state.revision,...extra});}
  function resetDrafts(){allocationPreview=null;templateDraft=null;activeReport=null;forecastRange=null;stage=null;stagedExpectation=null;stageReadGeneration++;reportCursor=0;}
  async function refresh(){const next=validateSnapshot(await repo.readSnapshot());state=next;needsReadRecovery=false;t=translator(state.profile.locale);range.currencyCode=state.profile.defaultCurrencyCode;resetDrafts();feedback='';error=false;await render();}
  async function perform(type,values,next){
    if(needsReadRecovery)throw new Error('POST_COMMIT_READ_FAILED');
    if(pendingWrite)return pendingWrite;
    const command={commandId:id(),type,input:values},revision=state.revision;
    feedback=t('pending');error=false;updateFeedback();
    pendingWrite=repo.runAtomicCommand(command,revision,{now:clock().toISOString()});
    document.querySelectorAll(type==='onboard'?'button':'button[type="submit"]').forEach(node=>{node.disabled=true;});
    try{const receipt=await pendingWrite;try{state=validateSnapshot(await repo.readSnapshot());}catch(cause){needsReadRecovery=true;throw new Error('POST_COMMIT_READ_FAILED',{cause});}t=translator(state.profile.locale);allocationPreview=null;formDrafts.clear();feedback=t('saved');error=false;if(next)route=next;return receipt;}
    finally{pendingWrite=null;await render();}
  }
  function rememberSetup(){const node=document.getElementById('onboard-form');if(route==='create'&&node)setupDrafts.set(namespace,Object.fromEntries(new browser.FormData(node)));}
  async function openNamespace(next){
    if(pendingWrite||setupSubmission||sharedView?.isBusy())throw new Error('WRITE_IN_PROGRESS');
    rememberSetup();const nextRepo=await repositoryFactory({namespace:next});let nextState;
    try{nextState=validateSnapshot(await nextRepo.readSnapshot());}catch(cause){
      if(!nextRepo.listRecoveryDatasets||!nextRepo.readRecoverySnapshot){nextRepo.close?.();throw cause;}
      sharedView?.close();sharedView=null;repo?.close?.();unsubscribe?.();namespace=next;repo=nextRepo;state=null;recoveryMode=true;needsReadRecovery=true;t=translator();route='recovery';resetDrafts();await render();return;
    }
    sharedView?.close();sharedView=null;repo?.close?.();unsubscribe?.();namespace=next;repo=nextRepo;state=nextState;ledgerFilter={query:'',type:''};planScope='pending';receiptSourceId='';t=translator(state.profile.locale);range=defaultPeriod();resetDrafts();ignoreLegacy=false;legacyRaw=null;routeTrail.length=0;
    recoveryMode=false;
    if(namespace==='personal'){try{legacyExpectedRaw=legacyStorage?.getItem('financial-assistant-prototype-v1')??null;legacyRaw=legacyExpectedRaw;}catch{legacyExpectedRaw=null;}}
    needsReadRecovery=false;route=hasBook()?'overview':'start';
    if(repo.subscribe)unsubscribe=repo.subscribe(()=>{if(!pendingWrite){allocationPreview=null;feedback=t('conflict');error=false;updateFeedback();}});
    await render();
  }
  async function go(next,{record=true,updateHash=true}={}){
    let resolved=resolveRoute(next);
    if(sharedView?.isBusy()&&route==='shared'&&resolved!=='shared'){feedback=t('pending');error=false;updateFeedback();return;}
    if(recoveryMode&&pendingWrite){feedback=t('pending');error=false;updateFeedback();return;}
    if(recoveryMode){route=resolved==='shared'?'shared':'recovery';if(updateHash&&browser?.location)browser.location.hash='#'+route;await render();return;}
    if((pendingWrite||setupSubmission)&&route==='create'){feedback=t('setupSaving');error=false;updateFeedback();return;}
    if(hasBook()&&['start','create'].includes(resolved))resolved='overview';
    if(!hasBook()&&!emptyRoutes.has(resolved))resolved='start';
    if(resolved!==route){rememberSetup();if(record)routeTrail.push(route);else if(routeTrail.at(-1)===resolved)routeTrail.pop();formDrafts.clear();allocationPreview=null;stageReadGeneration++;reportCursor=0;if(resolved.startsWith('templates/'))templateDraft=null;}
    route=resolved;feedback='';error=false;if(updateHash&&browser?.location)browser.location.hash='#'+route;await render();
  }
  async function goBack(){if(dismissFilters())return;if(route==='shared'&&sharedView?.back())return;if(recoveryMode&&stageKind==='recovery'&&stage){stage=null;stagedExpectation=null;stageReadGeneration++;await render();return;}let next=routeTrail.pop();if(!next){const parts=route.split('/');next=!hasBook()?'start':parts[0]==='allocations'||parts[0]==='envelopes'?'templates':parts.length>1&&['accounts','categories','plans','transactions'].includes(parts[0])?parts[0]:'overview';}await go(next,{record:false});}

  async function chooseMonth(offset){
    const date=new Date(today()+'T12:00:00Z');date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+offset);
    const month=date.toISOString().slice(0,7),end=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).toISOString().slice(0,10);
    range={...range,from:month+'-01',through:end};activeReport=null;reportCursor=0;formDrafts.delete('period-form');await render();
  }
  function rangeForm({datesOnly=false,poolOnly=false}={}){
    const fields=h('div',{class:'compact'},field(t('from'),'from',input('from','date',range.from,{required:true})),field(t('through'),'through',input('through','date',range.through,{required:true})),datesOnly?null:field(t('currency'),'currencyCode',select('currencyCode',[...new Set(state.accounts.map(a=>a.currencyCode))].map(c=>[c,c]),range.currencyCode)),datesOnly||poolOnly?null:field(t('scope'),'accountId',select('accountId',[['',t('allAccounts')],...state.accounts.filter(a=>a.currencyCode===range.currencyCode).map(a=>[a.id,a.name+(a.archivedAtUtc?' · '+t('archived'):'')])],range.accountId)));
    return h('div',{class:'range-fields'},h('div',{class:'actions'},action('month',()=>chooseMonth(0)),action('previousMonth',()=>chooseMonth(-1))),h('p',{},t('customPeriod')),form('period-form',fields,async values=>{
      const currencyCode=datesOnly?range.currencyCode:values.currencyCode,accountId=datesOnly?range.accountId:poolOnly||currencyCode!==range.currencyCode?'':values.accountId||'',next={from:values.from,through:values.through,currencyCode,accountId};
      reportDescriptor(state,{metricId:'ActualIncome',currencyCode:next.currencyCode,startLocalDateInclusive:next.from,endLocalDateExclusive:addDays(next.through,1),accountIds:next.accountId?[next.accountId]:[]});range=next;activeReport=null;reportCursor=0;feedback='';error=false;formDrafts.delete('period-form');await render();
    },'applyPeriod'));
  }
  function sharedContent(){
    if(!sharedView){const sharedNamespace=namespace;sharedView=createSharedOfflineView(document,{repositoryFactory:()=>sharedRepositoryFactory({namespace:sharedNamespace}),namespace:sharedNamespace,clock,FormData:browser.FormData,onDownload:onDownload||(async(text,name)=>{await download(text,name);return {status:'requested'};}),onReadBackup});}
    return sharedView.element;
  }
  function startScreen(){const draft=setupDrafts.get(namespace);return h('div',{class:'start-screen'},h('p',{class:'eyebrow'},t('app')),h('h1',{},t('welcome')),h('p',{class:'start-intro'},t('welcomeIntro')),hasIncompleteBook()?notice('setupRecovery',true):null,needsReadRecovery?notice('savedStateUnknown',true):null,needsReadRecovery?action('reload',refresh,true):null,h('div',{class:'start-actions'},action('beginCreate',()=>go('create'),true,{id:'start-create',disabled:hasIncompleteBook()||needsReadRecovery}),action('startGuide',()=>go('help'),false,{id:'start-guide'})),draft?card(h('p',{},t('setupDraftHelp')),action('resumeSetup',()=>go('create'))):null,h('p',{class:'start-note'},t('welcomePrivacy')),h('div',{class:'start-secondary'},action('sharedOfflineBook',()=>go('shared'),false,{id:'start-shared'}),link('data',t('restoreEntry')),legacyRaw?link('data-review',t('legacyEntry')):null),legacyRaw?notice('legacyWelcome'):null);}
  async function submitSetup(values){
    if(setupSubmission)return setupSubmission;
    if(needsReadRecovery)throw new Error('POST_COMMIT_READ_FAILED');
    if(hasBook())return go('overview');
    setupDrafts.set(namespace,{...values});
    const task=(async()=>{const timezoneId=values.timezoneId==='custom'?values.customTimezoneId:values.timezoneId,openingAmountMinor=toMinor(values.opening,values.currencyCode,values.locale);await perform('onboard',{name:values.name,accountType:values.accountType,currencyCode:values.currencyCode,locale:values.locale,timezoneId,openingAmountMinor,openingEffectiveLocalDate:values.openingDate},'overview');setupDrafts.delete(namespace);range=defaultPeriod();if(browser?.location)browser.location.hash='#overview';await render();})();
    setupSubmission=task;
    try{return await task;}finally{setupSubmission=null;}
  }
  function onboarding(){
    const draft=setupDrafts.get(namespace)||{locale:'vi-VN',currencyCode:state.profile.defaultCurrencyCode,timezoneId:state.profile.timezoneId,name:'',accountType:'BANK',opening:'0',openingDate:today()},zones=[['Asia/Ho_Chi_Minh',t('vietnamTime')],['Etc/UTC',t('utcTime')]];
    if(!zones.some(([zone])=>zone===draft.timezoneId)&&draft.timezoneId!=='custom')zones.push([draft.timezoneId,draft.timezoneId]);zones.push(['custom',t('otherTimezone')]);
    const zoneOf=values=>values.timezoneId==='custom'?values.customTimezoneId:values.timezoneId;
    let setupToday=today();try{if(zoneOf(draft))setupToday=todayInTimezone(zoneOf(draft),clock());}catch{}
    const updateSetupTimezone=run(async()=>{const values=Object.fromEntries(new browser.FormData(document.getElementById('onboard-form'))),zone=zoneOf(values);setupDrafts.set(namespace,values);if(!zone)return;const nextToday=todayInTimezone(zone,clock());let previousToday=today();try{if(zoneOf(draft))previousToday=todayInTimezone(zoneOf(draft),clock());}catch{}if(values.openingDate===previousToday)values.openingDate=nextToday;setupDrafts.set(namespace,values);formDrafts.delete('onboard-form');await render();});
    const currencyNames={VND:'Đồng Việt Nam',USD:'Đô la Mỹ',JPY:'Yên Nhật',KWD:'Dinar Kuwait',EUR:'Euro',GBP:'Bảng Anh',CAD:'Đô la Canada',AUD:'Đô la Úc'};
    return h('div',{class:'narrow setup-screen'},title('createBookTitle'),h('p',{},t('setupIntro')),needsReadRecovery?notice('savedStateUnknown',true):null,form('onboard-form',[
      h('section',{class:'setup-section'},h('h2',{},t('setupBasics')),field(t('currency'),'currencyCode',select('currencyCode',Object.keys(EXPONENTS).map(c=>[c,c+' — '+currencyNames[c]]),draft.currencyCode),t('setupCurrencyHelp')),field(t('setupTimezoneLabel'),'timezoneId',select('timezoneId',zones,draft.timezoneId,{onChange:updateSetupTimezone}),t('setupTimezoneHelp')),h('details',{},h('summary',{},t('customTimezone')),field(t('customTimezone'),'customTimezoneId',input('customTimezoneId','text',draft.customTimezoneId||'',{placeholder:'Asia/Tokyo',onChange:updateSetupTimezone}),t('customTimezoneHelp'))),input('locale','hidden','vi-VN')),
      h('section',{class:'setup-section'},h('h2',{},t('setupAccount')),field(t('firstAccount'),'name',input('name','text',draft.name,{required:true,maxlength:'80',placeholder:'Ngân hàng của tôi'}),t('setupAccountHelp')),field(t('type'),'accountType',select('accountType',[['BANK',t('bank')],['CASH',t('cash')]],draft.accountType))),
      h('section',{class:'setup-section'},h('h2',{},t('setupOpening')),field(t('opening'),'opening',input('opening','text',draft.opening,{required:true,inputmode:'decimal'}),t('setupOpeningHelp')),field(t('date'),'openingDate',input('openingDate','date',draft.openingDate,{required:true,max:setupToday}),t('setupDateHelp'))),h('p',{},t('setupCommitHelp'))
    ],submitSetup,'finishCreate'),h('div',{class:'actions'},needsReadRecovery?action('reload',refresh,true):null,action('cancelSetup',()=>go('start')),action('startGuide',()=>go('help'))));
  }

  function quickExpense(){const parts=route.split('/');if(parts[0]==='accounts'&&state.accounts.some(a=>a.id===parts[1]&&!a.archivedAtUtc)){const account=entity(state,'accounts',parts[1]);range={...range,accountId:account.id,currencyCode:account.currencyCode};}formDrafts.delete('transaction-form');return go('transactions/new/expense');}
  function scopedPostings(operation){return state.postings.filter(p=>p.operationId===operation.id&&p.currencyCode===range.currencyCode&&(!range.accountId||p.accountId===range.accountId));}
  function pendingPlans(){return state.occurrences.filter(p=>p.currencyCode===range.currencyCode&&(!range.accountId||p.expectedAccountId===range.accountId)).map(p=>planSummary(state,p.id)).filter(p=>p.closure==='OPEN'&&minor(p.openRemaining)>0n).sort((a,b)=>a.dueLocalDate.localeCompare(b.dueLocalDate));}
  function planTable(summaries){return table([t('due'),t('name'),t('type'),t('status'),t('expected'),t('settled'),t('remaining')],summaries.map(p=>[p.dueLocalDate,link('plans/'+p.id,p.title),t(p.direction.toLowerCase()),t(p.closure==='FINALIZED'?'closureFinalized':p.closure==='CANCELLED'?'closureCancelled':p.dueLocalDate<today()?'overdue':p.netSettled!=='0'?'partial':'closureOpen'),fmt(p.expectedAmountMinor,p.currencyCode),fmt(p.netSettled,p.currencyCode),fmt(p.openRemaining,p.currencyCode)]),{mobile:{primary:1,amount:6,date:0,amountLabel:true}});}

  function sourceLabel(source){const posting=entity(state,'postings',source.sourcePostingId),operation=entity(state,'operations',posting.operationId),capacity=sourceCapacity(state,source.id);return [operation.memo||t(operation.operationType.toLowerCase()),entity(state,'accounts',posting.accountId).name,posting.effectiveLocalDate,t('receivedAmount')+': '+fmt(capacity.eligible,posting.currencyCode),t('assignedAmount')+': '+fmt(capacity.consumed,posting.currencyCode),t('sourceRemaining')+': '+fmt(capacity.remaining,posting.currencyCode)].join(' · ');}
  async function overview(){
    const metrics=[['CashBalanceAsOf','cashBalance'],['ActualIncome','actualIncome'],['ActualExpense','actualExpense'],['CashChangeInPeriod','cashChange']];
    const cards=[];for(const [metric,label] of metrics){const result=await queryReport(state,descriptor(metric));cards.push(h('button',{type:'button',class:'metric'+(metric==='CashBalanceAsOf'?' metric-primary':''),'data-metric':label,onClick:run(async()=>{activeReport=result.descriptor;await go('reports/'+metric);})},h('small',{class:'domain'},t('actual')),h('span',{},t(label)),h('strong',{},fmt(result.totalMinor)),h('small',{},metric==='CashBalanceAsOf'?t('balanceAsOf')+' '+range.through:t('scope'))));}
    const accounts=state.accounts.filter(a=>a.currencyCode===range.currencyCode&&(!range.accountId||a.id===range.accountId));
    const near=pendingPlans().filter(p=>p.dueLocalDate<=addDays(today(),30)),pool=state.budgetPools.find(p=>p.currencyCode===range.currencyCode),unassigned=pool?await queryReport(state,descriptor('Unassigned',{budgetPoolId:pool.id,accountIds:[]})):null;
    const recent=state.operations.filter(o=>o.effectiveLocalDate>=range.from&&o.effectiveLocalDate<=range.through&&scopedPostings(o).length).sort((a,b)=>b.effectiveLocalDate.localeCompare(a.effectiveLocalDate)).slice(0,5);
    return [title('overview'),filterSheet(periodLabel(),rangeForm()),h('div',{class:'metrics overview-metrics'},cards),
      card(h('h2',{},t('nextPayments')),notice('upcomingScope'),near.length?planTable(near):notice('noUpcoming'),actionRow(action('allPending',async()=>{planScope='pending';await go('plans');}),action('newPlan',()=>go('plans/new')))),
      card(h('div',{class:'section-heading'},h('h2',{},t('recentTransactions')),action('viewLedger',()=>go('transactions'))),recent.length?table([t('date'),t('details'),t('amount')],recent.map(o=>[o.effectiveLocalDate,link('transactions/'+o.id,o.memo||t(o.operationType.toLowerCase())),scopedPostings(o).map(p=>fmt(p.signedAmountMinor,p.currencyCode)).join(' / ')])):notice('noTransactions')),
      card(h('h2',{},t('accounts')),h('p',{},t('balanceAsOf')+' '+range.through),table([t('account'),t('closing')],accounts.map(a=>[link('accounts/'+a.id+'/timeline',a.name),fmt(accountBalance(state,a.id,addDays(range.through,1)),a.currencyCode)]))),
      pool?card(h('h2',{},t('moneyAssigned')),notice('allocationHelp'),h('p',{},t('poolAllAccounts')+' · '+range.currencyCode+' · '+t('balanceAsOf')+' '+range.through),h('div',{class:'summary-line'},t('unassigned'),h('strong',{},fmt(unassigned.totalMinor))),actionRow(action('viewContributions',async()=>{activeReport=unassigned.descriptor;await go('reports/Unassigned');}),action('templates',()=>go('templates')))):null];
  }
  function ledger(){
    const query=ledgerFilter.query.trim().toLocaleLowerCase(state.profile.locale);
    const operations=state.operations.filter(o=>o.effectiveLocalDate>=range.from&&o.effectiveLocalDate<=range.through&&(!ledgerFilter.type||o.operationType===ledgerFilter.type)).sort((a,b)=>b.effectiveLocalDate.localeCompare(a.effectiveLocalDate));
    const rows=operations.map(o=>{const postings=scopedPostings(o);if(!postings.length)return null;const category=[...new Set(postings.filter(p=>p.categoryId).map(p=>entity(state,'categories',p.categoryId).name))].join(' / ');const accounts=postings.map(p=>entity(state,'accounts',p.accountId).name).join(' / ');if(query&&![o.memo||'',category,accounts].join(' ').toLocaleLowerCase(state.profile.locale).includes(query))return null;return [o.effectiveLocalDate,link('transactions/'+o.id,t(o.operationType.toLowerCase())),o.memo||'-',category||'-',accounts,postings.map(p=>fmt(p.signedAmountMinor,p.currencyCode)).join(' / ')];}).filter(Boolean);
    const filters=form('ledger-filter-form',[field(t('search'),'query',input('query','search',ledgerFilter.query,{placeholder:t('ledgerSearchHelp')})),field(t('type'),'type',select('type',[['',t('allTypes')],...['INCOME','EXPENSE','TRANSFER','OPENING','ADJUSTMENT','REVERSAL'].map(key=>[key,t(key.toLowerCase())])],ledgerFilter.type))],async values=>{ledgerFilter={query:values.query||'',type:values.type||''};formDrafts.delete('ledger-filter-form');await render();},'filterLedger');
    return [title('transactions'),notice('actualLedgerHelp'),filterSheet(periodLabel(),rangeForm(),filters,actionRow(action('clearFilters',async()=>{ledgerFilter={query:'',type:''};formDrafts.delete('ledger-filter-form');await render();}))),card(h('p',{id:'ledger-count'},t('resultsCount')+': '+rows.length),rows.length?table([t('date'),t('type'),t('note'),t('category'),t('account'),t('amount')],rows,{mobile:{primary:1,amount:5,date:0,note:2}}):notice(ledgerFilter.query||ledgerFilter.type?'noMatches':'noTransactions'))];
  }
  function transactionForm(planId=''){const plan=planId&&planId!=='expense'?entity(state,'occurrences',planId):null;const direction=plan?.direction||formDrafts.get('transaction-form')?.operationType||(planId==='expense'?'EXPENSE':'INCOME');return [title('newTransaction'),notice('recordOnly'),card(form('transaction-form',[
    field(t('type'),'operationType',select('operationType',plan?[[plan.direction,t(plan.direction.toLowerCase())]]:[['INCOME',t('income')],['EXPENSE',t('expense')],['TRANSFER',t('transfer')]],direction)),field(t('account'),'accountId',select('accountId',accountChoices(plan?.currencyCode),plan?.expectedAccountId||(accountChoices().some(([key])=>key===range.accountId)?range.accountId:accountChoices()[0]?.[0]),{required:true})),direction==='TRANSFER'?field(t('toAccount'),'toAccountId',select('toAccountId',[['','—'],...accountChoices()])):null,field(t('category'),'categoryId',select('categoryId',[['','-'],...state.categories.filter(c=>!c.archivedAtUtc&&c.direction===direction).map(c=>[c.id,c.name+' · '+t(c.direction.toLowerCase())])])),amountField('amount','',plan?.currencyCode||range.currencyCode),dateField(),field(t('note'),'memo',input('memo','text','',{maxlength:'500'})),plan?notice('planNoMoney'):null,
  ],async values=>{const account=entity(state,'accounts',values.accountId),amountMinor=toMinor(values.amount,account.currencyCode);const payload={operationType:values.operationType,amountMinor,effectiveLocalDate:values.date,memo:values.memo,...(values.categoryId?{categoryId:values.categoryId}:{}),...(values.operationType==='TRANSFER'?{fromAccountId:values.accountId,toAccountId:values.toAccountId}:{accountId:values.accountId})};if(plan){if(values.operationType!==plan.direction)throw new Error('INVALID_PLAN_DIRECTION');payload.settlement={planOccurrenceId:plan.id,amountMinor};}const receipt=await perform('recordActual',payload);await go(plan?'plans/'+plan.id:'transactions/'+receipt.resultIds[0]);})),notice('futureActual')];}
  function transactionDetail(operationId){const operation=entity(state,'operations',operationId),postings=state.postings.filter(p=>p.operationId===operationId),reversed=state.operations.some(o=>o.reversalOfOperationId===operationId);const children=[title('details'),card(h('h2',{},t(operation.operationType.toLowerCase())),h('p',{},operation.memo||'—'),table([t('date'),t('account'),t('amount')],postings.map(p=>[p.effectiveLocalDate,link('accounts/'+p.accountId+'/timeline',entity(state,'accounts',p.accountId).name),fmt(p.signedAmountMinor,p.currencyCode)])))];
    if(!reversed&&['INCOME','EXPENSE','TRANSFER'].includes(operation.operationType))children.push(card(form('reverse-form',[dateField(),field(t('reason'),'reason',input('reason','text','',{required:true})),notice('correctionHelp')],values=>perform('reverseOperation',{operationId,effectiveLocalDate:values.date,reason:values.reason},'transactions'),'undoOperation')));
    if(!reversed&&['INCOME','EXPENSE'].includes(operation.operationType)){
      const liveLinks=collection=>state[collection].filter(l=>[l.ledgerPostingId,l.expensePostingId].includes(postings[0].id)&&!l.reversalOfLinkId&&!state[collection].some(r=>r.reversalOfLinkId===l.id));
      const settlements=liveLinks('settlements'),spendLinks=liveLinks('spendLinks');
      const linkFields=(items,kind)=>items.map(l=>field(t(kind==='settlements'?'correctionLinkedPlan':'correctionLinkedFund')+' · '+(kind==='settlements'?entity(state,'occurrences',l.planOccurrenceId).title:entity(state,'envelopes',l.envelopeId).name),kind+'-'+l.id,input(kind+'-'+l.id,'text',decimalInput(l.signedAmountMinor,postings[0].currencyCode),{required:true,inputmode:'decimal'})));
      children.push(card(form('correct-form',[amountField('amount',decimalInput(postings[0].signedAmountMinor.replace('-',''),postings[0].currencyCode),postings[0].currencyCode),dateField(),field(t('correctionMemo'),'memo',input('memo','text',operation.memo||'',{maxlength:'500'})),field(t('reason'),'reason',input('reason','text','',{required:true})),settlements.length||spendLinks.length?h('div',{},h('h3',{},t('correctionLinks')),notice('correctionLinksHelp'),...linkFields(settlements,'settlements'),...linkFields(spendLinks,'spendLinks')):null],values=>perform('replaceOperation',{operationId,amountMinor:toMinor(values.amount,postings[0].currencyCode),effectiveLocalDate:values.date,reason:values.reason,memo:values.memo??operation.memo??'',linkReconciliation:{settlements:settlements.map(l=>({linkId:l.id,amountMinor:toMinor(values['settlements-'+l.id]??decimalInput(l.signedAmountMinor,postings[0].currencyCode),postings[0].currencyCode)})),spendLinks:spendLinks.map(l=>({linkId:l.id,amountMinor:toMinor(values['spendLinks-'+l.id]??decimalInput(l.signedAmountMinor,postings[0].currencyCode),postings[0].currencyCode)}))}},'transactions'),'correctOperation')));
    }
    if(operation.operationType==='INCOME'&&!reversed){const source=state.fundingSources.find(s=>s.sourcePostingId===postings[0].id);if(source)children.push(card(h('p',{},sourceLabel(source)),action('setAsideReceipt',async()=>{receiptSourceId=source.id;range.currencyCode=postings[0].currencyCode;await go('templates');})));}
    if(operation.operationType==='EXPENSE'&&!reversed)children.push(card(form('spend-link-form',[field(t('envelope'),'envelopeId',select('envelopeId',state.envelopes.filter(e=>e.currencyCode===postings[0].currencyCode&&!e.archivedAtUtc).map(e=>[e.id,e.name]),'',{required:true})),amountField('amount','',postings[0].currencyCode),dateField()],values=>perform('linkExpense',{expensePostingId:postings[0].id,envelopeId:values.envelopeId,amountMinor:toMinor(values.amount,postings[0].currencyCode),effectiveLocalDate:values.date},'transactions/'+operationId),'linkEnvelope')));
    return children;}
  const periodPostingAmount=(accountId)=>state.postings.filter(p=>p.accountId===accountId&&p.effectiveLocalDate>=range.from&&p.effectiveLocalDate<=range.through).reduce((n,p)=>n+minor(p.signedAmountMinor),0n).toString();
  function managementControls(collection,target){
    const type={accounts:'updateAccount',categories:'updateCategory',envelopes:'updateEnvelope'}[collection];
    return card(notice('archiveHelp'),notice('immutableScope'),form(collection+'-edit-form',[field(t('name'),'name',input('name','text',target.name,{required:true,maxlength:'500'}))],values=>perform(type,{entityId:target.id,name:values.name},route)),action(target.archivedAtUtc?'unarchive':'archive',()=>perform('archiveEntity',{collection,entityId:target.id,archived:!target.archivedAtUtc},route),false,{id:'archive-entity'}));
  }
  function accounts(){return [title('accounts'),card(filterSheet(periodLabel(),rangeForm()),action('newAccount',()=>go('accounts/new'),true)),card(table([t('account'),t('currency'),t('type'),t('status'),t('periodMovement'),t('closing'),t('timeline')],state.accounts.filter(a=>!range.accountId||a.id===range.accountId).map(a=>[link('accounts/'+a.id,a.name),a.currencyCode,t(a.type.toLowerCase()),t(a.archivedAtUtc?'archived':'active'),fmt(periodPostingAmount(a.id),a.currencyCode),fmt(accountBalance(state,a.id,addDays(range.through,1)),a.currencyCode),link('accounts/'+a.id+'/timeline',t('timeline'))]),{mobile:{primary:0,amount:5,amountLabel:true}}))];}
  function accountDetail(accountId){const a=entity(state,'accounts',accountId),opening=openingBalanceSummary(state,accountId);return [title('accounts'),card(h('h2',{},a.name),h('p',{},a.currencyCode+' · '+t(a.archivedAtUtc?'archived':'active')),rangeForm({datesOnly:true}),h('div',{class:'summary-line'},t('periodMovement'),h('strong',{},fmt(periodPostingAmount(a.id),a.currencyCode))),h('div',{class:'summary-line'},t('closing'),h('strong',{},fmt(accountBalance(state,a.id,addDays(range.through,1)),a.currencyCode))),link('accounts/'+a.id+'/timeline',t('timeline'))),managementControls('accounts',a),!a.archivedAtUtc?card(h('h2',{},t('openingCorrection')),notice('openingCorrectionHelp'),form('opening-correction-form',[field(t('openingCorrected'),'amount',input('amount','text',decimalInput(opening.correctedOpeningAmountMinor,a.currencyCode),{required:true,inputmode:'decimal'})),dateField('date',today()),field(t('reason'),'reason',input('reason','text','',{required:true,maxlength:'500'}))],values=>perform('correctOpeningBalance',{accountId,openingAmountMinor:toMinor(values.amount,a.currencyCode),effectiveLocalDate:values.date,reason:values.reason},'accounts/'+accountId),'openingCorrection')):null];}
  async function categories(){
    const rows=[];for(const category of state.categories){const metric=category.direction==='INCOME'?'ActualIncome':'ActualExpense',result=await queryReport(state,descriptor(metric,{categoryIds:[category.id]}));rows.push([link('categories/'+category.id,category.name),t(category.direction.toLowerCase()),t(category.archivedAtUtc?'archived':'active'),fmt(result.totalMinor)]);}
    return [title('categories'),notice('categoryHelp'),filterSheet(periodLabel(),rangeForm()),card(form('category-form',[field(t('name'),'name',input('name','text','',{required:true})),field(t('type'),'direction',select('direction',[['INCOME',t('income')],['EXPENSE',t('expense')]],'EXPENSE'))],values=>perform('addCategory',{name:values.name,direction:values.direction},'categories'),'newCategory')),card(rows.length?table([t('category'),t('type'),t('scope'),t('amount')],rows):empty())];
  }
  async function categoryDetail(categoryId){const category=entity(state,'categories',categoryId),result=await queryReport(state,descriptor(category.direction==='INCOME'?'ActualIncome':'ActualExpense',{categoryIds:[category.id]}));return [title('categories'),card(h('h2',{},category.name),rangeForm(),h('div',{class:'summary-line'},t(category.direction==='INCOME'?'periodIncome':'periodExpense'),h('strong',{},fmt(result.totalMinor))),action('viewContributions',async()=>{activeReport=result.descriptor;await go('reports/'+result.descriptor.metricId);},true)),managementControls('categories',category)];}
  async function envelopeDetail(envelopeId){const e=entity(state,'envelopes',envelopeId),d=descriptor('EnvelopeAvailable',{currencyCode:e.currencyCode,budgetPoolId:e.budgetPoolId,accountIds:[],envelopeIds:[e.id]}),result=await queryReport(state,d),movement=(minor(envelopeBalance(state,e.id,addDays(range.through,1)))-minor(envelopeBalance(state,e.id,range.from))).toString();
    const allocated=state.allocationEntries.filter(entry=>entry.envelopeId===e.id&&entity(state,'allocationApplications',entry.applicationId).allocationEffectiveLocalDate>=range.from&&entity(state,'allocationApplications',entry.applicationId).allocationEffectiveLocalDate<=range.through).reduce((n,entry)=>n+minor(entry.signedAmountMinor),0n).toString(),spent=state.spendLinks.filter(entry=>entry.envelopeId===e.id&&entry.effectiveLocalDate>=range.from&&entry.effectiveLocalDate<=range.through).reduce((n,entry)=>n+minor(entry.signedAmountMinor),0n).toString();
    return [title('envelope'),notice('allocationHelp'),card(h('h2',{},e.name),h('p',{},e.currencyCode+' · '+t('poolScope')),rangeForm({datesOnly:true}),...[[t('openingBefore'),envelopeBalance(state,e.id,range.from)],[t('allocated'),allocated],[t('spentFromEnvelope'),spent],[t('periodMovement'),movement],[t('envelopeAvailable'),result.totalMinor]].map(([label,value])=>h('div',{class:'summary-line'},label,h('strong',{},fmt(value,e.currencyCode)))),action('viewContributions',async()=>{activeReport=result.descriptor;await go('reports/EnvelopeAvailable');},true)),managementControls('envelopes',e)];}
  async function forecast(){
    if(!forecastRange)forecastRange={anchor:today(),through:addDays(today(),30),currencyCode:range.currencyCode,accountId:range.accountId};
    const scope=forecastRange,d=reportDescriptor(state,{metricId:'ForecastAsOf',currencyCode:scope.currencyCode,startLocalDateInclusive:addDays(scope.anchor,1),endLocalDateExclusive:addDays(scope.through,1),anchorLocalDate:scope.anchor,accountIds:scope.accountId?[scope.accountId]:[],datasetRevision:state.revision}),result=await queryReport(state,d),actual=accountBalanceForScope(scope),planned=(minor(result.totalMinor)-minor(actual)).toString(),rows=result.contributorRows.filter(r=>r.rowType==='FORECAST_PLAN');let projected=minor(actual);const timelineRows=result.groups.filter(group=>group.key>=d.startLocalDateInclusive).map(group=>{projected+=minor(group.subtotalMinor);return [group.key,fmt(group.subtotalMinor,scope.currencyCode),fmt(projected.toString(),scope.currencyCode)];});
    return [title('forecastTitle'),notice('forecastExplain'),card(form('forecast-form',[field(t('forecastAnchor'),'anchor',input('anchor','date',scope.anchor,{required:true,max:today()})),field(t('forecastThrough'),'through',input('through','date',scope.through,{required:true,min:addDays(today(),1)})),field(t('currency'),'currencyCode',select('currencyCode',[...new Set(state.accounts.map(a=>a.currencyCode))].map(c=>[c,c]),scope.currencyCode)),field(t('scope'),'accountId',select('accountId',[['',t('allAccounts')],...state.accounts.filter(a=>a.currencyCode===scope.currencyCode).map(a=>[a.id,a.name])],scope.accountId))],async values=>{if(values.anchor>today()||values.through<=today()||values.through<=values.anchor)throw new Error('INVALID_FORECAST_RANGE');const next={anchor:values.anchor,through:values.through,currencyCode:values.currencyCode,accountId:values.currencyCode===scope.currencyCode?values.accountId:''};reportDescriptor(state,{...d,currencyCode:next.currencyCode,accountIds:next.accountId?[next.accountId]:[],startLocalDateInclusive:addDays(next.anchor,1),endLocalDateExclusive:addDays(next.through,1),anchorLocalDate:next.anchor});forecastRange=next;formDrafts.delete('forecast-form');await render();},'applyPeriod'),h('p',{},t('forecastAnchor')+': '+scope.anchor+' · '+t('forecastStart')+': '+addDays(scope.anchor,1)+' → '+scope.through),h('div',{class:'summary-line'},t('forecastActual'),h('strong',{},fmt(actual,scope.currencyCode))),h('div',{class:'summary-line'},t('forecastNet'),h('strong',{},fmt(planned,scope.currencyCode))),h('button',{type:'button',class:'metric','data-metric':'forecast',onClick:run(async()=>{activeReport=result.descriptor;await go('reports/ForecastAsOf');})},h('small',{class:'domain'},t('planned')),h('span',{},t('forecastTitle')),h('strong',{},fmt(result.totalMinor,scope.currencyCode))),h('p',{},t('forecastOverdue')+': '+(result.excludedSummary.overdue||0))),card(h('h2',{},t('forecastDaily')),h('div',{id:'forecast-timeline'},timelineRows.length?table([t('date'),t('forecastNet'),t('forecastTitle')],timelineRows):empty())),card(rows.length?table([t('due'),t('name'),t('type'),t('expected'),t('settled'),t('remaining'),t('variance')],rows.map(p=>[p.dueLocalDate,link('plans/'+p.id,p.title),t('planned')+' · '+t(p.direction.toLowerCase()),fmt(p.expectedAmountMinor,p.currencyCode),fmt(p.netSettled,p.currencyCode),fmt(p.openRemaining,p.currencyCode),fmt(p.variance,p.currencyCode)]),{mobile:{primary:1,amount:5,date:0,amountLabel:true}}):result.paginationCursor!==null?notice('forecastListPage'):empty(),result.paginationCursor!==null?notice('forecastListPage'):null)];
  }
  function accountBalanceForScope(scope){return state.accounts.filter(a=>a.currencyCode===scope.currencyCode&&(!scope.accountId||a.id===scope.accountId)).reduce((n,a)=>n+minor(accountBalance(state,a.id,addDays(scope.anchor,1))),0n).toString();}

  function accountForm(){return [title('newAccount'),card(form('account-form',[field(t('name'),'name',input('name','text','',{required:true})),field(t('type'),'accountType',select('accountType',[['BANK',t('bank')],['CASH',t('cash')]],'BANK')),field(t('currency'),'currencyCode',select('currencyCode',Object.keys(EXPONENTS).map(c=>[c,c]),state.profile.defaultCurrencyCode)),field(t('opening'),'opening',input('opening','text','0',{required:true}),t('openingHelp')),dateField('openingDate')],values=>perform('addAccount',{name:values.name,accountType:values.accountType,currencyCode:values.currencyCode,openingAmountMinor:toMinor(values.opening,values.currencyCode),openingEffectiveLocalDate:values.openingDate},'accounts')))];}
  function timeline(accountId){const account=entity(state,'accounts',accountId),d=descriptor('CashBalanceAsOf',{currencyCode:account.currencyCode,accountIds:[accountId]}),result=dailyAccountTimeline(state,d);return [title('timeline'),card(h('h2',{},account.name),rangeForm({datesOnly:true})),card(h('div',{class:'summary-line'},t('openingBefore'),h('strong',{},fmt(result.openingBeforeRangeMinor,account.currencyCode))),table([t('date'),t('movement'),t('details'),t('closing')],result.days.map(day=>[day.date,fmt(day.movementMinor,account.currencyCode),day.postingIds.length?h('div',{class:'timeline-entries'},day.postingIds.map(postingId=>{const p=entity(state,'postings',postingId),o=entity(state,'operations',p.operationId);return link('transactions/'+o.id,[o.memo||t(o.operationType.toLowerCase()),t(o.operationType.toLowerCase()),fmt(p.signedAmountMinor,p.currencyCode)].join(' · '));})):t('noMovement'),fmt(day.closingMinor,account.currencyCode)])))];}
  async function report(metricId){
    if(!activeReport||activeReport.metricId!==metricId){const pool=state.budgetPools.find(p=>p.currencyCode===range.currencyCode);activeReport=descriptor(metricId,['Unassigned','EnvelopeAvailable'].includes(metricId)?{budgetPoolId:pool?.id,accountIds:[]}:{});}
    const result=await queryReport(state,activeReport,{cursor:reportCursor,pageSize:100}),currency=activeReport.currencyCode;
    const filters=form('report-filter-form',[field(t('grouping'),'grouping',select('grouping',[['day',t('day')],['month',t('month')],['year',t('year')]],activeReport.grouping)),['ActualIncome','ActualExpense'].includes(metricId)?h('div',{},field(t('search'),'searchQuery',input('searchQuery','search',activeReport.searchQuery)),field(t('category'),'categoryId',select('categoryId',[['',t('allCategories')],...state.categories.filter(c=>c.direction===(metricId==='ActualIncome'?'INCOME':'EXPENSE')).map(c=>[c.id,c.name+(c.archivedAtUtc?' · '+t('archived'):'')])],activeReport.categoryIds[0]||''))):null],async values=>{activeReport=reportDescriptor(state,{...activeReport,grouping:values.grouping,searchQuery:values.searchQuery||'',categoryIds:values.categoryId?[values.categoryId]:[]});reportCursor=0;formDrafts.delete('report-filter-form');await render();},'applyPeriod');
    return [title('report'),card(h('h2',{},fmt(result.totalMinor,currency)),h('p',{},activeReport.startLocalDateInclusive+' → '+addDays(activeReport.endLocalDateExclusive,-1)+' · '+t('contributions')+': '+result.contributionCount),h('p',{},t('reconcile')),filterSheet(t('advancedFilters'),filters),h('h3',{},t('groupedTotals')),table([t('date'),t('subtotal')],result.groups.map(group=>[group.key,fmt(group.subtotalMinor,currency)])),h('h3',{class:'section-divider'},t('contributions')),table([t('date'),t('type'),t('details'),t('amount')],result.contributorRows.map(r=>[r.effectiveLocalDate,t(r.operationType?.toLowerCase()||({PLAN:'planned',FORECAST_PLAN:'planned',POSTING:'actual',OPENING_BEFORE_RANGE:'openingBefore',ALLOCATION_ENTRY:'allocate',FORECAST_CASH:'cashBalance',ANCHOR_ACTUAL:'actual',POOL_CASH:'actual',ALLOCATION:'allocate',ENVELOPE_SPEND:'expense'}[r.rowType]||'details')),link(['PLAN','FORECAST_PLAN'].includes(r.rowType)?'plans/'+r.id:r.operationId?'transactions/'+r.operationId:r.applicationId?'allocations/'+r.applicationId:r.expensePostingId?'transactions/'+entity(state,'postings',r.expensePostingId).operationId:'accounts',r.title||r.memo||t('details')),fmt(r.contributionMinor,currency)]),{mobile:{primary:2,amount:3,date:0,amountLabel:true}}),h('div',{class:'actions'},reportCursor>0?action('previousPage',async()=>{reportCursor=Math.max(0,reportCursor-100);await render();}):null,result.paginationCursor!==null?action('nextPage',async()=>{reportCursor=result.paginationCursor;await render();}):null),h('div',{class:'summary-line'},t('subtotal'),h('strong',{},fmt(result.totalMinor,currency))))];
  }
  function nextMonths(after,count=12){const [year,month]=after.split('-').map(Number);return Array.from({length:count},(_,index)=>{const date=new Date(Date.UTC(year,month+index,1));if(date.getUTCFullYear()>9999)throw new Error('INVALID_RECURRENCE_RANGE');return date.toISOString().slice(0,7);});}
  function seriesManagement(){return state.planSeries.filter(series=>series.currencyCode===range.currencyCode&&(!range.accountId||series.defaultAccountId===range.accountId)).map(series=>{
    const generated=state.occurrences.filter(item=>item.seriesId===series.id).map(item=>item.occurrenceKey).sort(),last=generated.at(-1)||series.activeFromDate.slice(0,7);
    return card(h('h2',{},series.title),notice('recurrenceHelp'),h('p',{},t('recurrenceHorizon')+': '+last+(series.untilDate?' · '+t('seriesUntil')+': '+series.untilDate:'')),
      series.untilDate?action('resumeSeries',()=>perform('setSeriesUntilDate',{seriesId:series.id,untilDate:null},'plans')):action('extendSeries',()=>perform('generateOccurrences',{seriesId:series.id,monthKeys:nextMonths(last)},'plans'),true,{'data-series':series.id}),
      form('series-end-'+series.id,[notice('seriesEndHelp'),field(t('seriesUntil'),'until',input('until','date',series.untilDate||today(),{required:true,min:series.activeFromDate}))],values=>perform('setSeriesUntilDate',{seriesId:series.id,untilDate:values.until},'plans'),'stopSeries'));
  });}
  function plans(){const all=state.occurrences.filter(o=>o.currencyCode===range.currencyCode&&(!range.accountId||o.expectedAccountId===range.accountId)).map(o=>planSummary(state,o.id));const summaries=all.filter(p=>planScope==='period'?p.dueLocalDate>=range.from&&p.dueLocalDate<=range.through:planScope==='all'?true:p.closure==='OPEN'&&minor(p.openRemaining)>0n&&(planScope==='overdue'?p.dueLocalDate<today():planScope==='upcoming'?p.dueLocalDate>=today():true)).sort((a,b)=>a.dueLocalDate.localeCompare(b.dueLocalDate));return [title('plans'),notice('planNoMoney'),notice(planScope==='period'?'plansSelectedScope':'plansCurrentScope'),filterSheet(periodLabel(),rangeForm(),form('plan-scope-form',[field(t('planVisibility'),'visibility',select('visibility',[['pending',t('allPending')],['overdue',t('overdue')],['upcoming',t('upcoming')],['period',t('selectedPeriod')],['all',t('allPlans')]],planScope))],async values=>{planScope=values.visibility;formDrafts.delete('plan-scope-form');await render();},'applyPeriod')),actionRow(action('newPlan',()=>go('plans/new'),true)),...seriesManagement(),card(summaries.length?planTable(summaries):notice('noPlansInScope'))];}
  function planForm(){return [title('newPlan'),notice('recurrenceHelp'),card(form('plan-form',[field(t('name'),'title',input('title','text','',{required:true})),field(t('type'),'direction',select('direction',[['INCOME',t('income')],['EXPENSE',t('expense')]],'EXPENSE')),amountField(),dateField('due'),field(t('account'),'accountId',select('accountId',[['','—'],...accountChoices()])),field(t('recurrence'),'recurrence',select('recurrence',[['NONE',t('once')],['MONTHLY',t('monthly')]],'NONE'))],async values=>{const amountMinor=toMinor(values.amount);const payload={title:values.title,direction:values.direction,currencyCode:range.currencyCode,expectedAccountId:values.accountId};if(values.recurrence==='MONTHLY'){const monthKeys=Array.from({length:12},(_,i)=>{const d=new Date(values.due+'T12:00:00Z');d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+i);return d.toISOString().slice(0,7);});const receipt=await perform('createMonthlyPlan',{...payload,amountMinor,anchorLocalDate:values.due,monthDay:Number(values.due.slice(8)),monthKeys});await go('plans/'+receipt.resultIds[1]);}else{const receipt=await perform('createPlan',{...payload,expectedAmountMinor:amountMinor,dueLocalDate:values.due});await go('plans/'+receipt.resultIds[0]);}}))];}
  function planDetail(occurrenceId){const p=planSummary(state,occurrenceId),links=state.settlements.filter(s=>s.planOccurrenceId===p.id),eligible=state.postings.filter(s=>s.reportingOrigin===p.direction&&!s.reversesPostingId&&s.currencyCode===p.currencyCode&&!state.postings.some(r=>r.reversesPostingId===s.id));const parts=[title('plans'),card(h('h2',{},p.title),...['expected','settled','remaining','variance'].map((key,i)=>h('div',{class:'summary-line'},t(key),h('strong',{},fmt([p.expectedAmountMinor,p.netSettled,p.openRemaining,p.variance][i],p.currencyCode)))),h('p',{},t('due')+': '+p.dueLocalDate),notice('plannedHelp'),h('div',{class:'actions'},p.closure==='OPEN'?action(p.direction==='EXPENSE'?'recordPayment':'recordReceipt',()=>go('transactions/new/'+p.id),true):null,action(p.closure==='OPEN'?'finalize':'reopen',()=>perform('closePlan',{occurrenceId:p.id,closure:p.closure==='OPEN'?'FINALIZED':'OPEN',effectiveLocalDate:today(),reason:'Confirmed in plan UI'})),p.closure==='OPEN'?action('skip',()=>perform('closePlan',{occurrenceId:p.id,closure:'CANCELLED',effectiveLocalDate:today(),reason:'Skip occurrence'})):null))];
    if(p.closure==='OPEN')parts.push(card(form('settlement-form',[field(t('receipt'),'ledgerPostingId',select('ledgerPostingId',eligible.map(s=>[s.id,s.effectiveLocalDate+' · '+fmt(s.signedAmountMinor,s.currencyCode)]),'',{required:true})),amountField('amount','',p.currencyCode),dateField()],values=>perform('linkSettlement',{planOccurrenceId:p.id,ledgerPostingId:values.ledgerPostingId,amountMinor:toMinor(values.amount,p.currencyCode),effectiveLocalDate:values.date},'plans/'+p.id),'linkExisting')),card(form('reschedule-form',[dateField('due',p.dueLocalDate)],values=>perform('reschedulePlan',{occurrenceId:p.id,dueLocalDate:values.due},'plans/'+p.id),'reschedule')),card(form('revise-plan-form',[amountField('amount','',p.currencyCode)],values=>perform('revisePlan',{occurrenceId:p.id,expectedAmountMinor:toMinor(values.amount,p.currencyCode)},'plans/'+p.id),'revisePlan')));
    if(p.seriesId)parts.push(card(form('revise-series-form',[amountField('amount','',p.currencyCode),field(t('from'),'month',input('month','month',p.occurrenceKey,{required:true}))],values=>perform('revisePlanSeries',{seriesId:p.seriesId,amountMinor:toMinor(values.amount,p.currencyCode),validFromOccurrenceKey:values.month},'plans/'+p.id),'reviseSeries')));
    parts.push(card(links.length?table([t('date'),t('receipt'),t('details'),t('amount')],links.map(l=>[l.effectiveLocalDate,link('transactions/'+entity(state,'postings',l.ledgerPostingId).operationId,t('details')),l.reversalOfLinkId||links.some(r=>r.reversalOfLinkId===l.id)?t('reversal'):action('unlink',()=>perform('unlinkSettlement',{linkId:l.id,effectiveLocalDate:today()},'plans/'+p.id)),fmt(l.signedAmountMinor,p.currencyCode)])):empty()));return parts;}
  function envelopeForm(){return form('envelope-form',[field(t('envelopeName'),'name',input('name','text','',{required:true,maxlength:'80'}))],values=>perform('addEnvelope',{name:values.name,budgetPoolId:state.budgetPools.find(p=>p.currencyCode===range.currencyCode).id},route));}
  function templates(){
    const selected=receiptSourceId?entity(state,'fundingSources',receiptSourceId):null,selectedCurrency=selected?entity(state,'postings',selected.sourcePostingId).currencyCode:'';
    const visible=state.templates.filter(template=>!template.archivedAtUtc);
    const versions=visible.map(template=>({template,version:entity(state,'templateVersions',template.currentVersionId)}));
    const templateCards=versions.map(({template,version})=>card(
      h('h2',{},template.name),
      h('p',{},t('version')+' '+version.versionNumber+' · '+version.currencyCode+' · '+t(version.fixedScope==='CALENDAR_MONTH'?'calendarMonth':'perApplication')),
      h('div',{class:'actions'},
        action('useTemplate',()=>{if(version.lines.some(line=>entity(state,'envelopes',line.envelopeId).archivedAtUtc)||version.leftoverPolicy==='ENVELOPE'&&entity(state,'envelopes',version.leftoverEnvelopeId).archivedAtUtc)throw new Error('TEMPLATE_ENVELOPE_ARCHIVED');if(version.migrationNeedsEnvelopeMapping)throw new Error('MIGRATION_MAPPING_REQUIRED');return go('allocations/new/'+version.id);},true,{disabled:!!pendingWrite||!!selected&&(selectedCurrency!==version.currencyCode||minor(sourceCapacity(state,selected.id).remaining)<=0n)}),
        action('editTemplate',()=>{templateDraft=null;return go('templates/'+template.id+'/edit');})
      )
    ));
    const envelopes=state.envelopes.length?table([t('envelope'),t('scope'),t('amount')],state.envelopes.map(e=>[link('envelopes/'+e.id,e.name),t(e.archivedAtUtc?'archived':'notPaid'),fmt(envelopeBalance(state,e.id,addDays(range.through,1)),e.currencyCode)])):empty();
    const applications=state.allocationApplications.length?table([t('date'),t('version'),t('details')],state.allocationApplications.map(a=>[a.allocationEffectiveLocalDate,a.reversalOfApplicationId?t('reversal'):t('allocate'),link('allocations/'+a.id,t('details'))])):empty();
    return [title('templates'),notice('allocationHelp'),selected?card(h('h2',{},t('selectedReceipt')),h('p',{},sourceLabel(selected)),minor(sourceCapacity(state,selected.id).remaining)<=0n?notice('receiptUnavailable',true):notice('compatibleTemplates'),action('chooseOtherSources',async()=>{receiptSourceId='';allocationPreview=null;formDrafts.delete('allocation-form');await render();})):null,card(action('newTemplate',()=>go('templates/new'),true)),h('div',{class:'grid'},templateCards),card(h('h2',{},t('envelope')),rangeForm({poolOnly:true}),envelopeForm(),envelopes),card(h('h2',{},t('applications')),applications)];
  }
  const blankLine = () => ({stableLineKey:id(),envelopeId:state.envelopes.find(e=>e.currencyCode===range.currencyCode&&!e.archivedAtUtc)?.id||'',type:'FIXED',value:''});
  function readTemplateFields(values){return {name:values.name,scope:values.fixedScope,shortagePolicy:values.shortagePolicy,leftoverPolicy:values.leftoverPolicy,leftoverEnvelopeId:values.leftoverEnvelopeId,lines:templateDraft.lines.map((line,index)=>({...line,envelopeId:values['envelope-'+index],type:values['kind-'+index],value:values['value-'+index]}))};}
  function templateForm(templateId=''){
    if(!templateDraft){const template=templateId?entity(state,'templates',templateId):null,version=template?entity(state,'templateVersions',template.currentVersionId):null;if(version?.migrationNeedsEnvelopeMapping)throw new Error('MIGRATION_MAPPING_REQUIRED');if(version)range.currencyCode=version.currencyCode;templateDraft={name:template?.name||'',scope:version?.fixedScope||'CALENDAR_MONTH',shortagePolicy:version?.shortagePolicy||'BLOCK',leftoverPolicy:version?.leftoverPolicy||'UNASSIGNED',leftoverEnvelopeId:version?.leftoverEnvelopeId||'',lines:version?version.lines.map(line=>({...line,value:decimalInput(line.type==='FIXED'?line.fixedAmountMinor:String(line.percentageBps),line.type==='FIXED'?version.currencyCode:'USD')})):[blankLine()]};}
    const draft=templateDraft,choices=state.envelopes.filter(e=>e.currencyCode===range.currencyCode&&!e.archivedAtUtc).map(e=>[e.id,e.name]);
    const fields=[field(t('name'),'name',input('name','text',draft.name,{required:true})),field(t('fixedScope'),'fixedScope',select('fixedScope',[['CALENDAR_MONTH',t('calendarMonth')],['PER_APPLICATION',t('perApplication')]],draft.scope)),notice('monthlyHelp'),notice('perAppHelp'),field(t('shortagePolicy'),'shortagePolicy',select('shortagePolicy',[['BLOCK',t('block')],['PARTIAL_BY_PRIORITY',t('partialPriority')]],draft.shortagePolicy)),field(t('leftoverPolicy'),'leftoverPolicy',select('leftoverPolicy',[['UNASSIGNED',t('unassignedLeftover')],['ENVELOPE',t('leftoverEnvelope')]],draft.leftoverPolicy)),field(t('envelope'),'leftoverEnvelopeId',select('leftoverEnvelopeId',[['','—'],...choices],draft.leftoverEnvelopeId)),draft.lines.map((line,index)=>h('div',{class:'row-rule'},field(t('envelope'),'envelope-'+index,select('envelope-'+index,choices,line.envelopeId,{required:true})),field(t('type'),'kind-'+index,select('kind-'+index,[['FIXED',t('fixed')],['PERCENT',t('percent')]],line.type)),field(t('amount'),'value-'+index,input('value-'+index,'text',line.value,{required:true,inputmode:'decimal'})),action('remove',()=>{if(draft.lines.length<=1)return;templateDraft=readTemplateFields(Object.fromEntries(new browser.FormData(document.getElementById('template-form'))));templateDraft.lines.splice(index,1);return render();}))),action('addRule',()=>{templateDraft=readTemplateFields(Object.fromEntries(new browser.FormData(document.getElementById('template-form'))));if(templateDraft.lines.length>=12)return;templateDraft.lines.push(blankLine());return render();})];
    return [title('newTemplate'),notice('savedNoActual'),card(form('template-form',fields,async values=>{const current=readTemplateFields(values),lines=current.lines.map((line,index)=>({stableLineKey:line.stableLineKey,envelopeId:line.envelopeId,type:line.type,priority:index,...(line.type==='FIXED'?{fixedAmountMinor:toMinor(line.value)}:{percentageBps:Number(toMinor(line.value,'USD'))})}));await perform('saveTemplate',{...(templateId?{templateId}:{}),name:current.name,currencyCode:range.currencyCode,fixedScope:current.scope,shortagePolicy:current.shortagePolicy,leftoverPolicy:current.leftoverPolicy,leftoverEnvelopeId:current.leftoverEnvelopeId,lines},'templates');templateDraft=null;})),card(h('h2',{},t('envelope')),envelopeForm())];
  }
  function allocationRequest(versionId,groupId,values){if(receiptSourceId&&values.sourceId!==receiptSourceId)throw new Error('PREVIEW_STALE');const version=entity(state,'templateVersions',versionId),pool=state.budgetPools.find(p=>p.currencyCode===version.currencyCode);return {templateVersionId:versionId,budgetPoolId:pool.id,sourceIds:values.sourceId==='all'?state.fundingSources.filter(s=>s.budgetPoolId===pool.id&&minor(sourceCapacity(state,s.id).remaining)>0n).map(s=>s.id):[values.sourceId],requestedAmountMinor:toMinor(values.amount,version.currencyCode),allocationEffectiveLocalDate:values.date,...(groupId?{applicationGroupId:groupId}:{})};}
  function allocationForm(versionId,groupId='') {const version=entity(state,'templateVersions',versionId),template=entity(state,'templates',version.templateId);if(version.lines.some(line=>entity(state,'envelopes',line.envelopeId).archivedAtUtc)||version.leftoverPolicy==='ENVELOPE'&&entity(state,'envelopes',version.leftoverEnvelopeId).archivedAtUtc)throw new Error('TEMPLATE_ENVELOPE_ARCHIVED');if(receiptSourceId){const selected=entity(state,'fundingSources',receiptSourceId);if(entity(state,'postings',selected.sourcePostingId).currencyCode!==version.currencyCode||minor(sourceCapacity(state,selected.id).remaining)<=0n)return [title('allocate'),notice('receiptUnavailable',true),h('p',{},sourceLabel(selected)),action('back',()=>go('templates'))];}range.currencyCode=version.currencyCode;const pool=state.budgetPools.find(p=>p.currencyCode===version.currencyCode),sources=state.fundingSources.filter(s=>s.budgetPoolId===pool.id&&minor(sourceCapacity(state,s.id).remaining)>0n),draft=allocationPreview?.input;
    const preview=allocationPreview?h('div',{id:'allocation-preview'},h('h2',{},t('proposed')),notice('proposalOnly'),h('div',{class:'receipt-context'},allocationPreview.input.sourceIds.map(sourceId=>h('p',{},sourceLabel(entity(state,'fundingSources',sourceId))))),table([t('envelope'),t('type'),t('amount')],allocationPreview.result.lines.map(line=>[entity(state,'envelopes',line.envelopeId).name,t(line.type==='FIXED'?'fixed':line.type==='PERCENT'?'percent':'leftover'),fmt(line.amountMinor,version.currencyCode)])),...['fixedGranted','remainderBase','shortage','leftover','consumption'].map((key,index)=>h('div',{class:'summary-line'},t(key),h('strong',{},fmt([allocationPreview.result.fixedGrantedMinor,allocationPreview.result.remainderMinor,allocationPreview.result.shortageMinor,allocationPreview.result.leftoverMinor,allocationPreview.result.consumptionMinor][index],version.currencyCode)))),notice('allocationHelp'),allocationPreview.result.allowed?action('confirm',async()=>{if(!allocationPreview)throw new Error('PREVIEW_STALE');const values=Object.fromEntries(new browser.FormData(document.getElementById('allocation-form'))),request=allocationRequest(versionId,groupId,values);const receipt=await perform('confirmAllocation',{...request,previewHash:allocationPreview.previewHash});await go('allocations/'+receipt.resultIds[0]);},true,{id:'allocation-confirm'}):notice('block',true)):h('div',{id:'allocation-preview'});
    return [title('allocate'),notice('allocationHelp'),card(h('h2',{},template.name),receiptSourceId&&sources.some(s=>s.id===receiptSourceId)?h('p',{class:'receipt-context'},sourceLabel(entity(state,'fundingSources',receiptSourceId))):null,h('p',{},t(version.fixedScope==='CALENDAR_MONTH'?'monthlyHelp':'perAppHelp')),h('p',{},t('unassigned')+': '+fmt(poolSummary(state,pool.id).unassigned,version.currencyCode)),sources.length?form('allocation-form',[field(t('fundingSource'),'sourceId',select('sourceId',receiptSourceId?sources.filter(s=>s.id===receiptSourceId).map(s=>[s.id,sourceLabel(s)]):[['all',t('allEligibleSources')],...sources.map(s=>[s.id,sourceLabel(s)])],draft?.sourceIds?.length===1?draft.sourceIds[0]:sources.some(s=>s.id===receiptSourceId)?receiptSourceId:'all',{required:true})),amountField('amount',draft?decimalInput(draft.requestedAmountMinor,version.currencyCode):''),dateField('date',draft?.allocationEffectiveLocalDate||today())],async values=>{const request=allocationRequest(versionId,groupId,values);allocationPreview=await previewAllocationV3(state,request);feedback='';await render();},'preview'):notice('noSources',true)),card(preview)];}
  function allocationDetail(applicationId){const application=entity(state,'allocationApplications',applicationId),entries=state.allocationEntries.filter(e=>e.applicationId===applicationId),reversed=state.allocationApplications.some(a=>a.reversalOfApplicationId===applicationId);return [title('applications'),notice('allocationSaved'),notice('allocationHelp'),card(h('p',{},application.allocationEffectiveLocalDate),table([t('envelope'),t('amount')],entries.map(e=>[e.envelopeId?entity(state,'envelopes',e.envelopeId).name:t('unassigned'),fmt(e.signedAmountMinor,application.currencyCode)])),!reversed&&!application.reversalOfApplicationId?h('div',{class:'actions'},action('continueApplication',()=>go('allocations/new/'+application.templateVersionSnapshotId+'/'+application.applicationGroupId))):null),!reversed&&!application.reversalOfApplicationId?card(form('undo-allocation-form',[dateField(),h('label',{class:'checkbox'},input('acknowledgeDeficit','checkbox','yes'),t('deficitAck'))],values=>perform('reverseAllocation',{applicationId,effectiveLocalDate:values.date,acknowledgeDeficit:values.acknowledgeDeficit==='yes'},'templates'),'undoAllocation')):null];}
  async function download(text,filename,reportRequest=true){
    if(onDownload){const result=await onDownload(text,filename);if(result?.status==='cancelled'||result?.status==='failed'||result===null)throw new Error('BACKUP_WRITE_NOT_CONFIRMED');return result;}
    const url=browser.URL.createObjectURL(new browser.Blob([text],{type:'application/json;charset=utf-8'})),anchor=h('a',{href:url,download:filename});document.body.append(anchor);anchor.click();anchor.remove();browser.setTimeout(()=>browser.URL.revokeObjectURL(url),1000);if(reportRequest){feedback=t('downloadStarted');error=false;updateFeedback();}return {status:'requested'};
  }
  async function downloadFiles(filesPromise){
    const owner={repo,namespace,route,generation:++backupFeedbackGeneration};let revision=feedbackRevision;
    const stillCurrent=()=>!appClosed&&repo===owner.repo&&namespace===owner.namespace&&route===owner.route&&backupFeedbackGeneration===owner.generation&&feedbackRevision===revision;
    const report=message=>{if(stillCurrent()){feedback=message;error=false;updateFeedback();revision=feedbackRevision;}};
    try{
      const files=await filesPromise;let allWritten=files.length>0;
      if(files.length>1)report(t('multipartHelp'));
      for(let index=0;index<files.length;index++){
        if(files.length>1)report(t('multipartExport')+' '+(index+1)+' / '+files.length);
        const result=await download(files[index].text,files[index].name,false);
        if(!['written','requested'].includes(result?.status))throw new Error('BACKUP_WRITE_NOT_CONFIRMED');
        allWritten=allWritten&&result.status==='written';
      }
      if(files.length)report(allWritten?'':t('downloadStarted'));
    }catch(cause){if(stillCurrent())throw cause;return {error:cause.message};}
  }
  async function openCompatibility(raw,acknowledge){
    const current=legacyStorage?.getItem('financial-assistant-prototype-v1')??null;
    const source=raw||current||JSON.stringify({version:1,demo:false,accounts:[],cards:[],assets:[],transactions:[],plans:[],settings:{buffer:0}});
    await preserveCompatibilityBook(source,{storage:legacyStorage,locks:browser?.navigator?.locks||globalThis.navigator?.locks,acknowledge,expectedRaw:raw?legacyExpectedRaw:current});
    if(onOpenLegacy)return onOpenLegacy();
    if(browser?.location?.assign)browser.location.assign('./legacy.html');else if(browser?.location)browser.location.href='./legacy.html';
  }
  function compatibilityCard(raw=null){
    if(namespace!=='personal')return null;
    let counts=null;try{if(raw)counts=inspectCompatibilityBook(raw).counts;}catch{}
    return card(h('h2',{},t('compatibility')),notice('compatibilityHelp'),counts?h('p',{},t('accounts')+': '+counts.accounts+' · '+t('transactions')+': '+counts.transactions+' · Thẻ: '+counts.cards+' · Tài sản: '+counts.assets):null,
      form('compatibility-form',[h('label',{class:'checkbox'},input('acknowledge','checkbox','yes',{required:true}),t('compatibilityAck'))],values=>{if(values.acknowledge!=='yes')throw new Error('COMPATIBILITY_CONFIRMATION_REQUIRED');return openCompatibility(raw,true);},'compatibilityOpen'));
  }
  function stagePreview(){return stage?card(stage.activationAllowed?notice('stageReady'):notice('migrationBlocked',true),stageKind==='legacy'?h('p',{},t('migrationMapping')):null,stage.blockers?.length?notice('legacyUnsupported',true):null,stage.report?.accountReconciliation?table([t('account'),t('openingBefore'),t('closing')],stage.report.accountReconciliation.map(r=>[r.originalId,fmt(r.beforeMinor,'VND'),fmt(r.afterMinor,'VND')])):h('p',{},t('accounts')+': '+(stage.report?.accounts||0)+' · '+t('transactions')+': '+(stage.report?.postings||0)),stage.activationAllowed?form('activate-stage-form',[h('label',{class:'checkbox'},input('backupAck','checkbox','yes',{required:true}),t('backupAck')),h('label',{class:'checkbox'},input('replaceAck','checkbox','yes',{required:true}),t('replaceAck'))],async values=>{if(values.backupAck!=='yes'||values.replaceAck!=='yes')throw new Error('STAGE_CONFIRMATION_REQUIRED');if(!stagedExpectation)throw new Error('ACTIVATION_DATASET_REVISION_CONFLICT');await repo.activateStage(stage.id,{...stagedExpectation,confirm:true,backupAcknowledged:true,mode:'new'});stage=null;stagedExpectation=null;ignoreLegacy=true;state=await repo.readSnapshot();t=translator(state.profile.locale);range.currencyCode=state.profile.defaultCurrencyCode;await go('overview');},'activate'):null):null;}
  async function readBackupSelection(){
    const selectedFiles=onReadBackup?null:Array.from(document.getElementById('restore-form').querySelector('[name="backupFile"]').files||[]);
    const generation=++stageReadGeneration,expected={expectedDatasetId:state.datasetId,expectedRevision:state.revision},activeRepo=repo;
    const stillCurrent=()=>!appClosed&&generation===stageReadGeneration&&route==='data'&&repo===activeRepo;
    stage=null;stagedExpectation=null;stageKind='';formDrafts.delete('activate-stage-form');
    feedback='';error=false;await render();if(!stillCurrent())return;
    const selected=onReadBackup?[await onReadBackup()]:selectedFiles;
    if(!stillCurrent()||selected[0]===null)return;
    const rawTexts=[];let partInfo=null;
    for(let index=0;index<selected.length;index++){
      const file=selected[index];if(!file||!Number.isSafeInteger(file.size)||file.size<0||file.size>5*1024*1024)throw new Error('BACKUP_TOO_LARGE');
      const text=typeof file.text==='function'?await file.text():file.text;if(!stillCurrent())return;
      const info=inspectBackup(text);rawTexts.push(text);
      if(index===0&&info.kind==='legacy'){
        if(selected.length!==1)throw new Error('BACKUP_PARTS_MISMATCH');
        legacyExpectedRaw=legacyStorage?.getItem('financial-assistant-prototype-v1')??null;legacyRaw=text;stage=null;stagedExpectation=null;stageKind='legacy';route='data-review';await render();return;
      }
      if(info.kind==='recovery-archive'||info.recoveryOnly)throw new Error('BACKUP_RECOVERY_ARCHIVE_READ_ONLY');
      if(info.kind==='multipart'){
        if(!partInfo)partInfo=info;
        if(info.bundleId!==partInfo.bundleId||info.count!==partInfo.count)throw new Error('BACKUP_PARTS_MISMATCH');
        if(onReadBackup&&selected.length<partInfo.count){feedback=t('multipartProgress')+' '+(selected.length+1)+' / '+partInfo.count;error=false;updateFeedback();const next=await onReadBackup();if(!stillCurrent())return;if(next===null)throw new Error('BACKUP_PARTS_INCOMPLETE');selected.push(next);}
      }else if(selected.length>1)throw new Error('BACKUP_PARTS_MISMATCH');
    }
    const candidate=await stageRestoreFiles(rawTexts,{namespace});if(!stillCurrent())return;
    if(state.datasetId!==expected.expectedDatasetId||state.revision!==expected.expectedRevision)throw new Error('ACTIVATION_DATASET_REVISION_CONFLICT');
    await activeRepo.stageRestore(candidate,{mode:'new'});if(!stillCurrent())return;
    stagedExpectation=expected;stageKind='restore';stage=candidate;feedback='';error=false;await render();
  }
  async function retainedDatasets(){
    if(!repo.listRecoveryDatasets)return null;
    const choices=(await repo.listRecoveryDatasets()).filter(item=>!item.active);
    return card(h('h2',{},t('recoveryArchives')),choices.length?table([t('revision'),t('recoveryCounts'),t('details')],choices.map(item=>[String(item.revision??'—'),String(item.accountCount??0)+' / '+String(item.operationCount??0),actionRow(action('recoveryExport',async()=>downloadFiles(repo.readRecoverySnapshot(item.datasetId).then(exportRecoverySnapshotFiles))),item.valid?action('rollback',async()=>{const expected={expectedDatasetId:state.datasetId,expectedRevision:state.revision,confirm:true};await repo.rollback(item.datasetId,expected);await openNamespace(namespace);await go('data');}):h('span',{},t('recoveryInvalid')))])):h('p',{},t('recoveryNone')));
  }
  async function dataView(){return [title('data'),notice('plaintext'),notice('multipartHelp'),h('p',{},t('backupLimitHelp')),card(h('p',{},t('storageStatus')+': '+namespace+' · schema 3 · '+t('revision')+' '+state.revision),actionRow(action('export',async()=>downloadFiles(exportSnapshotFiles(state)),true)),form('restore-form',[onReadBackup?h('p',{},t('chooseLocalBackup')):field(t('backupFile'),'backupFile',input('backupFile','file','',{accept:'.json,application/json',multiple:true,required:true}))],readBackupSelection,'restore')),stagePreview(),await retainedDatasets(),compatibilityCard()];}
  async function recoveryView(){
    const choices=await repo.listRecoveryDatasets(),active=choices.find(item=>item.active);
    const items=choices.map(item=>card(h('p',{},t(item.active?'active':'recoveryArchives')+' · '+t('revision')+' '+(item.revision??'—')+' · '+t('recoveryCounts')+': '+(item.accountCount??0)+' / '+(item.operationCount??0)),action('recoveryExport',()=>exportPersonalRecovery(item.datasetId)),item.valid&&!item.active?form('recovery-'+item.datasetId,[h('label',{class:'checkbox'},input('acknowledge','checkbox','yes',{required:true}),t('recoveryConfirm'))],async values=>{if(values.acknowledge!=='yes')throw new Error('STAGE_CONFIRMATION_REQUIRED');await repo.rollback(item.datasetId,{expectedDatasetId:active?.datasetId,expectedRevision:active?.revision,confirm:true});await openNamespace(namespace);},'recoverySelect'):item.valid?null:notice('recoveryInvalid',true)));
    const recoveryImport=typeof repo.stageRecoveryRestore==='function'&&active&&!active.valid?card(h('h2',{},'Khôi phục sổ cá nhân từ bản sao hợp lệ'),h('p',{},'Kho hiện tại chưa đọc được an toàn. Có thể kiểm tra bản sao schema 3 hoặc đủ bộ tệp chia phần trước khi tạo sổ phục hồi riêng; giữ nguyên kho lỗi. Dữ liệu v0.4 cần được chuyển đổi riêng, không kích hoạt trực tiếp ở đây.'),notice('plaintext'),notice('multipartHelp'),form('recovery-restore-form',[onReadBackup?notice('chooseLocalBackup'):field(t('backupFile'),'backupFile',input('backupFile','file','',{accept:'.json,application/json',multiple:true,required:true}))],()=>readRecoveryBackupSelection(active),'restore'),recoveryStagePreview()):null;
    return h('main',{class:'narrow storage-failure'},h('h1',{},t('recoveryTitle')),notice('recoveryHelp',true),h('div',{id:'feedback'}),notice('recoveryArchiveOnly'),...items,items.length?null:notice('recoveryNone'),recoveryImport,action('reload',()=>browser?.location?.reload?.()));
  }
  async function recoveryOperation(task){
    if(appClosed)return;
    if(pendingWrite)return pendingWrite;
    feedback=t('pending');error=false;updateFeedback();
    pendingWrite=Promise.resolve().then(()=>appClosed?undefined:task());
    root.querySelectorAll('button,input,select,textarea').forEach(node=>{node.disabled=true;});
    try{return await pendingWrite;}
    catch(cause){if(!appClosed)throw cause;}
    finally{pendingWrite=null;if(!appClosed)await render();}
  }
  async function exportPersonalRecovery(datasetId){
    return recoveryOperation(async()=>{
      const files=await exportRecoverySnapshotFiles(await repo.readRecoverySnapshot(datasetId));let confirmed=true;
      for(let index=0;index<files.length;index++){
        if(appClosed)return;
        if(files.length>1){feedback=t('multipartExport')+' '+(index+1)+' / '+files.length;error=false;updateFeedback();}
        const result=await download(files[index].text,files[index].name);if(result?.status!=='written')confirmed=false;
      }
      feedback=confirmed?'Đã xác nhận lưu '+files.length+' tệp phục hồi. Giữ đủ bộ tệp và bảo vệ dữ liệu dạng rõ; tệp phục hồi không phải bản sao kích hoạt.':'Đã yêu cầu tải tệp phục hồi. Chưa xác nhận tệp đã được lưu; hãy kiểm tra và giữ đủ bộ trước khi xác nhận phục hồi.';error=false;
    });
  }
  async function readRecoveryBackupSelection(active){
    if(appClosed)return;
    if(pendingWrite)return pendingWrite;
    const selectedFiles=onReadBackup?null:Array.from(document.getElementById('recovery-restore-form').querySelector('[name="backupFile"]').files||[]);
    const generation=++stageReadGeneration,activeRepo=repo,currentNamespace=namespace;
    const expected={expectedDatasetId:active.datasetId??null,expectedRevision:active.revision??null};
    const stillCurrent=()=>!appClosed&&generation===stageReadGeneration&&recoveryMode&&route==='recovery'&&repo===activeRepo&&namespace===currentNamespace;
    stage=null;stagedExpectation=null;formDrafts.delete('recovery-activate-form');
    return recoveryOperation(async()=>{
      const first=onReadBackup?await onReadBackup():null,selected=onReadBackup?(first?[first]:[]):selectedFiles;
      if(!stillCurrent())return;
      if(!selected.length){feedback='Đã hủy chọn bản sao. Kho hiện tại chưa thay đổi.';error=false;return;}
      if(selected.length>MAX_BACKUP_PARTS)throw new Error('BACKUP_PARTS_MISMATCH');
      const rawTexts=[];let partInfo=null;
      for(let index=0;index<selected.length;index++){
        const file=selected[index];
        if(!file||!Number.isSafeInteger(file.size)||file.size<0||file.size>5*1024*1024)throw new Error('BACKUP_TOO_LARGE');
        const text=typeof file.text==='function'?await file.text():file.text;if(!stillCurrent())return;
        const info=inspectBackup(text);
        if(info.kind==='legacy')throw new Error('RESTORE_SCHEMA_UNSUPPORTED');
        if(info.kind==='recovery-archive'||info.recoveryOnly)throw new Error('BACKUP_RECOVERY_ARCHIVE_READ_ONLY');
        if(!['v3','multipart'].includes(info.kind))throw new Error('INVALID_BACKUP_FORMAT');
        rawTexts.push(text);
        if(info.kind==='multipart'){
          if(!partInfo)partInfo=info;
          if(info.bundleId!==partInfo.bundleId||info.count!==partInfo.count||selected.length>partInfo.count)throw new Error('BACKUP_PARTS_MISMATCH');
          if(onReadBackup&&selected.length<partInfo.count){feedback=t('multipartProgress')+' '+(selected.length+1)+' / '+partInfo.count;error=false;updateFeedback();const next=await onReadBackup();if(!stillCurrent())return;if(!next)throw new Error('BACKUP_PARTS_INCOMPLETE');selected.push(next);}
        }else if(selected.length>1)throw new Error('BACKUP_PARTS_MISMATCH');
      }
      const candidate=await stageRestoreFiles(rawTexts,{namespace:currentNamespace});if(!stillCurrent())return;
      await activeRepo.stageRecoveryRestore(candidate,expected);if(!stillCurrent())return;
      stage=candidate;stageKind='recovery';stagedExpectation=expected;feedback='Đã kiểm tra và lưu bản xem trước phục hồi. Kho hiện tại chưa thay đổi.';error=false;
    });
  }
  function recoveryStagePreview(){
    if(!stage||stageKind!=='recovery'||!stagedExpectation)return null;
    const preview=stage.snapshot;
    return card(h('h2',{},'Bản xem trước phục hồi sổ cá nhân'),notice('stageReady'),h('p',{},t('accounts')+': '+(stage.report?.accounts||0)+' · '+t('transactions')+': '+(stage.report?.postings||0)+' · '+preview.profile.defaultCurrencyCode),h('p',{},'Kho đích: '+namespace+'. Tên tài khoản: '+preview.accounts.slice(0,5).map(account=>account.name).join(', ')),form('recovery-activate-form',[
      h('label',{class:'checkbox'},input('backupAck','checkbox','yes',{required:true}),'Tôi đã giữ nguyên bản sao hoặc đủ bộ tệp phục hồi của kho lỗi hiện tại.'),
      h('label',{class:'checkbox'},input('replaceAck','checkbox','yes',{required:true}),'Tôi đã xem bản sao và muốn mở sổ cá nhân phục hồi riêng từ đúng bản xem trước này; không trộn với kho hiện tại.'),
      h('label',{class:'checkbox'},input('recoveryAck','checkbox','yes',{required:true}),'Tôi hiểu kho hiện tại không đọc được an toàn. Tôi xác nhận dùng bản sao đã kiểm tra và giữ kho lỗi để kiểm tra sau.')
    ],async values=>{
      if(values.backupAck!=='yes'||values.replaceAck!=='yes'||values.recoveryAck!=='yes')throw new Error('RECOVERY_CONFIRMATION_REQUIRED');
      const candidate=stage,expected={...stagedExpectation},activeRepo=repo;
      await recoveryOperation(async()=>{
        await activeRepo.activateStage(candidate.id,{...expected,mode:'new',confirm:true,backupAcknowledged:true,recoveryAcknowledged:true});
        const confirmed=validateSnapshot(await activeRepo.readSnapshot());
        state=confirmed;needsReadRecovery=false;recoveryMode=false;ignoreLegacy=true;t=translator(state.profile.locale);range=defaultPeriod();resetDrafts();formDrafts.clear();route=hasBook()?'overview':'start';feedback=t('saved');error=false;
        unsubscribe?.();if(repo.subscribe)unsubscribe=repo.subscribe(()=>{if(!pendingWrite){allocationPreview=null;feedback=t('conflict');error=false;updateFeedback();}});
      });
    },'activate'),action('cancel',async()=>{stage=null;stagedExpectation=null;stageReadGeneration++;await render();}));
  }
  async function migrationView(){let old=null;try{old=inspectBackup(legacyRaw).state;}catch{}const accounts=Array.isArray(old?.accounts)?old.accounts:[];return [title('legacyFound'),notice('legacyHelp',true),notice('legacyFileHelp'),card(actionRow(action('exportOld',()=>download(legacyRaw,'mach-tien-legacy-raw-'+today()+'.json'),true),action('newSeparate',async()=>{ignoreLegacy=true;await go('create');}))),card(form('migration-form',[accounts.map((a,i)=>field(t('openingDateLegacy')+' · '+String(a.name||a.id),'opening-'+i,input('opening-'+i,'date','',{required:true}))),h('label',{class:'checkbox'},input('backupAck','checkbox','yes',{required:true}),t('backupAck'))],async values=>{if(values.backupAck!=='yes')throw new Error('STAGE_CONFIRMATION_REQUIRED');const expected={expectedDatasetId:state.datasetId,expectedRevision:state.revision},candidate=await stageLegacyMigration(legacyRaw,{backupAcknowledged:true,openingDates:Object.fromEntries(accounts.map((a,i)=>[a.id,values['opening-'+i]])),namespace,timezoneId:state.profile.timezoneId,locale:state.profile.locale});if(state.datasetId!==expected.expectedDatasetId||state.revision!==expected.expectedRevision)throw new Error('ACTIVATION_DATASET_REVISION_CONFLICT');if(candidate.activationAllowed)await repo.stageRestore(candidate,{mode:'new'});stagedExpectation=expected;stageKind='legacy';stage=candidate;await render();},'migration')),stagePreview(),old?compatibilityCard(legacyRaw):null];}
  function help(){const steps=[['guideStep1','guideStep1Help'],['guideStep2','guideStep2Help'],['guideStep3','guideStep3Help'],['guideStep4','guideStep4Help']];return [title('startGuide'),h('p',{},t('guideIntro')),h('div',{class:'guide-steps'},steps.map(([heading,body],index)=>card(h('small',{class:'step-number'},String(index+1)),h('h2',{},t(heading)),h('p',{},t(body))))),h('div',{class:'actions'},hasBook()?action('overview',()=>go('overview'),true):action('beginCreate',()=>go('create'),true),!hasBook()?action('returnStart',()=>go('start')):null),card(h('dl',{},h('dt',{},t('actual')+' / '+t('planned')+' / '+t('proposed')),h('dd',{},t('planExplain')),h('dt',{},t('account')+' / '+t('envelope')),h('dd',{},t('budgetExplain')),h('dt',{},t('allocate')),h('dd',{},t('allocationHelp')),h('dd',{},t('monthlyHelp')),h('dt',{},t('transfer')),h('dd',{},t('transferExplain')),h('dt',{},t('data')),h('dd',{},t('backupExplain')),h('dd',{},t('plaintext'))))];}
  const navigationGroups=[['explore',[['overview','overview','▦',''],['transactions','transactions','≡','menuLedger'],['accounts','accounts','▣','menuAccounts'],['templates','templates','◉','menuTemplates'],['plans','plans','▤','menuPlans'],['forecast','forecastTitle','↗','menuForecast'],['categories','categories','◇','menuCategories']]],['support',[['history','history','↶','menuHistory'],['help','startGuide','?','menuHelpText'],['data','settingsData','⚙','menuData']]],['optional',[['shared','shared','◎','menuShared']]]];
  function navActive(key){const section=route.split('/')[0];return section===key||key==='templates'&&['allocations','envelopes'].includes(section);}
  function navLink([key,label,symbol,hint],className='nav-item'){return h('a',{href:'#'+key,class:className+(navActive(key)?' active':''),'aria-current':navActive(key)?'page':null,'data-nav':key,onClick:run(()=>go(key))},icon(key),h('span',{},t(label)));}
  function sidebar(){return h('aside',{class:'sidebar'},h('div',{class:'brand'},h('div',{class:'brand-mark','aria-hidden':'true'},h('span'),h('span'),h('span')),h('div',{},h('strong',{},t('app')),h('small',{},t('personalBook')))),h('nav',{'aria-label':t('mainNavigation')},navigationGroups.map(([label,items])=>h('div',{class:'nav-group'},h('p',{class:'sidebar-section-label'},t(label)),h('div',{class:'nav-list'},items.map(item=>navLink(item)))))),h('p',{class:'sidebar-note'},t('localBook')));}
  function mobileNav(){const items=navigationGroups[0][1],keys=['overview','transactions','templates','plans'];return h('nav',{class:'mobile-nav','aria-label':t('mobileNavigation')},keys.map(key=>navLink(items.find(item=>item[0]===key),'mobile-nav-item')),navLink(['menu','menu','☰',''],'mobile-nav-item'));}
  function menuView(){return [title('menuTitle'),h('p',{},t('menuHelp')),navigationGroups.map(([label,items])=>card(h('h2',{},t(label)),h('div',{class:'menu-list'},items.map(([key,name,symbol,hint])=>h('a',{href:'#'+key,class:'menu-row',onClick:run(()=>go(key))},icon(key),h('div',{},h('strong',{},t(name)),hint?h('small',{},t(hint)):null)))))),card(action(namespace==='sandbox'?'returnPersonal':'trySandbox',()=>openNamespace(namespace==='sandbox'?'personal':'sandbox')))];}
  function historyView(){const labels={onboard:'beginCreate',addAccount:'newAccount',updateAccount:'edit',addCategory:'newCategory',updateCategory:'edit',addEnvelope:'envelope',updateEnvelope:'edit',archiveEntity:'historyArchiveChange',recordActual:'newTransaction',reverseOperation:'undoOperation',replaceOperation:'correctOperation',createPlan:'newPlan',createMonthlyPlan:'newPlan',reschedulePlan:'reschedule',closePlan:'historyPlanChange',linkSettlement:'linkExisting',unlinkSettlement:'unlink',saveTemplate:'historyTemplateSave',confirmAllocation:'allocate',reverseAllocation:'undoAllocation',linkExpense:'linkEnvelope',revisePlan:'revisePlan',revisePlanSeries:'reviseSeries'};const rows=[...state.audit].reverse().map(entry=>{const date=new Intl.DateTimeFormat(state.profile.locale,{dateStyle:'short',timeStyle:'short',timeZone:state.profile.timezoneId}).format(new Date(entry.atUtc));return [date,t(labels[entry.type]||'details'),String(entry.revision)];});return [title('history'),notice('historyHelp'),card(rows.length?table([t('date'),t('details'),t('revision')],rows):empty())];}

  async function render(){
    if(recoveryMode){
      formHandlers.clear();
      const content=route==='shared'
        ?h('main',{class:'shell'},h('div',{id:'feedback'}),action('back',()=>go('recovery')),sharedContent())
        :await recoveryView();
      if(route!=='shared')content.append(action('sharedOfflineBook',()=>go('shared')));
      const finishViewport=viewTransition([namespace,route,'recovery'].join('|'));
      root.replaceChildren(content);updateFeedback();finishViewport(content);return;
    }
    if(!state)return;
    const restoreFilterFocus=!!activeFilterModal;
    formHandlers.clear();
    t=translator(state.profile.locale);document.documentElement?.setAttribute('lang',state.profile.locale.startsWith('en')?'en':'vi');
    if(hasBook()&&['start','create'].includes(route))route='overview';if(!hasBook()&&!emptyRoutes.has(route))route='start';
    const parts=route.split('/');let body;
    try{
      if(route==='start')body=startScreen();else if(route==='create')body=hasIncompleteBook()?[notice('setupRecovery',true),action('returnStart',()=>go('start'))]:onboarding();else if(route==='data-review')body=await migrationView();else if(route==='overview')body=await overview();else if(route==='transactions')body=ledger();else if(parts[0]==='transactions'&&parts[1]==='new')body=transactionForm(parts[2]);else if(parts[0]==='transactions')body=transactionDetail(parts[1]);else if(route==='accounts')body=accounts();else if(parts[0]==='accounts'&&parts[1]==='new')body=accountForm();else if(parts[0]==='accounts')body=parts[2]==='timeline'?timeline(parts[1]):accountDetail(parts[1]);else if(route==='categories')body=await categories();else if(parts[0]==='categories')body=await categoryDetail(parts[1]);else if(parts[0]==='envelopes')body=await envelopeDetail(parts[1]);else if(route==='forecast')body=await forecast();else if(route==='plans')body=plans();else if(parts[0]==='plans'&&parts[1]==='new')body=planForm();else if(parts[0]==='plans')body=planDetail(parts[1]);else if(route==='templates')body=templates();else if(parts[0]==='templates')body=templateForm(parts[1]==='new'?'':parts[1]);else if(parts[0]==='allocations'&&parts[1]==='new')body=allocationForm(parts[2],parts[3]);else if(parts[0]==='allocations')body=allocationDetail(parts[1]);else if(parts[0]==='reports')body=await report(parts[1]);else if(route==='data')body=await dataView();else if(route==='history')body=historyView();else if(route==='menu')body=menuView();else if(route==='shared')body=[sharedContent()];else body=help();
    }catch(cause){feedback=errorMessage(cause,t);error=true;body=[title('errorDetails'),action('reload',refresh,true),action('back',()=>go('overview'))];}
    const book=hasBook(),header=h('header',{class:'app-header'},h('div',{},h('div',{class:'header-brand'},t('app')),book?h('small',{},route==='shared'?t('sharedOfflineBook'):namespace==='sandbox'?t('sandbox'):t('personalBook')):null),book?h('div',{class:'header-actions'},route==='shared'||route.startsWith('transactions/new')?null:action('quickExpense',quickExpense,true,{id:'quick-expense'}),action('reload',route==='shared'?()=>sharedView?.refresh():refresh,false,{class:'button refresh-button','aria-label':t('reload')})):null),content=h('main',{id:'main-content',class:'shell',tabindex:'-1'},h('div',{id:'feedback'}),book?h('div',{class:'scope-switch','aria-label':t('bookScope')},action('personal',()=>go('overview'),false,{'aria-pressed':route!=='shared',class:'scope-choice'+(route!=='shared'?' active':'')}),action('shared',()=>go('shared'),false,{'aria-pressed':route==='shared',class:'scope-choice'+(route==='shared'?' active':'')})):null,route!=='start'&&route!=='overview'?h('div',{class:'back-row'},action('back',goBack)):null,body);
    releaseFilterModal();
    const finishViewport=viewTransition([namespace,route,'normal'].join('|'));
    root.replaceChildren(...[namespace==='sandbox'?h('div',{class:'sandbox'},t('sandbox')):null,h('div',{class:book?'app-layout':'welcome-layout'},book?sidebar():null,h('div',{class:'main-column'},header,content)),book&&route!=='shared'?mobileNav():null].filter(Boolean));updateFeedback();if(restoreFilterFocus)root.querySelector('summary')?.focus?.();
    finishViewport(content);
  }
  root.addEventListener('keydown',event=>{
    const sheet=Array.from(root.querySelectorAll('[data-filter-sheet]')).find(node=>node.open||node.getAttribute('open')!==null);
    if(!sheet)return;
    if(event.key==='Escape'){event.preventDefault?.();dismissFilters();return;}
    if(event.key==='Tab'&&activeFilterModal?.sheet===sheet){
      const panel=activeFilterModal.panel,focusable=Array.from(panel.querySelectorAll('button,input,select,textarea,a[href]')).filter(node=>!node.disabled&&!node.hidden),first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel)){event.preventDefault?.();last?.focus?.();}
      else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===panel)){event.preventDefault?.();first?.focus?.();}
    }
  });
  browser?.addEventListener?.('resize',()=>{for(const sheet of Array.from(root.querySelectorAll('[data-filter-sheet]')))activateFilterModal(sheet,sheet.querySelector('section'),sheet.querySelector('summary'));});

  root.addEventListener('input',event=>{if(event.target?.closest?.('#allocation-form')&&allocationPreview){allocationPreview=null;const confirm=document.getElementById('allocation-confirm');if(confirm)confirm.disabled=true;feedback=t('previewChanged');error=false;updateFeedback();}});
  root.addEventListener('change',async event=>{if(event.target?.name==='operationType'&&event.target?.closest?.('#transaction-form')){const values=Object.fromEntries(new browser.FormData(document.getElementById('transaction-form')));values.categoryId='';formDrafts.set('transaction-form',values);await render();return;}if(event.target?.closest?.('#allocation-form')&&allocationPreview){allocationPreview=null;const confirm=document.getElementById('allocation-confirm');if(confirm)confirm.disabled=true;feedback=t('previewChanged');error=false;updateFeedback();}});
  browser?.addEventListener?.('hashchange',()=>{const next=resolveRoute(browser.location.hash);if(next!==route)return run(()=>go(next,{record:false,updateHash:false}))();});
  browser?.addEventListener?.('focus',()=>{if(state&&!pendingWrite)repo.readSnapshot().then(next=>{if(next.datasetId!==state.datasetId||next.revision!==state.revision){feedback=t('conflict');error=false;updateFeedback();}}).catch(fail);});
  const initialRoute=resolveRoute(browser?.location?.hash);
  await openNamespace(namespace);
  if(hasBook()&&browser?.location?.hash)await go(initialRoute);else if(!hasBook()&&['help','data','data-review','shared'].includes(initialRoute))await go(initialRoute);
  return {go,goBack,dismissFilters,handleNativeBack:async()=>{if(pendingWrite||setupSubmission||sharedView?.isBusy())return true;if(dismissFilters())return true;if(route==='overview'||route==='start')return false;await goBack();return true;},refresh,render,perform,snapshot:()=>structuredClone(state),sharedController:()=>sharedView,currentRoute:()=>route,openNamespace,submit:async(formId,values)=>{if(!document.getElementById(formId)||!formHandlers.has(formId))throw new Error('FORM_NOT_VISIBLE');return formHandlers.get(formId)(values);},close(){appClosed=true;stageReadGeneration++;releaseFilterModal();sharedView?.close();unsubscribe?.();repo?.close?.();}};
}

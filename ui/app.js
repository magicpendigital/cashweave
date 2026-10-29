import { openIndexedDbRepository } from '../core/repository.js';
import { minor, parseMoney, formatMinor, EXPONENTS } from '../core/money.js';
import { todayInTimezone, addDays } from '../core/calendar.js';
import { entity, accountBalance, planSummary, sourceCapacity, validateSnapshot } from '../core/model.js';
import { queryReport, reportDescriptor } from '../core/reports.js';
import { exportSnapshot } from '../core/migration.js';
import { id } from '../core/identity.js';
import { createSharedView } from './shared-view.js';
import { translator, errorMessage, fill } from './i18n.js';
import { dom } from './dom.js';
import { startScreen, setupScreen } from './screens/welcome.js';
import { homeScreen } from './screens/home.js';
import { ledgerScreen, quickAddScreen, transactionDetail } from './screens/ledger.js';
import { upcomingScreen, planForm, planDetail, forecastScreen } from './screens/plans.js';
import { fundsScreen, allocationForm, allocationDetail, envelopeDetail, recipesScreen, builderScreen } from './screens/funds.js';
import { moreScreen, accountsScreen, accountForm, accountDetail, timelineScreen, categoriesScreen, categoryDetail, reportsScreen, reportDetail, dataScreen, migrationScreen, historyScreen, helpScreen } from './screens/more.js';
import { assetsScreen, priceUpdateScreen } from './screens/assets.js';

// Old links keep working: every v0.4/V4 hash resolves to its new home in the 5-tab IA.
export const ROUTE_ALIASES = Object.freeze({dashboard:'overview',home:'overview',ledger:'transactions',add:'transactions/new/expense',calendar:'plans',upcoming:'plans',guide:'help',allocations:'funds',templates:'funds',envelopes:'funds',menu:'more',networth:'assets','settings/data':'data','settings/accounts':'accounts','settings/profile':'data'});
export const resolveRoute = raw => { const route = String(raw || 'overview').replace(/^#\/?/,''); return ROUTE_ALIASES[route] || route; };
const TAB_ROUTES = new Set(['overview','transactions','plans','funds','more']);
const PLAN_SECTIONS = ['plans','funds','envelopes','allocations','allocate','templates','recipes','forecast'];
const MORE_SECTIONS = ['more','accounts','categories','reports','data','data-review','history','help','assets','shared'];
function safeStorage(){try{return globalThis.localStorage||null;}catch{return null;}}
export async function createNextApp(root,{document = globalThis.document,browser = globalThis.window,repositoryFactory = options => openIndexedDbRepository(options),namespace = 'personal',clock = () => new Date(),legacyStorage = globalThis.localStorage,preferenceStorage = safeStorage(),onDownload = null,onReadBackup = null} = {}) {
  const {h,field,input,select,button,table,icon} = dom(document);
  const formHandlers=new Map(),formDrafts=new Map(),setupDrafts=new Map(),routeTrail=[],memoCache=new Map();
  let setupSubmission=null,needsReadRecovery=false,sharedView=null,activeFilterModal=null,memoKey='',prefsCache=null;
  let repo,state,t,route = 'overview',feedback = '',error = false,pendingWrite = null,unsubscribe = null;
  const ui={range:{from:'',through:'',accountId:'',currencyCode:'VND'},ledgerFilter:{query:'',type:''},ledgerLimit:50,showCorrections:false,planScope:'pending',receiptSourceId:'',allocationPreview:null,templateDraft:null,activeReport:null,reportCursor:0,forecastRange:null,stage:null,stagedExpectation:null,stageKind:'',stageReadGeneration:0,lastDatasetId:'',legacyRaw:null,ignoreLegacy:false,openPreset:'',reportMonth:'',addingCategory:false,priceDraft:null,flash:''};
  const hasBook=()=>!!state?.profile.onboardingCompletedAtUtc&&state.accounts.length>0;
  const hasIncompleteBook=()=>!hasBook()&&(!!state?.profile.onboardingCompletedAtUtc||state?.accounts.length>0);
  const emptyRoutes=new Set(['start','create','help','data','data-review']);
  const today = () => todayInTimezone(state?.profile.timezoneId || 'Asia/Ho_Chi_Minh',clock());
  const currentMonth = () => today().slice(0,7);
  const monthEnd = month => new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
  const shiftMonth = (month,offset) => { const d=new Date(month+'-15T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+offset);return d.toISOString().slice(0,7); };
  const defaultPeriod=()=>({from:today().slice(0,7)+'-01',through:today(),accountId:'',currencyCode:state.profile.defaultCurrencyCode});
  ui.range={from:todayInTimezone('Asia/Ho_Chi_Minh',clock()).slice(0,7)+'-01',through:todayInTimezone('Asia/Ho_Chi_Minh',clock()),accountId:'',currencyCode:'VND'};

  // Per-namespace UI preferences (last backup time, hidden amounts). Storage may be blocked: never fatal.
  const prefKey=()=>'cashweave-ui-'+namespace;
  function prefs(){if(prefsCache)return prefsCache;try{prefsCache=JSON.parse(preferenceStorage?.getItem?.(prefKey())||'{}')||{};}catch{prefsCache={};}return prefsCache;}
  function setPrefs(patch){prefsCache={...prefs(),...patch};try{preferenceStorage?.setItem?.(prefKey(),JSON.stringify(prefsCache));}catch{}}
  const amountsHidden=()=>prefs().hideAmounts===true;
  const fmt = (value,currency = ui.range.currencyCode || state.profile.defaultCurrencyCode) => amountsHidden()?'•••••':formatMinor(value,currency,state.profile.locale);
  const fmtSigned = (value,currency) => (minor(value)>0n?'+':'')+fmt(value,currency);
  const shortDate = date => date.slice(8,10)+'/'+date.slice(5,7);
  const DAYS=['Chủ nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'];
  const weekday = date => DAYS[new Date(date+'T12:00:00Z').getUTCDay()];
  const dayLabel = date => (date===today()?t('today'):date===addDays(today(),-1)?t('yesterday'):weekday(date))+' · '+shortDate(date);
  const monthLabel = month => fill(t('monthLabel'),{m:Number(month.slice(5,7))});
  const daysBetween = (from,to) => Math.round((Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/86400000);

  // Derived values are memoised per snapshot revision and local day; a new revision drops every entry.
  function memo(key,fn){const k=state.datasetId+':'+state.revision+':'+today()+':'+(amountsHidden()?1:0);if(k!==memoKey){memoKey=k;memoCache.clear();}if(!memoCache.has(key))memoCache.set(key,fn());return memoCache.get(key);}
  const balance = (accountId,endExclusive=addDays(today(),1)) => memo('balance:'+accountId+':'+endExclusive,()=>accountBalance(state,accountId,endExclusive));
  const report = d => memo('report:'+JSON.stringify(d),()=>queryReport(state,d));
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
    const summary=h('summary',{class:'filter-chip'},h('span',{},label),icon('down'));
    const panel=h('section',{class:'filter-panel','aria-label':t('advancedFilters'),tabindex:'-1'},h('div',{class:'filter-panel-head'},h('h2',{},t('advancedFilters')),action('closeFilters',()=>closeFilterSheet(sheet,summary))),h('div',{class:'filter-feedback','data-filter-feedback':'true'}),children);
    const sheet=h('details',{class:'filter-sheet','data-filter-sheet':'true',onToggle:()=>{if(sheet.open)activateFilterModal(sheet,panel,summary);else if(activeFilterModal?.sheet===sheet)releaseFilterModal({returnFocus:true});}},summary,panel);
    return sheet;
  }
  const isWholeMonth=r=>r.from.endsWith('-01')&&(r.through===monthEnd(r.from.slice(0,7))||r.from.slice(0,7)===currentMonth()&&r.through===today());
  const periodLabel=()=>(isWholeMonth(ui.range)?monthLabel(ui.range.from.slice(0,7))+(ui.range.from.slice(0,4)!==today().slice(0,4)?' / '+ui.range.from.slice(0,4):''):shortDate(ui.range.from)+' → '+shortDate(ui.range.through))+(ui.range.currencyCode!==state.profile.defaultCurrencyCode?' · '+ui.range.currencyCode:'')+(ui.range.accountId?' · '+entity(state,'accounts',ui.range.accountId).name:'');
  function setFeedback(text,isError=false){feedback=text;error=isError;updateFeedback();}
  function fail(cause) {feedback=errorMessage(cause,t);error=true;updateFeedback();return {error:cause.message};}
  function updateFeedback() { const target=activeFilterModal?.panel.querySelector('[data-filter-feedback]')||document.getElementById('feedback');if(target){target.replaceChildren();if(feedback)target.append(h('div',{role:error?'alert':'status',class:'notice'+(error?' error':''),tabindex:error?'-1':null},feedback));if(error&&activeFilterModal)target.querySelector('[role="alert"]')?.focus?.();} }
  const run = fn => async event => {if(event?.preventDefault)event.preventDefault();try{return await fn(event);}catch(cause){return fail(cause);}};
  function link(next,label,extra={}) {return h('a',{href:'#'+next,onClick:run(()=>go(next)),...extra},label);}
  function action(label,fn,primary=false,extra={}) {return button(t(label),run(fn),primary,{disabled:!!pendingWrite,...extra});}
  function form(formId,fields,submit,submitLabel='save',extra={}) {
    const handler=run(async values=>{formDrafts.set(formId,values);return submit(values);});formHandlers.set(formId,handler);
    const node=h('form',{id:formId,class:extra.class,onSubmit:run(event=>handler(Object.fromEntries(new browser.FormData(event.target))))},fields,submitLabel===null?null:h('div',{class:'actions'+(extra.stickySubmit?' sticky-submit':'')},h('button',{type:'submit',class:'button primary'+(extra.wide?' wide':''),disabled:!!pendingWrite||needsReadRecovery},t(submitLabel))));
    const draft=formDrafts.get(formId);
    node.querySelectorAll('[name]').forEach(control=>{if(draft&&Object.hasOwn(draft,control.name)&&control.type!=='file'){if(control.type==='checkbox')control.checked=draft[control.name]===control.value;else control.value=draft[control.name];}});
    node.querySelectorAll('[id]').forEach(control=>{control.id=formId+'-'+control.id;});
    node.querySelectorAll('label[for]').forEach(label=>label.setAttribute('for',formId+'-'+label.getAttribute('for')));
    return node;
  }
  const accountChoices = (currency=ui.range.currencyCode) => state.accounts.filter(a=>a.currencyCode===currency&&!a.archivedAtUtc).map(a=>[a.id,a.name]);
  const amountField = (name='amount',value='',currency=ui.range.currencyCode) => field(t('amount')+' · '+currency,name,input(name,'text',value,{required:true,inputmode:'decimal',autocomplete:'off'}),t('moneyInputHelp'));
  const dateField = (name='date',value=today(),label='date') => field(t(label),name,input(name,'date',value,{required:true}));
  const toMinor = (text,currency=ui.range.currencyCode,locale=state.profile.locale) => parseMoney(text,currency,locale).amountMinor;
  const decimalInput = (amount,currency=ui.range.currencyCode) => {const exponent=EXPONENTS[currency],n=BigInt(amount),abs=n<0n?-n:n,scale=10n**BigInt(exponent),separator=new Intl.NumberFormat(state.profile.locale).formatToParts(1.1).find(p=>p.type==='decimal')?.value||'.';return (n<0n?'-':'')+(abs/scale).toString()+(exponent?separator+(abs%scale).toString().padStart(exponent,'0'):'');};
  function descriptor(metricId,extra={}) {return reportDescriptor(state,{metricId,currencyCode:ui.range.currencyCode,startLocalDateInclusive:ui.range.from,endLocalDateExclusive:addDays(ui.range.through,1),accountIds:ui.range.accountId?[ui.range.accountId]:[],datasetRevision:state.revision,...extra});}
  const opLabel = operation => operation.operationType==='OPENING'?t('opening'):operation.operationType==='REVERSAL'?t('reversal'):t(operation.operationType.toLowerCase());
  function scopedPostings(operation){return state.postings.filter(p=>p.operationId===operation.id&&p.currencyCode===ui.range.currencyCode&&(!ui.range.accountId||p.accountId===ui.range.accountId));}
  function pendingPlans({currency=ui.range.currencyCode,accountId=ui.range.accountId}={}){return memo('pending:'+currency+':'+accountId,()=>state.occurrences.filter(p=>p.currencyCode===currency&&(!accountId||p.expectedAccountId===accountId)).map(p=>planSummary(state,p.id)).filter(p=>p.closure==='OPEN'&&minor(p.openRemaining)>0n).sort((a,b)=>a.dueLocalDate.localeCompare(b.dueLocalDate)));}
  function sourceLabel(source){const posting=entity(state,'postings',source.sourcePostingId),operation=entity(state,'operations',posting.operationId),capacity=sourceCapacity(state,source.id);return [operation.operationType==='OPENING'?t('opening'):operation.memo||opLabel(operation),entity(state,'accounts',posting.accountId).name,posting.effectiveLocalDate,t('receivedAmount')+': '+fmt(capacity.eligible,posting.currencyCode),t('assignedAmount')+': '+fmt(capacity.consumed,posting.currencyCode),t('sourceRemaining')+': '+fmt(capacity.remaining,posting.currencyCode)].join(' · ');}
  // "Đang dùng": the method behind the latest allocation, else the most recently saved one.
  function currentTemplate(currency=ui.range.currencyCode){
    const usable=state.templates.filter(tp=>!tp.archivedAtUtc&&tp.currentVersionId&&state.templateVersions.some(v=>v.id===tp.currentVersionId&&v.currencyCode===currency));
    if(!usable.length)return null;
    const lastApp=[...state.allocationApplications].filter(a=>!a.reversalOfApplicationId&&usable.some(tp=>tp.id===a.templateId)).sort((a,b)=>b.revision-a.revision)[0];
    return lastApp?usable.find(tp=>tp.id===lastApp.templateId):[...usable].sort((a,b)=>(b.updatedAtUtc||'').localeCompare(a.updatedAtUtc||'')||b.revision-a.revision)[0];
  }
  function resetDrafts(){ui.allocationPreview=null;ui.templateDraft=null;ui.activeReport=null;ui.forecastRange=null;ui.stage=null;ui.stagedExpectation=null;ui.stageReadGeneration++;ui.reportCursor=0;ui.priceDraft=null;ui.priceErrors=null;ui.addingCategory=false;}
  async function refresh(){const next=validateSnapshot(await repo.readSnapshot());state=next;needsReadRecovery=false;t=translator(state.profile.locale);ui.range.currencyCode=state.profile.defaultCurrencyCode;resetDrafts();feedback='';error=false;await render();}
  async function perform(type,values,next){
    if(needsReadRecovery)throw new Error('POST_COMMIT_READ_FAILED');
    if(pendingWrite)return pendingWrite;
    const command={commandId:id(),type,input:values},revision=state.revision;
    feedback=t('pending');error=false;updateFeedback();
    pendingWrite=repo.runAtomicCommand(command,revision,{now:clock().toISOString()});
    document.querySelectorAll(type==='onboard'?'button':'button[type="submit"]').forEach(node=>{node.disabled=true;});
    // The core validates every committed snapshot; re-validating here only cost time on large books.
    try{const receipt=await pendingWrite;try{state=await repo.readSnapshot();}catch(cause){needsReadRecovery=true;throw new Error('POST_COMMIT_READ_FAILED',{cause});}t=translator(state.profile.locale);ui.allocationPreview=null;formDrafts.clear();feedback=t('saved');error=false;if(next&&next!==route){if(routeTrail.at(-1)===next)routeTrail.pop();route=next;if(browser?.location)browser.location.hash='#'+route;}else if(next)route=next;return receipt;}
    finally{pendingWrite=null;await render();}
  }
  function rememberSetup(){const node=document.getElementById('onboard-form');if(route==='create'&&node)setupDrafts.set(namespace,Object.fromEntries(new browser.FormData(node)));}
  async function openNamespace(next){
    if(pendingWrite||setupSubmission)throw new Error('WRITE_IN_PROGRESS');
    rememberSetup();const nextRepo=await repositoryFactory({namespace:next});let nextState;
    try{nextState=validateSnapshot(await nextRepo.readSnapshot());}catch(cause){nextRepo.close?.();throw cause;}
    repo?.close?.();unsubscribe?.();namespace=next;repo=nextRepo;state=nextState;prefsCache=null;ui.ledgerFilter={query:'',type:''};ui.ledgerLimit=50;ui.planScope='pending';ui.receiptSourceId='';t=translator(state.profile.locale);ui.range=defaultPeriod();resetDrafts();ui.ignoreLegacy=false;ui.legacyRaw=null;routeTrail.length=0;
    if(namespace==='personal'&&!hasBook()){try{ui.legacyRaw=legacyStorage?.getItem('financial-assistant-prototype-v1')||null;}catch{}}
    needsReadRecovery=false;route=hasBook()?'overview':'start';
    if(repo.subscribe)unsubscribe=repo.subscribe(()=>{if(!pendingWrite){ui.allocationPreview=null;feedback=t('conflict');error=false;updateFeedback();}});
    await render();
  }
  async function go(next,{record=true,updateHash=true}={}){
    let resolved=resolveRoute(next);
    if((pendingWrite||setupSubmission)&&route==='create'){feedback=t('setupSaving');error=false;updateFeedback();return;}
    if(hasBook()&&['start','create'].includes(resolved))resolved='overview';
    if(!hasBook()&&!emptyRoutes.has(resolved))resolved='start';
    if(resolved==='allocate'){
      const currency=ui.receiptSourceId?entity(state,'fundingSources',ui.receiptSourceId).currencyCode:ui.range.currencyCode,template=currentTemplate(currency);
      if(template)resolved='allocations/new/'+template.currentVersionId;else{resolved='recipes';ui.flash='chooseMethodFirst';}
    }
    const changed=resolved!==route;
    if(changed){rememberSetup();if(record)routeTrail.push(route);else if(routeTrail.at(-1)===resolved)routeTrail.pop();formDrafts.clear();ui.allocationPreview=null;ui.stageReadGeneration++;ui.reportCursor=0;ui.addingCategory=false;if(resolved.startsWith('templates/'))ui.templateDraft=null;if(resolved!=='assets/update'){ui.priceDraft=null;ui.priceErrors=null;}if(resolved==='transactions'&&!route.startsWith('transactions'))ui.ledgerLimit=50;}
    route=resolved;feedback='';error=false;if(browser?.location&&(updateHash||resolveRoute(next)!==route))browser.location.hash='#'+route;await render();
    // Each new screen starts at its top (the old app kept the previous scroll offset).
    if(changed){try{browser?.scrollTo?.(0,0);}catch{}}
  }
  function backTarget(){const parts=route.split('/');if(!hasBook())return 'start';if(['allocations','envelopes','templates','recipes'].includes(parts[0]))return parts[0]==='templates'?'recipes':'funds';if(parts[0]==='assets')return parts[1]?'assets':'more';if(parts[0]==='reports')return parts[1]?'reports':'more';if(parts.length>1&&['accounts','categories','plans','transactions'].includes(parts[0]))return parts[0]==='transactions'&&parts[1]==='new'?'overview':parts[0];if(MORE_SECTIONS.includes(parts[0])&&parts[0]!=='more')return 'more';if(parts[0]==='forecast')return 'plans';return 'overview';}
  async function goBack(){if(dismissFilters())return;if(route==='shared'&&sharedView?.back())return;const next=routeTrail.pop()||backTarget();await go(next,{record:false});}
  async function quickExpense(){const parts=route.split('/');if(parts[0]==='accounts'&&state.accounts.some(a=>a.id===parts[1]&&!a.archivedAtUtc)){const account=entity(state,'accounts',parts[1]);ui.range={...ui.range,accountId:account.id,currencyCode:account.currencyCode};}formDrafts.delete('transaction-form');return go('transactions/new/expense');}

  async function chooseMonth(offset){
    const month=shiftMonth(today().slice(0,7),offset);
    ui.range={...ui.range,from:month+'-01',through:monthEnd(month)};ui.activeReport=null;ui.reportCursor=0;ui.ledgerLimit=50;formDrafts.delete('period-form');await render();
  }
  function rangeForm({datesOnly=false,poolOnly=false}={}){
    const fields=h('div',{class:'compact'},field(t('from'),'from',input('from','date',ui.range.from,{required:true})),field(t('through'),'through',input('through','date',ui.range.through,{required:true})),datesOnly?null:field(t('currency'),'currencyCode',select('currencyCode',[...new Set(state.accounts.map(a=>a.currencyCode))].map(c=>[c,c]),ui.range.currencyCode)),datesOnly||poolOnly?null:field(t('scope'),'accountId',select('accountId',[['',t('allAccounts')],...state.accounts.filter(a=>a.currencyCode===ui.range.currencyCode).map(a=>[a.id,a.name+(a.archivedAtUtc?' · '+t('archived'):'')])],ui.range.accountId)));
    return h('div',{class:'range-fields'},h('div',{class:'actions'},action('month',()=>chooseMonth(0)),action('previousMonth',()=>chooseMonth(-1))),h('p',{class:'muted'},t('customPeriod')),form('period-form',fields,async values=>{
      const currencyCode=datesOnly?ui.range.currencyCode:values.currencyCode,accountId=datesOnly?ui.range.accountId:poolOnly||currencyCode!==ui.range.currencyCode?'':values.accountId||'',next={from:values.from,through:values.through,currencyCode,accountId};
      reportDescriptor(state,{metricId:'ActualIncome',currencyCode:next.currencyCode,startLocalDateInclusive:next.from,endLocalDateExclusive:addDays(next.through,1),accountIds:next.accountId?[next.accountId]:[]});ui.range=next;ui.activeReport=null;ui.reportCursor=0;ui.ledgerLimit=50;feedback='';error=false;formDrafts.delete('period-form');await render();
    },'applyPeriod'));
  }
  async function submitSetup(values){
    if(setupSubmission)return setupSubmission;
    if(needsReadRecovery)throw new Error('POST_COMMIT_READ_FAILED');
    if(hasBook())return go('overview');
    setupDrafts.set(namespace,{...values});
    const task=(async()=>{const timezoneId=values.timezoneId==='custom'?values.customTimezoneId:values.timezoneId,openingAmountMinor=toMinor(values.opening||'0',values.currencyCode,values.locale);await perform('onboard',{name:values.name,accountType:values.accountType,currencyCode:values.currencyCode,locale:values.locale,timezoneId,openingAmountMinor,openingEffectiveLocalDate:values.openingDate},'overview');setupDrafts.delete(namespace);ui.range=defaultPeriod();if(browser?.location)browser.location.hash='#overview';await render();try{browser?.scrollTo?.(0,0);}catch{}})();
    setupSubmission=task;
    try{return await task;}finally{setupSubmission=null;}
  }
  function managementControls(collection,target){
    const type={accounts:'updateAccount',categories:'updateCategory',envelopes:'updateEnvelope'}[collection];
    return h('details',{class:'card disclosure'},h('summary',{},t('edit')),notice('archiveHelp'),notice('immutableScope'),form(collection+'-edit-form',[field(t('name'),'name',input('name','text',target.name,{required:true,maxlength:'500'}))],values=>perform(type,{entityId:target.id,name:values.name},route)),action(target.archivedAtUtc?'unarchive':'archive',()=>perform('archiveEntity',{collection,entityId:target.id,archived:!target.archivedAtUtc},route),false,{id:'archive-entity'}));
  }
  const markExported=()=>setPrefs({lastExportAtUtc:clock().toISOString()});
  // Only a confirmed native save, or a browser download hand-off, counts as "last backup".
  async function download(text,filename,{backup=false}={}){if(onDownload){const result=await onDownload(text,filename);if(backup&&(result===true||result?.saved===true)){markExported();await render();}return;}const url=browser.URL.createObjectURL(new browser.Blob([text],{type:'application/json;charset=utf-8'})),anchor=h('a',{href:url,download:filename});document.body.append(anchor);anchor.click();anchor.remove();browser.setTimeout(()=>browser.URL.revokeObjectURL(url),1000);if(backup){markExported();await render();}feedback=t('downloadStarted');error=false;updateFeedback();}
  const exportBackup=async()=>download(await exportSnapshot(state),'cashweave-backup-'+today()+'.json',{backup:true});
  function backupStatus(){const last=prefs().lastExportAtUtc;if(!last||Number.isNaN(Date.parse(last)))return {days:null,stale:true};const days=Math.max(0,Math.floor((clock().getTime()-Date.parse(last))/86400000));return {days,stale:days>=7};}

  const c={h,field,input,select,button,table,icon,ui,browser,document,clock,formDrafts,setupDrafts,onReadBackup,
    get state(){return state;},get t(){return t;},get route(){return route;},get namespace(){return namespace;},get pending(){return !!pendingWrite;},get needsReadRecovery(){return needsReadRecovery;},get repo(){return repo;},
    fmt,fmtSigned,fill,today,currentMonth,monthEnd,shiftMonth,shortDate,weekday,dayLabel,monthLabel,daysBetween,memo,balance,report,title,notice,empty,card,actionRow,link,action,form,run,go,goBack,perform,render,refresh,filterSheet,rangeForm,chooseMonth,periodLabel,toMinor,decimalInput,descriptor,accountChoices,amountField,dateField,opLabel,scopedPostings,pendingPlans,sourceLabel,currentTemplate,download,exportBackup,backupStatus,prefs,setPrefs,amountsHidden,hasBook,hasIncompleteBook,submitSetup,managementControls,openNamespace,quickExpense,setFeedback,
    submitForm:(formId,values)=>{if(!formHandlers.has(formId))throw new Error('FORM_NOT_VISIBLE');return formHandlers.get(formId)(values);},
    setState(next){state=next;t=translator(state.profile.locale);ui.range.currencyCode=state.profile.defaultCurrencyCode;}};

  function navActive(key){const section=route.split('/')[0];if(key==='overview')return section==='overview';if(key==='transactions')return section==='transactions'&&route.split('/')[1]!=='new';if(key==='plans')return PLAN_SECTIONS.includes(section);return MORE_SECTIONS.includes(section);}
  function navLink(key,label,iconName){const active=navActive(key);return h('a',{href:'#'+key,class:'tab-item'+(active?' active':''),'aria-current':active?'page':null,'data-nav':key,onClick:run(()=>go(key))},icon(iconName),h('span',{},t(label)));}
  function bottomNav(){return h('nav',{class:'tab-bar','aria-label':t('mainNavigation')},navLink('overview','navHome','home'),navLink('transactions','navLedger','ledger'),h('a',{href:'#transactions/new/expense',id:'quick-expense',class:'tab-fab','data-nav':'add','aria-label':t('quickExpense'),onClick:run(quickExpense)},icon('add')),navLink('plans','navPlans','calendar'),navLink('more','navMore','more'));}
  function screenFor(parts){
    if(route==='start')return startScreen(c);
    if(route==='create')return hasIncompleteBook()?[notice('setupRecovery',true),action('returnStart',()=>go('start'))]:setupScreen(c);
    if(route==='data-review')return migrationScreen(c);
    if(route==='overview')return homeScreen(c);
    if(route==='transactions')return ledgerScreen(c);
    if(parts[0]==='transactions'&&parts[1]==='new')return quickAddScreen(c,parts[2]||'');
    if(parts[0]==='transactions')return transactionDetail(c,parts[1]);
    if(route==='accounts')return accountsScreen(c);
    if(parts[0]==='accounts'&&parts[1]==='new')return accountForm(c);
    if(parts[0]==='accounts')return parts[2]==='timeline'?timelineScreen(c,parts[1]):accountDetail(c,parts[1]);
    if(route==='categories')return categoriesScreen(c);
    if(parts[0]==='categories')return categoryDetail(c,parts[1]);
    if(parts[0]==='envelopes')return envelopeDetail(c,parts[1]);
    if(route==='forecast')return forecastScreen(c);
    if(route==='plans')return upcomingScreen(c);
    if(parts[0]==='plans'&&parts[1]==='new')return planForm(c);
    if(parts[0]==='plans')return planDetail(c,parts[1]);
    if(route==='funds')return fundsScreen(c);
    if(route==='recipes')return recipesScreen(c);
    if(parts[0]==='templates')return builderScreen(c,parts[1]==='new'?'':parts[1]);
    if(parts[0]==='allocations'&&parts[1]==='new')return allocationForm(c,parts[2],parts[3]);
    if(parts[0]==='allocations')return allocationDetail(c,parts[1]);
    if(route==='reports')return reportsScreen(c);
    if(parts[0]==='reports')return reportDetail(c,parts[1]);
    if(route==='assets')return assetsScreen(c);
    if(route==='assets/update')return priceUpdateScreen(c);
    if(route==='data')return dataScreen(c);
    if(route==='history')return historyScreen(c);
    if(route==='more')return moreScreen(c);
    if(route==='shared'){if(!sharedView)sharedView=createSharedView(document,browser);return [sharedView.element];}
    return helpScreen(c);
  }
  async function render(){
    if(!state)return;
    const restoreFilterFocus=!!activeFilterModal;
    formHandlers.clear();
    t=translator(state.profile.locale);document.documentElement?.setAttribute('lang',state.profile.locale.startsWith('en')?'en':'vi');
    if(hasBook()&&['start','create'].includes(route))route='overview';if(!hasBook()&&!emptyRoutes.has(route))route='start';
    const parts=route.split('/');let body;
    try{body=await screenFor(parts);}
    catch(cause){feedback=errorMessage(cause,t);error=true;body=[title('errorDetails'),actionRow(action('reload',refresh,true),action('back',()=>go('overview')))];}
    const book=hasBook(),top=TAB_ROUTES.has(route)||route==='start',fullScreen=route.startsWith('transactions/new'),showNav=book&&route!=='shared'&&!fullScreen;
    const bar=top?null:h('header',{class:'top-bar'},h('button',{type:'button',class:'back-button',onClick:run(goBack),disabled:!!pendingWrite&&route!=='create'},icon(fullScreen?'close':'back'),h('span',{},t(fullScreen?'close':'back'))),route==='shared'?h('strong',{class:'top-title'},t('sharedDemo')):fullScreen?h('h1',{class:'top-title sheet-title'},t('newTransaction')):null);
    const content=h('main',{id:'main-content',class:'shell'+(fullScreen?' full-screen':''),tabindex:'-1'},namespace==='sandbox'?h('div',{class:'sandbox'},t('sandbox')):null,h('div',{id:'feedback'}),body);
    releaseFilterModal();
    root.replaceChildren(...[h('div',{class:'app-column'+(showNav?' with-nav':'')},bar,content),showNav?bottomNav():null].filter(Boolean));updateFeedback();if(restoreFilterFocus)root.querySelector('summary')?.focus?.();
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
  const invalidatePreview=()=>{ui.allocationPreview=null;const confirm=document.getElementById('allocation-confirm');if(confirm)confirm.disabled=true;feedback=t('previewChanged');error=false;updateFeedback();};
  root.addEventListener('input',event=>{if(event.target?.closest?.('#allocation-form')&&ui.allocationPreview)invalidatePreview();});
  root.addEventListener('change',async event=>{if(event.target?.name==='operationType'&&event.target?.closest?.('#transaction-form')){const values=Object.fromEntries(new browser.FormData(document.getElementById('transaction-form')));values.categoryId='';formDrafts.set('transaction-form',values);await render();return;}if(event.target?.closest?.('#allocation-form')&&ui.allocationPreview)invalidatePreview();});
  browser?.addEventListener?.('hashchange',()=>{const next=resolveRoute(browser.location.hash);if(next!==route)return run(()=>go(next,{record:false,updateHash:false}))();});
  browser?.addEventListener?.('focus',()=>{if(state&&!pendingWrite)repo.readSnapshot().then(next=>{if(next.datasetId!==state.datasetId||next.revision!==state.revision){feedback=t('conflict');error=false;updateFeedback();}}).catch(fail);});
  const initialRoute=resolveRoute(browser?.location?.hash);
  await openNamespace(namespace);
  if(hasBook()&&browser?.location?.hash)await go(initialRoute);else if(!hasBook()&&['help','data','data-review'].includes(initialRoute))await go(initialRoute);
  return {go,goBack,dismissFilters,handleNativeBack:async()=>{if(pendingWrite||setupSubmission)return true;if(dismissFilters())return true;if(route==='overview'||route==='start')return false;await goBack();return true;},refresh,render,perform,snapshot:()=>structuredClone(state),currentRoute:()=>route,openNamespace,submit:async(formId,values)=>{if(!document.getElementById(formId)||!formHandlers.has(formId))throw new Error('FORM_NOT_VISIBLE');return formHandlers.get(formId)(values);},close(){releaseFilterModal();unsubscribe?.();repo?.close?.();}};
}

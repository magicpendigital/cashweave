import { EXPONENTS } from '../../core/money.js';
import { todayInTimezone } from '../../core/calendar.js';

// Screen 1 · Chào mừng. Three benefits, one primary path, restore and guide stay reachable.
export function startScreen(c){
  const {h,t,icon,action,link,notice,card,go,ui,setupDrafts,namespace,refresh}=c,draft=setupDrafts.get(namespace),blocked=c.hasIncompleteBook()||c.needsReadRecovery;
  const benefit=(iconName,tone,heading,body)=>h('li',{class:'benefit'},h('span',{class:'benefit-icon '+tone},icon(iconName)),h('div',{},h('strong',{},t(heading)),h('p',{},t(body))));
  return h('div',{class:'start-screen'},
    h('div',{class:'brand-row'},h('span',{class:'brand-mark','aria-hidden':'true'},icon('transfer')),h('strong',{},t('app'))),
    h('h1',{},t('welcome')),h('p',{class:'start-intro'},t('welcomeIntro')),
    h('ul',{class:'benefits'},benefit('cash','tone-green','benefitWhere','benefitWhereHelp'),benefit('calendar','tone-amber','benefitDue','benefitDueHelp'),benefit('lock','tone-blue','benefitPrivate','benefitPrivateHelp')),
    h('a',{href:'#help',id:'start-guide',class:'guide-card',onClick:c.run(()=>go('help'))},h('span',{class:'benefit-icon tone-blue'},icon('help')),h('span',{class:'grow'},h('strong',{},t('guideCardTitle')),h('span',{class:'row-meta'},t('guideCardBody'))),icon('chevron')),
    c.hasIncompleteBook()?notice('setupRecovery',true):null,c.needsReadRecovery?notice('savedStateUnknown',true):null,c.needsReadRecovery?action('reload',refresh,true):null,
    draft?card(h('p',{},t('setupDraftHelp')),action('resumeSetup',()=>go('create'))):null,
    ui.legacyRaw?notice('legacyWelcome'):null,
    h('div',{class:'start-actions'},action('beginCreate',()=>go('create'),true,{id:'start-create',class:'button primary wide',disabled:blocked||c.pending}),link('data',t('restoreEntry'),{class:'button wide'}),ui.legacyRaw?link('data-review',t('legacyEntry'),{class:'button wide'}):null));
}

// Screen 2 · Tạo sổ: one screen; currency, timezone and start date fold into an "Đổi" row.
export function setupScreen(c){
  const {h,t,field,input,select,icon,form,run,action,notice,go,today,clock,browser,document,setupDrafts,namespace}=c,state=c.state;
  const draft=setupDrafts.get(namespace)||{locale:'vi-VN',currencyCode:state.profile.defaultCurrencyCode,timezoneId:state.profile.timezoneId,customTimezoneId:'',name:t('defaultBankName'),accountType:'BANK',opening:'0',openingDate:today()},zones=[['Asia/Ho_Chi_Minh',t('vietnamTime')],['Etc/UTC',t('utcTime')]];
  if(!zones.some(([zone])=>zone===draft.timezoneId)&&draft.timezoneId!=='custom')zones.push([draft.timezoneId,draft.timezoneId]);zones.push(['custom',t('otherTimezone')]);
  const zoneOf=values=>values.timezoneId==='custom'?values.customTimezoneId:values.timezoneId;
  let setupToday=today();try{if(zoneOf(draft))setupToday=todayInTimezone(zoneOf(draft),clock());}catch{}
  const current=()=>Object.fromEntries(new browser.FormData(document.getElementById('onboard-form')));
  const updateSetupTimezone=run(async()=>{const values=current(),zone=zoneOf(values);setupDrafts.set(namespace,values);if(!zone)return;const nextToday=todayInTimezone(zone,clock());let previousToday=today();try{if(zoneOf(draft))previousToday=todayInTimezone(zoneOf(draft),clock());}catch{}if(values.openingDate===previousToday)values.openingDate=nextToday;setupDrafts.set(namespace,values);c.formDrafts.delete('onboard-form');await c.render();});
  const defaults={BANK:t('defaultBankName'),CASH:t('defaultCashName')};
  const pickType=type=>run(async()=>{const values=current();if(!values.name?.trim()||Object.values(defaults).includes(values.name))values.name=defaults[type];values.accountType=type;setupDrafts.set(namespace,values);c.formDrafts.delete('onboard-form');await c.render();});
  const currencyNames={VND:'Đồng Việt Nam',USD:'Đô la Mỹ',JPY:'Yên Nhật',KWD:'Dinar Kuwait',EUR:'Euro',GBP:'Bảng Anh',CAD:'Đô la Canada',AUD:'Đô la Úc'};
  const choice=(type,iconName,label)=>h('button',{type:'button',class:'choice'+(draft.accountType===type?' on':''),'aria-pressed':String(draft.accountType===type),'data-account-type':type,onClick:pickType(type)},icon(iconName),h('span',{},t(label)));
  const zoneName=(zones.find(([z])=>z===draft.timezoneId)||[,draft.customTimezoneId||draft.timezoneId])[1];
  return h('div',{class:'setup-screen'},h('h1',{},t('createBookTitle')),h('p',{class:'muted'},t('setupIntro')),c.needsReadRecovery?notice('savedStateUnknown',true):null,form('onboard-form',[
    h('p',{class:'question'},t('setupWhere')),h('div',{class:'choice-row',role:'group','aria-label':t('setupWhere')},choice('BANK','bank','bank'),choice('CASH','cash','cash')),input('accountType','hidden',draft.accountType),
    field(t('setupName'),'name',input('name','text',draft.name,{required:true,maxlength:'80',autocomplete:'off'})),
    h('div',{class:'field big-amount'},h('label',{for:'opening'},t('openingAsk')),h('div',{class:'amount-box'},input('opening','text',draft.opening,{required:true,inputmode:'decimal',autocomplete:'off'}),h('span',{class:'amount-unit'},draft.currencyCode)),h('small',{},t('setupOpeningHelp'))),
    h('details',{class:'setup-more'},h('summary',{},h('span',{},(currencyNames[draft.currencyCode]||draft.currencyCode)+' · '+zoneName),h('span',{class:'link-text'},t('setupChange'))),
      field(t('currency'),'currencyCode',select('currencyCode',Object.keys(EXPONENTS).map(code=>[code,code+' — '+currencyNames[code]]),draft.currencyCode),t('setupCurrencyHelp')),
      field(t('setupTimezoneLabel'),'timezoneId',select('timezoneId',zones,draft.timezoneId,{onChange:updateSetupTimezone}),t('setupTimezoneHelp')),
      field(t('customTimezone'),'customTimezoneId',input('customTimezoneId','text',draft.customTimezoneId||'',{placeholder:'Asia/Tokyo',onChange:updateSetupTimezone}),t('customTimezoneHelp')),
      field(t('date'),'openingDate',input('openingDate','date',draft.openingDate,{required:true,max:setupToday}),t('setupDateHelp'))),
    input('locale','hidden','vi-VN'),h('p',{class:'muted center'},t('setupCommitHelp'))
  ],c.submitSetup,'finishCreate',{wide:true}),h('div',{class:'actions center'},c.needsReadRecovery?action('reload',c.refresh,true):null,action('cancelSetup',()=>go('start'),false,{class:'button text-button'}),action('startGuide',()=>go('help'),false,{class:'button text-button'})));
}

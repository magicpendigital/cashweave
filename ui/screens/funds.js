import { minor, sum, EXPONENTS } from '../../core/money.js';
import { addDays } from '../../core/calendar.js';
import { entity, poolSummary, envelopeBalance, sourceCapacity } from '../../core/model.js';
import { previewAllocationV3, calculateAllocation } from '../../core/allocation.js';
import { queryReport } from '../../core/reports.js';
import { id } from '../../core/identity.js';
import { RECIPE_PRESETS } from '../features.js';
import { planTabs } from './plans.js';
import { overAllocatedCard } from './home.js';

const SEGMENTS=6;
const percentText=(bps,locale)=>(bps/100).toLocaleString(locale,{maximumFractionDigits:2});
function templateBlocked(state,version){return version.lines.some(line=>entity(state,'envelopes',line.envelopeId).archivedAtUtc)||version.leftoverPolicy==='ENVELOPE'&&entity(state,'envelopes',version.leftoverEnvelopeId).archivedAtUtc;}
function ruleText(c,line,version,index){const {t,fill,fmt}=c;return line.type==='FIXED'?fill(t('ruleFixed'),{amount:fmt(line.fixedAmountMinor,version.currencyCode),n:index+1}):fill(t('rulePercent'),{p:percentText(line.percentageBps,c.state.profile.locale)});}
function selectedReceiptCard(c){
  const {h,t,ui,action,notice,sourceLabel}=c,state=c.state;if(!ui.receiptSourceId)return null;
  const selected=entity(state,'fundingSources',ui.receiptSourceId);
  return h('section',{class:'card'},h('h2',{},t('selectedReceipt')),h('p',{class:'receipt-context'},sourceLabel(selected)),minor(sourceCapacity(state,selected.id).remaining)<=0n?notice('receiptUnavailable',true):notice('compatibleTemplates'),action('chooseOtherSources',async()=>{ui.receiptSourceId='';ui.allocationPreview=null;c.formDrafts.delete('allocation-form');await c.render();}));
}
function envelopeForm(c){const {t,form,field,input,ui,perform}=c,state=c.state,pool=state.budgetPools.find(p=>p.currencyCode===ui.range.currencyCode);return pool?form('envelope-form',[field(t('envelopeName'),'name',input('name','text','',{required:true,maxlength:'80'}))],values=>perform('addEnvelope',{name:values.name,budgetPoolId:pool.id},c.route),'newEnvelope'):null;}

// Screen 7 · Kế hoạch › Hũ.
export async function fundsScreen(c){
  const {h,t,fmt,fill,ui,link,action,go,today,memo,currentMonth,icon,run}=c,state=c.state,currency=ui.range.currencyCode,end=addDays(today(),1),month=currentMonth();
  const pool=state.budgetPools.find(p=>p.currencyCode===currency),unassigned=pool?memo('unassigned:'+pool.id,()=>poolSummary(state,pool.id,end).unassigned):'0';
  const template=c.currentTemplate(currency),version=template?entity(state,'templateVersions',template.currentVersionId):null;
  const fixedTargets=new Map((version?.lines||[]).filter(l=>l.type==='FIXED').map(l=>[l.envelopeId,l.fixedAmountMinor]));
  const envelopes=state.envelopes.filter(e=>e.currencyCode===currency).sort((a,b)=>(a.archivedAtUtc?1:0)-(b.archivedAtUtc?1:0));
  const monthOf=app=>app.allocationEffectiveLocalDate.slice(0,7)===month;
  const cards=envelopes.map((e,i)=>{
    const available=memo('envelope:'+e.id,()=>envelopeBalance(state,e.id,end));
    const allocated=sum(state.allocationEntries.filter(entry=>entry.envelopeId===e.id&&monthOf(entity(state,'allocationApplications',entry.applicationId))).map(entry=>entry.signedAmountMinor));
    const spent=sum(state.spendLinks.filter(l=>l.envelopeId===e.id&&l.effectiveLocalDate.slice(0,7)===month).map(l=>l.signedAmountMinor));
    const target=fixedTargets.get(e.id),base=minor(target||allocated),pct=base>0n?Math.max(0,Math.min(100,Number(minor(available)*100n/base))):minor(available)>0n?100:0;
    return link('envelopes/'+e.id,[h('span',{class:'fund-head'},h('strong',{},e.name+(e.archivedAtUtc?' · '+t('archived'):'')),h('span',{class:'num'},fmt(available,currency))),h('span',{class:'bar'},h('span',{class:'seg-'+(i%SEGMENTS),style:'width:'+pct+'%'})),h('small',{class:'muted'},target?fill(t('envelopeTarget'),{amount:fmt(target,currency)})+' · ':'',fill(t('envelopeMonthNote'),{allocated:fmt(allocated,currency),spent:fmt(spent,currency)}))],{class:'card fund-card','data-envelope':e.id});
  });
  const applications=[...state.allocationApplications].sort((a,b)=>b.revision-a.revision).slice(0,10);
  return [...planTabs(c,'funds'),h('p',{class:'muted'},t('fundsIntro')),selectedReceiptCard(c),
    minor(unassigned)<0n?overAllocatedCard(c,unassigned,currency):h('section',{class:'hero-mini'},h('span',{},h('small',{},t('unassigned')),h('strong',{class:'num','data-amount':'unassigned'},fmt(unassigned,currency))),minor(unassigned)>0n?action('allocate',()=>go('allocate'),false,{class:'button light-button'}):h('small',{class:'hero-note'},t('nothingToAllocate'))),
    link('recipes',[icon('recipe'),h('span',{class:'grow'},h('span',{class:'muted'},t('methodLabel')+' '),h('strong',{},template?template.name:t('noMethod'))),h('span',{class:'link-text'},t('change'))],{class:'card method-row'}),
    cards.length?cards:h('div',{class:'empty'},t('noEnvelopes')),
    h('details',{class:'card disclosure',open:!envelopes.length||!!c.formDrafts.get('envelope-form')},h('summary',{},t('newEnvelope')),envelopeForm(c)),
    pool?c.action('viewContributions',async()=>{ui.range={...ui.range,from:month+'-01',through:today(),accountId:''};ui.activeReport=null;await go('reports/Unassigned');},false,{class:'button text-button'}):null,
    applications.length?[h('h2',{class:'group-title'},t('allocationHistory')),h('section',{class:'card list-card'},applications.map(a=>{const name=state.templates.find(tp=>tp.id===a.templateId)?.name||t('allocate'),total=sum(state.allocationEntries.filter(e=>e.applicationId===a.id&&e.envelopeId).map(e=>e.signedAmountMinor));return h('a',{href:'#allocations/'+a.id,class:'ledger-row',onClick:run(()=>go('allocations/'+a.id))},h('div',{class:'row-main'},h('p',{class:'row-title'},name),h('p',{class:'row-meta'},c.shortDate(a.allocationEffectiveLocalDate)+(a.reversalOfApplicationId?' · '+t('reversal'):''))),h('span',{class:'row-amount num'},fmt(total,a.currencyCode)));}))]:null];
}

function allocationRequest(c,versionId,groupId,values){const {ui,toMinor}=c,state=c.state;if(ui.receiptSourceId&&values.sourceId!==ui.receiptSourceId)throw new Error('PREVIEW_STALE');const version=entity(state,'templateVersions',versionId),pool=state.budgetPools.find(p=>p.currencyCode===version.currencyCode);return {templateVersionId:versionId,budgetPoolId:pool.id,sourceIds:values.sourceId==='all'?state.fundingSources.filter(s=>s.budgetPoolId===pool.id&&minor(sourceCapacity(state,s.id).remaining)>0n).map(s=>s.id):[values.sourceId],requestedAmountMinor:toMinor(values.amount,version.currencyCode),allocationEffectiveLocalDate:values.date,...(groupId?{applicationGroupId:groupId}:{})};}
// Screen 8 · Chia vào hũ: choose amount, see each hũ's share, confirm. Preview stays mandatory.
export function allocationForm(c,versionId,groupId=''){
  const {h,t,fmt,fill,ui,form,field,select,amountField,dateField,action,link,notice,today,go,perform,decimalInput,sourceLabel,browser,document,button,run}=c,state=c.state;
  const version=entity(state,'templateVersions',versionId),template=entity(state,'templates',version.templateId);
  if(templateBlocked(state,version))throw new Error('TEMPLATE_ENVELOPE_ARCHIVED');
  if(ui.receiptSourceId){const selected=entity(state,'fundingSources',ui.receiptSourceId);if(entity(state,'postings',selected.sourcePostingId).currencyCode!==version.currencyCode||minor(sourceCapacity(state,selected.id).remaining)<=0n)return [c.title('allocate'),notice('receiptUnavailable',true),h('p',{class:'receipt-context'},sourceLabel(selected)),c.actionRow(action('back',()=>go('recipes')),action('chooseOtherSources',async()=>{ui.receiptSourceId='';await c.render();}))];}
  ui.range.currencyCode=version.currencyCode;
  const currency=version.currencyCode,pool=state.budgetPools.find(p=>p.currencyCode===currency),sources=state.fundingSources.filter(s=>s.budgetPoolId===pool.id&&minor(sourceCapacity(state,s.id).remaining)>0n),preview=ui.allocationPreview,draft=preview?.input;
  const unassigned=poolSummary(state,pool.id).unassigned,locked=ui.receiptSourceId&&sources.some(s=>s.id===ui.receiptSourceId);
  const capacity=locked?sourceCapacity(state,ui.receiptSourceId).remaining:sum(sources.map(s=>sourceCapacity(state,s.id).remaining)),max=minor(capacity)<minor(unassigned)?minor(capacity):minor(unassigned);
  const lines=[...version.lines].sort((a,b)=>a.priority-b.priority),name=id=>entity(state,'envelopes',id).name;
  const choose=amount=>run(async()=>{const values=Object.fromEntries(new browser.FormData(document.getElementById('allocation-form')));values.amount=decimalInput(amount,currency);document.getElementById('allocation-form-amount').value=values.amount;await c.submitForm('allocation-form',values);});
  const chips=max>0n?[[max,'allOf'],...(max>1n?[[max/2n,'halfOf']]:[])].map(([amount,label])=>h('button',{type:'button',class:'chip'+(draft&&minor(draft.requestedAmountMinor)===amount?' on':''),'data-amount-choice':label,onClick:choose(amount.toString())},fill(t(label),{amount:fmt(amount.toString(),currency)}))):[];
  const results=preview?new Map(preview.result.lines.map(l=>[l.stableLineKey,l])):null;
  const lineRows=lines.map((line,i)=>h('div',{class:'line-row'},h('div',{class:'row-main'},h('p',{class:'row-title'},name(line.envelopeId)),h('p',{class:'row-meta'},ruleText(c,line,version,i))),h('span',{class:'row-amount num'+(results&&minor(results.get(line.stableLineKey)?.amountMinor||'0')===0n?' warn-text':'')},results?fmt(results.get(line.stableLineKey)?.amountMinor||'0',currency):'—')));
  const leftoverLine=preview?.result.lines.find(l=>l.type==='LEFTOVER');
  const previewNode=preview?h('div',{id:'allocation-preview'},h('h2',{class:'sr-heading'},t('proposed')),h('section',{class:'card list-card'},lineRows,leftoverLine?h('div',{class:'line-row'},h('div',{class:'row-main'},h('p',{class:'row-title'},name(leftoverLine.envelopeId)),h('p',{class:'row-meta'},t('leftoverShare'))),h('span',{class:'row-amount num'},fmt(leftoverLine.amountMinor,currency))):null),
    version.leftoverPolicy==='UNASSIGNED'?h('div',{class:'summary-pill'},h('span',{},t('leftover')),h('strong',{class:'num'},fmt(preview.result.leftoverMinor,currency))):null,
    minor(preview.result.shortageMinor)>0n?h('p',{class:'notice warning'},t('shortageWarn')):null,
    h('details',{class:'disclosure plain'},h('summary',{},t('calcDetails')),h('p',{},t('proposalOnly')),h('div',{class:'receipt-context'},preview.input.sourceIds.map(sourceId=>h('p',{},sourceLabel(entity(state,'fundingSources',sourceId))))),...['fixedGranted','remainderBase','shortage','leftover','consumption'].map((key,index)=>h('div',{class:'summary-line'},t(key),h('strong',{},fmt([preview.result.fixedGrantedMinor,preview.result.remainderMinor,preview.result.shortageMinor,preview.result.leftoverMinor,preview.result.consumptionMinor][index],currency))))),
    h('p',{class:'muted center'},t('splitNote')),
    preview.result.allowed?action('confirmSplit',async()=>{if(!ui.allocationPreview)throw new Error('PREVIEW_STALE');const values=Object.fromEntries(new browser.FormData(document.getElementById('allocation-form'))),request=allocationRequest(c,versionId,groupId,values);const receipt=await perform('confirmAllocation',{...request,previewHash:ui.allocationPreview.previewHash});await go('allocations/'+receipt.resultIds[0]);},true,{id:'allocation-confirm',class:'button primary wide'}):notice('block',true)):h('div',{id:'allocation-preview'});
  return [c.title('allocate'),
    h('section',{class:'card'},h('p',{class:'muted'},t('fromReceipt')),locked?h('p',{class:'receipt-context'},sourceLabel(entity(state,'fundingSources',ui.receiptSourceId))):null,h('p',{class:'muted'},t('unassigned')+': '+fmt(unassigned,currency)),
      sources.length?form('allocation-form',[field(t('fundingSource'),'sourceId',select('sourceId',ui.receiptSourceId?sources.filter(s=>s.id===ui.receiptSourceId).map(s=>[s.id,sourceLabel(s)]):[['all',t('allEligibleSources')],...sources.map(s=>[s.id,sourceLabel(s)])],draft?.sourceIds?.length===1?draft.sourceIds[0]:locked?ui.receiptSourceId:'all',{required:true})),h('p',{class:'question'},t('howMuch')),h('div',{class:'chip-row'},chips),amountField('amount',draft?decimalInput(draft.requestedAmountMinor,currency):''),dateField('date',draft?.allocationEffectiveLocalDate||today(),'allocationDate')],async values=>{const request=allocationRequest(c,versionId,groupId,values);ui.allocationPreview=await previewAllocationV3(state,request);c.setFeedback('');await c.render();},'preview'):notice('noSources',true)),
    h('div',{class:'section-heading'},h('h2',{},fill(t('methodName'),{name:template.name})),h('span',{class:'link-pair'},link('recipes',t('change'),{class:'text-link'}),link('templates/'+template.id+'/edit',t('editTemplate'),{class:'text-link'}))),
    h('p',{class:'muted'},t(version.fixedScope==='CALENDAR_MONTH'?'monthlyHelp':'perAppHelp')),
    preview?null:h('section',{class:'card list-card'},lineRows),
    previewNode,
    button(t('later'),run(()=>c.goBack()),false,{class:'button text-button wide'})];
}
export function allocationDetail(c,applicationId){
  const {h,t,fmt,action,form,input,dateField,table,card,notice,perform,go,title}=c,state=c.state;
  const application=entity(state,'allocationApplications',applicationId),entries=state.allocationEntries.filter(e=>e.applicationId===applicationId),reversed=state.allocationApplications.some(a=>a.reversalOfApplicationId===applicationId),open=!reversed&&!application.reversalOfApplicationId;
  return [title('applications'),notice('allocationSaved'),card(h('p',{class:'muted'},c.dayLabel(application.allocationEffectiveLocalDate)+' · '+(state.templates.find(tp=>tp.id===application.templateId)?.name||'')),table([t('envelope'),t('amount')],entries.map(e=>[e.envelopeId?entity(state,'envelopes',e.envelopeId).name:t('unassigned'),fmt(e.signedAmountMinor,application.currencyCode)])),open?h('div',{class:'actions'},action('continueApplication',()=>go('allocations/new/'+application.templateVersionSnapshotId+'/'+application.applicationGroupId))):null),
    open?h('details',{class:'card disclosure'},h('summary',{},t('undoAllocation')),form('undo-allocation-form',[h('p',{class:'muted'},t('allocationHelp')),dateField(),h('label',{class:'checkbox'},input('acknowledgeDeficit','checkbox','yes'),t('deficitAck'))],values=>perform('reverseAllocation',{applicationId,effectiveLocalDate:values.date,acknowledgeDeficit:values.acknowledgeDeficit==='yes'},'funds'),'undoAllocation')):null];
}
export async function envelopeDetail(c,envelopeId){
  const {h,t,fmt,ui,rangeForm,action,card,notice,go,descriptor,title}=c,state=c.state,r=ui.range;
  const e=entity(state,'envelopes',envelopeId),d=descriptor('EnvelopeAvailable',{currencyCode:e.currencyCode,budgetPoolId:e.budgetPoolId,accountIds:[],envelopeIds:[e.id]}),result=await queryReport(state,d),movement=(minor(envelopeBalance(state,e.id,addDays(r.through,1)))-minor(envelopeBalance(state,e.id,r.from))).toString();
  const allocated=state.allocationEntries.filter(entry=>entry.envelopeId===e.id&&entity(state,'allocationApplications',entry.applicationId).allocationEffectiveLocalDate>=r.from&&entity(state,'allocationApplications',entry.applicationId).allocationEffectiveLocalDate<=r.through).reduce((n,entry)=>n+minor(entry.signedAmountMinor),0n).toString(),spent=state.spendLinks.filter(entry=>entry.envelopeId===e.id&&entry.effectiveLocalDate>=r.from&&entry.effectiveLocalDate<=r.through).reduce((n,entry)=>n+minor(entry.signedAmountMinor),0n).toString();
  return [title('envelope'),card(h('h2',{},e.name),h('p',{class:'muted'},e.currencyCode+' · '+t('poolScope')),rangeForm({datesOnly:true}),...[[t('openingBefore'),envelopeBalance(state,e.id,r.from)],[t('allocated'),allocated],[t('spentFromEnvelope'),spent],[t('periodMovement'),movement],[t('envelopeAvailable'),result.totalMinor]].map(([label,value])=>h('div',{class:'summary-line'},label,h('strong',{},fmt(value,e.currencyCode)))),action('viewContributions',async()=>{ui.activeReport=result.descriptor;await go('reports/EnvelopeAvailable');},true)),notice('allocationHelp'),c.managementControls('envelopes',e)];
}

// Screen 11 · Phương pháp chia tiền: library presets (core) + the user's own methods.
export function recipesScreen(c){
  const {h,t,fmt,fill,ui,action,link,notice,perform,go,run}=c,state=c.state,currency=ui.range.currencyCode,locale=state.profile.locale;
  const flash=ui.flash;ui.flash='';
  const presets=Array.isArray(RECIPE_PRESETS)?RECIPE_PRESETS:[],pool=state.budgetPools.find(p=>p.currencyCode===currency),current=c.currentTemplate(currency);
  const selected=ui.receiptSourceId?entity(state,'fundingSources',ui.receiptSourceId):null,selectedCurrency=selected?entity(state,'postings',selected.sourcePostingId).currencyCode:'';
  const presetLines=p=>{const weights=p.lines.map(l=>l.type==='PERCENT'?Number(l.value):0),fixedCount=p.lines.filter(l=>l.type==='FIXED').length,total=weights.reduce((n,w)=>n+w,0)||1;return p.lines.map((l,i)=>({name:l.envelopeName,label:l.type==='PERCENT'?percentText(Number(l.value),locale)+'%':minor(String(l.value))>0n?fmt(String(l.value),currency):t('leftoverShare'),width:l.type==='PERCENT'?Math.max(4,Math.round(weights[i]/total*100)):Math.max(4,Math.round(100/(fixedCount||1))),seg:i%SEGMENTS}));};
  const applyPreset=preset=>async()=>{if(!pool)throw new Error('FEATURE_UNAVAILABLE');const existing=state.templates.find(tp=>!tp.archivedAtUtc&&state.templateVersions.some(v=>v.templateId===tp.id&&v.presetId===preset.id&&v.currencyCode===currency));const receipt=await perform('applyRecipePreset',{presetId:preset.id,budgetPoolId:pool.id,...(existing?{templateId:existing.id}:{})});ui.templateDraft=null;await go(receipt?.resultIds?.[0]?'templates/'+receipt.resultIds[0]+'/edit':'funds');};
  const presetCards=presets.map(p=>{const open=ui.openPreset===p.id,lines=presetLines(p);return h('div',{class:'preset'+(open?' on':'')},h('button',{type:'button',class:'preset-head','aria-expanded':String(open),'data-preset':p.id,onClick:run(async()=>{ui.openPreset=open?'':p.id;await c.render();})},h('strong',{},p.name),h('span',{class:'muted'},p.summary),h('span',{class:'stack-bar','aria-hidden':'true'},lines.map(l=>h('span',{class:'seg-'+l.seg,style:'width:'+l.width+'%'})))),
    open?h('div',{class:'preset-body'},h('ul',{class:'legend'},lines.map(l=>h('li',{},h('span',{class:'swatch seg-'+l.seg}),h('span',{class:'grow'},l.name),h('strong',{class:'num'},l.label)))),p.suitedFor?h('p',{class:'muted'},t('suitedFor')+': '+p.suitedFor):null,c.button(fill(t('useAndEdit'),{name:p.name}),run(applyPreset(p)),true,{class:'button primary wide','data-apply-preset':p.id,disabled:c.pending})):null);});
  const mine=state.templates.filter(tp=>!tp.archivedAtUtc).map(template=>{const version=entity(state,'templateVersions',template.currentVersionId),isCurrent=current?.id===template.id;
    return h('section',{class:'card method-card'+(isCurrent?' on':''),'data-template':template.id},h('div',{class:'fund-head'},h('strong',{},template.name),isCurrent?h('span',{class:'tag tag-green'},t('inUse')):null),h('p',{class:'muted'},version.lines.map((l,i)=>entity(state,'envelopes',l.envelopeId).name+' '+(l.type==='FIXED'?fmt(l.fixedAmountMinor,version.currencyCode):percentText(l.percentageBps,locale)+'%')).join(' · ')+' · '+version.currencyCode),
      h('div',{class:'actions'},action('useTemplate',()=>{if(templateBlocked(state,version))throw new Error('TEMPLATE_ENVELOPE_ARCHIVED');if(version.migrationNeedsEnvelopeMapping)throw new Error('MIGRATION_MAPPING_REQUIRED');return go('allocations/new/'+version.id);},true,{disabled:c.pending||!!selected&&(selectedCurrency!==version.currencyCode||minor(sourceCapacity(state,selected.id).remaining)<=0n)}),action('editTemplate',()=>{ui.templateDraft=null;return go('templates/'+template.id+'/edit');})));});
  return [c.title('templates'),flash?notice(flash,true):null,h('p',{class:'muted'},t('recipesIntro')),selectedReceiptCard(c),
    presets.length?presetCards:notice('presetsUnavailable'),
    mine.length?[h('h2',{class:'group-title'},t('yourMethods')),mine]:null,
    link('templates/new',[c.icon('add'),h('span',{},t('createOwn'))],{class:'button dashed wide'}),
    h('p',{class:'muted center small'},t('notAdvice'))];
}

const blankLine=(c,currency)=>({stableLineKey:id(),envelopeId:c.state.envelopes.find(e=>e.currencyCode===currency&&!e.archivedAtUtc)?.id||'',type:'PERCENT',value:'10'});
function readTemplateFields(c,values){return {name:values.name,scope:values.fixedScope,shortagePolicy:values.shortagePolicy,leftoverPolicy:values.leftoverPolicy,leftoverEnvelopeId:values.leftoverEnvelopeId,lines:c.ui.templateDraft.lines.map((line,index)=>({...line,envelopeId:values['envelope-'+index],type:values['kind-'+index],value:values['value-'+index]}))};}
// Screen 12 · Tự tạo phương pháp: fixed amounts first, then % of the remainder; live example split.
export function builderScreen(c,templateId=''){
  const {h,t,fmt,fill,ui,form,field,input,select,action,button,run,perform,toMinor,decimalInput,notice,browser,document}=c,state=c.state,locale=state.profile.locale;
  if(!ui.templateDraft){const template=templateId?entity(state,'templates',templateId):null,version=template?entity(state,'templateVersions',template.currentVersionId):null;if(version?.migrationNeedsEnvelopeMapping)throw new Error('MIGRATION_MAPPING_REQUIRED');if(version)ui.range.currencyCode=version.currencyCode;ui.templateDraft={name:template?.name||'',scope:version?.fixedScope||'CALENDAR_MONTH',shortagePolicy:version?.shortagePolicy||'PARTIAL_BY_PRIORITY',leftoverPolicy:version?.leftoverPolicy||'UNASSIGNED',leftoverEnvelopeId:version?.leftoverEnvelopeId||'',lines:version?[...version.lines].sort((a,b)=>a.priority-b.priority).map(line=>({...line,value:line.type==='FIXED'?decimalInput(line.fixedAmountMinor,version.currencyCode):percentText(line.percentageBps,locale)})):[blankLine(c,ui.range.currencyCode)]};}
  const currency=ui.range.currencyCode,draft=ui.templateDraft,choices=state.envelopes.filter(e=>e.currencyCode===currency&&!e.archivedAtUtc).map(e=>[e.id,e.name]);
  const fixedStep=10n**BigInt(EXPONENTS[currency]||0)*(EXPONENTS[currency]?10n:500000n);
  const parse=(line)=>{try{return line.type==='FIXED'?{fixedAmountMinor:toMinor(line.value,currency)}:{percentageBps:Number(toMinor(line.value,'USD'))};}catch{return null;}};
  const current=()=>readTemplateFields(c,Object.fromEntries(new browser.FormData(document.getElementById('template-form'))));
  const update=fn=>run(async()=>{ui.templateDraft=current();fn(ui.templateDraft);await c.render();});
  const step=(index,direction)=>update(d=>{const line=d.lines[index],parsed=parse(line)||(line.type==='FIXED'?{fixedAmountMinor:'0'}:{percentageBps:0});if(line.type==='FIXED'){const next=minor(parsed.fixedAmountMinor)+BigInt(direction)*fixedStep;line.value=decimalInput((next<0n?0n:next).toString(),currency);}else{const next=Math.max(0,Math.min(10000,parsed.percentageBps+direction*500));line.value=percentText(next,locale);}});
  const toggle=index=>update(d=>{const line=d.lines[index];if(line.type==='FIXED'){line.type='PERCENT';line.value='10';}else{line.type='FIXED';line.value=decimalInput(fixedStep.toString(),currency);}});
  const latestIncome=[...state.postings].filter(p=>p.currencyCode===currency&&p.reportingOrigin==='INCOME'&&minor(p.signedAmountMinor)>0n&&!p.reversesPostingId).sort((a,b)=>b.effectiveLocalDate.localeCompare(a.effectiveLocalDate))[0];
  const sample=latestIncome?latestIncome.signedAmountMinor:(10n**BigInt(EXPONENTS[currency]||0)*(EXPONENTS[currency]?1000n:10000000n)).toString();
  const parsedLines=draft.lines.map((line,index)=>({line,parsed:parse(line),index}));
  const bps=parsedLines.reduce((n,l)=>n+(l.line.type==='PERCENT'&&l.parsed?l.parsed.percentageBps:0),0);
  let example=null;try{const usable=parsedLines.filter(l=>l.parsed&&l.line.envelopeId).map(l=>({stableLineKey:l.line.stableLineKey,envelopeId:l.line.envelopeId,type:l.line.type,priority:l.index,...l.parsed}));if(usable.length&&bps<=10000)example=calculateAllocation(sample,usable,{shortagePolicy:'PARTIAL_BY_PRIORITY',leftoverPolicy:draft.leftoverPolicy==='ENVELOPE'&&draft.leftoverEnvelopeId?'ENVELOPE':'UNASSIGNED',leftoverEnvelopeId:draft.leftoverEnvelopeId});}catch{example=null;}
  const amountFor=key=>example?.lines.find(l=>l.stableLineKey===key)?.amountMinor||'0',name=envelopeId=>state.envelopes.find(e=>e.id===envelopeId)?.name||'—';
  const share=amount=>{const whole=minor(sample);return whole>0n?Math.max(2,Number(minor(amount)*100n/whole)):0;};
  const fields=[field(t('methodNameLabel'),'name',input('name','text',draft.name,{required:true,maxlength:'120'})),
    h('div',{class:'builder-status'},h('span',{class:'stack-bar','aria-hidden':'true'},draft.lines.map((line,i)=>h('span',{class:'seg-'+(i%SEGMENTS),style:'width:'+share(amountFor(line.stableLineKey))+'%'}))),h('p',{class:bps>10000?'error-text':'muted','data-percent-status':String(bps)},fill(t(bps>10000?'percentOver':'percentUsed'),{p:percentText(bps,locale)}))),
    h('section',{class:'card list-card'},draft.lines.map((line,index)=>h('div',{class:'builder-line','data-line':String(index)},
      h('div',{class:'row-main'},h('span',{class:'swatch seg-'+(index%SEGMENTS)}),field(t('envelope'),'envelope-'+index,select('envelope-'+index,choices,line.envelopeId,{required:true})),input('kind-'+index,'hidden',line.type),button(t(line.type==='FIXED'?'fixed':'percent'),toggle(index),false,{class:'kind-toggle '+(line.type==='FIXED'?'kind-fixed':'kind-percent'),'data-kind-toggle':String(index)})),
      h('div',{class:'stepper'},button('−',step(index,-1),false,{class:'step','data-step':index+':down','aria-label':t('decrease')+' '+name(line.envelopeId)}),h('label',{for:'value-'+index,class:'sr-only'},t('amount')),input('value-'+index,'text',line.value,{required:true,inputmode:'decimal',autocomplete:'off'}),button('+',step(index,1),false,{class:'step','data-step':index+':up','aria-label':t('increase')+' '+name(line.envelopeId)})),
      button(t('remove'),update(d=>{if(d.lines.length>1)d.lines.splice(index,1);}),false,{class:'button text-button'})))),
    draft.lines.length<12?button('+ '+t('addRule'),update(d=>{if(d.lines.length<12)d.lines.push(blankLine(c,currency));}),false,{class:'button text-button','data-add-line':'true'}):h('p',{class:'muted'},t('lineLimit')),
    example?h('div',{class:'example'},h('p',{class:'muted'},fill(t('ifReceive'),{amount:fmt(sample,currency)})),example.lines.map(l=>h('p',{class:'summary-line'},h('span',{},name(l.envelopeId)),h('strong',{class:'num'},fmt(l.amountMinor,currency)))),draft.leftoverPolicy!=='ENVELOPE'?h('p',{class:'summary-line'},h('span',{},t('freeLeftover')),h('strong',{class:'num'},fmt(example.leftoverMinor,currency))):null):null,
    h('details',{class:'disclosure plain'},h('summary',{},t('advancedOptions')),field(t('fixedScope'),'fixedScope',select('fixedScope',[['CALENDAR_MONTH',t('calendarMonth')],['PER_APPLICATION',t('perApplication')]],draft.scope)),field(t('shortagePolicy'),'shortagePolicy',select('shortagePolicy',[['PARTIAL_BY_PRIORITY',t('partialPriority')],['BLOCK',t('block')]],draft.shortagePolicy)),field(t('leftoverPolicy'),'leftoverPolicy',select('leftoverPolicy',[['UNASSIGNED',t('unassignedLeftover')],['ENVELOPE',t('leftoverEnvelope')]],draft.leftoverPolicy)),field(t('envelope'),'leftoverEnvelopeId',select('leftoverEnvelopeId',[['','—'],...choices],draft.leftoverEnvelopeId)))];
  return [c.title(templateId?'builderTitle':'newTemplate'),h('p',{class:'muted'},t('savedNoActual')),
    form('template-form',fields,async values=>{const currentDraft=readTemplateFields(c,values),lines=currentDraft.lines.map((line,index)=>({stableLineKey:line.stableLineKey,envelopeId:line.envelopeId,type:line.type,priority:index,...(line.type==='FIXED'?{fixedAmountMinor:toMinor(line.value)}:{percentageBps:Number(toMinor(line.value,'USD'))})}));if(lines.filter(l=>l.type==='PERCENT').reduce((n,l)=>n+l.percentageBps,0)>10000)throw new Error('PERCENT_OVER_100');await perform('saveTemplate',{...(templateId?{templateId}:{}),name:currentDraft.name,currencyCode:currency,fixedScope:currentDraft.scope,shortagePolicy:currentDraft.shortagePolicy,leftoverPolicy:currentDraft.leftoverPolicy,leftoverEnvelopeId:currentDraft.leftoverEnvelopeId,lines},'funds');ui.templateDraft=null;},'saveMethod',{wide:true,stickySubmit:true}),
    h('details',{class:'card disclosure',open:!choices.length},h('summary',{},t('newEnvelope')),envelopeForm(c))];
}

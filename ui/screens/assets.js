import { minor, sum, parseMoney } from '../../core/money.js';
import { coreNetWorth, FEATURES } from '../features.js';

const GROUP_ORDER=['BANK','CASH','E_WALLET','INVESTMENT'];
const GROUP_LABEL={BANK:'bankType',CASH:'cashType',E_WALLET:'eWalletType',INVESTMENT:'investmentType'};
const latestValuation=(state,accountId,date)=>(state.valuations||[]).filter(v=>v.accountId===accountId&&v.date<=date).sort((a,b)=>b.date.localeCompare(a.date)||(b.revision||0)-(a.revision||0))[0]||null;

// Net worth in one currency. Uses the core report when this build has it; otherwise the same rule
// from plan 4.2 over existing data: ledger balances, plus the latest manual valuation for investments.
export function netWorthOf(c,currency=c.state.profile.defaultCurrencyCode){
  const state=c.state,date=c.today();
  return c.memo('networth:'+currency,()=>{
    const accounts=state.accounts.filter(a=>a.currencyCode===currency);
    let rows;
    if(coreNetWorth){const result=coreNetWorth(state,{date,staleDays:7,currencyCode:currency});rows=result.accounts.filter(r=>accounts.some(a=>a.id===r.accountId)).map(r=>({...r}));}
    else rows=accounts.map(a=>{const valuation=a.type==='INVESTMENT'?latestValuation(state,a.id,date):null;return {accountId:a.id,valueMinor:valuation?valuation.valueMinor:c.balance(a.id),valuedAt:valuation?.date||null,stale:!!valuation&&c.daysBetween(valuation.date,date)>7};});
    const typeOf=id=>accounts.find(a=>a.id===id)?.type||'BANK';
    const spendableIds=new Set(accounts.filter(a=>a.includeInBudget!==false&&a.type!=='INVESTMENT').map(a=>a.id));
    const groups=GROUP_ORDER.map(type=>({type,totalMinor:sum(rows.filter(r=>typeOf(r.accountId)===type).map(r=>r.valueMinor))})).filter(g=>rows.some(r=>typeOf(r.accountId)===g.type));
    return {totalMinor:sum(rows.map(r=>r.valueMinor)),spendableMinor:sum(rows.filter(r=>spendableIds.has(r.accountId)).map(r=>r.valueMinor)),spendableIds,groups,accounts:rows};
  });
}
const share=(part,total)=>{const whole=minor(total);if(whole<=0n)return 0;const value=minor(part);return value<=0n?0:Number(value*1000n/whole)/10;};

// Screen 13 · Tổng tài sản.
export function assetsScreen(c){
  const {h,t,fmt,fill,link,go,run,icon,today,daysBetween,title}=c,state=c.state,currency=state.profile.defaultCurrencyCode,worth=netWorthOf(c,currency);
  const positive=sum(worth.groups.map(g=>minor(g.totalMinor)>0n?g.totalMinor:'0'));
  const investments=state.accounts.filter(a=>a.type==='INVESTMENT'&&!a.archivedAtUtc);
  const meta=(account,row)=>account.type!=='INVESTMENT'?(worth.spendableIds.has(account.id)?t('spendableMeta')+' · ':'')+t(GROUP_LABEL[account.type]||'account'):!row.valuedAt?t('notValued'):row.stale?fill(t('staleValue'),{n:daysBetween(row.valuedAt,today())}):row.valuedAt===today()?t('valuedToday'):fill(t('valuedDaysAgo'),{n:daysBetween(row.valuedAt,today())});
  return [title('netWorthTitle'),
    h('section',{class:'card'},h('p',{class:'muted'},t('netWorth')),h('p',{class:'big-number num','data-amount':'networth'},fmt(worth.totalMinor,currency)),
      h('div',{class:'stack-bar','aria-hidden':'true'},worth.groups.map((g,i)=>h('span',{class:'seg-'+i,style:'width:'+Math.max(2,share(g.totalMinor,positive))+'%'}))),
      h('ul',{class:'legend'},worth.groups.map((g,i)=>h('li',{},h('span',{class:'swatch seg-'+i}),h('span',{class:'grow'},t(GROUP_LABEL[g.type])),h('strong',{class:'num'},share(g.totalMinor,positive).toLocaleString(state.profile.locale)+'%'))))),
    worth.accounts.map(row=>{const account=state.accounts.find(a=>a.id===row.accountId);return link(account.type==='INVESTMENT'?'assets/update':'accounts/'+account.id+'/timeline',[h('span',{class:'row-main'},h('strong',{},account.name+(account.archivedAtUtc?' · '+t('archived'):'')),h('small',{class:row.stale?'warn-text':'muted'},meta(account,row))),h('strong',{class:'num'},fmt(row.valueMinor,currency))],{class:'card asset-row','data-account':account.id});}),
    investments.length?c.action('updatePrices',()=>go('assets/update'),true,{class:'button primary wide'}):null,
    h('p',{class:'muted center'},t('pricesNote')),
    c.actionRow(link('accounts/new',t('newAccount'),{class:'button'}),link('accounts',t('accounts'),{class:'button'}))];
}

// Quantities follow the same vi-VN rule as money: comma = decimal, '.' only as thousands grouping
// (every group exactly three digits). Anything ambiguous is rejected instead of guessed.
function separators(locale){const parts=new Intl.NumberFormat(locale).formatToParts(11111.1);return {group:parts.find(p=>p.type==='group')?.value||'.',decimal:parts.find(p=>p.type==='decimal')?.value||','};}
const groupDigits=(digits,group)=>digits.replace(/\B(?=(\d{3})+(?!\d))/g,group);
export function parseQuantity(text,locale='vi-VN'){
  const raw=String(text??'').trim().replace(/[\s ]/g,'');if(!raw)return {empty:true};
  const {group,decimal}=separators(locale),bad={error:'quantityFormat'},[whole,fraction,...extra]=raw.split(decimal);
  if(extra.length||!whole)return bad;
  let digits;
  if(whole.includes(group)){const groups=whole.split(group);if(!/^\d{1,3}$/.test(groups[0])||!groups.slice(1).every(g=>/^\d{3}$/.test(g)))return bad;digits=groups.join('');}
  else{if(!/^\d+$/.test(whole))return bad;digits=whole;}
  if(fraction!==undefined&&!/^\d{1,12}$/.test(fraction))return bad;
  digits=digits.replace(/^0+(?=\d)/,'');
  return {value:digits+(fraction?'.'+fraction:''),display:groupDigits(digits,group)+(fraction?decimal+fraction:'')};
}
export function displayQuantity(value,locale='vi-VN'){const {group,decimal}=separators(locale),[whole,fraction]=String(value||'').split('.');return whole?groupDigits(whole,group)+(fraction?decimal+fraction:''):'';}
function quantityValue(value,unitPriceMinor){
  const [whole,fraction='']=value.split('.'),scale=10n**BigInt(fraction.length),product=BigInt(whole+fraction)*minor(unitPriceMinor);
  return ((product*2n+scale)/(2n*scale)).toString();
}
const priceMinor=(c,text,currency)=>{try{return text?parseMoney(text,currency,c.state.profile.locale).amountMinor:null;}catch{return null;}};

// Screen 14 · Cập nhật giá: per-holding price × quantity, or a single total (funds, gold).
export function priceUpdateScreen(c){
  const {h,t,fmt,fill,form,input,field,button,run,go,today,shortDate,notice,title,ui,perform,decimalInput,document,browser}=c,state=c.state,currency=state.profile.defaultCurrencyCode,locale=state.profile.locale;
  const accounts=state.accounts.filter(a=>a.type==='INVESTMENT'&&!a.archivedAtUtc&&a.currencyCode===currency);
  if(!accounts.length)return [title('updatePrices'),notice('noInvestments'),c.actionRow(c.link('accounts/new',t('newAccount'),{class:'button primary'}))];
  if(!ui.priceDraft)ui.priceDraft=Object.fromEntries(accounts.map(a=>{const v=latestValuation(state,a.id,today());const lines=(v?.lines||[]).map(l=>({symbol:l.symbol,quantity:displayQuantity(l.quantity,locale),price:decimalInput(l.unitPriceMinor,currency)}));return [a.id,{mode:v&&!lines.length?'total':'lines',lines:lines.length?lines:[{symbol:'',quantity:'',price:''}],total:v&&!lines.length?decimalInput(v.valueMinor,currency):''}];}));
  const errors=ui.priceErrors||{};
  const formValues=()=>Object.fromEntries(new browser.FormData(document.getElementById('price-form')));
  const readDraft=(values=formValues())=>{for(const a of accounts){const d=ui.priceDraft[a.id];d.total=values['total-'+a.id]??d.total;d.lines=d.lines.map((l,i)=>({symbol:values['symbol-'+a.id+'-'+i]??l.symbol,quantity:values['qty-'+a.id+'-'+i]??l.quantity,price:values['price-'+a.id+'-'+i]??l.price}));}return values;};
  const lineValue=(a,i,values,l)=>{const price=priceMinor(c,values['price-'+a.id+'-'+i]??l.price,currency),quantity=parseQuantity(values['qty-'+a.id+'-'+i]??l.quantity,locale);return price===null||!quantity.value?null:quantityValue(quantity.value,price);};
  const accountValue=(a,values)=>{const d=ui.priceDraft[a.id];if(d.mode==='total')return priceMinor(c,values['total-'+a.id]??d.total,currency);const parts=d.lines.map((l,i)=>lineValue(a,i,values,l)).filter(v=>v!==null);return parts.length?sum(parts):null;};
  const quantityNote=text=>{const q=parseQuantity(text,locale);return q.empty?'':q.error?t('quantityFormat'):fill(t('quantityRead'),{q:q.display});};
  const noteClass=text=>parseQuantity(text,locale).error?'qty-note error-text':'qty-note muted';
  // Live feedback on every 'input' event: interpreted quantity and the recomputed total.
  const refresh=()=>{const node=document.getElementById('price-form');if(!node)return;const values=formValues();for(const note of node.querySelectorAll('[data-qty-preview]')){const text=values[note.getAttribute('data-qty-preview')];note.textContent=quantityNote(text);note.setAttribute('class',noteClass(text));}const target=node.querySelector('[data-price-total]');if(target)target.textContent=fmt(sum(accounts.map(a=>accountValue(a,values)||c.balance(a.id))),currency);};
  const rowError=key=>key?h('p',{class:'error-text row-error','data-row-error':key},t(key)):null;
  const sections=accounts.map(a=>{const d=ui.priceDraft[a.id];return h('section',{class:'card price-card','data-account':a.id},
    h('div',{class:'section-heading'},h('h2',{},a.name),h('div',{class:'segmented small',role:'group','aria-label':a.name},['lines','total'].map(mode=>h('button',{type:'button',class:'seg'+(d.mode===mode?' on':''),'aria-pressed':String(d.mode===mode),onClick:run(async()=>{readDraft();d.mode=mode;ui.priceErrors=null;await c.render();})},t(mode==='lines'?'byHolding':'byTotal'))))),
    d.mode==='total'?[field(t('totalValue')+' · '+currency,'total-'+a.id,input('total-'+a.id,'text',d.total,{inputmode:'decimal',autocomplete:'off',onInput:refresh,'aria-invalid':errors[a.id+'-total']?'true':null})),rowError(errors[a.id+'-total'])]:
      [d.lines.map((l,i)=>{const key=a.id+'-'+i,qtyName='qty-'+key;return h('div',{class:'holding'+(errors[key]?' has-error':''),'data-holding':key},h('div',{class:'holding-row'},
          field(t('symbol'),'symbol-'+key,input('symbol-'+key,'text',l.symbol,{maxlength:'20',autocomplete:'off','aria-invalid':errors[key]==='symbolRequired'?'true':null})),
          h('div',{class:'field'},h('label',{for:qtyName},t('quantity')),input(qtyName,'text',l.quantity,{inputmode:'decimal',autocomplete:'off',placeholder:'0,0125',onInput:refresh,'aria-invalid':['quantityFormat','quantityRequired'].includes(errors[key])?'true':null}),h('small',{class:noteClass(l.quantity),'data-qty-preview':qtyName,'aria-live':'polite'},quantityNote(l.quantity))),
          field(t('unitPrice')+' · '+currency,'price-'+key,input('price-'+key,'text',l.price,{inputmode:'decimal',autocomplete:'off',onInput:refresh}))),rowError(errors[key]));}),
       button(t('addHolding'),run(async()=>{readDraft();if(d.lines.length<30)d.lines.push({symbol:'',quantity:'',price:''});await c.render();}),false,{class:'button text-button'})]);});
  const initialTotal=sum(accounts.map(a=>accountValue(a,{})||c.balance(a.id)));
  return [title('updatePrices'),h('p',{class:'muted'},fill(t('priceIntro'),{date:shortDate(today())})),FEATURES.valuations?null:notice('valuationUnavailable',true),
    form('price-form',[sections,h('div',{class:'summary-pill'},h('span',{},t('totalAfter')),h('strong',{class:'num','data-price-total':'true','aria-live':'polite'},fmt(initialTotal,currency)))],async values=>{
      readDraft(values);
      // Validate every row first: nothing is written, and nothing typed is cleared, if any row is wrong.
      const found={},payloads=[];
      for(const a of accounts){const d=ui.priceDraft[a.id];
        if(d.mode==='total'){const text=String(values['total-'+a.id]||'').trim();if(!text)continue;const value=priceMinor(c,text,currency);if(value===null)found[a.id+'-total']='totalInvalid';else payloads.push({accountId:a.id,date:today(),valueMinor:value});continue;}
        const lines=[];
        d.lines.forEach((l,i)=>{const key=a.id+'-'+i,symbol=String(values['symbol-'+key]||'').trim().toUpperCase(),qtyText=String(values['qty-'+key]||'').trim(),priceText=String(values['price-'+key]||'').trim();if(!symbol&&!qtyText&&!priceText)return;
          const quantity=parseQuantity(qtyText,locale),price=priceMinor(c,priceText,currency);
          const problem=!symbol?'symbolRequired':quantity.empty?'quantityRequired':quantity.error?'quantityFormat':!priceText?'priceRequired':price===null?'valuationPrice':'';
          if(problem)found[key]=problem;else lines.push({symbol,quantity:quantity.value,unitPriceMinor:price});});
        if(lines.length)payloads.push({accountId:a.id,date:today(),lines});}
      if(Object.keys(found).length){ui.priceErrors=found;await c.render();throw new Error('PRICE_FORM_INVALID');}
      ui.priceErrors=null;
      for(const payload of payloads)await perform('recordValuation',payload);
      ui.priceDraft=null;if(payloads.length)await go('assets');
    },'savePrices',{wide:true,stickySubmit:true}),
    h('div',{class:'actions'},button(t('importCsv')+' · '+t('comingSoon'),null,false,{disabled:true,'aria-disabled':'true'}))];
}

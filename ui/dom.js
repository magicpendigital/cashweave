export function dom(document) {
  function h(tag,attributes = {},...children) {
    const node = document.createElement(tag);
    for (const [key,value] of Object.entries(attributes)) {
      if (value === undefined || value === null || value === false&&!key.startsWith('aria-')) continue;
      if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(),value);
      else if (['value','checked','selected','disabled','required','hidden','type','name','id'].includes(key)) node[key] = value;
      else node.setAttribute(key,typeof value==='boolean'&&key.startsWith('aria-')?String(value):value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) if (child !== undefined && child !== null && child !== false) node.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
    return node;
  }
  const field = (label,name,control,hint = '') => h('div',{class:'field'},h('label',{for:name},label),control,hint ? h('small',{},hint) : null);
  const input = (name,type = 'text',value = '',extra = {}) => h('input',{id:name,name,type,value,...extra});
  const select = (name,choices,value = '',extra = {}) => h('select',{id:name,name,...extra},choices.map(([key,label]) => h('option',{value:key,selected:key === value},label)));
  const button = (label,onClick,primary = false,extra = {}) => h('button',{type:'button',class:'button'+(primary?' primary':''),onClick,...extra},label);
  // Explicit mobile metadata chooses financial meaning; unspecified cells stay visible.
  // Never infer a financial amount/status from a column's position or hide actions.
  const table = (headings,rows,{mobile=null}={}) => h('div',{class:'table-wrap'},h('table',{},h('thead',{},h('tr',{},headings.map(text=>h('th',{scope:'col'},text)))),h('tbody',{},rows.map(cells=>{
    const primary=mobile?.primary??cells.findIndex(value=>value?.tagName==='A');
    const compact=!!mobile||(headings.length>=4&&primary>=0);
    const amount=mobile?.amount??-1,date=mobile?.date??-1,note=mobile?.note??-1;
    return h('tr',{class:compact?'mobile-record':''},cells.map((value,index)=>{
      const interactive=value?.tagName==='BUTTON'||value?.querySelector?.('button')||value?.tagName==='A'&&index!==primary;
      const role=index===primary?'record-title':index===amount?'amount record-amount':index===date?'record-date':index===note?'record-note':'record-meta';
      return h('td',{class:(compact?role:index===cells.length-1?'amount':'')+(interactive?' record-action':''),'data-label':headings[index],'data-amount-label':index===amount&&mobile?.amountLabel?'true':null},value);
    }));
  }))));
  const paths={overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',transactions:'M7 5h14 M7 12h14 M7 19h14 M3 5h.01 M3 12h.01 M3 19h.01',accounts:'M3 8h18v13H3z M2 8l10-6 10 6 M7 12v5 M12 12v5 M17 12v5',templates:'M3 5h18v15H3z M3 9h18 M8 5v4 M8 14h8',plans:'M4 5h16v16H4z M8 2v6 M16 2v6 M4 10h16 M8 14h2 M14 14h2 M8 18h2',menu:'M4 6h16 M4 12h16 M4 18h16',filter:'M4 6h16 M7 12h10 M10 18h4',forecast:'M3 18l6-6 4 3 8-11 M15 4h6v6',shared:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87',history:'M3 5v5h5 M3 10a9 9 0 1 1 1 8 M12 7v6l4 2',help:'M12 17h.01 M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',data:'M4 5h16v16H4z M8 5v6h8V5 M8 21v-6h8v6',categories:'M3 3h8l10 10-8 8L3 11z M7 7h.01',
    home:'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',ledger:'M8 6h13 M8 12h13 M8 18h13 M3.5 6h.01 M3.5 12h.01 M3.5 18h.01',add:'M12 5v14 M5 12h14',calendar:'M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M16 2v4 M8 2v4 M3 10h18',more:'M4 6h16 M4 12h16 M4 18h16',
    back:'M15 18l-6-6 6-6',close:'M6 6l12 12 M18 6L6 18',chevron:'M9 6l6 6-6 6',down:'M6 9l6 6 6-6',eye:'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',eyeOff:'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2 M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6',
    bank:'M3 10h18L12 4z M5 10v8 M9.5 10v8 M14.5 10v8 M19 10v8 M3 20h18',cash:'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',lock:'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z M8 11V8a4 4 0 0 1 8 0v3',
    split:'M12 3v18 M3 12h18 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',recipe:'M12 3v9l7 4 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',warning:'M12 9v4 M12 17h.01 M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    income:'M12 19V5 M5 12l7-7 7 7',expense:'M12 5v14 M19 12l-7 7-7-7',transfer:'M7 7h12l-3-3 M17 17H5l3 3',search:'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M20 20l-3.5-3.5',assets:'M3 3v18h18 M7 15l4-4 3 3 5-6',report:'M4 20V10 M10 20V4 M16 20v-7 M22 20H2'};
  function icon(name){
    if(!document.createElementNS)return h('span',{class:'nav-icon','aria-hidden':'true','data-icon':name},'');
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value] of Object.entries({class:'nav-icon',viewBox:'0 0 24 24',width:'24',height:'24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[name]||paths.menu);svg.append(path);return svg;
  }
  return {h,field,input,select,button,table,icon};
}

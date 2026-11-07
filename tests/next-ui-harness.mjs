// Synthetic DOM execution adapter; this does not verify browser layout or IndexedDB.
import { createNextApp } from '../ui/app.js';
import { createMemoryRepository } from '../core/repository.js';
import { createMemorySharedRepository } from '../core/shared-repository.js';
import { createDataset } from '../core/model.js';
class Node {
  constructor(tag='',text=''){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attributes=new Map();this.listeners=new Map();this._text=text;this._value=undefined;this.files=[];this.style={};this.inert=false;}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const child of this.children)child.parentNode=null;this.children=[];this._text='';this.append(...nodes);}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  set textContent(value){this.replaceChildren();this._text=String(value);}
  setAttribute(k,v){this.attributes.set(k,String(v));if(['id','name','type'].includes(k))this[k]=String(v);}
  getAttribute(k){return this.attributes.get(k)??(this[k]===undefined?null:String(this[k]));}
  removeAttribute(k){this.attributes.delete(k);}
  focus(){if(this.ownerDocument)this.ownerDocument.activeElement=this;}
  get value(){return this._value??(this.tagName==='SELECT'?(this.children.find(n=>n.selected)||this.children[0])?.value||'':'');}
  set value(v){this._value=String(v);}
  matches(selector){const match=/^([\w-]+)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(selector);if(selector.startsWith('#'))return this.id===selector.slice(1);return !!match&&(!match[1]||this.tagName===match[1].toUpperCase())&&(!match[2]||(this.getAttribute(match[2])!==null&&(match[3]===undefined||this.getAttribute(match[2])===match[3])));}
  querySelectorAll(selector){if(selector.includes(','))return [...new Set(selector.split(',').flatMap(s=>this.querySelectorAll(s)))];return this.children.flatMap(n=>[...(n.matches(selector)?[n]:[]),...n.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){return this.matches(selector)?this:this.parentNode?.closest(selector)||null;}
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  async dispatch(type,extra={}){const event={target:this,preventDefault(){},...extra};for(let node=this;node;node=node.parentNode)for(const fn of node.listeners.get(type)||[])await fn(event);}
  async click(){if(!this.disabled)await this.dispatch('click');}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);}
}
export async function nextHarness({initial,hash='',failWrite=false,legacyRaw=null,appFactory=createNextApp,clock=()=>new Date('2026-10-31T10:00:00.000Z'),appOptions={},viewportWidth=1280}={}){
  const documentElement=new Node('html'),body=new Node('body'),root=new Node('div');root.id='next-app';documentElement.append(body);body.append(root);
  const document={documentElement,body,createElement:tag=>Object.assign(new Node(tag),{ownerDocument:document}),createTextNode:text=>Object.assign(new Node('',text),{ownerDocument:document}),getElementById:id=>documentElement.querySelector('#'+id),querySelectorAll:s=>documentElement.querySelectorAll(s)};
  for(const node of [documentElement,body,root])node.ownerDocument=document;document.activeElement=body;
  class FormData {constructor(form){this.values=form.querySelectorAll('[name]').filter(n=>n.type!=='checkbox'||n.checked).map(n=>[n.name,n.value]);}[Symbol.iterator](){return this.values[Symbol.iterator]();}get(key){return this.values.find(([name])=>name===key)?.[1]??null;}has(key){return this.values.some(([name])=>name===key);}entries(){return this.values[Symbol.iterator]();}}
  const browserListeners=new Map();let reloads=0;
  const browser={matchMedia:query=>({matches:viewportWidth<=Number(query.match(/max-width:\s*(\d+)/)?.[1]||0)}),location:{hash,reload(){reloads++;}},FormData,addEventListener(type,fn){browserListeners.set(type,[...(browserListeners.get(type)||[]),fn]);},async emit(type){for(const fn of browserListeners.get(type)||[])await fn();}};
  const repositories=new Map(),sharedRepositories=new Map(),sharedSnapshots=new Map(),sharedClosed=new Set(),downloads=[];
  const factory=async({namespace})=>{if(!repositories.has(namespace)){const repository=createMemoryRepository(namespace==='personal'&&initial?initial:createDataset({namespace}));if(failWrite){const original=repository.runAtomicCommand;repository.runAtomicCommand=(...args)=>original(args[0],args[1],{...args[2],failBeforeCommit:true});}repositories.set(namespace,repository);}return repositories.get(namespace);};
  const sharedFactory=async({namespace})=>{
    if(!sharedRepositories.has(namespace)||sharedClosed.has(namespace)){
      const repository=createMemorySharedRepository({namespace,...(sharedSnapshots.has(namespace)?{initialSnapshot:sharedSnapshots.get(namespace)}:{})});sharedClosed.delete(namespace);
      for(const method of ['readSnapshot','execute','activateStage','rollback']){const original=repository[method].bind(repository);repository[method]=async(...args)=>{const value=await original(...args);if(value?.datasetId&&value?.schemaVersion===1)sharedSnapshots.set(namespace,structuredClone(value));return value;};}
      const close=repository.close.bind(repository);repository.close=()=>{sharedClosed.add(namespace);close();};sharedRepositories.set(namespace,repository);
    }
    return sharedRepositories.get(namespace);
  };
  const app=await appFactory(root,{document,browser,repositoryFactory:factory,sharedRepositoryFactory:sharedFactory,clock,legacyStorage:{getItem:key=>key==='financial-assistant-prototype-v1'?legacyRaw:null},onDownload:(text,name)=>downloads.push({text,name}),...appOptions});
  return {app,root,document,browser,repositories,sharedRepositories,downloads,reloads:()=>reloads,get:id=>document.getElementById(id),button:text=>root.querySelectorAll('button').find(n=>n.textContent===text),setForm(formId,values){for(const control of document.getElementById(formId).querySelectorAll('[name]'))if(Object.hasOwn(values,control.name))control.value=values[control.name];},async submit(formId,values){this.setForm(formId,values);return app.submit(formId,values);},text:()=>root.textContent};
}

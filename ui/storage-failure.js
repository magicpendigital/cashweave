import {dom} from './dom.js';
import {translator} from './i18n.js';
export function showStorageFailure(root,{document=globalThis.document,browser=globalThis.window}={}){
  const {h,button}=dom(document),t=translator();
  root.replaceChildren(h('main',{class:'narrow storage-failure'},h('h1',{},t('storageBlocked')),h('p',{role:'alert'},t('storageBlockedHelp')),button(t('reload'),()=>browser?.location?.reload?.(),true),h('details',{},h('summary',{},t('startGuide')),h('p',{},t('guideStep1Help')),h('p',{},t('guideStep4Help')))));
}

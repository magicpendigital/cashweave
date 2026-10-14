// Architectural guardrails only; no claim of backend or multi-device readiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('financial domain remains independent of UI, Capacitor and network/persistence APIs',async()=>{
 for(const name of ['money','model','commands','allocation','reports','calendar','identity']){
  const source=await readFile(new URL('../core/'+name+'.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from\s+['"][^'"]*(?:ui\/|@capacitor|mobile\/|backend\/)/,name);
  assert.doesNotMatch(source,/\b(?:document|window|localStorage|indexedDB|fetch|WebSocket)\s*[.(]/,name);
 }
});
test('native device services remain injected into the UI rather than importing native SDK there',async()=>{
 const ui=await readFile(new URL('../ui/app.js',import.meta.url),'utf8');assert.doesNotMatch(ui,/from\s+['"][^'"]*@capacitor/);assert.match(ui,/repositoryFactory/);assert.match(ui,/onReadBackup = null/);assert.match(ui,/onDownload = null/);
});

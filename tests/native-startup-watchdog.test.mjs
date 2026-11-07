import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

test('Native startup policy: exact deadline, background/resume, genuine ready and destruction without reload or retry',async t=>{
 const java=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java';
 const javac=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'javac.exe':'javac'):'javac';
 const probe=spawnSync(javac,['-version'],{encoding:'utf8',timeout:8000,windowsHide:true});
 if(probe.error?.code==='ENOENT'){t.skip('JDK unavailable; plain-Java policy execution requires a JDK. Android compile/device gates remain separate.');return;}
 assert.equal(probe.status,0,probe.error?.message||probe.stderr);
 const folder=await mkdtemp(join(tmpdir(),'cashweave-startup-policy-'));
 try{
  const compile=spawnSync(javac,['-encoding','UTF-8','-d',folder,join(root,'android/app/src/main/java/app/cashweave/offline/trial/StartupState.java'),join(root,'tests/java/StartupStateBehaviorTest.java')],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(compile.status,0,compile.error?.message||compile.stderr);
  const run=spawnSync(java,['-cp',folder,'app.cashweave.offline.trial.StartupStateBehaviorTest'],{encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(run.status,0,run.error?.message||run.stderr);assert.match(run.stdout,/PASS 15 startup policy behavior checks/);
 }finally{assert.equal(dirname(resolve(folder)),resolve(tmpdir()));assert.ok(folder.includes('cashweave-startup-policy-'));await rm(folder,{recursive:true,force:true});}
});

test('Initial-Activity diagnostics retain mobile/iOS contract and native offline restrictions',async()=>{
 const read=path=>readFile(join(root,path),'utf8');const main=await read('android/app/src/main/java/app/cashweave/offline/trial/MainActivity.java');
 assert.doesNotMatch(main,/clearCache|clearHistory|deleteDatabase|deleteAllData|setWebContentsDebuggingEnabled\(true\)|boolean onRenderProcessGone|getBridge\(\)\.reload\(|recreate\(/);
 assert.match(main,/content\.addView\(panel/);assert.match(main,/moveTaskToBack\(true\)/);
 assert.match(main,/stage\(getBridge\(\) != null \? "BRIDGE_CREATED" : "BRIDGE_UNAVAILABLE"\)/);
 assert.doesNotMatch(main,/getStartupContext|startupGeneration|USER_RETRY/);
});

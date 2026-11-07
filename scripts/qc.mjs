// Local synthetic QC only. No install, network client, native build, signing,
// device installation, store upload or owner-approval generation.
import { spawn, spawnSync } from 'node:child_process';
import { readFile, readdir, lstat, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const now=()=>new Date().toISOString(),env={platform:process.platform,arch:process.arch,node:process.version};
const args=process.argv.slice(2),listOnly=args.length===1&&args[0]==='--list';
if(!listOnly&&!(args.length===0||(args.length===2&&args[0]==='--out')))throw new Error('Usage: node scripts/qc.mjs [--out evidence/<new-run>.json | --list]');
const output=resolve(root,args[1]||`evidence/qc-local/${now().replaceAll(':','-')}.json`),evidenceRoot=resolve(root,'evidence');
if(!listOnly&&(!output.startsWith(evidenceRoot+sep)||!output.endsWith('.json')))throw new Error('QC output must be a new JSON file inside evidence/');
const logDirectory=output.slice(0,-5)+'.logs';
const profile=JSON.parse(await readFile(resolve(root,'docs/release/release-profile.json'),'utf8'));
const prohibited=/(^|\/)(\.env(?:\..*)?|\.git|node_modules|credentials?|secrets?|.*\.(?:pem|p12|pfx|keystore|jks))($|\/)/i;
async function inventory() {
  const entries=new Map();
  async function visit(name) {
    if(typeof name!=='string'||!name||name.includes('\\')||name.includes(':')||name.split('/').some(p=>!p||p==='.'||p==='..')||prohibited.test(name))throw new Error('UNSAFE_QC_INPUT_ROOT');
    let cursor=root;for(const component of name.split('/')){cursor=resolve(cursor,component);if((await lstat(cursor)).isSymbolicLink())throw new Error('SYMLINK_QC_INPUT');}
    const full=resolve(root,name),stat=await lstat(full);
    if(stat.isDirectory()){for(const entry of (await readdir(full)).sort())await visit(`${name}/${entry}`);}
    else if(stat.isFile())entries.set(name,{path:name,sha256:hash(await readFile(full)),bytes:stat.size});
    else throw new Error('UNSUPPORTED_QC_INPUT');
  }
  for(const name of profile.inputRoots)await visit(name);
  const files=[...entries.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {sha256:hash(JSON.stringify(files)),files};
}
const tests=(await readdir(resolve(root,'tests'))).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>`tests/${f}`);
const nodeStep=(id,script,options={})=>({id,command:process.execPath,args:[script],timeoutMs:45000,...options});
const steps=[
  nodeStep('legacy-review-build','scripts/build-review.mjs'),
  nodeStep('v3-review-build','scripts/build-next-review.mjs'),
  {id:'node-full-suite',command:process.execPath,args:['--test','--test-concurrency=1',...tests],timeoutMs:180000,needs:['legacy-review-build','v3-review-build']},
  {id:'release-gate-fixtures',command:process.execPath,args:['--test','scripts/release-evidence.test.mjs'],timeoutMs:60000},
  {id:'source-packager-security',command:'python',args:['-m','unittest','discover','-s','tests','-p','packager_security_test.py'],timeoutMs:120000},
  nodeStep('browser-indexeddb','scripts/verify-indexeddb.mjs',{timeoutMs:90000}),
  nodeStep('mobile-web-assets','scripts/build-android-web.mjs',{runtime:'core'}),
  nodeStep('android-assets-copy','scripts/sync-android-assets.mjs',{needs:['mobile-web-assets']}),
  nodeStep('android-assets-verify','scripts/verify-android-assets.mjs',{needs:['android-assets-copy']}),
  nodeStep('ios-assets-copy','scripts/sync-ios-assets.mjs',{needs:['mobile-web-assets'],runtime:'ios'}),
  nodeStep('ios-assets-verify','scripts/verify-ios-assets.mjs',{needs:['ios-assets-copy']}),
  nodeStep('android-tool-availability','scripts/check-android-toolchain.mjs',{blockedExitCodes:[2]}),
  nodeStep('ios-tool-availability','scripts/check-ios-toolchain.mjs',{blockedExitCodes:[2]}),
];
const pending=[
  {id:'android-native-lint-compile-binary',reason:'Native lintRelease/bundleRelease/compiled manifest/signature inspection require reviewed toolchain and a separately executed exact artifact gate.'},
  {id:'ios-native-analyze-build-binary',reason:'Swift/Xcode analyze/build/entitlements/privacy binary inspection require macOS, reviewed SDK/package cache and separate exact artifact evidence.'},
  {id:'device-lifecycle-recovery-accessibility-uat',reason:'Android/iOS device/update/process-death/file-provider/accessibility/performance and human acceptance have not been executed by this local orchestrator; use docs/native-device-qa.vi.md.'},
  {id:'dependency-security-provenance-review',reason:'Pinned lockfile and static source tests do not establish dependency implementation/CVE/native-cache provenance; independent review still required.'},
  {id:'store-signing-and-owner-acceptance',reason:'Signed store candidate, current policy/account/privacy verification and exact owner approval are not produced by local QC.'},
];
if(listOnly){console.log(JSON.stringify({validationType:'LocalQcPlan',environment:env,steps,pending,releaseAuthorized:false},null,2));process.exit(0);}
await mkdir(dirname(output),{recursive:true});
try{await access(output);throw new Error('QC_OUTPUT_EXISTS_USE_NEW_PATH');}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(logDirectory,{recursive:false});
const git=gitArgs=>{const r=spawnSync('git',['-c',`safe.directory=${root}`,'--no-optional-locks','-C',root,...gitArgs],{encoding:'utf8',timeout:5000});return r.status===0?r.stdout.trim():null;};
const commit=git(['rev-parse','HEAD']),dirty=git(['status','--porcelain=v1','--untracked-files=no']);
const startedAt=now(),start=await inventory(),results=[];
async function run(step) {
  const before=await inventory(),started=Date.now(),receipt={schemaVersion:1,checkId:step.id,status:'BLOCKED',sourceIdentity:{kind:'working-tree-inputs',gitCommit:commit,trackedDirty:dirty===null?null:Boolean(dirty),inputsSha256:before.sha256},command:[step.command,...step.args].join(' '),exitCode:null,environment:env,executedAt:now(),durationMs:0,sourceInputsSha256Before:before.sha256,sourceInputsSha256After:null,reason:null};
  const dependency=step.needs?.find(id=>results.find(r=>r.checkId===id)?.status!=='PASS');
  if(dependency)receipt.reason=`Required preceding check did not pass: ${dependency}`;
  if(!receipt.reason&&step.runtime){try{const pkg=JSON.parse(await readFile(resolve(root,`node_modules/@capacitor/${step.runtime}/package.json`),'utf8'));if(pkg.version!=='8.5.3')receipt.reason=`Unreviewed @capacitor/${step.runtime} version; expected pinned 8.5.3`;}catch{receipt.reason=`Pinned @capacitor/${step.runtime} runtime unavailable; no dependency install attempted`;}}
  let text='',truncated=false,timedOut=false;
  if(!receipt.reason){
    const execution=await new Promise(resolveResult=>{
      let child,closed=false;
      const finish=value=>{if(closed)return;closed=true;clearTimeout(timer);resolveResult(value);};
      let timer;
      try{child=spawn(step.command,step.args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});}catch(error){finish({error,exitCode:null});return;}
      const collect=chunk=>{if(text.length<4*1024*1024)text+=chunk.toString();else truncated=true;};
      child.stdout.on('data',collect);child.stderr.on('data',collect);child.once('error',error=>finish({error,exitCode:null}));child.once('close',(code,signal)=>finish({exitCode:code,signal}));
      timer=setTimeout(()=>{timedOut=true;child.kill();setTimeout(()=>finish({exitCode:null,signal:'TIMEOUT'}),2000).unref();},step.timeoutMs);
    });
    receipt.exitCode=execution.exitCode;receipt.timedOut=timedOut;receipt.signal=execution.signal||null;
    if(execution.error){receipt.status=execution.error.code==='ENOENT'||execution.error.code==='EPERM'?'BLOCKED':'FAIL';receipt.reason=`Unable to launch local check: ${execution.error.code||execution.error.message}`;}
    else if(timedOut){receipt.status='BLOCKED';receipt.reason=`Check exceeded bounded timeout ${step.timeoutMs} ms; no PASS claimed`;}
    else if(execution.exitCode===0)receipt.status='PASS';
    else if(step.blockedExitCodes?.includes(execution.exitCode)){receipt.status='BLOCKED';receipt.reason='Tool availability probe reports missing or unreviewed platform prerequisites';}
    else{receipt.status='FAIL';receipt.reason=`Executed check returned exit ${execution.exitCode}`;}
  }
  receipt.durationMs=Date.now()-started;receipt.finishedAt=now();receipt.sourceInputsSha256After=(await inventory()).sha256;
  if(receipt.sourceInputsSha256After!==before.sha256){receipt.status='BLOCKED';receipt.reason='SOURCE_INPUTS_CHANGED_DURING_CHECK; rerun after source freeze';}
  const log=text||`${receipt.reason}\n`,logPath=resolve(logDirectory,`${String(results.length+1).padStart(2,'0')}-${step.id}.log`);await writeFile(logPath,log,{flag:'wx'});
  receipt.output={path:relative(root,logPath).split(sep).join('/'),sha256:hash(log),truncated};results.push(receipt);
  process.stdout.write(`${step.id}: ${receipt.status} (exit ${receipt.exitCode??'not run'})\n`);
}
for(const step of steps)await run(step);
const end=await inventory();
for(const item of pending)results.push({schemaVersion:1,checkId:item.id,status:'BLOCKED',command:'Not executed by local QC; separate gate required',exitCode:null,environment:env,executedAt:now(),sourceIdentity:{kind:'working-tree-inputs',gitCommit:commit,inputsSha256:end.sha256},reason:item.reason});
const status=results.some(r=>r.status==='FAIL')?'FAIL':'BLOCKED';
const report={schemaVersion:1,validationType:'LocalQcExecution',status,releaseAuthorized:false,startedAt,finishedAt:now(),environment:env,source:{kind:'working-tree-inputs',gitCommit:commit,trackedDirty:dirty===null?null:Boolean(dirty),inputsSha256Start:start.sha256,inputsSha256End:end.sha256,unchanged:start.sha256===end.sha256,inputs:end.files},checks:results,counts:Object.fromEntries(['PASS','FAIL','BLOCKED','NOT_APPLICABLE'].map(s=>[s,results.filter(r=>r.status===s).length])),limitations:['Synthetic Node/browser/static/source checks only; actual logs and command exits bound to working-tree input hashes.','This report is not an approved release manifest and cannot bypass clean-Git, exact-target, independent-review or owner-approval requirements.']};
if(!report.source.unchanged)report.limitations.push('Source inputs changed during this run; rerun after freeze.');
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,counts:report.counts,inputsUnchanged:report.source.unchanged,report:relative(root,output).split(sep).join('/'),releaseAuthorized:false}));
process.exitCode=report.status==='FAIL'?1:2;

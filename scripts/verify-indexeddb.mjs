// Runs an installed headless browser in an isolated synthetic-only profile.
// No dependencies, existing browser profiles, running apps or fixed ports.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const qa = join(root,'evidence','.browser-qa'); await mkdir(qa,{recursive:true}); const profile = await mkdtemp(join(qa,'profile-'));
const server = createServer(async (req,res) => {
  const path = new URL(req.url,'http://localhost').pathname;
  if (path === '/') { res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'"}); res.end('<!doctype html><title>Synthetic IndexedDB verification</title>'); return; }
  if (path === '/ui/next.css') { res.writeHead(200,{'Content-Type':'text/css'}); res.end(await readFile(join(root,'ui/next.css'))); return; }
  if (!/^\/(core\/[a-z-]+\.js|mobile\/backup-bridge\.js|ui\/(?:app|dom|i18n|remediation-text|shared-view|shared-offline-view)\.js|(?:ledger|state-schema|budgeting|storage|sample|couples|compatibility|legacy-platform)\.js|tests\/browser-(?:idb|ui|shared|shared-ui|personal-recovery-ui|route-scroll|backup-feedback)-scenarios\.js)$/.test(path)) { res.writeHead(404); res.end(); return; }
  try { const bytes = await readFile(join(root,path.slice(1))); res.writeHead(200,{'Content-Type':'text/javascript'}); res.end(bytes); } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); const port = server.address().port;
const browserPath = process.env.MACH_TIEN_QA_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const child = spawn(browserPath,['--headless','--disable-gpu','--disable-background-networking','--disable-sync','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let websocket, serial = 0; const pending = new Map();
function send(method,params={},sessionId) { const id = ++serial; const result = new Promise((resolve,reject) => {const timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`DEBUGGER_TIMEOUT:${method}`));},params.awaitPromise?30000:5000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});}); websocket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})); return result; }
try {
  let endpoint, launchError;
  child.once('error',error=>{launchError=error;});
  const launchDeadline=Date.now()+15000;
  while(Date.now()<launchDeadline){
    if(launchError)throw launchError;
    try{const [port,path]=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);if(/^\d+$/.test(port)&&path.startsWith('/devtools/browser/')){endpoint=`ws://127.0.0.1:${port}${path}`;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!endpoint)throw new Error('ISOLATED_BROWSER_START_TIMEOUT');
  process.stdout.write('Isolated browser launched.\n');
  websocket = new WebSocket(endpoint); await new Promise((resolve,reject) => {const timeout=setTimeout(()=>reject(new Error('DEBUGGER_CONNECT_TIMEOUT')),5000);websocket.onopen=()=>{clearTimeout(timeout);resolve();};websocket.onerror=error=>{clearTimeout(timeout);reject(error);};});
  websocket.onmessage = event => {const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const callbacks=pending.get(message.id);pending.delete(message.id);message.error?callbacks.reject(new Error(JSON.stringify(message.error))):callbacks.resolve(message.result);}};
  websocket.onclose=()=>{for(const callbacks of pending.values())callbacks.reject(new Error('DEBUGGER_CLOSED'));pending.clear();};
  process.stdout.write('Isolated browser debugger connected.\n');
  const {targetId} = await send('Target.createTarget',{url:`http://127.0.0.1:${port}/`}); const {sessionId} = await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Runtime.enable',{},sessionId);
  const deadline = Date.now()+10000; let ready;
  while(Date.now()<deadline){const r=await send('Runtime.evaluate',{expression:'location.hostname === "127.0.0.1" && document.readyState === "complete"',returnByValue:true},sessionId);if(r.result.value){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}
  if(!ready)throw new Error('BROWSER_NAVIGATION_TIMEOUT');
  const result=await Promise.race([send('Runtime.evaluate',{expression:'import("/tests/browser-idb-scenarios.js").then(m => m.verifyIndexedDb())',awaitPromise:true,returnByValue:true},sessionId),new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(new Error('BROWSER_SCENARIO_TIMEOUT')),15000);timeout.unref();})]);
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
  const emergency=await send('Runtime.evaluate',{expression:'import("/tests/browser-idb-scenarios.js").then(m => m.verifyPersonalEmergencyRestore())',awaitPromise:true,returnByValue:true},sessionId);
  if(emergency.exceptionDetails)throw new Error(emergency.exceptionDetails.exception?.description||emergency.exceptionDetails.text);
  const shared=await send('Runtime.evaluate',{expression:'import("/tests/browser-shared-scenarios.js").then(m => m.verifySharedIndexedDb())',awaitPromise:true,returnByValue:true},sessionId);
  if(shared.exceptionDetails)throw new Error(shared.exceptionDetails.exception?.description||shared.exceptionDetails.text);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
  await send('Runtime.evaluate',{expression:'document.head.insertAdjacentHTML("beforeend", \'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui/next.css">\')'},sessionId);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
  const routeScroll=await send('Runtime.evaluate',{expression:'import("/tests/browser-route-scroll-scenarios.js").then(m => m.verifyRouteScrollBrowserUi())',awaitPromise:true,returnByValue:true},sessionId);
  if(routeScroll.exceptionDetails)throw new Error(routeScroll.exceptionDetails.exception?.description||routeScroll.exceptionDetails.text);
  const uiResult=await send('Runtime.evaluate',{expression:'import("/tests/browser-ui-scenarios.js").then(m => m.verifyBrowserUi())',awaitPromise:true,returnByValue:true},sessionId);
  if(uiResult.exceptionDetails)throw new Error(uiResult.exceptionDetails.exception?.description||uiResult.exceptionDetails.text);
  const screenshots=[];
  async function captureScreens(label){for(const [width,height,mobile] of [[390,844,true],[1280,900,false]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile},sessionId);
    await send('Runtime.evaluate',{expression:'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',awaitPromise:true},sessionId);
    const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},sessionId),bytes=Buffer.from(data,'base64'),path=join(profile,`${label}-${width}.png`);await writeFile(path,bytes);
    const layout=await send('Runtime.evaluate',{expression:'({viewport:innerWidth,document:document.documentElement.scrollWidth})',returnByValue:true},sessionId);
    if(layout.result.value.document>layout.result.value.viewport+1)throw new Error('OVERVIEW_HORIZONTAL_OVERFLOW');
    screenshots.push({path,label,width,height,sha256:createHash('sha256').update(bytes).digest('hex')});
  }}
  await captureScreens('overview');
  const emergencyUi=await send('Runtime.evaluate',{expression:'import("/tests/browser-personal-recovery-ui-scenarios.js").then(m => m.verifyPersonalRecoveryBrowserUi())',awaitPromise:true,returnByValue:true},sessionId);
  if(emergencyUi.exceptionDetails)throw new Error(emergencyUi.exceptionDetails.exception?.description||emergencyUi.exceptionDetails.text);
  const sharedUi=await send('Runtime.evaluate',{expression:'import("/tests/browser-shared-ui-scenarios.js").then(m => m.verifySharedBrowserUi())',awaitPromise:true,returnByValue:true},sessionId);
  if(sharedUi.exceptionDetails)throw new Error(sharedUi.exceptionDetails.exception?.description||sharedUi.exceptionDetails.text);
  await captureScreens('shared-overview');
  const backupFeedback=await send('Runtime.evaluate',{expression:'import("/tests/browser-backup-feedback-scenarios.js").then(m => m.verifyBackupFeedbackBrowserUi())',awaitPromise:true,returnByValue:true},sessionId);
  if(backupFeedback.exceptionDetails)throw new Error(backupFeedback.exceptionDetails.exception?.description||backupFeedback.exceptionDetails.text);
  await captureScreens('backup-preview-feedback');
  process.stdout.write(JSON.stringify({browser:'isolated Edge',indexedDB:result.result.value,personalEmergencyRecovery:emergency.result.value,sharedIndexedDB:shared.result.value,renderedUi:uiResult.result.value,personalRecoveryRenderedUi:emergencyUi.result.value,sharedRenderedUi:sharedUi.result.value,routeScrollRenderedUi:routeScroll.result.value,backupFeedbackRenderedUi:backupFeedback.result.value,screenshots,passed:result.result.value.passed+emergency.result.value.passed+shared.result.value.passed+uiResult.result.value.passed+emergencyUi.result.value.passed+sharedUi.result.value.passed+routeScroll.result.value.passed+backupFeedback.result.value.passed})+'\n');
} finally {
  if(websocket?.readyState===WebSocket.OPEN)try{await Promise.race([send('Browser.close'),new Promise(resolve=>setTimeout(resolve,1000))]);}catch{}
  websocket?.close(); child.kill(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
}

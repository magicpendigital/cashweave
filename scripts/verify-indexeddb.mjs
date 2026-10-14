// Runs an installed headless browser in an isolated synthetic-only profile.
// No dependencies, existing browser profiles, running apps or fixed ports.
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const qa = join(root,'..','.browser-qa'); await mkdir(qa,{recursive:true}); const profile = await mkdtemp(join(qa,'profile-'));
const server = createServer(async (req,res) => {
  const path = new URL(req.url,'http://localhost').pathname;
  if (path === '/') { res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'"}); res.end('<!doctype html><title>Synthetic IndexedDB verification</title>'); return; }
  if (!/^\/(core\/[a-z-]+\.js|(?:ledger|state-schema|budgeting)\.js|tests\/browser-idb-scenarios\.js)$/.test(path)) { res.writeHead(404); res.end(); return; }
  try { const bytes = await readFile(join(root,path.slice(1))); res.writeHead(200,{'Content-Type':'text/javascript'}); res.end(bytes); } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); const port = server.address().port;
const browserPath = process.env.MACH_TIEN_QA_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const child = spawn(browserPath,['--headless','--disable-gpu','--disable-background-networking','--disable-sync','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let websocket, serial = 0; const pending = new Map();
function send(method,params={},sessionId) { const id = ++serial; const result = new Promise((resolve,reject) => {const timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`DEBUGGER_TIMEOUT:${method}`));},5000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});}); websocket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})); return result; }
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
  process.stdout.write(JSON.stringify({browser:'isolated Edge',...result.result.value})+'\n');
} finally {
  if(websocket?.readyState===WebSocket.OPEN)try{await Promise.race([send('Browser.close'),new Promise(resolve=>setTimeout(resolve,1000))]);}catch{}
  websocket?.close(); child.kill(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
}

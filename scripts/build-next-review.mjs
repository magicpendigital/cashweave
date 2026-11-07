// Small deterministic bundler for this project's named ES-module imports only.
// Unsupported imports fail closed. No dependencies, transforms or network access.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {reviewOutputDirectory} from './review-output.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=reviewOutputDirectory();
const modules=new Map(),visiting=new Set(),manifest=[];
const key=path=>relative(root,path).split(sep).join('/');
async function bundle(path){
 const name=key(path);if(modules.has(name))return;if(visiting.has(name))throw new Error('Cyclic module '+name);if(name.startsWith('..'))throw new Error('Import outside project');visiting.add(name);
 const original=await readFile(path,'utf8');let source=original;const imports=[...source.matchAll(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm)];
 for(const match of imports){const dep=resolve(dirname(path),match[2]);await bundle(dep);source=source.replace(match[0],`const {${match[1].replace(/\s+as\s+/g,':')}}=modules[${JSON.stringify(key(dep))}];`);}
 if(/^import\s/m.test(source))throw new Error('Unsupported import '+name);
 const names=[...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/gm)].map(m=>m[1]);
 if(/^export const INT64_MIN =/m.test(source))names.push('INT64_MAX');
 source=source.replace(/^export\s*\{([^}]+)\};?[ \t]*$/gm,(_,items)=>{for(const item of items.split(',')){const parts=item.trim().split(/\s+as\s+/);names.push(parts.length===2?parts[1]+':'+parts[0]:parts[0]);}return '';});
 source=source.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let)\s)/gm,'');
 if(/^export\s/m.test(source))throw new Error('Unsupported export '+name);
 modules.set(name,`modules[${JSON.stringify(name)}]=(()=>{\n${source}\nreturn {${names.join(',')}};\n})();`);
 manifest.push({path:name,sha256:createHash('sha256').update(original).digest('hex'),bytes:Buffer.byteLength(original)});visiting.delete(name);
}
await bundle(resolve(root,'ui/app.js'));
await bundle(resolve(root,'ui/storage-failure.js'));
const script=`'use strict';\nconst modules=Object.create(null);\n${[...modules.values()].join('\n')}\nglobalThis.__machTienReview=Object.freeze({createNextApp:modules['ui/app.js'].createNextApp,createMemoryRepository:modules['core/repository.js'].createMemoryRepository,createDataset:modules['core/model.js'].createDataset});\nif(typeof document!=='undefined'){const root=document.getElementById('next-app');modules['ui/app.js'].createNextApp(root).catch(()=>modules['ui/storage-failure.js'].showStorageFailure(root));}`;
// Escaping HTML end-tags inside JS strings preserves their evaluated content.
const inlineScript=script.replace(/<\/script/gi,'<\\/script');
const hash='sha256-'+createHash('sha256').update(inlineScript).digest('base64'),css=await readFile(resolve(root,'ui/next.css'),'utf8');
const csp=`default-src 'none'; script-src '${hash}'; style-src 'unsafe-inline'; img-src data:; frame-src 'none'; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'`;
const html=`<!doctype html>\n<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>CashWeave V4 Mobile - offline trial</title><style>${css}</style></head><body><div id="next-app"><p role="status">Đang mở kho dữ liệu.</p></div><script>${inlineScript}</script></body></html>\n`;
await mkdir(output,{recursive:true});await writeFile(resolve(output,'mach-tien-next-review.html'),html);await writeFile(resolve(output,'mach-tien-next-review.syntax.mjs'),script);await writeFile(resolve(output,'mach-tien-next-review.manifest.json'),JSON.stringify({schema:1,reviewIteration:'V4-mobile-20261009',entry:'ui/app.js',scriptCspHash:hash,htmlSha256:createHash('sha256').update(html).digest('hex'),modules:manifest},null,2)+'\n');
console.log(JSON.stringify({modules:modules.size,bytes:Buffer.byteLength(html),output:resolve(output,'mach-tien-next-review.html')}));

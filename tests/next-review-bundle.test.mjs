import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {nextHarness} from './next-ui-harness.mjs';
import {reviewArtifactUrl} from '../scripts/review-output.mjs';
test('review bundle hash matches inline script and bundled UI runs a synthetic onboarding flow',async()=>{
 const html=await readFile(reviewArtifactUrl('mach-tien-next-review.html'),'utf8');
 const matches=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(matches.length,1);const script=matches[0][1];
 const manifest=JSON.parse(await readFile(reviewArtifactUrl('mach-tien-next-review.manifest.json'),'utf8'));
 assert.equal(manifest.scriptCspHash,'sha256-'+createHash('sha256').update(script).digest('base64'));assert.equal(manifest.htmlSha256,createHash('sha256').update(html).digest('hex'));assert.ok(html.includes(manifest.scriptCspHash));
 for(const file of manifest.modules)assert.equal(file.sha256,createHash('sha256').update(await readFile(new URL('../'+file.path,import.meta.url))).digest('hex'));
 const context=vm.createContext({crypto:webcrypto,structuredClone,TextEncoder,Intl,Date,console});vm.runInContext(script,context);assert.ok(context.__machTienReview.createNextApp);assert.equal(vm.runInContext("typeof modules['ui/shared-view.js']",context),'undefined');assert.equal(vm.runInContext("typeof modules['ui/shared-offline-view.js'].createSharedOfflineView",context),'function');assert.equal(vm.runInContext("typeof modules['shared-embed.js']",context),'undefined');assert.ok(html.includes("frame-src 'none'"));
 const h=await nextHarness({appFactory:context.__machTienReview.createNextApp});await h.app.go('create');await h.submit('onboard-form',{locale:'vi-VN',currencyCode:'VND',timezoneId:'Asia/Ho_Chi_Minh',name:'Synthetic bundled account',accountType:'BANK',opening:'5.000',openingDate:'2026-10-01'});assert.equal(h.app.currentRoute(),'overview');assert.equal(h.app.snapshot().postings[0].signedAmountMinor,'5000');h.app.close();
});

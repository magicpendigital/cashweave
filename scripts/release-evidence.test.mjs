import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256,validateRelease,testedBundleSha256} from './release-evidence.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'release-evidence-'));
  t.after(()=>{const base=fs.realpathSync(os.tmpdir());const resolved=fs.realpathSync(root);assert.ok(resolved.startsWith(base+path.sep));fs.rmSync(resolved,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'docs/release'),{recursive:true});
  fs.mkdirSync(path.join(root,'src'));
  fs.writeFileSync(path.join(root,'src/app.js'),'synthetic source');
  fs.writeFileSync(path.join(root,'build.bin'),'synthetic artifact');
  fs.writeFileSync(path.join(root,'docs/release/RELEASE_RUNBOOK.md'),'synthetic test policy, no deployment authority');
  const receipt={schemaVersion:1,checkId:'save',status:'PASS',sourceIdentity:'synthetic-1',target:{id:'local-review',kind:'local-review'},command:'synthetic test fixture',exitCode:0,environment:'isolated synthetic test',executedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(root,'check.json'),JSON.stringify(receipt));
  fs.writeFileSync(path.join(root,'owner.md'),'synthetic owner packet');
  const profile={schemaVersion:1,projectId:'test',mode:'offline',targets:[{id:'local-review',kind:'local-review'}],blockers:[],inputRoots:['src'],requiredChecks:[{id:'save',allowNotApplicable:false}]};
  const record=p=>({path:p,sha256:sha256(fs.readFileSync(path.join(root,p)))});
  const manifest={schemaVersion:1,projectId:'test',mode:'offline',releaseId:'review-1',target:{id:'local-review',kind:'local-review'},source:{kind:'snapshot',commit:null,snapshotId:'synthetic-1',inputs:[record('src/app.js')]},artifacts:[record('build.bin')],migrations:[],config:{expectations:{offline:true},expectationsSha256:sha256(Buffer.from(JSON.stringify({offline:true})))},checks:[{id:'save',status:'PASS',evidence:record('check.json')}],ownerPacket:record('owner.md')};
  const prepare=(approvalOverride={})=>{
    fs.writeFileSync(path.join(root,'docs/release/release-profile.json'),JSON.stringify(profile));
    manifest.policy={profileSha256:record('docs/release/release-profile.json').sha256,runbookSha256:record('docs/release/RELEASE_RUNBOOK.md').sha256,checkerSha256:sha256(fs.readFileSync(fileURLToPath(new URL('./release-evidence.mjs',import.meta.url))))};
    const bytes=Buffer.from(JSON.stringify(manifest));
    const approval={decision:'APPROVE',revoked:false,owner:'synthetic fixture',releaseId:manifest.releaseId,targetId:manifest.target.id,manifestSha256:sha256(bytes),approvedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),...approvalOverride};
    return {bytes,approvalBytes:Buffer.from(JSON.stringify(approval))};
  };
  const run=(approvalOverride={})=>{const data=prepare(approvalOverride);return validateRelease(root,data.bytes,data.approvalBytes);};
  const bindReceipt=()=>{prepare();receipt.testedBundleSha256=testedBundleSha256(manifest);fs.writeFileSync(path.join(root,'check.json'),JSON.stringify(receipt));const check=manifest.checks?.find(c=>c.id==='save');if(check?.evidence)check.evidence=record('check.json');};
  bindReceipt();
  return {root,profile,manifest,run,record,prepare,receipt,bindReceipt};
}
test('valid synthetic offline evidence passes without granting release authority',t=>{const f=fixture(t);const r=f.run();assert.equal(r.status,'PASS');assert.equal(r.releaseAuthorized,false);assert.deepEqual(r.results.filter(check=>check.id==='approval'),[{id:'approval',status:'PASS',detail:'APPROVAL_BINDING'}]);});
for (const [label,value] of [['null',null],['false',false],['zero',0],['empty string',''],['empty array',[]],['true',true],['positive number',1],['nonempty string','APPROVE']]) {
  test(`approval JSON ${label} blocks an otherwise valid evidence bundle`,t=>{
    const f=fixture(t),{bytes}=f.prepare();
    const result=validateRelease(f.root,bytes,Buffer.from(JSON.stringify(value)));
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.releaseAuthorized,false);
    assert.deepEqual(result.results.filter(check=>check.id==='approval'),[{id:'approval',status:'BLOCKED',detail:'EXACT_OWNER_APPROVAL_REQUIRED'}]);
  });
}
test('malformed and incomplete object approvals each produce one blocking approval result',t=>{
  const f=fixture(t),{bytes}=f.prepare();
  for(const raw of ['', '{', '{}']){
    const result=validateRelease(f.root,bytes,Buffer.from(raw)),checks=result.results.filter(check=>check.id==='approval');
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.releaseAuthorized,false);
    assert.equal(checks.length,1);
    assert.equal(checks[0].status,'BLOCKED');
  }
});
test('missing target blocks',t=>{const f=fixture(t);f.manifest.target={id:'production',kind:'production'};f.receipt.target=f.manifest.target;f.bindReceipt();assert.equal(f.run().status,'BLOCKED');});
test('changed source fails',t=>{const f=fixture(t);fs.writeFileSync(path.join(f.root,'src/app.js'),'changed');assert.equal(f.run().status,'FAIL');});
test('new unrecorded source fails',t=>{const f=fixture(t);fs.writeFileSync(path.join(f.root,'src/new.js'),'changed');assert.equal(f.run().status,'FAIL');});
test('changed built artifact fails',t=>{const f=fixture(t);fs.writeFileSync(path.join(f.root,'build.bin'),'changed');assert.equal(f.run().status,'FAIL');});
test('missing artifact blocks',t=>{const f=fixture(t);f.manifest.artifacts=[];f.bindReceipt();assert.equal(f.run().status,'BLOCKED');});
test('missing test evidence blocks',t=>{const f=fixture(t);f.manifest.checks=[];assert.equal(f.run().status,'BLOCKED');});
test('failure is never treated as passing evidence',t=>{const f=fixture(t);f.manifest.checks[0].status='FAIL';assert.equal(f.run().status,'FAIL');});
test('unknown status fails',t=>{const f=fixture(t);f.manifest.checks[0].status='UNVERIFIED';assert.equal(f.run().status,'FAIL');});
test('unapproved N/A fails',t=>{const f=fixture(t);f.manifest.checks[0]={id:'save',status:'NOT_APPLICABLE',reason:'not in this scope'};assert.equal(f.run().status,'FAIL');});
test('allowed N/A still requires hashed scope evidence',t=>{const f=fixture(t);f.profile.requiredChecks[0].allowNotApplicable=true;Object.assign(f.receipt,{status:'NOT_APPLICABLE',exitCode:null,reason:'not in this scope'});f.manifest.checks[0]={id:'save',status:'NOT_APPLICABLE',reason:'not in this scope',evidence:f.record('check.json')};f.bindReceipt();assert.equal(f.run().status,'PASS');delete f.manifest.checks[0].evidence;assert.equal(f.run().status,'FAIL');});
test('old approval invalidated by manifest changes',t=>{const f=fixture(t);assert.equal(f.run({manifestSha256:'0'.repeat(64)}).status,'BLOCKED');});
test('approval must bind the target and decision',t=>{const f=fixture(t);assert.equal(f.run({targetId:'another-target'}).status,'BLOCKED');assert.equal(f.run({decision:'REJECT'}).status,'BLOCKED');});
test('config hash mismatch fails',t=>{const f=fixture(t);f.manifest.config.expectations={offline:false};assert.equal(f.run().status,'FAIL');});
test('path traversal is rejected before reading',t=>{const f=fixture(t);f.manifest.artifacts=[{path:'../outside.txt',sha256:'0'.repeat(64)}];assert.equal(f.run().status,'FAIL');});
test('credential paths are prohibited before reading',t=>{const f=fixture(t);f.manifest.artifacts=[{path:'.env.local',sha256:'0'.repeat(64)}];assert.equal(f.run().status,'FAIL');});
test('offline manifest cannot introduce cloud migrations',t=>{const f=fixture(t);f.manifest.migrations=[{path:'migration.sql',sha256:'0'.repeat(64)}];assert.equal(f.run().status,'FAIL');});
test('documented blockers remain blocking even with passing records',t=>{const f=fixture(t);f.profile.blockers=['reviewed-migration-blocker'];f.bindReceipt();assert.equal(f.run().status,'BLOCKED');});
test('cloud evidence cannot use snapshot identity',t=>{const f=fixture(t);f.profile.mode='cloud';f.manifest.mode='cloud';assert.equal(f.run().status,'FAIL');});
test('additional failed checks are not ignored',t=>{const f=fixture(t);f.manifest.checks.push({id:'unexpected-regression',status:'FAIL'});assert.equal(f.run().status,'FAIL');});
function cloudFixture(t) {
  const f=fixture(t);
  f.profile.mode='cloud';f.manifest.mode='cloud';
  f.profile.environmentPolicy={stagingOrganizationId:'drxbmvimiekeoeesgssp',productionOrganizationId:'rzbpjfrndhrtxagpgdre'};
  const target={id:'reviewed-staging',kind:'staging',organizationId:'drxbmvimiekeoeesgssp',projectRef:'abcdefghijklmnopqrst'};
  f.profile.targets=[target];f.manifest.target={...target};
  f.manifest.config.expectations={target:f.manifest.target};
  f.manifest.config.expectationsSha256=sha256(Buffer.from(JSON.stringify(f.manifest.config.expectations)));
  fs.mkdirSync(path.join(f.root,'supabase/migrations'),{recursive:true});
  fs.writeFileSync(path.join(f.root,'supabase/migrations/20261004000000_test.sql'),'-- synthetic SQL, never executed');
  f.manifest.migrations=[f.record('supabase/migrations/20261004000000_test.sql')];
  f.profile.ledgerPath='supabase/ledger.json';
  fs.writeFileSync(path.join(f.root,'supabase/ledger.json'),JSON.stringify({status:'blocked_pending_reconciliation'}));
  return f;
}
test('same project alias in wrong organization blocks',t=>{const f=cloudFixture(t);f.manifest.target.organizationId='rzbpjfrndhrtxagpgdre';const r=f.run();assert.equal(r.results.find(c=>c.id==='target').status,'BLOCKED');assert.equal(r.results.find(c=>c.id==='organization-project').status,'BLOCKED');});
test('production cannot be allowlisted in the staging organization',t=>{const f=cloudFixture(t);f.profile.targets[0].kind='production';f.manifest.target.kind='production';assert.equal(f.run().results.find(c=>c.id==='organization-project').status,'BLOCKED');});
test('migration bytes and complete inventory are verified',t=>{const f=cloudFixture(t);fs.writeFileSync(path.join(f.root,'supabase/migrations/20261004000000_test.sql'),'-- changed');assert.equal(f.run().results.find(c=>c.id==='migration-0').status,'FAIL');f.manifest.migrations=[];assert.equal(f.run().results.find(c=>c.id==='migrations').status,'FAIL');});
test('foreign-history ledger remains blocked and only reconciled is accepted',t=>{const f=cloudFixture(t);assert.equal(f.run().results.find(c=>c.id==='migration-ledger').status,'BLOCKED');fs.writeFileSync(path.join(f.root,'supabase/ledger.json'),JSON.stringify({status:'ready'}));assert.equal(f.run().results.find(c=>c.id==='migration-ledger').status,'BLOCKED');fs.writeFileSync(path.join(f.root,'supabase/ledger.json'),JSON.stringify({status:'reconciled'}));assert.equal(f.run().results.find(c=>c.id==='migration-ledger').status,'PASS');});
test('approval timestamps must be parseable and not future',t=>{const f=fixture(t);assert.equal(f.run({approvedAt:'not-a-time'}).status,'BLOCKED');assert.equal(f.run({approvedAt:new Date(Date.now()+86400000).toISOString(),expiresAt:new Date(Date.now()+172800000).toISOString()}).status,'BLOCKED');});
test('approval must have a valid unexpired lifetime',t=>{const f=fixture(t);assert.equal(f.run({expiresAt:undefined}).status,'BLOCKED');assert.equal(f.run({expiresAt:'bad-time'}).status,'BLOCKED');assert.equal(f.run({expiresAt:new Date(Date.now()-1000).toISOString()}).status,'BLOCKED');});
test('revoked or unspecified revocation state is never accepted',t=>{const f=fixture(t);assert.equal(f.run({revoked:true}).status,'BLOCKED');assert.equal(f.run({revoked:undefined}).status,'BLOCKED');});
test('policy tampering is detected even when inputRoots omit policy files',t=>{const f=fixture(t);const frozen=f.prepare();f.profile.requiredChecks=[];fs.writeFileSync(path.join(f.root,'docs/release/release-profile.json'),JSON.stringify(f.profile));const r=validateRelease(f.root,frozen.bytes,frozen.approvalBytes);assert.equal(r.results.find(c=>c.id==='policy-profile').status,'FAIL');assert.equal(r.status,'FAIL');});
test('runbook and checker hashes are mandatory independent policy bindings',t=>{const f=fixture(t);const frozen=f.prepare();fs.writeFileSync(path.join(f.root,'docs/release/RELEASE_RUNBOOK.md'),'tampered policy');assert.equal(validateRelease(f.root,frozen.bytes,frozen.approvalBytes).results.find(c=>c.id==='policy-runbook').status,'FAIL');const manifest=JSON.parse(frozen.bytes);delete manifest.policy;const r=validateRelease(f.root,Buffer.from(JSON.stringify(manifest)),frozen.approvalBytes);assert.equal(r.results.find(c=>c.id==='policy-checker').status,'FAIL');});
test('receipt body FAIL cannot be declared PASS',t=>{const f=fixture(t);f.receipt.status='FAIL';f.receipt.exitCode=1;fs.writeFileSync(path.join(f.root,'check.json'),JSON.stringify(f.receipt));f.manifest.checks[0].evidence=f.record('check.json');assert.equal(f.run().results.find(c=>c.id==='save-receipt').status,'FAIL');});
test('plain text and wrong source/target receipts fail',t=>{const f=fixture(t);fs.writeFileSync(path.join(f.root,'check.json'),'PASS unstructured text');f.manifest.checks[0].evidence=f.record('check.json');assert.equal(f.run().status,'FAIL');f.receipt.sourceIdentity='another-source';fs.writeFileSync(path.join(f.root,'check.json'),JSON.stringify(f.receipt));f.manifest.checks[0].evidence=f.record('check.json');assert.equal(f.run().status,'FAIL');});
test('full synthetic cloud bundle passes in a clean temporary Git repository',t=>{
  const f=cloudFixture(t);
  fs.writeFileSync(path.join(f.root,'supabase/ledger.json'),JSON.stringify({status:'reconciled'}));
  f.profile.inputRoots=['src','docs/release','supabase'];
  // Only this disposable synthetic fixture is committed; never a real project.
  fs.writeFileSync(path.join(f.root,'docs/release/release-profile.json'),JSON.stringify(f.profile));
  const git=args=>execFileSync('git',['-c',`safe.directory=${f.root}`,'-c','core.autocrlf=false','-c','commit.gpgsign=false','-c','core.hooksPath=NUL','-C',f.root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','--quiet']);git(['add','src','docs/release','supabase']);
  git(['-c','user.name=Synthetic release test','-c','user.email=synthetic@example.invalid','commit','--quiet','-m','Synthetic fixture only']);
  const commit=git(['rev-parse','HEAD']);
  const files=['src/app.js','docs/release/RELEASE_RUNBOOK.md','docs/release/release-profile.json','supabase/ledger.json','supabase/migrations/20261004000000_test.sql'];
  f.manifest.source={kind:'git',repoRoot:f.root,commit,inputs:files.map(f.record)};
  f.receipt.sourceIdentity=commit;f.receipt.target=f.manifest.target;
  f.bindReceipt();
  const r=f.run();assert.equal(r.status,'PASS',JSON.stringify(r.results));assert.equal(r.validationType,'EvidenceBundleValidation');assert.equal(r.releaseAuthorized,false);
});
test('old receipt cannot approve changed artifact even with updated hashes and fresh approval',t=>{
  const f=fixture(t);assert.equal(f.run().status,'PASS');
  fs.writeFileSync(path.join(f.root,'build.bin'),'different synthetic artifact');
  f.manifest.artifacts=[f.record('build.bin')];
  const r=f.run();assert.equal(r.results.find(c=>c.id==='artifact-0').status,'PASS');assert.equal(r.results.find(c=>c.id==='approval').status,'PASS');assert.equal(r.results.find(c=>c.id==='save-receipt').status,'FAIL');
});
test('old receipt cannot approve changed config or known input hashes',t=>{
  const f=fixture(t);assert.equal(f.run().status,'PASS');
  f.manifest.config.expectations={offline:true,featureVersion:2};f.manifest.config.expectationsSha256=sha256(Buffer.from(JSON.stringify(f.manifest.config.expectations)));
  assert.equal(f.run().results.find(c=>c.id==='save-receipt').status,'FAIL');
  f.manifest.config.expectations={offline:true};f.manifest.config.expectationsSha256=sha256(Buffer.from(JSON.stringify(f.manifest.config.expectations)));
  fs.writeFileSync(path.join(f.root,'src/app.js'),'new source with the same snapshot label');f.manifest.source.inputs=[f.record('src/app.js')];
  assert.equal(f.run().results.find(c=>c.id==='save-receipt').status,'FAIL');
});
test('receipt is bound to release identity and cannot be omitted',t=>{
  const f=fixture(t);assert.equal(f.run().status,'PASS');f.manifest.releaseId='review-2';assert.equal(f.run().results.find(c=>c.id==='save-receipt').status,'FAIL');
  f.manifest.releaseId='review-1';const receipt=JSON.parse(fs.readFileSync(path.join(f.root,'check.json'),'utf8'));delete receipt.testedBundleSha256;fs.writeFileSync(path.join(f.root,'check.json'),JSON.stringify(receipt));f.manifest.checks[0].evidence=f.record('check.json');assert.equal(f.run().results.find(c=>c.id==='save-receipt').status,'FAIL');
});
test('fresh receipt binding permits a genuinely new synthetic candidate',t=>{
  const f=fixture(t);assert.equal(f.run().status,'PASS');fs.writeFileSync(path.join(f.root,'build.bin'),'new tested synthetic artifact');f.manifest.artifacts=[f.record('build.bin')];f.manifest.releaseId='review-2';f.manifest.config.expectations={offline:true,featureVersion:2};f.manifest.config.expectationsSha256=sha256(Buffer.from(JSON.stringify(f.manifest.config.expectations)));
  f.receipt.testedBundleSha256=testedBundleSha256(f.manifest);fs.writeFileSync(path.join(f.root,'check.json'),JSON.stringify(f.receipt));f.manifest.checks[0].evidence=f.record('check.json');const r=f.run();assert.equal(r.status,'PASS');assert.equal(r.releaseAuthorized,false);
});
test('tested-scope digest is stable and excludes receipts to avoid a hash cycle',t=>{
  const f=fixture(t);f.prepare();const digest=testedBundleSha256(f.manifest);
  const reordered={...f.manifest,config:{expectationsSha256:f.manifest.config.expectationsSha256,expectations:f.manifest.config.expectations},checks:[{id:'different-receipt'}]};assert.equal(testedBundleSha256(reordered),digest);
  reordered.migrations=[{path:'synthetic.sql',sha256:'0'.repeat(64)}];assert.notEqual(testedBundleSha256(reordered),digest);
});

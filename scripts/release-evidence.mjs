import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const prohibited = /(^|\/)(\.env(?:\..*)?|\.git|node_modules|credentials?|secrets?|.*\.(?:pem|p12|pfx|keystore|jks))($|\/)/i;

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const fileSet = entries => Array.isArray(entries) ? entries.map(entry => ({path:entry?.path,sha256:entry?.sha256})).sort((a,b)=>String(a.path)<String(b.path)?-1:String(a.path)>String(b.path)?1:0) : null;

// Does not include checks/receipts, owner packet or approval: no circular digest.
// File-list order and object-key order do not change the tested scope.
export function testedBundleSha256(manifest) {
  const scope={schemaVersion:manifest.schemaVersion,projectId:manifest.projectId,mode:manifest.mode,releaseId:manifest.releaseId,target:manifest.target,source:{kind:manifest.source?.kind,repoRoot:manifest.source?.repoRoot,commit:manifest.source?.commit,snapshotId:manifest.source?.snapshotId,inputs:fileSet(manifest.source?.inputs)},artifacts:fileSet(manifest.artifacts),migrations:fileSet(manifest.migrations),config:manifest.config,policy:manifest.policy};
  return sha256(Buffer.from(JSON.stringify(canonical(scope))));
}

// Read-only evidence gate. It neither deploys nor authenticates approval authors.
export function validateRelease(root, manifestBytes, approvalBytes) {
  const results = [];
  const add = (id, status, detail) => results.push({id, status, detail});
  root = fs.realpathSync(root);
  function safeFile(relative) {
    if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') || path.isAbsolute(relative) || relative.split('/').some(p => !p || p === '.' || p === '..') || prohibited.test(relative)) throw Error('UNSAFE_PATH');
    const full = path.join(root, relative);
    let cursor = root;
    for (const part of relative.split('/')) {
      cursor = path.join(cursor, part);
      if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Error('SYMLINK_PATH');
    }
    if (!fs.existsSync(full)) throw Error('MISSING_FILE');
    if (!fs.statSync(full).isFile()) throw Error('NOT_FILE');
    return full;
  }
  function fileRecord(record, id) {
    if (!record || !hashPattern.test(record.sha256 ?? '')) {add(id, 'FAIL', 'INVALID_FILE_RECORD'); return false;}
    try {const valid=sha256(fs.readFileSync(safeFile(record.path))) === record.sha256;add(id, valid ? 'PASS' : 'FAIL', 'FILE_HASH');return valid;}
    catch (error) {add(id, error.message === 'MISSING_FILE' ? 'BLOCKED' : 'FAIL', error.message);}
    return false;
  }
  function checkReceipt(check) {
    if (!fileRecord(check.evidence,check.id)) return;
    try {
      const receipt=JSON.parse(fs.readFileSync(safeFile(check.evidence.path),'utf8'));
      const claimedSource=manifest.source?.kind === 'git' ? manifest.source.commit : manifest.source?.snapshotId;
      const timestamp=Date.parse(receipt.executedAt ?? '');
      const valid=receipt.schemaVersion === 1 && receipt.checkId === check.id && receipt.status === check.status && receipt.sourceIdentity === claimedSource && receipt.testedBundleSha256 === testedBundleSha256(manifest) && JSON.stringify(receipt.target) === JSON.stringify(manifest.target) && typeof receipt.command === 'string' && receipt.command.trim().length > 0 && typeof receipt.environment === 'string' && receipt.environment.trim().length > 0 && Number.isFinite(timestamp) && timestamp <= Date.now() && (check.status === 'PASS' ? receipt.exitCode === 0 : receipt.exitCode === null && receipt.reason === check.reason);
      add(`${check.id}-receipt`,valid ? 'PASS' : 'FAIL','RECEIPT_STATUS_SCOPE_AND_EXIT');
    } catch {add(`${check.id}-receipt`,'FAIL','STRUCTURED_RECEIPT_REQUIRED');}
  }
  function inventory(relative, output = []) {
    if (prohibited.test(relative) || relative.includes('\\') || relative.includes(':') || relative.split('/').some(p => !p || p === '.' || p === '..')) throw Error('UNSAFE_INPUT_ROOT');
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) throw Error('MISSING_INPUT_ROOT');
    if (fs.lstatSync(full).isSymbolicLink()) throw Error('SYMLINK_INPUT');
    if (fs.statSync(full).isDirectory()) {
      for (const entry of fs.readdirSync(full).sort()) inventory(`${relative}/${entry}`, output);
    } else {safeFile(relative); output.push(relative);}
    return output;
  }
  let profile, manifest;
  try {
    profile = JSON.parse(fs.readFileSync(safeFile('docs/release/release-profile.json'), 'utf8'));
    manifest = JSON.parse(manifestBytes);
  } catch {return {validationType:'EvidenceBundleValidation',status:'FAIL', releaseAuthorized:false, results:[{id:'parse',status:'FAIL',detail:'INVALID_OR_MISSING_PROFILE_OR_MANIFEST'}]};}
  // These hashes are mandatory even if a changed profile excludes its own files.
  fileRecord({path:'docs/release/release-profile.json',sha256:manifest.policy?.profileSha256},'policy-profile');
  fileRecord({path:'docs/release/RELEASE_RUNBOOK.md',sha256:manifest.policy?.runbookSha256},'policy-runbook');
  const checkerHash=sha256(fs.readFileSync(fileURLToPath(import.meta.url)));
  add('policy-checker',manifest.policy?.checkerSha256 === checkerHash ? 'PASS' : 'FAIL','CHECKER_HASH');
  if (profile.schemaVersion !== 1 || manifest.schemaVersion !== 1 || manifest.projectId !== profile.projectId || manifest.mode !== profile.mode || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(manifest.releaseId ?? '')) add('identity','FAIL','INVALID_IDENTITY');
  if (!Array.isArray(profile.targets) || !profile.targets.some(t => t.id === manifest.target?.id && t.kind === manifest.target?.kind && (profile.mode !== 'cloud' || (t.organizationId === manifest.target.organizationId && t.projectRef === manifest.target.projectRef && /^[a-z]{20}$/.test(t.projectRef ?? ''))))) add('target','BLOCKED','TARGET_NOT_ALLOWLISTED');
  else add('target','PASS','ALLOWLIST_MATCH');
  if (profile.mode === 'cloud') {
    const requiredOrg = manifest.target?.kind === 'staging' ? profile.environmentPolicy?.stagingOrganizationId : manifest.target?.kind === 'production' ? profile.environmentPolicy?.productionOrganizationId : null;
    if (!requiredOrg || manifest.target?.organizationId !== requiredOrg || !/^[a-z]{20}$/.test(manifest.target?.projectRef ?? '')) add('organization-project','BLOCKED','ORGANIZATION_AND_PROJECT_MAPPING_REQUIRED');
    if (JSON.stringify(manifest.config?.expectations?.target) !== JSON.stringify(manifest.target)) add('target-config','FAIL','TARGET_CONFIG_BINDING_REQUIRED');
  }
  for (const blocker of profile.blockers ?? []) add('policy-blocker','BLOCKED',blocker);
  if (profile.mode === 'cloud' && manifest.source?.kind !== 'git') add('source','FAIL','CLOUD_REQUIRES_GIT');
  const git = args => execFileSync('git',['-c',`safe.directory=${root}`,'--no-optional-locks','-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  try {
    if (manifest.source?.kind === 'git') {
      const top = fs.realpathSync(git(['rev-parse','--show-toplevel']));
      const claimedRoot = fs.realpathSync(manifest.source.repoRoot);
      if (top !== claimedRoot) add('repository','FAIL','REPOSITORY_ROOT_MISMATCH');
      if (!/^[a-f0-9]{40}$/.test(manifest.source.commit ?? '') || git(['rev-parse','HEAD']) !== manifest.source.commit) add('commit','FAIL','COMMIT_MISMATCH');
      if (git(['status','--porcelain=v1','--untracked-files=no'])) add('working-tree','BLOCKED','TRACKED_CHANGES_REQUIRE_REVIEWED_COMMIT');
    } else if (manifest.source?.kind === 'snapshot' && profile.mode === 'offline' && manifest.source.commit === null) {
      if (!manifest.source.snapshotId) add('source','FAIL','SNAPSHOT_ID_REQUIRED');
      try {git(['rev-parse','--show-toplevel']); add('source','FAIL','EXISTING_GIT_CANNOT_USE_SNAPSHOT');} catch {}
    }
    else if (manifest.source?.kind !== 'snapshot' || profile.mode !== 'offline' || manifest.source.commit !== null) add('source','FAIL','INVALID_SOURCE_KIND');
  } catch {add('repository','BLOCKED','GIT_OR_REPOSITORY_UNAVAILABLE');}
  try {
    const expected = [...new Set(profile.inputRoots.flatMap(r => inventory(r)))].sort();
    const entries = manifest.source?.inputs;
    if (!Array.isArray(entries) || entries.length === 0 || new Set(entries.map(e => e.path)).size !== entries.length || JSON.stringify(entries.map(e => e.path).sort()) !== JSON.stringify(expected)) add('inputs','FAIL','INPUT_INVENTORY_MISMATCH');
    else entries.forEach((entry, index) => fileRecord(entry,`input-${index}`));
  } catch {add('inputs','BLOCKED','INPUT_INVENTORY_UNAVAILABLE_OR_UNSAFE');}
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) add('artifacts','BLOCKED','ARTIFACTS_REQUIRED');
  else manifest.artifacts.forEach((entry,index) => fileRecord(entry,`artifact-${index}`));
  if (!hashPattern.test(manifest.config?.expectationsSha256 ?? '')) add('config','BLOCKED','CONFIG_EXPECTATIONS_REQUIRED');
  else {
    const actual = sha256(Buffer.from(JSON.stringify(manifest.config.expectations ?? null)));
    add('config',actual === manifest.config.expectationsSha256 ? 'PASS' : 'FAIL','CONFIG_EXPECTATIONS_HASH');
  }
  if (profile.mode === 'cloud') {
    try {
      const expected = inventory('supabase/migrations').filter(p => p.endsWith('.sql')).sort();
      const entries = manifest.migrations;
      if (!Array.isArray(entries) || expected.length === 0 || JSON.stringify(entries.map(e => e.path).sort()) !== JSON.stringify(expected) || new Set(entries.map(e => e.path)).size !== entries.length) add('migrations','FAIL','MIGRATION_INVENTORY_MISMATCH');
      else entries.forEach((entry,index) => fileRecord(entry,`migration-${index}`));
      if (profile.ledgerPath) {
        const ledger = JSON.parse(fs.readFileSync(safeFile(profile.ledgerPath),'utf8'));
        add('migration-ledger',ledger.status === 'reconciled' ? 'PASS' : 'BLOCKED','LEDGER_STATUS');
      }
    } catch {add('migrations','BLOCKED','MIGRATION_OR_LEDGER_UNAVAILABLE');}
  } else if (!Array.isArray(manifest.migrations) || manifest.migrations.length) add('migrations','FAIL','OFFLINE_REQUIRES_EMPTY_MIGRATIONS');
  if (!Array.isArray(manifest.checks) || new Set(manifest.checks.map(c => c.id)).size !== manifest.checks.length) add('checks','FAIL','INVALID_OR_DUPLICATE_CHECKS');
  for (const rule of profile.requiredChecks ?? []) {
    const check = manifest.checks?.find?.(c => c.id === rule.id);
    if (!check) {add(rule.id,'BLOCKED','CHECK_REQUIRED');continue;}
    if (!['PASS','FAIL','BLOCKED','NOT_APPLICABLE'].includes(check.status)) {add(rule.id,'FAIL','INVALID_CHECK_STATUS');continue;}
    if (check.status === 'NOT_APPLICABLE') {
      add(rule.id,rule.allowNotApplicable === true && typeof check.reason === 'string' && check.reason.trim().length >= 12 ? 'NOT_APPLICABLE' : 'FAIL','APPLICABILITY_REASON');
      if (rule.allowNotApplicable === true) checkReceipt(check);
    } else if (check.status === 'PASS') checkReceipt(check);
    else add(rule.id,check.status,'REPORTED_CHECK_STATUS');
  }
  if (!Array.isArray(profile.requiredChecks) || !profile.requiredChecks.length) add('profile','FAIL','EMPTY_REQUIRED_CHECKS');
  if (Array.isArray(manifest.checks)) for (const check of manifest.checks) {
    if (!profile.requiredChecks?.some(c => c.id === check.id)) {
      if (!['PASS','FAIL','BLOCKED','NOT_APPLICABLE'].includes(check.status)) add('extra-check','FAIL','INVALID_CHECK_STATUS');
      else if (check.status === 'FAIL' || check.status === 'BLOCKED') add(check.id,check.status,'EXTRA_CHECK_UNRESOLVED');
      else if (check.status === 'PASS') checkReceipt(check);
      else add(check.id,'FAIL','UNREVIEWED_NOT_APPLICABLE');
    }
  }
  fileRecord(manifest.ownerPacket,'owner-packet');
  let approval;
  try {
    const parsed = JSON.parse(approvalBytes);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype) add('approval','BLOCKED','EXACT_OWNER_APPROVAL_REQUIRED');
    else approval = parsed;
  } catch {add('approval','BLOCKED','EXACT_OWNER_APPROVAL_REQUIRED');}
  if (approval !== undefined) {
    const approvedAt=Date.parse(approval.approvedAt ?? '');
    const expiresAt=Date.parse(approval.expiresAt ?? '');
    const now=Date.now();
    const valid = approval.decision === 'APPROVE' && approval.revoked === false && typeof approval.owner === 'string' && approval.owner.trim().length > 0 && approval.releaseId === manifest.releaseId && approval.targetId === manifest.target?.id && approval.manifestSha256 === sha256(manifestBytes) && /^\d{4}-\d\d-\d\dT/.test(approval.approvedAt ?? '') && /^\d{4}-\d\d-\d\dT/.test(approval.expiresAt ?? '') && Number.isFinite(approvedAt) && Number.isFinite(expiresAt) && approvedAt <= now && expiresAt > now && expiresAt > approvedAt;
    add('approval',valid ? 'PASS' : 'BLOCKED','APPROVAL_BINDING');
  }
  const status = results.some(r => r.status === 'FAIL') ? 'FAIL' : results.some(r => r.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
  return {validationType:'EvidenceBundleValidation',status, releaseAuthorized:false, manifestSha256:sha256(manifestBytes), testedBundleSha256:testedBundleSha256(manifest), results};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [manifestFile,approvalFile] = process.argv.slice(2);
    if (!manifestFile || !approvalFile) throw Error('ARGUMENTS');
    if ([manifestFile,approvalFile].some(p => prohibited.test(p.replaceAll('\\','/')))) throw Error('CREDENTIAL_PATH');
    const result = validateRelease(process.cwd(),fs.readFileSync(manifestFile),fs.readFileSync(approvalFile));
    console.log(JSON.stringify(result,null,2));
    process.exitCode = result.status === 'PASS' ? 0 : result.status === 'BLOCKED' ? 2 : 1;
  } catch {console.error('FAIL: provide readable nonsecret manifest and approval JSON paths. No release action was performed.');process.exitCode=1;}
}

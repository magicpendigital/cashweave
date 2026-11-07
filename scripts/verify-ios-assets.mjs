import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFile(resolve(root, path));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await read('mobile-www/asset-manifest.json'));
assert.equal(manifest.capacitor, '8.5.3');
assert.equal(manifest.network, 'disabled');
const expected = new Set(['asset-manifest.json', ...manifest.files.map(file => file.path)]);
async function list(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false, 'Symlink in iOS assets');
    if (entry.isDirectory()) files.push(...await list(resolve(directory, entry.name), prefix + entry.name + '/'));
    else files.push(prefix + entry.name);
  }
  return files;
}
for (const input of manifest.sourceInputs) assert.equal(hash(await read(input.path)), input.sha256, 'Stale generated input: ' + input.path);
for (const directory of ['mobile-www', 'ios/App/App/public']) {
  assert.deepEqual(new Set(await list(resolve(root, directory))), expected);
  for (const file of manifest.files) {
    const bytes = await read(directory + '/' + file.path);
    assert.equal(hash(bytes), file.sha256, file.path); assert.equal(bytes.length, file.bytes, file.path);
    if (!['index.html', 'legacy.html', 'shared-embed.js'].includes(file.path)) {
      const source = file.path === 'mobile/capacitor-runtime.js' ? 'node_modules/@capacitor/core/dist/index.js' : file.path === 'CAPACITOR-LICENSE.txt' ? 'node_modules/@capacitor/core/LICENSE' : file.path;
      assert.equal(hash(await read(source)), file.sha256, 'Stale source: ' + file.path);
    }
  }
}
const config = JSON.parse(await read('capacitor.config.json'));
assert.equal((await read('ios/App/App/public/shared-embed.js')).toString(), "export const sharedDocument = '';\n");
assert.deepEqual(JSON.parse(await read('ios/App/App/capacitor.config.json')), { ...config, packageClassList: [] });
assert.equal(config.server.iosScheme, 'capacitor');
assert.equal(config.ios.limitsNavigationsToAppBoundDomains, true);
assert.equal(config.plugins.CapacitorHttp.enabled, false);
for (const file of ['index.html', 'legacy.html']) {
  const html = (await read('ios/App/App/public/' + file)).toString();
  assert.match(html, /connect-src 'none'/); assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /<iframe\b|<script(?![^>]*\bsrc=)[^>]*>|src="https?:\/\//);
}
const project = (await read('ios/App/App.xcodeproj/project.pbxproj')).toString();
for (const file of ['LocalBackupPlugin.swift', 'CashWeaveViewController.swift', 'PrivacyInfo.xcprivacy']) assert.ok(project.includes(file + ' in '), file + ' missing from build target');
assert.match((await read('ios/App/CapApp-SPM/Package.swift')).toString(), /exact: "8\.5\.3"/);
console.log(JSON.stringify({ status: 'PASS', files: manifest.files.length, assetManifestSha256: hash(await read('mobile-www/asset-manifest.json')), scope: 'iOS exact-source/assets/origin/CSP/source-target check only; Swift compilation and iOS runtime NOT tested' }, null, 2));

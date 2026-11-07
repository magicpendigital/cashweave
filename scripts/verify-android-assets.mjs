import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'mobile-www');
const assets = resolve(root, 'android/app/src/main/assets');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFile(resolve(root, path));
const manifest = JSON.parse(await readFile(resolve(output, 'asset-manifest.json'), 'utf8'));
assert.equal(manifest.capacitor, '8.5.3');
assert.ok(manifest.files.some(file => file.path === 'ui/shared-offline-view.js'));
assert.ok(manifest.files.some(file => file.path === 'shared-embed.js'));
const expected = new Set(['asset-manifest.json', ...manifest.files.map(file => file.path)]);
for (const input of manifest.sourceInputs) assert.equal(hash(await read(input.path)), input.sha256, 'Stale generated input: ' + input.path);
async function list(path, prefix = '') {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Symlinks not allowed');
    if (entry.isDirectory()) files.push(...await list(resolve(path, entry.name), prefix + entry.name + '/'));
    else files.push(prefix + entry.name);
  }
  return files;
}
for (const directory of [output, resolve(assets, 'public')]) {
  assert.deepEqual(new Set(await list(directory)), expected);
  for (const file of manifest.files) {
    const content = await readFile(resolve(directory, file.path));
    assert.equal(hash(content), file.sha256, file.path);
    assert.equal(content.length, file.bytes, file.path);
    const sourcePath = file.path === 'mobile/capacitor-runtime.js' ? 'node_modules/@capacitor/core/dist/index.js' : file.path === 'CAPACITOR-LICENSE.txt' ? 'node_modules/@capacitor/core/LICENSE' : file.path;
    if (!['index.html', 'legacy.html', 'shared-embed.js'].includes(file.path)) assert.equal(hash(await read(sourcePath)), file.sha256, 'Stale source: ' + file.path);
  }
}
assert.equal(hash(await read('capacitor.config.json')), hash(await readFile(resolve(assets, 'capacitor.config.json'))));
assert.equal(await readFile(resolve(assets, 'capacitor.plugins.json'), 'utf8'), '[]\n');
const html = await readFile(resolve(output, 'index.html'), 'utf8');
assert.match(html, /<head>\n<meta charset/);
assert.match(html, /script-src 'self';/);
assert.match(html, /frame-src 'none'; connect-src 'none';/);
assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|src="https?:\/\//);
const legacy = await readFile(resolve(output, 'legacy.html'), 'utf8');
assert.equal(await readFile(resolve(output, 'shared-embed.js'), 'utf8'), "export const sharedDocument = '';\n");
assert.match(legacy, /src="\.\/mobile\/legacy-entry\.js"/);
assert.match(legacy, /connect-src 'none'/);
assert.doesNotMatch(legacy, /<iframe\b|data-view="shared"|<script(?![^>]*\bsrc=)[^>]*>|src="https?:\/\//);
const bridge = await read('node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/JSInjector.java');
assert.ok(bridge.toString().includes('modifiedHtml.insert(html.indexOf("<head>") + "<head>".length(), "\\n" + js + "\\n");'), 'Native bridge injection ordering changed; review CSP before use');
console.log(JSON.stringify({ status: 'PASS', files: manifest.files.length, scope: 'static exact-source/assets/CSP check; Android runtime behavior NOT tested', nativeInjectorSha256: hash(bridge), assetManifestSha256: hash(await readFile(resolve(output, 'asset-manifest.json'))) }, null, 2));

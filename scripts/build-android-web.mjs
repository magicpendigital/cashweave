// No network, transpilation, remote assets, minification, or financial transforms.
// Copy the app's exact ESM import graph and the pinned official native runtime.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'mobile-www');
const files = new Map();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const nameOf = path => relative(root, path).split(sep).join('/');

async function collect(path) {
  const name = nameOf(path);
  if (name.startsWith('../') || name.startsWith('/')) throw new Error('Asset outside project');
  if (files.has(name)) return;
  const source = await readFile(path, 'utf8');
  files.set(name, source);
  const imports = [...source.matchAll(/^import\s+\{[^}]+\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm)];
  let remainder = source;
  for (const match of imports) {
    if (!match[1].startsWith('.')) throw new Error('Remote or bare import: ' + name);
    remainder = remainder.replace(match[0], '');
    const dep = resolve(dirname(path), match[1]);
    if (nameOf(dep) === 'mobile/capacitor-runtime.js') continue;
    await collect(dep);
  }
  if (/^import\s/m.test(remainder) || /\bimport\s*\(/.test(source)) throw new Error('Unsupported import: ' + name);
}

await collect(resolve(root, 'mobile/entry.js'));
const pkg = JSON.parse(await readFile(resolve(root, 'node_modules/@capacitor/core/package.json'), 'utf8'));
const expected = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).dependencies['@capacitor/core'];
if (pkg.version !== expected || pkg.version !== '8.5.3') throw new Error('Unreviewed Capacitor runtime');
files.set('mobile/capacitor-runtime.js', await readFile(resolve(root, 'node_modules/@capacitor/core/dist/index.js'), 'utf8'));
files.set('ui/next.css', await readFile(resolve(root, 'ui/next.css'), 'utf8'));
files.set('mobile/native.css', await readFile(resolve(root, 'mobile/native.css'), 'utf8'));
files.set('CAPACITOR-LICENSE.txt', await readFile(resolve(root, 'node_modules/@capacitor/core/LICENSE'), 'utf8'));

// Capacitor 8.5.3 JSInjector inserts the trusted native bridge directly after
// literal <head>, before this meta policy. Keep this order and verify on device.
// The shared view is now part of the normal ESM app; no iframe/inline script.
const csp = `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'none'; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'`;
files.set('index.html', `<!doctype html>\n<html lang="vi"><head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${csp}">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta name="color-scheme" content="light">\n<title>CashWeave Trial · Offline</title>\n<link rel="stylesheet" href="./ui/next.css">\n<link rel="stylesheet" href="./mobile/native.css">\n</head><body><div id="native-feedback" aria-live="polite"></div><div id="next-app"><p role="status">Đang mở kho dữ liệu…</p></div><script type="module" src="./mobile/entry.js"></script></body></html>\n`);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const manifest = [];
for (const [name, source] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
  await mkdir(dirname(resolve(output, name)), { recursive: true });
  await writeFile(resolve(output, name), source);
  manifest.push({ path: name, sha256: sha256(source), bytes: Buffer.byteLength(source) });
}
await writeFile(resolve(output, 'asset-manifest.json'), JSON.stringify({ schemaVersion: 1, appId: 'app.cashweave.offline.trial', version: '0.4.1-trial.1', capacitor: pkg.version, network: 'disabled', files: manifest }, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', scope: 'offline ESM assets only; native build and smoke not implied', files: files.size, output }));

// Project-local asset copy. Never invokes Xcode, package resolution or signing.
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = resolve(root, 'ios/App/App');
const config = JSON.parse(await readFile(resolve(root, 'capacitor.config.json'), 'utf8'));
if (config.server.url || config.server.hostname !== 'localhost' || config.server.iosScheme !== 'capacitor') throw new Error('Unreviewed iOS origin or remote server');
const ios = JSON.parse(await readFile(resolve(root, 'node_modules/@capacitor/ios/package.json'), 'utf8'));
if (ios.version !== '8.5.3') throw new Error('Unreviewed iOS runtime');
await readFile(resolve(root, config.webDir, 'asset-manifest.json'));
await mkdir(app, { recursive: true });
const publicDirectory = resolve(app, 'public');
if (!publicDirectory.startsWith(root + '/') && !publicDirectory.startsWith(root + '\\')) throw new Error('Asset path outside workspace');
await rm(publicDirectory, { recursive: true, force: true });
await cp(resolve(root, config.webDir), publicDirectory, { recursive: true });
await writeFile(resolve(app, 'capacitor.config.json'), JSON.stringify({ ...config, packageClassList: [] }, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', scope: 'iOS exact asset copy only; no Swift compilation, package resolution or signing', app }));

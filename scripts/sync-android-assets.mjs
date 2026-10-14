// Sync only this project's local, first-party plugin and bundled web assets.
// This is intentionally not a generic Capacitor/Cordova plugin synchronizer.
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = resolve(root, 'android/app/src/main/assets');
const config = JSON.parse(await readFile(resolve(root, 'capacitor.config.json'), 'utf8'));
if (config.server.url || config.server.hostname !== 'localhost' || config.server.androidScheme !== 'https') throw new Error('Unreviewed origin or remote server');
await readFile(resolve(root, config.webDir, 'asset-manifest.json'));
await mkdir(assets, { recursive: true });
await rm(resolve(assets, 'public'), { recursive: true, force: true });
await cp(resolve(root, config.webDir), resolve(assets, 'public'), { recursive: true });
await cp(resolve(root, 'capacitor.config.json'), resolve(assets, 'capacitor.config.json'));
await writeFile(resolve(assets, 'capacitor.plugins.json'), '[]\n');
console.log(JSON.stringify({ status: 'PASS', scope: 'asset copy only; no native compilation', assets }));

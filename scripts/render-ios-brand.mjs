// Deterministic format conversion of the existing Android VectorDrawable.
// No redesign, fonts, network, AI generation, or installed app data is involved.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleRoot = process.argv[2];
if (!moduleRoot) throw new Error('Pass the existing bundled Node node_modules directory; no package installation is performed.');
const requireRenderer = createRequire(resolve(moduleRoot, 'package.json'));
const sharp = requireRenderer('sharp');
if (sharp.versions.sharp !== '0.35.5') throw new Error('Renderer version changed; review before regenerating branded assets.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePath = 'android/app/src/main/res/drawable/ic_launcher.xml';
const source = await readFile(resolve(root, sourcePath));
const xml = source.toString();
const viewportWidth = Number(xml.match(/android:viewportWidth="([\d.]+)"/)?.[1]);
const viewportHeight = Number(xml.match(/android:viewportHeight="([\d.]+)"/)?.[1]);
if (!(viewportWidth > 0) || viewportWidth !== viewportHeight || /<(?:group|clip-path)\b/.test(xml)) throw new Error('Unsupported Android vector geometry');
const paths = [...xml.matchAll(/<path\b[^>]*\/>/g)].map(([tag]) => {
  const fill = tag.match(/android:fillColor="([^"]+)"/)?.[1];
  const path = tag.match(/android:pathData="([^"]+)"/)?.[1];
  if (!/^#[0-9a-f]{6}$/i.test(fill || '') || !/^[MmZzLlHhVvCcSsQqTtAaEe\d,.\s+-]+$/.test(path || '') || /android:(?:stroke|fillAlpha|fillType)/.test(tag)) throw new Error('Unsupported Android vector path');
  return `<path fill="${fill}" d="${path}"/>`;
});
if (paths.length !== 3) throw new Error('Review changed Android vector before generating iOS assets');
const svgAtSize = size => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${viewportWidth} ${viewportHeight}">${paths.join('')}</svg>`);
const assetRoot = resolve(root, 'ios/App/App/Assets.xcassets');
const outputs = [
  { path: 'AppIcon.appiconset/AppIcon-512@2x.png', size: 1024 },
  { path: 'Splash.imageset/cashweave-splash.png', size: 128 },
  { path: 'Splash.imageset/cashweave-splash@2x.png', size: 256 },
  { path: 'Splash.imageset/cashweave-splash@3x.png', size: 384 }
];
const files = [];
for (const output of outputs) {
  const bytes = await sharp(svgAtSize(output.size), { density: 72 }).flatten({ background: '#215c47' }).removeAlpha().png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
  const target = resolve(assetRoot, output.path);
  if (!target.startsWith(assetRoot + sep)) throw new Error('Output outside iOS asset root');
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
  files.push({ path: 'ios/App/App/Assets.xcassets/' + output.path, width: output.size, height: output.size, opaque: true, sha256: hash(bytes) });
}
for (const filename of ['splash-2732x2732-1.png', 'splash-2732x2732-2.png', 'splash-2732x2732.png']) {
  const target = resolve(assetRoot, 'Splash.imageset', filename);
  if (!target.startsWith(assetRoot + sep)) throw new Error('Cleanup outside iOS asset root');
  await rm(target, { force: true });
}
const manifest = {
  schemaVersion: 1,
  purpose: 'Exact Android brand vector converted to opaque iOS PNG assets; no redesign',
  source: { path: sourcePath, sha256: hash(source) },
  generator: { path: 'scripts/render-ios-brand.mjs', sha256: hash(await readFile(fileURLToPath(import.meta.url))) },
  renderer: { sharp: sharp.versions.sharp, vips: sharp.versions.vips, rsvg: sharp.versions.rsvg },
  launch: { pointSize: 128, contentMode: 'scaleAspectFit', background: '#f5f8f3', layout: 'centered with fixed width and height; no cropping' },
  files
};
await writeFile(resolve(root, 'ios/brand-assets.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', files: files.length, sourceSha256: manifest.source.sha256, scope: 'Branded raster conversion only; iOS launch-screen runtime NOT tested' }));

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const probe = args => {
  if (process.platform !== 'darwin') return { available: false, exitCode: null, output: 'Requires macOS; no command executed' };
  const result = spawnSync('xcodebuild', args, { encoding: 'utf8', timeout: 8000, killSignal: 'SIGKILL' });
  return { available: !result.error && result.status === 0, exitCode: result.status, output: ((result.stdout || '') + (result.stderr || '')).trim() };
};
const xcode = probe(['-version']);
const sdk = probe(['-showsdks']);
const packageResolved = existsSync(resolve(root, 'ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'));
const status = process.platform === 'darwin' && xcode.available && /Xcode 26\./.test(xcode.output) && sdk.available && /iphoneos26\./.test(sdk.output) && packageResolved ? 'PASS' : 'BLOCKED';
console.log(JSON.stringify({ status, platform: process.platform, xcode, sdk, packageResolved, scope: 'Availability only; Xcode 26.x/iOS 26.x SDK and reviewed pre-resolved cached SPM packages required. No license acceptance, package download, signing, install or archive performed.' }, null, 2));
process.exitCode = status === 'PASS' ? 0 : 2;

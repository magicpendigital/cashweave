// Local analysis/build only. No package downloads, provisioning, archive or IPA.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin') { console.error('BLOCKED: iOS native analysis/build requires macOS and Xcode.'); process.exitCode = 2; }
else {
  const args = ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Release', '-destination', 'generic/platform=iOS', '-derivedDataPath', 'ios/DerivedData', '-disableAutomaticPackageResolution', '-onlyUsePackageVersionsFromResolvedFile', '-skipPackageUpdates', 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', '-jobs', '1'];
  for (const action of ['analyze', 'build']) {
    const result = spawnSync('xcodebuild', [...args, action], { cwd: root, stdio: 'inherit' });
    if (result.error || result.status !== 0) { process.exitCode = result.status || 2; break; }
  }
}

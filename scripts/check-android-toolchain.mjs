import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const probe = (command, args) => {
  // Windows Gradle is a .bat launcher; use the system command processor for
  // these fixed tool names/arguments, including synthetic test launchers.
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', ['/d', '/c', command, ...args], { encoding: 'utf8', timeout: 8000, killSignal: 'SIGKILL', windowsHide: true })
    : spawnSync(command, args, { encoding: 'utf8', timeout: 8000, killSignal: 'SIGKILL' });
  return { available: !result.error && result.status === 0, exitCode: result.status, output: ((result.stdout || '') + (result.stderr || '')).trim() };
};
const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || '';
const result = {
  checkedAt: new Date().toISOString(),
  node: process.version,
  java: probe('java', ['-version']),
  javac: probe('javac', ['-version']),
  gradle: probe('gradle', ['--version']),
  adb: probe('adb', ['version']),
  sdkConfigured: Boolean(sdk),
  sdkPlatform36: Boolean(sdk) && existsSync(resolve(sdk, 'platforms/android-36/android.jar')),
  sdkBuildTools36: Boolean(sdk) && existsSync(resolve(sdk, 'build-tools/36.0.0')),
  status: 'BLOCKED',
  scope: 'Tool availability only. This check does not accept SDK licenses, sign builds, or install devices.'
};
if (Number(process.versions.node.split('.')[0]) >= 22 && result.java.available && /version "21[.\"]/.test(result.java.output) && result.javac.available && /^javac 21\./m.test(result.javac.output) && result.gradle.available && /Gradle 8\.14\.3/.test(result.gradle.output) && result.sdkPlatform36 && result.sdkBuildTools36) result.status = 'PASS';
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === 'PASS' ? 0 : 2;

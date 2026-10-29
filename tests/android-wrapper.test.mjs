import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeBackupAdapter, MAX_BACKUP_BYTES } from '../mobile/backup-bridge.js';
import { createNativeBackHandler } from '../mobile/back-handler.js';

function setup(plugin) {
  const messages = [];
  return { adapter: createNativeBackupAdapter(plugin, (...message) => messages.push(message)), messages };
}

test('native backup reports success only after actual write completion', async () => {
  let finish;
  const { adapter, messages } = setup({ saveJson: () => new Promise(resolve => { finish = resolve; }) });
  const pending = adapter.onDownload('{"sổ":1}', 'backup.json');
  assert.equal(messages.length, 0);
  finish({ saved: true, bytes: new TextEncoder().encode('{"sổ":1}').byteLength });
  assert.deepEqual(await pending, { saved: true });
  assert.match(messages[0][0], /Đã lưu/);
  assert.notEqual(messages[0][1], true);
});

test('native backup cancellation is explicit and never called success', async () => {
  const { adapter, messages } = setup({ saveJson: async () => ({ cancelled: true }) });
  assert.equal(await adapter.onDownload('{}', 'backup.json'), undefined);
  assert.match(messages[0][0], /Đã hủy/);
  assert.doesNotMatch(messages[0][0], /Đã lưu/);
});

test('native backup failure and incorrect byte count cannot silently succeed', async () => {
  for (const saveJson of [async () => { throw new Error('provider'); }, async () => ({ saved: true, bytes: 1 }), async () => ({ saved: false, bytes: 2 })]) {
    const { adapter, messages } = setup({ saveJson });
    assert.equal(await adapter.onDownload('{}', 'backup.json'), undefined);
    assert.equal(messages[0][1], true);
    assert.match(messages[0][0], /Không xác nhận được/);
    assert.match(messages[0][0], /Tệp có thể trống hoặc chưa đầy đủ/);
  }
});

test('native backup enforces 64 MiB UTF-8 limit before picker', async () => {
  let opened = false;
  const { adapter, messages } = setup({ saveJson: async () => { opened = true; } });
  await adapter.onDownload('é'.repeat(Math.floor(MAX_BACKUP_BYTES / 2) + 1), 'backup.json');
  assert.equal(opened, false);
  assert.equal(messages[0][1], true);
  assert.match(messages[0][0], /64 MiB/);
});

test('native restore returns unchanged text and byte size for application validation', async () => {
  const text = '{"synthetic":"Sổ thử"}';
  const bytes = new TextEncoder().encode(text).byteLength;
  const { adapter } = setup({ openJson: async () => ({ text, bytes }) });
  assert.deepEqual(await adapter.onReadBackup(), { text, size: bytes });
});

test('native restore cancellation and IO errors keep restore inactive', async () => {
  for (const openJson of [async () => ({ cancelled: true }), async () => { throw new Error('read'); }, async () => ({ text: '{}', bytes: MAX_BACKUP_BYTES + 1 }), async () => ({ text: '{}', bytes: 1 })]) {
    const { adapter, messages } = setup({ openJson });
    assert.equal(await adapter.onReadBackup(), null);
    assert.ok(messages.length);
    assert.doesNotMatch(messages[0][0], /Đã lưu/);
  }
});

test('native bridge rejects overlapping pickers and resets after failure', async () => {
  let finish;
  let opens = 0;
  const { adapter, messages } = setup({ saveJson: () => new Promise(resolve => { finish = resolve; }), openJson: async () => { opens++; return { cancelled: true }; } });
  const pending = adapter.onDownload('{}', 'backup.json');
  assert.equal(await adapter.onReadBackup(), null);
  assert.equal(opens, 0);
  assert.match(messages[0][0], /Đang chọn/);
  finish({ cancelled: true });
  await pending;
  await adapter.onReadBackup();
  assert.equal(opens, 1);
});

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
test('Android configuration fixes the private origin and disables native HTTP', async () => {
  const config = JSON.parse(await read('capacitor.config.json'));
  assert.equal(config.appId, 'app.cashweave.offline.trial');
  assert.equal(config.server.hostname, 'localhost');
  assert.equal(config.server.androidScheme, 'https');
  assert.equal(config.server.url, undefined);
  assert.equal(config.server.allowNavigation, undefined);
  assert.equal(config.android.allowMixedContent, false);
  assert.equal(config.android.webContentsDebuggingEnabled, false);
  assert.equal(config.plugins.CapacitorHttp.enabled, false);
});

test('Android source manifest excludes backup, networking and broad storage permission', async () => {
  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:fullBackupContent="false"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  for (const permission of manifest.matchAll(/<uses-permission\b[^>]+>/g)) assert.match(permission[0], /tools:node="remove"/);
  const rules = await read('android/app/src/main/res/xml/data_extraction_rules.xml');
  for (const section of ['cloud-backup', 'device-transfer']) {
    const body = rules.match(new RegExp(`<${section}[^>]*>([\\s\\S]*?)<\\/${section}>`))[1];
    for (const domain of ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref']) assert.ok(body.includes(`domain="${domain}" path="."`));
  }
});

test('camera removal stays fail-closed with only a marker-specific lint suppression', async () => {
  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  const permissions = [...manifest.matchAll(/<uses-permission\b[^>]+>/g)].map(match => match[0]);
  const camera = permissions.filter(tag => /android:name="android.permission.CAMERA"/.test(tag));
  assert.equal(camera.length, 1);
  assert.match(camera[0], /tools:node="remove"/);
  assert.match(camera[0], /tools:ignore="PermissionImpliesUnsupportedChromeOsHardware"/);
  assert.equal(permissions.filter(tag => /tools:ignore=/.test(tag)).length, 1);
  assert.doesNotMatch(manifest, /<uses-feature\b[^>]*android\.hardware\.camera/);
  const gradle = await read('android/app/build.gradle');
  assert.match(gradle, /lint \{ abortOnError true \}/);
  assert.doesNotMatch(gradle, /disable.*PermissionImpliesUnsupportedChromeOsHardware/);
});

test('native Java source uses local-only pickers, bounded reads and no retained URI grant', async () => {
  const plugin = await read('android/app/src/main/java/app/cashweave/offline/trial/LocalBackupPlugin.java');
  assert.match(plugin, /Intent.ACTION_CREATE_DOCUMENT/);
  assert.match(plugin, /Intent.ACTION_OPEN_DOCUMENT/);
  assert.equal((plugin.match(/Intent.EXTRA_LOCAL_ONLY, true/g) || []).length, 2);
  assert.match(plugin, /buffer.size\(\) \+ size > MAX_BYTES/);
  assert.match(plugin, /onMalformedInput\(CodingErrorAction.REPORT\)/);
  assert.doesNotMatch(plugin, /takePersistableUriPermission|Logger\.|Log\./);
});

test('CSP scaffold allows neither arbitrary inline scripts nor eval nor network', async () => {
  const builder = await read('scripts/build-android-web.mjs');
  const csp = builder.match(/const csp = `([^`]+)`/)[1];
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp.split('script-src ')[1].split(';')[0], /unsafe-inline|unsafe-eval|https:|\*/);
  assert.match(builder, /<head>\\n<meta charset/);
});

test('native export payload is removed before picker and excluded from saved state', async () => {
  const source = await read('android/app/src/main/java/app/cashweave/offline/trial/LocalBackupPlugin.java');
  const save = source.slice(source.indexOf('public void saveJson'), source.indexOf('private Uri selectedUri'));
  assert.ok(save.indexOf('call.getData().remove("text")') < save.indexOf('launch(operation'));
  assert.ok(save.includes('Operation operation = acquire(call, payload)'));
  const callback = source.slice(source.indexOf('private void saveResult'), source.indexOf('public void openJson'));
  assert.doesNotMatch(callback, /call.getString\("text"\)/);
  assert.match(callback, /byte\[\] bytes = operation.payload/);
  const state = source.slice(source.indexOf('protected Bundle saveInstanceState'), source.indexOf('protected void restoreState'));
  assert.match(state, /putBoolean\(INTERRUPTION, active != null\)/);
  assert.doesNotMatch(state, /putString|putByteArray|super.saveInstanceState/);
  assert.match(source, /operation.payload = null/);
});

test('provider I/O is isolated, bounded and atomically settled on interruption', async () => {
  const source = await read('android/app/src/main/java/app/cashweave/offline/trial/LocalBackupPlugin.java');
  assert.doesNotMatch(source, /getBridge\(\).execute/);
  assert.match(source, /ioExecutor.submit\(runnable\)/);
  assert.match(source, /compareAndSet\(false, true\)/);
  assert.match(source, /CancellationSignal/);
  assert.match(source, /IO_TIMEOUT_SECONDS = 30/);
  assert.match(source, /cleanupExecutor.execute/);
  assert.match(source, /operation.task.cancel\(true\)/);
  assert.match(source, /IllegalStateException/);
  assert.match(source, /if \(operation == null\) \{ interruption\(call\); return; \}/);
  assert.match(source, /notifyListeners\("backupInterrupted", new JSObject\(\), true\)/);
  const entry = await read('mobile/entry.js');
  assert.match(entry, /addListener\('backupInterrupted', showInterruption\)/);
  assert.match(entry, /LocalBackup.consumeInterruption\(\)/);
  assert.match(entry, /Tệp có thể trống, chưa đầy đủ hoặc đã được ghi/);
});

test('native Back has startup readiness and per-request bounded fallback', async () => {
  const source = await read('android/app/src/main/java/app/cashweave/offline/trial/MainActivity.java');
  assert.match(source, /getBridge\(\) == null \|\| !nativeReady/);
  assert.match(source, /backHandler.postDelayed/);
  assert.match(source, /pendingBack == requestId/);
  assert.match(source, /pendingBack = 0/);
  assert.match(source, /1500/);
  assert.match(source, /removeCallbacksAndMessages\(null\)/);
});

test('Back acknowledges repeats without duplicate navigation or losing write protection', async () => {
  let finish, navigations = 0, minimizes = 0;
  const acknowledged = [];
  const plugin = { acknowledgeBack: async ({ requestId }) => acknowledged.push(requestId), minimize: async () => minimizes++ };
  const handle = createNativeBackHandler(plugin, () => ({ handleNativeBack: () => { navigations++; return new Promise(resolve => { finish = resolve; }); } }), () => {});
  const first = handle({ requestId: 1 });
  await Promise.resolve();
  await handle({ requestId: 2 });
  await handle({ requestId: 3 });
  assert.deepEqual(acknowledged, [1, 2, 3]);
  assert.equal(navigations, 1);
  finish(true);
  await first;
  assert.equal(minimizes, 0);
});

test('Back at root minimizes; failed acknowledgement leaves native fallback intact', async () => {
  let minimizes = 0, navigations = 0;
  const handle = createNativeBackHandler({ acknowledgeBack: async () => {}, minimize: async () => minimizes++ }, () => ({ handleNativeBack: async () => false }), () => {});
  await handle({ requestId: 1 });
  assert.equal(minimizes, 1);
  const blocked = createNativeBackHandler({ acknowledgeBack: async () => { throw new Error('bridge unavailable'); }, minimize: async () => minimizes++ }, () => ({ handleNativeBack: async () => { navigations++; } }), () => {});
  await blocked({ requestId: 2 });
  assert.equal(navigations, 0);
  assert.equal(minimizes, 1);
});

test('Android preflight rejects a JRE-only or wrong compiler even when SDK and Gradle exist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cashweave-preflight-'));
  try {
    const bin = join(directory, 'bin'), sdk = join(directory, 'sdk');
    await mkdir(bin);
    await mkdir(join(sdk, 'platforms/android-36'), { recursive: true });
    await mkdir(join(sdk, 'build-tools/36.0.0'), { recursive: true });
    await writeFile(join(sdk, 'platforms/android-36/android.jar'), 'synthetic toolchain fixture');
    const launcher = async (name, text) => writeFile(
      join(bin, name + (process.platform === 'win32' ? '.cmd' : '')),
      process.platform === 'win32' ? '@echo off\r\necho ' + text + '\r\n' : '#!/bin/sh\nprintf \'%s\\n\' \'' + text + '\'\n',
      { mode: 0o755 }
    );
    for (const [name, text] of Object.entries({ java: 'openjdk version "21.0.12.1"', gradle: 'Gradle 8.14.3', adb: 'Android Debug Bridge version 1.0.41' })) {
      await launcher(name, text);
    }
    const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/check-android-toolchain.mjs', import.meta.url))], { env: { ...process.env, PATH: bin, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk }, encoding: 'utf8' });
    assert.equal(run().status, 2);
    await launcher('javac', 'javac 17.0.1');
    assert.equal(run().status, 2);
    await launcher('javac', 'javac 21.0.12.1');
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'PASS');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

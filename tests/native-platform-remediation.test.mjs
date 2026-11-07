import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createNativeBackupAdapter } from '../mobile/backup-bridge.js';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);

test('native CSV uses an explicit text export without claiming a JSON backup was written', async () => {
  const calls = [], messages = [];
  const adapter = createNativeBackupAdapter({
    saveJson: async () => { throw new Error('wrong native API'); },
    saveText: async value => { calls.push(value); return { saved: true, bytes: new TextEncoder().encode(value.text).length }; }
  }, message => messages.push(message));
  const text = 'date,memo,amount\r\n2026-10-20,Sổ thử,10\r\n';
  assert.deepEqual(await adapter.onDownload(text, 'transactions.csv'), { status: 'written', bytes: new TextEncoder().encode(text).length });
  assert.deepEqual(calls, [{ text, filename: 'transactions.csv', mimeType: 'text/csv' }]);
  assert.match(messages[0], /Đã lưu tệp CSV/);
});

test('native cancellation and bad-byte writes cannot acknowledge export for recovery', async () => {
  for (const [result, expected] of [[{ cancelled: true }, 'cancelled'], [{ saved: true, bytes: 1 }, 'failed']]) {
    const adapter = createNativeBackupAdapter({ saveJson: async () => result }, () => {});
    assert.equal((await adapter.onDownload('{}', 'backup.json')).status, expected);
  }
});

test('native CSV read returns text without applying or interpreting transactions', async () => {
  const text = 'date,memo,amount\n2026-10-20,Sổ thử,10';
  const adapter = createNativeBackupAdapter({ openJson: async () => ({ text, bytes: new TextEncoder().encode(text).length }) }, () => {});
  assert.deepEqual(await adapter.onReadBackup(), { text, size: new TextEncoder().encode(text).length });
});

test('iOS Xcode target parses and wires app-local bridge sources and privacy resource into build phases', () => {
  // This parses build graph wiring only; it does not compile Swift on Windows.
  const xcode = require('xcode');
  const project = xcode.project(fileURLToPath(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url)));
  project.parseSync();
  const sources = Object.values(project.hash.project.objects.PBXSourcesBuildPhase).filter(value => value && typeof value === 'object').flatMap(value => value.files || []).map(value => value.comment);
  for (const source of ['AppDelegate.swift', 'SceneDelegate.swift', 'LocalBackupPlugin.swift', 'CashWeaveViewController.swift']) assert.ok(sources.includes(source + ' in Sources'), source);
  const resources = Object.values(project.hash.project.objects.PBXResourcesBuildPhase).filter(value => value && typeof value === 'object').flatMap(value => value.files || []).map(value => value.comment);
  assert.ok(resources.includes('PrivacyInfo.xcprivacy in Resources'));
  assert.ok(resources.includes('public in Resources'));
  for (const config of Object.values(project.pbxXCBuildConfigurationSection()).filter(value => value && typeof value === 'object')) {
    assert.equal(Number(config.buildSettings.IPHONEOS_DEPLOYMENT_TARGET), 15.4);
    if (config.buildSettings.PRODUCT_BUNDLE_IDENTIFIER) assert.equal(config.buildSettings.PRODUCT_BUNDLE_IDENTIFIER, 'app.cashweave.offline.trial');
  }
});

test('iOS Info and privacy manifests parse with fixed offline origin and app-only preferences', async () => {
  const plist = require('plist');
  const info = plist.parse(await read('ios/App/App/Info.plist'));
  assert.deepEqual(info.WKAppBoundDomains, ['localhost']);
  assert.equal(info.NSAppTransportSecurity.NSAllowsArbitraryLoads, false);
  assert.equal(info.NSAppTransportSecurity.NSAllowsArbitraryLoadsInWebContent, false);
  assert.equal(info.UIFileSharingEnabled, true); // Only explicit Documents/Backups; IndexedDB lives in Library.
  assert.equal(info.LSSupportsOpeningDocumentsInPlace, true);
  assert.equal(info.UIMainStoryboardFile, undefined);
  const privacy = plist.parse(await read('ios/App/App/PrivacyInfo.xcprivacy'));
  assert.equal(privacy.NSPrivacyTracking, false);
  assert.deepEqual(privacy.NSPrivacyCollectedDataTypes, []);
  assert.deepEqual(privacy.NSPrivacyAccessedAPITypes, [
    { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
    { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] }
  ]);
});

test('native platform source contract includes iOS without changing existing Android identity or origin', async () => {
  const config = JSON.parse(await read('capacitor.config.json'));
  assert.equal(config.appId, 'app.cashweave.offline.trial');
  assert.equal(config.server.androidScheme, 'https');
  assert.equal(config.server.iosScheme, 'capacitor');
  assert.equal(config.server.hostname, 'localhost');
  assert.match(await read('mobile/entry.js'), /\['android', 'ios'\]\.includes\(Capacitor\.getPlatform\(\)\)/);
  assert.match(await read('ios/App/App/SceneDelegate.swift'), /rootViewController = CashWeaveViewController\(\)/);
  assert.match(await read('ios/App/App/CashWeaveViewController.swift'), /registerPluginInstance\(LocalBackupPlugin\(\)\)/);
  const pkg = JSON.parse(await read('package.json'));
  for (const name of ['@capacitor/core', '@capacitor/android', '@capacitor/ios']) assert.equal(pkg.dependencies[name], '8.5.3');
  assert.ok(pkg.scripts['android:compile:unsigned'].indexOf(':app:lintRelease') < pkg.scripts['android:compile:unsigned'].indexOf(':app:bundleRelease'));
  assert.doesNotMatch(pkg.scripts['android:compile:unsigned'], /assembleRelease|signing|allowProvisioning/);
});

test('iOS source denies native HTTP and external navigation before the first web document', async () => {
  const controller = await read('ios/App/App/CashWeaveViewController.swift');
  assert.match(controller, /registerPluginInstance\(OfflineHttpPlugin\(\)\)/);
  assert.match(controller, /guard offlineRulesReady else \{ pendingRequest = request; return nil \}/);
  assert.match(controller, /NETWORK_DISABLED_OFFLINE/);
  assert.match(controller, /"type":"block"/);
  assert.doesNotMatch(controller, /nonPersistent\(|isInspectable = true|URLSession|UIApplication\.shared\.open/);
  const plugin = await read('ios/App/App/LocalBackupPlugin.swift');
  assert.match(plugin, /url\.scheme != "capacitor" \|\| url\.host != "localhost"/);
  assert.match(plugin, /bytes\.count \+ count > Self\.maxBytes/);
  assert.match(plugin, /String\(data: bytes, encoding: \.utf8\)/);
  assert.match(plugin, /guard bytes == operation\.payload/);
  assert.match(plugin, /call\.options = \[:\]/);
  assert.doesNotMatch(plugin, /UIDocumentPicker|UIActivityViewController|startAccessingSecurityScopedResource/);
  assert.match(plugin, /documents\.appendingPathComponent\("Backups"/);
  assert.match(plugin, /didEnterBackgroundNotification/);
  assert.match(plugin, /"backupInterrupted"/);
  assert.doesNotMatch(plugin, /UserDefaults.*text|NSCoder|NSKeyedArchiver|print\(/);
});

test('iOS import source only enumerates app-owned local regular files and rechecks descriptor after selection', async () => {
  const plugin = await read('ios/App/App/LocalBackupPlugin.swift');
  assert.match(plugin, /documents\.appendingPathComponent\("Imports"/);
  assert.match(plugin, /O_DIRECTORY \| O_NOFOLLOW \| O_CLOEXEC/);
  assert.match(plugin, /scanned < 250, names\.count < 50/);
  assert.match(plugin, /fstatat\(dirfd\(listing\), name, &metadata, AT_SYMLINK_NOFOLLOW\)/);
  assert.match(plugin, /openat\(directory, name, O_RDONLY \| O_NOFOLLOW \| O_CLOEXEC \| O_NONBLOCK\)/);
  assert.match(plugin, /fstat\(descriptor, &metadata\) == 0/);
  assert.match(plugin, /metadata\.st_nlink == 1/);
  assert.match(plugin, /S_IFREG/);
  const application = await read('ios/App/App/AppDelegate.swift');
  assert.match(application, /for name in \["Imports", "Backups"\]/);
});

test('Android source denies external WebView navigation before Capacitor can launch an external application', async () => {
  const plugin = await read('android/app/src/main/java/app/cashweave/offline/trial/LocalBackupPlugin.java');
  assert.match(plugin, /public Boolean shouldOverrideLoad\(Uri url\)/);
  assert.match(plugin, /!"https"\.equals\(url\.getScheme\(\)\)/);
  assert.match(plugin, /!"localhost"\.equals\(url\.getHost\(\)\)/);
  assert.match(plugin, /url\.getUserInfo\(\) != null/);
  assert.match(plugin, /url\.getPort\(\) != -1 && url\.getPort\(\) != 443/);
  assert.match(plugin, /path\.startsWith\("\/_capacitor_http_interceptor_"\)/);
});

test('iOS brand assets have exact Android source provenance, correct opaque PNG sizes and uncropped launch wiring', async () => {
  const manifest = JSON.parse(await read('ios/brand-assets.json'));
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(manifest.source.path, 'android/app/src/main/res/drawable/ic_launcher.xml');
  assert.equal(sha256(await readFile(new URL('../' + manifest.source.path, import.meta.url))), manifest.source.sha256);
  assert.equal(sha256(await readFile(new URL('../' + manifest.generator.path, import.meta.url))), manifest.generator.sha256);
  assert.deepEqual(manifest.files.map(file => [file.width, file.height]), [[1024, 1024], [128, 128], [256, 256], [384, 384]]);
  for (const asset of manifest.files) {
    const bytes = await readFile(new URL('../' + asset.path, import.meta.url));
    assert.equal(sha256(bytes), asset.sha256);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.readUInt32BE(16), asset.width);
    assert.equal(bytes.readUInt32BE(20), asset.height);
    assert.equal(bytes[25], 2, 'RGB PNG, no alpha channel: ' + asset.path);
  }
  const splash = JSON.parse(await read('ios/App/App/Assets.xcassets/Splash.imageset/Contents.json'));
  assert.deepEqual(splash.images.map(image => image.filename), ['cashweave-splash.png', 'cashweave-splash@2x.png', 'cashweave-splash@3x.png']);
  const storyboard = await read('ios/App/App/Base.lproj/LaunchScreen.storyboard');
  assert.match(storyboard, /contentMode="scaleAspectFit" image="Splash"/);
  assert.doesNotMatch(storyboard, /scaleAspectFill|systemBackgroundColor/);
  assert.match(storyboard, /firstAttribute="width" constant="128"/);
  assert.match(storyboard, /firstAttribute="height" constant="128"/);
  assert.match(storyboard, /firstAttribute="centerX"/);
  assert.match(storyboard, /firstAttribute="centerY"/);
});

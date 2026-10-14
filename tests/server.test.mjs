import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sharedScriptHash } from '../shared-csp.js';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function startPrototype(port) {
  const child = spawn(process.execPath, [join(projectRoot, 'server.js')], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Máy chủ bản mẫu không khởi động.')), 20_000);
      child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Máy chủ dừng với mã ${code}.`)); });
    });
  } catch (error) {
    child.kill();
    throw error;
  }
  return child;
}

test('máy chủ phục vụ giao diện nhưng không công khai tài liệu cá nhân', { timeout: 30_000 }, async () => {
  const port = await availablePort();
  const child = await startPrototype(port);
  try {
    const origin = `http://127.0.0.1:${port}`;
    const home = await fetch(origin);
    const privateFile = await fetch(`${origin}/documents/%2e%2e/documents/ghi-chep.csv`);
    const privateDirectory = await fetch(`${origin}/documents/ghi-chep.csv`);
    const unsupportedWrite = await fetch(`${origin}/`, { method: 'POST' });

    assert.equal(home.status, 200);
    assert.equal((await fetch(origin+'/ui/storage-failure.js')).status,200);
    for (const path of ['/next','/next.html','/ui/next.css','/ui/app.js','/ui/boot.js','/ui/dom.js','/ui/i18n.js','/core/allocation.js','/core/calendar.js','/core/commands.js','/core/identity.js','/core/migration.js','/core/model.js','/core/money.js','/core/reports.js','/core/repository.js']) assert.equal((await fetch(origin+path)).status,200);
    for (const path of ['/core/unknown.js','/ui/unknown.js','/docs/checkpoint-1.md','/tests/next-ui.test.mjs']) assert.equal((await fetch(origin+path)).status,404);
    for (const path of ['/backend/command-service.js','/tests/couples.test.mjs','/source-manifest.json','/.env']) assert.equal((await fetch(origin+path)).status,404);
    for (const path of ['/couples.html','/couples.css','/couples.js','/couples-app.js','/shared-embed.js','/ui/shared-view.js','/budgeting.js','/state-schema.js','/storage.js']) assert.equal((await fetch(origin+path)).status,200);
    assert.match(await home.text(), /<html lang="vi">/);
    const policy = home.headers.get('content-security-policy');
    assert.ok(policy.includes("'" + sharedScriptHash + "'"));
    assert.match(policy, /connect-src 'none'/);
    assert.match(policy, /form-action 'none'/);
    assert.match(policy, /frame-src 'self'/);
    assert.doesNotMatch(/script-src ([^;]+)/.exec(policy)[1], /unsafe-inline|unsafe-eval/);
    assert.equal(privateFile.status, 404);
    assert.equal(privateDirectory.status, 404);
    assert.equal(unsupportedWrite.status, 404);
  } finally {
    child.kill();
  }
});

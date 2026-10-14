import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { reviewOutputDirectory, reviewArtifactUrl } from '../scripts/review-output.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = text => createHash('sha256').update(text).digest('hex');

test('review builders and consumers share a project-local default independent of cwd', () => {
  assert.equal(reviewOutputDirectory({}), resolve(root, 'review-output'));
  assert.equal(fileURLToPath(reviewArtifactUrl('mach-tien-next-review.html', {})), resolve(root, 'review-output/mach-tien-next-review.html'));
  assert.equal(reviewOutputDirectory({ CASHWEAVE_REVIEW_OUTPUT_DIR: 'review-output/custom' }), resolve(root, 'review-output/custom'));
  for (const name of ['../private.json', '..\\private.json', '.', '..']) assert.throws(() => reviewArtifactUrl(name, {}));
});

test('offline review artifacts can be rebuilt and consumed in a relocated synthetic package', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cashweave-review-output-'));
  try {
    const env = { ...process.env, CASHWEAVE_REVIEW_OUTPUT_DIR: join(directory, 'artifacts') };
    for (const script of ['build-review.mjs', 'build-next-review.mjs']) {
      const result = spawnSync(process.execPath, [resolve(root, 'scripts', script)], { cwd: directory, env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    const legacy = await readFile(reviewArtifactUrl('financial-assistant-couples-demo.html', env), 'utf8');
    const next = await readFile(reviewArtifactUrl('mach-tien-next-review.html', env), 'utf8');
    const manifest = JSON.parse(await readFile(reviewArtifactUrl('mach-tien-next-review.manifest.json', env), 'utf8'));
    assert.equal(hash(next), manifest.htmlSha256);
    for (const file of manifest.modules) assert.equal(hash(await readFile(resolve(root, file.path))), file.sha256);
    for (const html of [legacy, next]) {
      const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
      const cspHash = 'sha256-' + createHash('sha256').update(script).digest('base64');
      assert.ok(html.includes(cspHash));
      assert.ok(html.includes("connect-src 'none'"));
      assert.doesNotMatch(html, /src="https?:\/\//);
    }
  } finally {
    // Only delete the absolute directory returned by mkdtemp within tmpdir.
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
    await rm(directory, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

test('patched UUID rejects truncated caller buffers and remains compatible with Xcode project generation', () => {
  const xcode = require('xcode');
  const fromXcode = createRequire(require.resolve('xcode'));
  const uuid = fromXcode('uuid');
  const namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  assert.throws(() => uuid.v5('synthetic', namespace, new Uint8Array(8), 4), RangeError);
  assert.throws(() => uuid.v6({}, new Uint8Array(8), 4), RangeError);
  const project = xcode.project(fileURLToPath(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url)));
  project.parseSync();
  const generated = new Set();
  for (let i = 0; i < 1024; i++) {
    const id = project.generateUuid();
    assert.match(id, /^[A-F0-9]{24}$/); generated.add(id);
  }
  assert.equal(generated.size, 1024);
  const parsed = require('xcode/lib/parser/pbxproj').parse(project.writeSync());
  assert.equal(parsed.project.rootObject, project.hash.project.rootObject);
  assert.deepEqual(Object.keys(parsed.project.objects.PBXNativeTarget), Object.keys(project.hash.project.objects.PBXNativeTarget));
});

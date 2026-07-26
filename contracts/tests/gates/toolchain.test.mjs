import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertExactVersion,
  assertFileSha256,
  assertPackageMetadata,
  platformKey,
} from '../../scripts/lib/toolchain.mjs';

test('tool version guard rejects a wrong version', () => {
  assert.doesNotThrow(() => assertExactVersion('uv', 'uv 0.11.28 (build)', '0.11.28', 'uv '));
  assert.throws(
    () => assertExactVersion('uv', 'uv 0.11.27 (build)', '0.11.28', 'uv '),
    /version mismatch/,
  );
});

test('tool digest guard rejects missing and mismatched executables', () => {
  const root = mkdtempSync(join(tmpdir(), 'glimmer-contracts-toolchain-'));
  const executable = join(root, process.platform === 'win32' ? 'tool.exe' : 'tool');
  try {
    assert.throws(() => assertFileSha256('tool', executable, '0'.repeat(64)), /is missing/);
    writeFileSync(executable, 'pinned-tool', 'utf8');
    assert.doesNotThrow(() => assertFileSha256(
      'tool',
      executable,
      '4abdad978ee29b2ce6cc391ab501d4a250a871fc9f917527ba0016581f1e4189',
    ));
    assert.throws(() => assertFileSha256('tool', executable, '0'.repeat(64)), /SHA256 mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('supported platform key is explicit', () => {
  assert.equal(platformKey('win32', 'x64'), 'win32-x64');
  assert.equal(platformKey('linux', 'x64'), 'linux-x64');
});

test('package metadata guard rejects license drift', () => {
  const expected = { version: '33.0.0', license: 'Apache-2.0' };
  assert.doesNotThrow(() => assertPackageMetadata('protoc', expected, expected));
  assert.throws(
    () => assertPackageMetadata('protoc', { version: '33.0.0', license: 'BSD-3-Clause' }, expected),
    /installed metadata mismatch/,
  );
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const nativeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Native ABI 不重新吸收 Audio Engine 能力', () => {
  const header = fs.readFileSync(path.join(nativeRoot, 'include', 'platform_native.h'), 'utf8');
  assert.doesNotMatch(header, /platform_native_(?:asr|tts)_/);
});

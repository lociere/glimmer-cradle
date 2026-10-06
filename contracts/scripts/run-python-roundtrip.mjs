import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { verifyUv } from './lib/toolchain.mjs';

const root = resolve(import.meta.dirname, '..');
const uv = verifyUv(root);

const result = spawnSync(uv, [
  'run',
  '--package',
  'glimmer-cradle-contracts-python-roundtrip',
  '--locked',
  '--offline',
  '--no-python-downloads',
  'python',
  resolve(root, 'tests/roundtrip/roundtrip.py'),
], {
  cwd: resolve(root, '..'),
  stdio: 'inherit',
  shell: false,
});

if (result.status !== 0) {
  if (result.error) {
    console.error(result.error.message);
  }
  process.exit(result.status ?? 1);
}

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { verifyUv } from './lib/toolchain.mjs';

const root = resolve(import.meta.dirname, '..');
const uv = verifyUv(root);

const result = spawnSync(uv, [
  'run',
  '--project',
  'tests/python',
  '--locked',
  '--offline',
  '--no-python-downloads',
  'python',
  'tests/roundtrip/roundtrip.py',
], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});

if (result.status !== 0) {
  if (result.error) {
    console.error(result.error.message);
  }
  process.exit(result.status ?? 1);
}

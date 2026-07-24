import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const uv = process.platform === 'win32' ? 'uv.exe' : 'uv';

const result = spawnSync(uv, ['run', '--project', 'tests/python', 'python', 'tests/roundtrip/roundtrip.py'], {
  cwd: root,
  stdio: 'inherit',
});

if (result.status !== 0) {
  if (result.error) {
    console.error(result.error.message);
  }
  process.exit(result.status ?? 1);
}

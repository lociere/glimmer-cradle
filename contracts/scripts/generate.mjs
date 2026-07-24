import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const buf = resolve(root, 'node_modules', '@bufbuild', 'buf', 'bin', 'buf');
const binPath = resolve(root, 'node_modules', '.bin');

rmSync(resolve(root, 'generated'), { recursive: true, force: true });

const result = spawnSync(process.execPath, [buf, 'generate'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: `${binPath}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
  },
});

if (result.status !== 0) {
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

function walk(dir) {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}

for (const file of walk(resolve(root, 'generated'))) {
  if (!/\.(ts|py|cs)$/i.test(file)) continue;
  const original = readFileSync(file, 'utf8');
  const normalized = `${original.replace(/\s+$/u, '')}\n`;
  if (normalized !== original) {
    writeFileSync(file, normalized, 'utf8');
  }
}

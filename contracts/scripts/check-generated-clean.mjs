import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const git = process.platform === 'win32' ? 'git.exe' : 'git';
const workspace = resolve(import.meta.dirname, '..', '..');
const root = resolve(import.meta.dirname, '..');

function walk(dir) {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__pycache__') continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

function snapshot(dir) {
  return new Map(walk(dir).map((file) => [
    relative(root, file).replaceAll('\\', '/'),
    createHash('sha256').update(readFileSync(file)).digest('hex'),
  ]));
}

function assertSame(before, after) {
  const beforeKeys = [...before.keys()].sort();
  const afterKeys = [...after.keys()].sort();
  if (beforeKeys.join('\n') !== afterKeys.join('\n')) {
    throw new Error('contracts generated file set changed after consecutive generation');
  }
  for (const key of beforeKeys) {
    if (before.get(key) !== after.get(key)) {
      throw new Error(`contracts generated file changed after consecutive generation: ${key}`);
    }
  }
}

const before = snapshot(resolve(root, 'generated'));
const generate = spawnSync(process.execPath, [resolve(root, 'scripts/generate.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (generate.status !== 0) {
  if (generate.error) console.error(generate.error.message);
  process.exit(generate.status ?? 1);
}
const after = snapshot(resolve(root, 'generated'));
assertSame(before, after);

const result = spawnSync(git, ['diff', '--exit-code', '--', 'contracts/generated', 'contracts/compatibility'], {
  cwd: workspace,
  stdio: 'inherit',
});

if (result.status !== 0) {
  console.error('contracts generated or compatibility artifacts changed; run pnpm contracts:generate and pnpm --filter @glimmer-cradle/contracts baseline:refresh intentionally.');
  process.exit(result.status ?? 1);
}

console.log('contracts generated: clean');

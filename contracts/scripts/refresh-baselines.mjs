import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const buf = resolve(root, 'node_modules', '@bufbuild', 'buf', 'bin', 'buf');
const binPath = resolve(root, 'node_modules', '.bin');

function run(command, args) {
  const executable = command === 'buf' ? process.execPath : command;
  const commandArgs = command === 'buf' ? [buf, ...args] : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${binPath}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
    },
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function walk(dir) {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

mkdirSync(resolve(root, 'compatibility'), { recursive: true });
run('buf', ['build', '-o', 'compatibility/proto-image.binpb']);

const schemaRoot = resolve(root, 'json-schema');
const schemas = walk(schemaRoot).filter((file) => file.endsWith('.schema.json'));
const baseline = {
  generated_at: 'fixed by M12 Slice 1 baseline refresh',
  compatibility: 'Schema removals or content changes require an intentional baseline update and review.',
  schemas: schemas.map((file) => {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    return {
      path: relative(root, file).replaceAll('\\', '/'),
      id: json.$id,
      dialect: json.$schema,
      owner: json['x-glimmer-owner'],
      kind: json['x-glimmer-contract-kind'],
      compatibility: json['x-glimmer-compatibility'],
      sha256: sha256(file),
    };
  }),
};

writeFileSync(
  resolve(root, 'compatibility/json-schema-baseline.json'),
  `${JSON.stringify(baseline, null, 2)}\n`,
  'utf8',
);

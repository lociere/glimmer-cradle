import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const contractsRoot = resolve(import.meta.dirname, '..', '..');
const checker = resolve(contractsRoot, 'scripts/check-json-schema.mjs');
const baselineRefresher = resolve(contractsRoot, 'scripts/refresh-baselines.mjs');
const temporaryRoots = [];

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'glimmer-contracts-json-schema-'));
  temporaryRoots.push(root);
  for (const directory of ['json-schema', 'compatibility', 'fixtures']) {
    cpSync(resolve(contractsRoot, directory), resolve(root, directory), { recursive: true });
  }
  return root;
}

function check(root) {
  return spawnSync(process.execPath, [checker, '--contracts-root', root], {
    encoding: 'utf8',
    shell: false,
  });
}

test.after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

test('normal dialect, fixture and compatibility baseline passes', () => {
  const result = check(fixtureRoot());
  assert.equal(result.status, 0, result.stderr);
});

test('JSON-only baseline refresh preserves the Proto compatibility image', () => {
  const root = fixtureRoot();
  mkdirSync(resolve(root, 'scripts'), { recursive: true });
  cpSync(baselineRefresher, resolve(root, 'scripts/refresh-baselines.mjs'));
  const protoImage = resolve(root, 'compatibility/proto-image.binpb');
  const before = readFileSync(protoImage);

  const result = spawnSync(
    process.execPath,
    [resolve(root, 'scripts/refresh-baselines.mjs'), '--json-schema-only'],
    { encoding: 'utf8', shell: false },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(protoImage), before);
});

test('new unregistered canonical schema fails closed', () => {
  const root = fixtureRoot();
  const source = resolve(root, 'json-schema/skill/v1/tool-parameters.schema.json');
  const added = resolve(root, 'json-schema/skill/v1/unregistered.schema.json');
  const schema = JSON.parse(readFileSync(source, 'utf8'));
  schema.$id = 'https://glimmer-cradle.local/contracts/skill/v1/unregistered.schema.json';
  schema.title = 'UnregisteredDocument';
  writeFileSync(added, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');

  const result = check(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not registered in compatibility baseline/);
});

test('deleted canonical schema fails closed', () => {
  const root = fixtureRoot();
  const sourcePath = resolve(root, 'json-schema/skill/v1/tool-parameters.schema.json');
  const keeperPath = resolve(root, 'json-schema/skill/v1/registered-keeper.schema.json');
  const keeper = JSON.parse(readFileSync(sourcePath, 'utf8'));
  keeper.$id = 'https://glimmer-cradle.local/contracts/skill/v1/registered-keeper.schema.json';
  keeper.title = 'RegisteredKeeperDocument';
  writeFileSync(keeperPath, `${JSON.stringify(keeper, null, 2)}\n`, 'utf8');
  const baselinePath = resolve(root, 'compatibility/json-schema-baseline.json');
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  baseline.schemas.push({
    ...baseline.schemas[0],
    path: 'json-schema/skill/v1/registered-keeper.schema.json',
    id: keeper.$id,
    sha256: createHash('sha256').update(readFileSync(keeperPath)).digest('hex'),
  });
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  unlinkSync(sourcePath);

  const result = check(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /compatibility baseline lost/);
});

test('canonical schema content change fails closed', () => {
  const root = fixtureRoot();
  const schemaPath = resolve(root, 'json-schema/skill/v1/tool-parameters.schema.json');
  writeFileSync(schemaPath, `${readFileSync(schemaPath, 'utf8').trimEnd()}\n `, 'utf8');

  const result = check(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /compatibility baseline mismatch.*sha256/);
});

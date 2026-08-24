import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const contractsRoot = resolve(import.meta.dirname, '..', '..');
const checker = resolve(contractsRoot, 'scripts/check-inventory.mjs');
const temporaryRoots = [];

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'glimmer-contracts-inventory-'));
  temporaryRoots.push(root);
  for (const directory of ['proto', 'json-schema']) {
    cpSync(resolve(contractsRoot, directory), resolve(root, directory), { recursive: true });
  }
  cpSync(resolve(contractsRoot, 'inventory.md'), resolve(root, 'inventory.md'));
  return root;
}

function check(root, workspaceRoot) {
  const args = [checker, '--contracts-root', root];
  if (workspaceRoot) args.push('--workspace-root', workspaceRoot);
  return spawnSync(process.execPath, args, { encoding: 'utf8', shell: false });
}

function write(root, relativePath, content) {
  const target = resolve(root, relativePath);
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function project(name, devDependencies = ['pytest>=8']) {
  return [
    '[project]',
    `name = "${name}"`,
    'version = "0.0.0"',
    '',
    '[project.optional-dependencies]',
    `dev = ${JSON.stringify(devDependencies)}`,
    '',
  ].join('\n');
}

function lockFile(projectName, devDependencies = ['pytest'], lockedPackages = ['pytest']) {
  const sections = [
    'version = 1',
    'revision = 3',
    'requires-python = ">=3.11"',
    '',
    '[[package]]',
    `name = "${projectName}"`,
    'version = "0.0.0"',
    'source = { editable = "." }',
    '',
    '[package.optional-dependencies]',
    `dev = [${devDependencies.map((name) => `{ name = "${name}" }`).join(', ')}]`,
  ];
  for (const name of lockedPackages) {
    sections.push('', '[[package]]', `name = "${name}"`, 'version = "1.0.0"', 'source = { registry = "https://pypi.org/simple" }');
  }
  return `${sections.join('\n')}\n`;
}

function workspaceFixture() {
  const workspace = mkdtempSync(join(tmpdir(), 'glimmer-contracts-workspace-'));
  temporaryRoots.push(workspace);
  const fixtureContracts = resolve(workspace, 'contracts');
  mkdirSync(fixtureContracts, { recursive: true });
  for (const directory of ['proto', 'json-schema']) {
    cpSync(resolve(contractsRoot, directory), resolve(fixtureContracts, directory), { recursive: true });
  }
  cpSync(resolve(contractsRoot, 'inventory.md'), resolve(fixtureContracts, 'inventory.md'));
  write(workspace, 'engines/audio/pyproject.toml', project('glimmer-cradle-audio-engine'));
  write(workspace, 'engines/audio/uv.lock', lockFile('glimmer-cradle-audio-engine'));
  write(workspace, 'core/cognition/pyproject.toml', project('glimmer-cradle-cognition'));
  write(workspace, 'core/cognition/uv.lock', lockFile('glimmer-cradle-cognition'));
  return { workspace, contracts: fixtureContracts };
}

test.after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

test('canonical paths and symbols in inventory match IDL', () => {
  const result = check(fixtureRoot());
  assert.equal(result.status, 0, result.stderr);
});

test('wrong canonical message symbol fails closed', () => {
  const root = fixtureRoot();
  const inventoryPath = resolve(root, 'inventory.md');
  writeFileSync(inventoryPath, readFileSync(inventoryPath, 'utf8').replaceAll('`EchoProbeResponse`', '`ContractProbeResponse`'), 'utf8');
  const result = check(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing canonical proto symbol.*EchoProbeResponse/);
});

test('wrong canonical path fails closed', () => {
  const root = fixtureRoot();
  const inventoryPath = resolve(root, 'inventory.md');
  writeFileSync(inventoryPath, readFileSync(inventoryPath, 'utf8').replaceAll(
    '`proto/glimmer/common/v1/contract_probe.proto`',
    '`proto/glimmer/common/v1/contract_probe_v2.proto`',
  ), 'utf8');
  const result = check(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing canonical proto path/);
});

test('structured workspace after legacy protocol closure passes', () => {
  const fixture = workspaceFixture();
  const result = check(fixture.contracts, fixture.workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('legacy Audio generated projection fails closed', () => {
  const fixture = workspaceFixture();
  write(fixture.workspace, 'engines/audio/src/glimmer_cradle/audio/generated/model.py', '# legacy\n');
  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /generated output must remain deleted/);
});

test('legacy Protocol directory fails closed', () => {
  const fixture = workspaceFixture();
  write(fixture.workspace, 'protocol/src/generated/engine/AudioEngineCommand.ts', 'export interface AudioEngineCommand {}\n');
  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /legacy Protocol directory must remain deleted/);
});

test('Audio control contract rejects inline media bytes', () => {
  const fixture = workspaceFixture();
  const protoPath = resolve(fixture.contracts, 'proto/glimmer/engine/audio/v1/audio_engine.proto');
  writeFileSync(protoPath, readFileSync(protoPath, 'utf8').replace(
    'message SynthesizeRequest {',
    'message SynthesizeRequest {\n  bytes audio = 99;',
  ), 'utf8');
  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not carry media bytes/);
});

test('legacy Protocol package fails closed', () => {
  const fixture = workspaceFixture();
  write(fixture.workspace, 'protocol/package.json', JSON.stringify({ scripts: { 'gen:py': 'python codegen/gen-py.py', 'gen:all': 'pnpm gen:ts && pnpm gen:py' } }));
  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /legacy Protocol directory must remain deleted/);
});

test('legacy Protocol C# generator path fails closed', () => {
  const fixture = workspaceFixture();
  write(fixture.workspace, 'protocol/codegen/gen-cs.ts', '// legacy\n');
  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /legacy Protocol directory must remain deleted/);
});

test('Audio dev dependency retaining the generator fails closed', () => {
  const fixture = workspaceFixture();
  write(fixture.workspace, 'engines/audio/pyproject.toml', project('glimmer-cradle-audio-engine', ['pytest>=8', 'datamodel-code-generator>=0.25,<1']));
  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Audio must not retain/);
});

test('Audio lock retaining the generator fails closed', () => {
  const fixture = workspaceFixture();
  write(fixture.workspace, 'engines/audio/uv.lock', lockFile('glimmer-cradle-audio-engine', ['datamodel-code-generator'], ['datamodel-code-generator']));
  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Audio lock must not retain/);
});

test('Cognition lock retaining the generator fails closed', () => {
  const fixture = workspaceFixture();
  write(fixture.workspace, 'core/cognition/uv.lock', lockFile('glimmer-cradle-cognition', ['datamodel-code-generator'], ['datamodel-code-generator']));
  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cognition lock must not retain/);
});

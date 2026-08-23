import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
const checker = resolve(contractsRoot, 'scripts/check-inventory.mjs');
const temporaryRoots = [];
const expectedGeneratorCommand =
  'uv run --project ../engines/audio --extra dev python codegen/gen-py.py';

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
  return spawnSync(process.execPath, args, {
    encoding: 'utf8',
    shell: false,
  });
}

function write(root, relativePath, content) {
  const path = resolve(root, relativePath);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function audioProject(devDependencies = ['datamodel-code-generator>=0.25,<1']) {
  return [
    '[project]',
    'name = "glimmer-cradle-audio-engine"',
    'version = "0.0.0"',
    '',
    '[project.optional-dependencies]',
    `dev = ${JSON.stringify(devDependencies)}`,
    '',
  ].join('\n');
}

function cognitionProject(devDependencies = ['pytest>=8']) {
  return [
    '[project]',
    'name = "glimmer-cradle-cognition"',
    'version = "0.0.0"',
    '',
    '[project.optional-dependencies]',
    `dev = ${JSON.stringify(devDependencies)}`,
    '',
  ].join('\n');
}

function lockFile(projectName, devDependencies, lockedPackages = devDependencies) {
  const lockedDevDependencies = devDependencies
    .map((name) => `{ name = ${JSON.stringify(name)} }`)
    .join(', ');
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
    `dev = [${lockedDevDependencies}]`,
  ];
  for (const name of lockedPackages) {
    sections.push(
      '',
      '[[package]]',
      `name = "${name}"`,
      'version = "1.0.0"',
      'source = { registry = "https://pypi.org/simple" }',
    );
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
  write(workspace, 'protocol/package.json', JSON.stringify({
    scripts: { 'gen:py': expectedGeneratorCommand },
  }));
  write(workspace, 'engines/audio/pyproject.toml', audioProject());
  write(workspace, 'engines/audio/uv.lock', lockFile(
    'glimmer-cradle-audio-engine',
    ['datamodel-code-generator'],
    ['datamodel-code-generator'],
  ));
  write(workspace, 'engines/audio/src/glimmer_cradle/audio/generated/model.py', '# generated\n');
  write(workspace, 'core/cognition/pyproject.toml', cognitionProject());
  write(workspace, 'core/cognition/uv.lock', lockFile(
    'glimmer-cradle-cognition',
    ['pytest'],
    ['pytest'],
  ));
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
  const inventory = readFileSync(inventoryPath, 'utf8').replaceAll('`EchoProbeResponse`', '`ContractProbeResponse`');
  writeFileSync(inventoryPath, inventory, 'utf8');

  const result = check(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing canonical proto symbol.*EchoProbeResponse/);
});

test('wrong canonical path fails closed', () => {
  const root = fixtureRoot();
  const inventoryPath = resolve(root, 'inventory.md');
  const inventory = readFileSync(inventoryPath, 'utf8').replaceAll(
    '`proto/glimmer/common/v1/contract_probe.proto`',
    '`proto/glimmer/common/v1/contract_probe_v2.proto`',
  );
  writeFileSync(inventoryPath, inventory, 'utf8');

  const result = check(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing canonical proto path/);
});

test('structured workspace owner fixture passes with explicit roots', () => {
  const fixture = workspaceFixture();
  const result = check(fixture.contracts, fixture.workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('comments and inactive TOML sections cannot impersonate the Audio dev dependency', () => {
  const fixture = workspaceFixture();
  write(fixture.workspace, 'engines/audio/pyproject.toml', [
    audioProject([]),
    '# datamodel-code-generator belongs to an unrelated comment',
    '[tool.unrelated]',
    'description = "datamodel-code-generator"',
  ].join('\n'));

  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Audio owner project must declare/);
});

test('inactive script cannot conceal a wrong active generator project', () => {
  const fixture = workspaceFixture();
  write(fixture.workspace, 'protocol/package.json', JSON.stringify({
    scripts: {
      'gen:py': 'uv run --project ../core/cognition python codegen/gen-py.py',
      'inactive:gen:py': expectedGeneratorCommand,
    },
  }));

  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must execute in the Audio owner project/);
});

test('wrong Audio project spelling fails the exact active command gate', () => {
  const fixture = workspaceFixture();
  write(fixture.workspace, 'protocol/package.json', JSON.stringify({
    scripts: {
      'gen:py': 'uv run --project ../engines/audio-tools --extra dev python codegen/gen-py.py',
    },
  }));

  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must execute in the Audio owner project/);
});

test('Cognition dev dependency retains the generator fails closed', () => {
  const fixture = workspaceFixture();
  write(fixture.workspace, 'core/cognition/pyproject.toml', cognitionProject([
    'pytest>=8',
    'datamodel-code-generator>=0.25,<1',
  ]));

  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cognition must not retain/);
});

test('Audio project missing its generator dependency fails closed', () => {
  const fixture = workspaceFixture();
  write(fixture.workspace, 'engines/audio/pyproject.toml', audioProject(['pytest>=8']));

  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Audio owner project must declare/);
});

test('Audio lock missing its generator resolution fails closed', () => {
  const fixture = workspaceFixture();
  write(fixture.workspace, 'engines/audio/uv.lock', lockFile(
    'glimmer-cradle-audio-engine',
    ['datamodel-code-generator'],
    [],
  ));

  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Audio lock must resolve/);
});

test('missing Audio lock fails closed', () => {
  const fixture = workspaceFixture();
  unlinkSync(resolve(fixture.workspace, 'engines/audio/uv.lock'));

  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Audio lock is missing/);
});

test('Cognition lock retaining the generator fails closed', () => {
  const fixture = workspaceFixture();
  write(fixture.workspace, 'core/cognition/uv.lock', lockFile(
    'glimmer-cradle-cognition',
    ['datamodel-code-generator'],
    ['datamodel-code-generator'],
  ));

  const result = check(fixture.contracts, fixture.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cognition lock must not retain/);
});

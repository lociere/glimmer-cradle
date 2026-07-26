import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

function check(root) {
  return spawnSync(process.execPath, [checker, '--contracts-root', root], {
    encoding: 'utf8',
    shell: false,
  });
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

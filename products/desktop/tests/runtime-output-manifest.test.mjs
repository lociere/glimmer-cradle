import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  digestRuntimeInputs,
  digestRuntimeOutputs,
} from '../scripts/runtime-output-manifest.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('runtime cache 输入包含 lock/toolchain/shared manifest 且依赖传播 output digest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'glimmer-runtime-digest-'));
  try {
    const lock = path.join(root, 'pnpm-lock.yaml');
    const toolchain = path.join(root, '.nvmrc');
    const manifest = path.join(root, 'package.json');
    await writeFile(lock, 'lock-v1\n');
    await writeFile(toolchain, '24.18.0\n');
    await writeFile(manifest, '{"name":"fixture"}\n');
    const inputs = [lock, toolchain, manifest];
    const first = await digestRuntimeInputs(root, inputs, ['output-a']);
    const dependencyChanged = await digestRuntimeInputs(root, inputs, ['output-b']);
    assert.notEqual(first, dependencyChanged);
    await writeFile(toolchain, '24.19.0\n');
    const toolchainChanged = await digestRuntimeInputs(root, inputs, ['output-a']);
    assert.notEqual(first, toolchainChanged);
    await writeFile(lock, 'lock-v2\n');
    const lockChanged = await digestRuntimeInputs(root, inputs, ['output-a']);
    assert.notEqual(toolchainChanged, lockChanged);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime task 向下游传播实际 output digest，不传播 input digest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'glimmer-runtime-output-'));
  try {
    const output = path.join(root, 'dist.js');
    await writeFile(output, 'output-v1\n');
    const first = await digestRuntimeOutputs(root, [output]);
    await writeFile(output, 'output-v2\n');
    const second = await digestRuntimeOutputs(root, [output]);
    assert.notEqual(first.digest, second.digest);
    const prepare = await readFile(
      path.join(repoRoot, 'products', 'desktop', 'scripts', 'prepare-runtime.mjs'),
      'utf8',
    );
    assert.match(prepare, /return outputs\.digest;/);
    assert.doesNotMatch(prepare, /return digest;\s*\}/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('组合任务只有 root 拓扑构建依赖，package atomic task 不含重复 prehook', async () => {
  for (const relative of [
    'packages/extension-sdk/package.json',
    'hosts/extension-host/package.json',
    'core/kernel/package.json',
    'templates/extension-basic/package.json',
  ]) {
    const manifest = JSON.parse(await readFile(path.join(repoRoot, relative), 'utf8'));
    assert.equal(Object.keys(manifest.scripts).some((name) => /^pre(?:build|test|typecheck)$/.test(name)), false);
    assert.ok(Object.keys(manifest.scripts).some((name) => name.endsWith(':with-deps')));
  }
  const rootManifest = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.match(rootManifest.scripts['build:all'], /build:extension-tooling/);
  assert.match(rootManifest.scripts['build:all'], /@glimmer-cradle\/kernel run build/);
  assert.match(rootManifest.scripts['build:all'], /@glimmer-cradle\/desktop run build/);
  assert.match(rootManifest.scripts['build:all'], /@glimmer-cradle\/personal-server run build/);
  assert.match(rootManifest.scripts['build:extension-tooling'], /contracts/);
  assert.match(rootManifest.scripts['test:all'], /build:all/);
  assert.match(rootManifest.scripts['test:cognition'], /--extra dev/);
  assert.match(rootManifest.scripts.typecheck, /contracts/);
});

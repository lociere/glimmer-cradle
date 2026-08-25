import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createWorkspacePlan } from '../src/workspace-plan.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function plan(productId, mode = 'development', kernelOnly = false) {
  return createWorkspacePlan({
    repositoryRoot, productId, mode, kernelOnly, platform: 'linux', execPath: '/usr/bin/node',
  });
}

test('Desktop preparation 由 Desktop package manifest 显式拥有', () => {
  const result = plan('desktop');
  assert.deepEqual(result.preparation.args, [
    'pnpm', '--filter', '@glimmer-cradle/desktop', 'run', 'product:prepare',
  ]);
  assert.ok(result.services.some((service) => service.args.includes('product:dev')));
});

test('Personal Server preparation 不经过 Desktop 或 desktop-assets', () => {
  const result = plan('personal-server');
  assert.deepEqual(result.preparation.args, [
    'pnpm', '--filter', '@glimmer-cradle/personal-server', 'run', 'product:prepare',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /@glimmer-cradle\/desktop|desktop-assets|products[\\/]desktop/);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, 'products', 'personal-server', 'package.json'),
    'utf8',
  ));
  assert.doesNotMatch(manifest.scripts['product:prepare'], /desktop|prepare-runtime|sync-assets/i);
});

test('production 跳过 preparation，kernel-only 不启动 Product Host', () => {
  assert.equal(plan('desktop', 'production').preparation, undefined);
  const kernelOnly = plan('desktop', 'development', true);
  assert.deepEqual(kernelOnly.services.map((service) => service.id), ['kernel']);
});

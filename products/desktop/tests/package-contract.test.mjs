import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const packageScript = await readFile(
  path.join(repoRoot, 'products', 'desktop', 'scripts', 'package.mjs'),
  'utf8',
);
const prepareScript = await readFile(
  path.join(repoRoot, 'products', 'desktop', 'scripts', 'prepare-package.mjs'),
  'utf8',
);
const builderConfig = JSON.parse(await readFile(
  path.join(repoRoot, 'products', 'desktop', 'electron-builder.json'),
  'utf8',
));
const workflow = await readFile(
  path.join(repoRoot, '.github', 'workflows', 'release-desktop.yml'),
  'utf8',
);

test('Desktop package dry-run 是独立 Windows fixed-artifact 任务且不发布', async () => {
  const output = await new Promise((resolve, reject) => {
    execFile(process.execPath, [
      path.join(repoRoot, 'products', 'desktop', 'scripts', 'package.mjs'),
      '--dry-run',
    ], { cwd: repoRoot }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
  const contract = JSON.parse(output);
  assert.equal(contract.product, 'desktop');
  assert.equal(contract.platform, 'windows-x64');
  assert.equal(contract.publish, false);
  assert.match(contract.output.replaceAll('\\', '/'), /dist\/desktop\/0\.1\.8\/windows-x64$/);
  assert.ok(!JSON.stringify(contract).includes('personal-server'));
});

test('Desktop package 在 clean Windows owner task 准备六类 runtime projection', () => {
  assert.match(workflow, /runs-on: windows-2025/);
  assert.match(workflow, /pnpm --filter @glimmer-cradle\/desktop package/);
  assert.match(workflow, /actions\/attest@59d89421af93a897026c735860bf21b6eb4f7b26/);
  for (const command of ["['build']", "['prepare:runtime']", "['avatar:build']"]) {
    assert.match(packageScript, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const component of ['kernel', 'cognition', 'audio', 'avatar', 'extension-host', 'native']) {
    assert.match(prepareScript, new RegExp(`id: '${component}'`));
  }
  const stagingResource = builderConfig.extraResources.find((entry) => (
    entry.from === '../../build/staging/desktop/windows-x64/resources'
  ));
  assert.ok(stagingResource);
  assert.equal(stagingResource.to, '.');
});

test('Desktop fixed artifact 绑定完整 component manifest 与独立 expected identity', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'glimmer-desktop-package-'));
  try {
    await writeFile(path.join(output, 'GlimmerCradle-Setup.exe'), Buffer.from('fixture installer'));
    const resources = path.join(output, 'win-unpacked', 'resources');
    const components = [];
    for (const id of ['kernel', 'cognition', 'audio', 'avatar', 'extension-host', 'native']) {
      const relative = `components/${id}/runtime.bin`;
      const target = path.join(resources, relative);
      const bytes = Buffer.from(`fixture ${id}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
      components.push({
        id,
        owner: `owner/${id}`,
        projection: `components/${id}`,
        files: [{
          path: relative,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        }],
      });
    }
    await writeFile(path.join(resources, 'component-manifest.json'), JSON.stringify({
      schema_version: 1,
      platform: 'windows-x64',
      components,
    }));
    await execNode('release-manifest.mjs', [output, '0.1.8'], {
      GLIMMER_CRADLE_SOURCE_COMMIT: 'a'.repeat(40),
    });
    const digest = createHash('sha256')
      .update(await readFile(path.join(output, 'artifact-manifest.json')))
      .digest('hex');
    const verifyArgs = [
      output,
      '--expected-commit', 'a'.repeat(40),
      '--expected-manifest-digest', digest,
      '--expected-builder', 'products/desktop/scripts/package.mjs',
      '--expected-issuer', 'github-actions-sigstore',
    ];
    await execNode('verify-package.mjs', verifyArgs);
    await assert.rejects(() => execNode('verify-package.mjs', [
      ...verifyArgs.slice(0, 2),
      'b'.repeat(40),
      ...verifyArgs.slice(3),
    ]));
    await writeFile(path.join(resources, 'component-manifest.json'), JSON.stringify({
      schema_version: 1,
      platform: 'windows-x64',
      components: components.filter((component) => component.id !== 'native'),
    }));
    await execNode('release-manifest.mjs', [output, '0.1.8'], {
      GLIMMER_CRADLE_SOURCE_COMMIT: 'a'.repeat(40),
    });
    const forgedDigest = createHash('sha256')
      .update(await readFile(path.join(output, 'artifact-manifest.json')))
      .digest('hex');
    await assert.rejects(() => execNode('verify-package.mjs', [
      output,
      '--expected-commit', 'a'.repeat(40),
      '--expected-manifest-digest', forgedDigest,
      '--expected-builder', 'products/desktop/scripts/package.mjs',
      '--expected-issuer', 'github-actions-sigstore',
    ]));
    for (const name of [
      'artifact-manifest.json',
      'provenance.json',
      'sbom.spdx.json',
      'build-claim.json',
    ]) {
      assert.ok((await readFile(path.join(output, name))).length > 0, `${name} must exist`);
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

function execNode(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [
      path.join(repoRoot, 'products', 'desktop', 'scripts', script),
      ...args,
    ], { cwd: repoRoot, env: { ...process.env, ...env } }, (error, stdout) => (
      error ? reject(error) : resolve(stdout)
    ));
  });
}

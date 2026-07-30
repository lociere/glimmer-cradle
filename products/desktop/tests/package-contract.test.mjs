import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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

test('Desktop fixed artifact 生成并验证 manifest、SBOM、provenance 与 attestation', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'glimmer-desktop-package-'));
  try {
    await writeFile(path.join(output, 'GlimmerCradle-Setup.exe'), Buffer.from('fixture installer'));
    await execNode('release-manifest.mjs', [output, '0.1.8'], {
      GLIMMER_CRADLE_SOURCE_COMMIT: 'a'.repeat(40),
    });
    await execNode('verify-package.mjs', [output]);
    for (const name of [
      'artifact-manifest.json',
      'provenance.json',
      'sbom.spdx.json',
      'attestation.json',
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

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dockerfile = await readFile(path.join(repoRoot, 'deploy', 'personal-server', 'Dockerfile'), 'utf8');
const workflowText = await readFile(
  path.join(repoRoot, '.github', 'workflows', 'release-personal-server.yml'),
  'utf8',
);
const workflow = YAML.parse(workflowText);

test('Personal Server 基础镜像输入必须使用 digest 且 Dockerfile 无 tag 默认值', () => {
  for (const name of ['NODE_IMAGE', 'PYTHON_IMAGE', 'UV_IMAGE']) {
    assert.match(dockerfile, new RegExp(`ARG ${name}(?:\\r?\\n)`));
    assert.doesNotMatch(dockerfile, new RegExp(`ARG ${name}=`));
    assert.match(workflowText, new RegExp(`${name}`));
  }
  assert.match(workflowText, /@sha256:\[0-9a-f\]\{64\}/);
});

test('Release job 只下载并发布 build job 固定的制品', () => {
  const jobs = workflow.jobs;
  assert.ok(jobs['build-fixed-artifact']);
  assert.equal(jobs.release.needs, 'build-fixed-artifact');
  const releaseUses = JSON.stringify(jobs.release);
  const releaseCommands = jobs.release.steps
    .flatMap((step) => String(step.run || '').split(/\r?\n/))
    .join('\n');
  assert.match(releaseUses, /actions\/download-artifact@/);
  assert.match(releaseUses, /softprops\/action-gh-release@/);
  assert.doesNotMatch(releaseCommands, /^\s*(?:docker|pnpm build|node .*package-release\.mjs)/m);
  assert.match(releaseUses, /gh attestation verify/);
  assert.match(workflowText, /actions\/attest@59d89421af93a897026c735860bf21b6eb4f7b26/);
});

test('Personal Server fixed artifact verifier 要求独立 expected identity，unsigned claim 不冒充 attestation', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'glimmer-personal-server-package-'));
  try {
    const artifact = path.join(output, 'glimmer-cradle-personal-server.tar.gz');
    await writeFile(artifact, Buffer.from('fixture release'));
    await execNode('release-manifest.mjs', [output, '0.1.8'], {
      GLIMMER_CRADLE_SOURCE_COMMIT: 'b'.repeat(40),
      GLIMMER_CRADLE_OCI_IMAGE: `ghcr.io/example/personal-server@sha256:${'d'.repeat(64)}`,
    });
    const digest = createHash('sha256')
      .update(await readFile(path.join(output, 'artifact-manifest.json')))
      .digest('hex');
    const verifyArgs = [
      output,
      '--expected-commit', 'b'.repeat(40),
      '--expected-manifest-digest', digest,
      '--expected-builder', 'products/personal-server/scripts/package-release.mjs',
      '--expected-issuer', 'github-actions-sigstore',
      '--expected-oci-digest', `sha256:${'d'.repeat(64)}`,
    ];
    await execNode('verify-release.mjs', verifyArgs);
    await assert.rejects(() => execNode('verify-release.mjs', [
      output,
      '--expected-commit', 'c'.repeat(40),
      '--expected-manifest-digest', digest,
      '--expected-builder', 'products/personal-server/scripts/package-release.mjs',
      '--expected-issuer', 'github-actions-sigstore',
      '--expected-oci-digest', `sha256:${'d'.repeat(64)}`,
    ]));
    assert.match(
      await readFile(path.join(output, 'build-claim.json'), 'utf8'),
      /unsigned-build-claim/,
    );
    await writeFile(artifact, Buffer.from('tampered release'));
    await assert.rejects(() => execNode('verify-release.mjs', verifyArgs));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

function execNode(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [
      path.join(repoRoot, 'products', 'personal-server', 'scripts', script),
      ...args,
    ], { cwd: repoRoot, env: { ...process.env, ...env } }, (error, stdout) => (
      error ? reject(error) : resolve(stdout)
    ));
  });
}

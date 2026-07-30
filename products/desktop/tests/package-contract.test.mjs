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
const runtimeScript = await readFile(
  path.join(repoRoot, 'products', 'desktop', 'scripts', 'prepare-package-runtimes.mjs'),
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
const workspaceConfig = await readFile(
  path.join(repoRoot, 'pnpm-workspace.yaml'),
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
  for (const command of ["['build']", "['prepare:runtime']"]) {
    assert.match(packageScript, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(packageScript, /\['avatar:build'\]/);
  assert.match(packageScript, /prepare-package-runtimes\.mjs/);
  assert.match(workflow, /pnpm avatar:build/);
  assert.match(workflow, /needs: avatar-fixed-artifact/);
  assert.match(workflow, /GLIMMER_CRADLE_CUBISM_UNITY_SDK/);
  assert.match(workflow, /UNITY_EDITOR_ARCHIVE_SHA256/);
  assert.match(workflow, /CUBISM_UNITY_SDK_ARCHIVE_SHA256/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /gh attestation verify/);
  assert.match(workflow, /needs\.avatar-fixed-artifact\.outputs\.manifest_digest/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workspaceConfig, /^\s*electron-winstaller: true$/m);
  assert.match(workflow, /IsNullOrWhiteSpace[\s\S]*throw "Desktop Avatar build prerequisite missing/);
  assert.doesNotMatch(workflow, /\bgh release\b|upload-release-asset|docker (?:push|login)/);
  for (const line of workflow.split(/\r?\n/).filter((value) => value.trim().startsWith('- uses:'))) {
    assert.match(line, /@[0-9a-f]{40}(?:\s|$)/);
  }
  assert.match(runtimeScript, /pythonVersion = '3\.12\.13'/);
  assert.match(runtimeScript, /core\/cognition\/uv\.lock/);
  assert.match(runtimeScript, /engines\/audio\/uv\.lock/);
  assert.match(runtimeScript, /--frozen/);
  assert.match(runtimeScript, /kernel', 'node_modules/);
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
    await writePeFixture(path.join(output, 'GlimmerCradle-Setup.exe'));
    await writePeFixture(path.join(output, 'win-unpacked', 'GlimmerCradle.exe'));
    const resources = path.join(output, 'win-unpacked', 'resources');
    await writeFileTree(path.join(resources, 'app.asar'), 'fixture app archive');
    const components = [];
    const componentPaths = new Map([
      ['kernel', 'runtime/kernel/dist/index.js'],
      ['cognition', 'runtime/python/Lib/site-packages/glimmer_cradle/cognition/__init__.py'],
      ['audio', 'runtime/python/Lib/site-packages/glimmer_cradle/audio/__init__.py'],
      ['avatar', 'components/avatar/unity-host/UnityAvatarHostLauncher.exe'],
      ['extension-host', 'extension-host/modules/host.mjs'],
      ['native', 'components/native/composition-host/platform_native.dll'],
    ]);
    const runtimeFiles = [];
    for (const [id, relative] of componentPaths) {
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
      if (relative.startsWith('runtime/')) {
        runtimeFiles.push(components.at(-1).files[0]);
      }
    }
    for (const relative of [
      'runtime/node/node.exe',
      'runtime/python/Scripts/python.exe',
      'runtime/kernel/node_modules/fixture/index.js',
      'runtime/runtime-manifest.json',
      'products/desktop/product.json',
      'app.asar.unpacked/dist/main/packaged-supervisor.js',
      'app.asar.unpacked/dist/main/packaged-paths.js',
    ]) {
      const bytes = Buffer.from(`fixture ${relative}`);
      await mkdir(path.dirname(path.join(resources, relative)), { recursive: true });
      await writeFile(path.join(resources, relative), bytes);
      if (relative.startsWith('runtime/')) {
        runtimeFiles.push({
          path: relative,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
    }
    await writeFile(path.join(resources, 'component-manifest.json'), JSON.stringify({
      schema_version: 2,
      platform: 'windows-x64',
      supervisor: 'app.asar.unpacked/dist/main/packaged-supervisor.js',
      path_resolver: 'app.asar.unpacked/dist/main/packaged-paths.js',
      runtime_manifest: 'runtime/runtime-manifest.json',
      runtime_files: runtimeFiles,
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
    await writeFile(path.join(output, 'GlimmerCradle-Setup.exe'), 'fabricated installer');
    await execNode('release-manifest.mjs', [output, '0.1.8'], {
      GLIMMER_CRADLE_SOURCE_COMMIT: 'a'.repeat(40),
    });
    const fabricatedDigest = createHash('sha256')
      .update(await readFile(path.join(output, 'artifact-manifest.json')))
      .digest('hex');
    await assert.rejects(() => execNode('verify-package.mjs', [
      output,
      '--expected-commit', 'a'.repeat(40),
      '--expected-manifest-digest', fabricatedDigest,
      '--expected-builder', 'products/desktop/scripts/package.mjs',
      '--expected-issuer', 'github-actions-sigstore',
    ]), /Windows PE/);
    await writePeFixture(path.join(output, 'GlimmerCradle-Setup.exe'));
    await writeFile(path.join(resources, 'component-manifest.json'), JSON.stringify({
      schema_version: 2,
      platform: 'windows-x64',
      supervisor: 'app.asar.unpacked/dist/main/packaged-supervisor.js',
      path_resolver: 'app.asar.unpacked/dist/main/packaged-paths.js',
      runtime_manifest: 'runtime/runtime-manifest.json',
      runtime_files: runtimeFiles,
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

test('Avatar owner fixed artifact 绑定 commit/digest，漂移或缺失产物失败闭合', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'glimmer-avatar-fixed-'));
  const buildRoot = path.join(root, 'build');
  const artifactRoot = path.join(root, 'artifact');
  const commit = 'c'.repeat(40);
  try {
    await writeFileTree(path.join(
      buildRoot,
      'components',
      'avatar',
      'unity-host',
      'windows-x64',
      'UnityAvatarHostLauncher.exe',
    ), 'avatar');
    await writeFileTree(path.join(
      buildRoot,
      'components',
      'native',
      'composition-host',
      'windows-x64',
      'platform_native.dll',
    ), 'native');
    const created = JSON.parse(await execOwnerArtifact(
      ['create', artifactRoot, commit],
      buildRoot,
    ));
    await rm(path.join(buildRoot, 'components'), { recursive: true, force: true });
    await execOwnerArtifact(
      ['consume', artifactRoot, commit, created.manifest_digest],
      buildRoot,
    );
    assert.equal(
      await readFile(path.join(
        buildRoot,
        'components',
        'avatar',
        'unity-host',
        'windows-x64',
        'UnityAvatarHostLauncher.exe',
      ), 'utf8'),
      'avatar',
    );
    await writeFile(path.join(artifactRoot, 'avatar', 'tampered.bin'), 'tampered');
    await assert.rejects(() => execOwnerArtifact(
      ['consume', artifactRoot, commit, created.manifest_digest],
      buildRoot,
    ));
    await assert.rejects(() => execOwnerArtifact(
      ['consume', artifactRoot, 'd'.repeat(40), created.manifest_digest],
      buildRoot,
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
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

function execOwnerArtifact(args, buildRoot) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [
      path.join(repoRoot, 'hosts', 'unity-avatar-host', 'scripts', 'fixed-artifact.mjs'),
      ...args,
    ], {
      cwd: repoRoot,
      env: { ...process.env, GLIMMER_CRADLE_BUILD_ROOT: buildRoot },
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

async function writeFileTree(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function writePeFixture(target) {
  const bytes = Buffer.alloc(64 * 1024, 0);
  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  await writeFileTree(target, bytes);
}

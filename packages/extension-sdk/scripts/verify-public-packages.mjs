import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(sdkRoot, '..', '..');
const contractsRoot = path.join(repositoryRoot, 'contracts');
const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'glimmer-extension-sdk-release-'));
const packageRoot = path.join(candidateRoot, 'packages');
const consumerRoot = path.join(candidateRoot, 'consumer');
const pnpmEntry = process.env.npm_execpath;
assert.ok(pnpmEntry, '必须通过 pnpm script 运行发布候选验证。');

try {
  fs.mkdirSync(packageRoot, { recursive: true });
  pack(contractsRoot);
  pack(sdkRoot);

  const contractsPackage = findPackage('glimmer-cradle-contracts-');
  const sdkPackage = findPackage('glimmer-cradle-extension-sdk-');
  await verifyArchive(contractsPackage, [
    'package/package.json',
    'package/dist/glimmer/extension/v1/extension_host_process_pb.js',
    'package/json-schema/extension/v1/extension-manifest.schema.json',
  ]);
  await verifyArchive(sdkPackage, [
    'package/package.json',
    'package/dist/index.js',
    'package/dist/manifest/index.js',
    'package/dist/distribution/index.js',
  ]);
  const contractsManifest = await readPackedManifest(contractsPackage, 'contracts');
  const sdkManifest = await readPackedManifest(sdkPackage, 'extension-sdk');
  assert.equal(contractsManifest.private, false, 'Contract 发布包不能标记 private');
  assert.equal(sdkManifest.private, false, 'SDK 发布包不能标记 private');
  assert.equal(sdkManifest.version, contractsManifest.version, 'Contract 与 SDK 发布版本必须一致');
  assert.equal(
    sdkManifest.dependencies?.['@glimmer-cradle/contracts'],
    contractsManifest.version,
    'SDK tarball 必须把 workspace Contract 依赖改写为精确版本',
  );
  assert.ok(!JSON.stringify(sdkManifest).includes('workspace:'), 'SDK tarball 不得残留 workspace 协议');

  fs.mkdirSync(consumerRoot, { recursive: true });
  const contractsPackageReference = `file:${contractsPackage.replaceAll('\\', '/')}`;
  fs.writeFileSync(path.join(consumerRoot, 'package.json'), `${JSON.stringify({
    name: 'glimmer-extension-sdk-release-probe',
    private: true,
    type: 'module',
    dependencies: {
      '@glimmer-cradle/contracts': contractsPackageReference,
      '@glimmer-cradle/extension-sdk': `file:${sdkPackage.replaceAll('\\', '/')}`,
      zod: '3.25.76',
    },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(consumerRoot, 'pnpm-workspace.yaml'), `packages:\n  - .\noverrides:\n  '@glimmer-cradle/contracts': ${contractsPackageReference}\n`, 'utf8');
  fs.writeFileSync(path.join(consumerRoot, 'probe.mjs'), `
import { validateExtensionManifest } from '@glimmer-cradle/extension-sdk/manifest';
import { validateExtensionRegistryCatalog } from '@glimmer-cradle/extension-sdk/distribution';

const manifest = validateExtensionManifest({
  id: 'community.release-probe',
  name: 'Release Probe',
  version: '1.0.0',
  publisher: 'community',
  license: 'MIT',
  repository: 'https://example.com/community/release-probe',
  description: 'Verifies the packed public SDK boundary.',
  products: ['any'],
  platforms: ['any'],
  main: 'dist/index.js',
  requires: [],
  permissions: [],
  contributes: {},
});
if (!manifest.ok) throw new Error(manifest.errors.join('; '));

const registry = validateExtensionRegistryCatalog({
  schema: 'glimmer-cradle.extension-registry',
  schema_version: 1,
  registry: { id: 'registry.example.com', name: 'Probe', homepage: 'https://example.com' },
  extensions: [],
});
if (!registry.ok) throw new Error(registry.errors.join('; '));
`, 'utf8');

  runPnpm(['install', '--ignore-scripts', '--frozen-lockfile=false'], consumerRoot);
  run(process.execPath, ['probe.mjs'], consumerRoot);
  process.stdout.write('[extension-sdk-release] contracts 与 SDK 发布包可由干净 consumer 安装并加载。\n');
} finally {
  fs.rmSync(candidateRoot, { recursive: true, force: true });
}

function pack(packageDirectory) {
  runPnpm(['pack', '--pack-destination', packageRoot], packageDirectory);
}

function findPackage(prefix) {
  const match = fs.readdirSync(packageRoot).find((name) => name.startsWith(prefix) && name.endsWith('.tgz'));
  assert.ok(match, `缺少 ${prefix}*.tgz`);
  return path.join(packageRoot, match);
}

async function verifyArchive(archivePath, requiredPaths) {
  const entries = [];
  await tar.t({ file: archivePath, onentry: (entry) => entries.push(entry.path) });
  for (const requiredPath of requiredPaths) {
    assert.ok(entries.includes(requiredPath), `${path.basename(archivePath)} 缺少 ${requiredPath}`);
  }
  assert.ok(entries.every((entry) => !entry.includes('/node_modules/')), `${path.basename(archivePath)} 包含 node_modules`);
  assert.ok(entries.every((entry) => !entry.includes('/compatibility/')), `${path.basename(archivePath)} 包含内部 compatibility 基线`);
  assert.ok(entries.every((entry) => !entry.includes('/tests/')), `${path.basename(archivePath)} 包含内部测试`);
  assert.ok(entries.every((entry) => !/\.test\.(?:js|d\.ts|d\.ts\.map)$/.test(entry)), `${path.basename(archivePath)} 包含编译后的测试文件`);
}

async function readPackedManifest(archivePath, directoryName) {
  const destination = path.join(candidateRoot, 'manifests', directoryName);
  fs.mkdirSync(destination, { recursive: true });
  await tar.x({
    file: archivePath,
    cwd: destination,
    filter: (entryPath) => entryPath === 'package/package.json',
  });
  return JSON.parse(fs.readFileSync(path.join(destination, 'package', 'package.json'), 'utf8'));
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

function runPnpm(args, cwd) {
  run(process.execPath, [pnpmEntry, ...args], cwd);
}

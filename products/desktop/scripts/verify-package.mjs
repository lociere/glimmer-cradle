#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

if (!process.argv[2]) throw new Error('用法: verify-package.mjs <artifact-root> [expected options]');
const root = path.resolve(process.argv[2]);
const expectedCommit = option('--expected-commit');
const expectedManifestDigest = option('--expected-manifest-digest');
const expectedBuilder = option('--expected-builder');
const expectedIssuer = option('--expected-issuer');
if (!/^[0-9a-f]{40,64}$/.test(expectedCommit)
  || !/^[0-9a-f]{64}$/.test(expectedManifestDigest)
  || !expectedBuilder
  || !expectedIssuer) {
  throw new Error('Desktop verifier 需要独立 expected commit/digest/builder/issuer');
}
const manifestBytes = await fs.readFile(path.join(root, 'artifact-manifest.json'));
const manifest = JSON.parse(manifestBytes);
const provenance = JSON.parse(await fs.readFile(path.join(root, 'provenance.json'), 'utf8'));
const buildClaim = JSON.parse(await fs.readFile(path.join(root, 'build-claim.json'), 'utf8'));
const sbom = JSON.parse(await fs.readFile(path.join(root, 'sbom.spdx.json'), 'utf8'));
const digest = createHash('sha256').update(manifestBytes).digest('hex');
if (digest !== expectedManifestDigest
  || manifest.product !== 'desktop'
  || manifest.platform !== 'windows-x64'
  || manifest.schema_version !== 2
  || manifest.source_commit !== expectedCommit
  || !Array.isArray(manifest.files)
  || manifest.files.length < 2
  || provenance.subject?.sha256 !== expectedManifestDigest
  || provenance.source?.commit !== expectedCommit
  || provenance.builder?.id !== expectedBuilder
  || buildClaim.trust_level !== 'unsigned-build-claim'
  || buildClaim.external_verification_required !== true
  || buildClaim.external_attestation?.provider !== expectedIssuer
  || buildClaim.subject?.sha256 !== expectedManifestDigest
  || buildClaim.source?.commit !== expectedCommit
  || buildClaim.builder?.id !== expectedBuilder
  || sbom.spdxVersion !== 'SPDX-2.3') {
  throw new Error('Desktop fixed artifact 未绑定独立 expected identity');
}
const sbomFiles = new Map((sbom.files || []).map((file) => [
  file.fileName,
  file.checksums?.find((checksum) => checksum.algorithm === 'SHA256')?.checksumValue,
]));
const artifactFiles = new Map();
for (const file of manifest.files) {
  if (typeof file.path !== 'string' || path.isAbsolute(file.path)
    || file.path.includes('..') || artifactFiles.has(file.path)
    || sbomFiles.get(file.path) !== file.sha256) {
    throw new Error(`Desktop 制品路径或 SBOM 无效: ${file.path}`);
  }
  const target = path.resolve(root, file.path);
  const stat = await fs.lstat(target);
  const bytes = stat.isFile() && !stat.isSymbolicLink() ? await fs.readFile(target) : Buffer.alloc(0);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== file.size || actual !== file.sha256) {
    throw new Error(`Desktop 制品校验失败: ${file.path}`);
  }
  artifactFiles.set(file.path, file);
}
const componentManifest = JSON.parse(
  await fs.readFile(path.join(root, manifest.component_manifest), 'utf8'),
);
if (componentManifest.schema_version !== 2
  || componentManifest.supervisor !== 'app.asar.unpacked/dist/main/packaged-supervisor.js'
  || componentManifest.path_resolver !== 'app.asar.unpacked/dist/main/packaged-paths.js'
  || componentManifest.runtime_manifest !== 'runtime/runtime-manifest.json') {
  throw new Error('Desktop component manifest 未声明正式 supervisor/path resolver/runtime');
}
const requiredComponents = new Set(['kernel', 'cognition', 'audio', 'avatar', 'extension-host', 'native']);
for (const component of componentManifest.components || []) {
  requiredComponents.delete(component.id);
  if (!component.owner || !Array.isArray(component.files) || component.files.length === 0) {
    throw new Error(`Desktop component manifest 无效: ${component.id}`);
  }
  for (const file of component.files) {
    const packagedPath = `win-unpacked/resources/${file.path}`;
    const packaged = artifactFiles.get(packagedPath);
    if (!packaged || packaged.sha256 !== file.sha256 || packaged.size !== file.size) {
      throw new Error(`Desktop installer component 未绑定: ${component.id}/${file.path}`);
    }
  }
}
for (const file of componentManifest.runtime_files || []) {
  const packagedPath = `win-unpacked/resources/${file.path}`;
  const packaged = artifactFiles.get(packagedPath);
  if (!packaged || packaged.sha256 !== file.sha256 || packaged.size !== file.size) {
    throw new Error(`Desktop executable runtime 未绑定: ${file.path}`);
  }
}
for (const requiredPath of [
  'GlimmerCradle-Setup.exe',
  'win-unpacked/GlimmerCradle.exe',
  'win-unpacked/resources/app.asar',
  'win-unpacked/resources/app.asar.unpacked/dist/main/packaged-supervisor.js',
  'win-unpacked/resources/app.asar.unpacked/dist/main/packaged-paths.js',
  'win-unpacked/resources/runtime/node/node.exe',
  'win-unpacked/resources/runtime/python/Scripts/python.exe',
  'win-unpacked/resources/runtime/kernel/dist/index.js',
  'win-unpacked/resources/runtime/runtime-manifest.json',
  'win-unpacked/resources/products/desktop/product.json',
  'win-unpacked/resources/components/native/composition-host/bin/Release/platform_native.dll',
  'win-unpacked/resources/components/native/composition-host/bin/Release/UnityAvatarHostLauncher.exe',
  'win-unpacked/resources/components/native/composition-host/DesktopProcessTreeBridge.exe',
]) {
  if (!artifactFiles.has(requiredPath)) throw new Error(`Desktop installer 运行入口缺失: ${requiredPath}`);
}
for (const executablePath of [
  'GlimmerCradle-Setup.exe',
  'win-unpacked/GlimmerCradle.exe',
]) {
  const bytes = await fs.readFile(path.join(root, executablePath));
  if (bytes.length < 64 * 1024 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error(`Desktop installer 不是可执行 Windows PE 制品: ${executablePath}`);
  }
}
if (![...artifactFiles.keys()].some((file) => (
  file.startsWith('win-unpacked/resources/runtime/kernel/node_modules/')
))) {
  throw new Error('Desktop installer 缺少 Kernel resolved dependencies');
}
if (requiredComponents.size > 0 || (sbom.packages || []).length < 6) {
  throw new Error(`Desktop runtime component 缺失: ${[...requiredComponents].join(',')}`);
}
process.stdout.write(`${JSON.stringify({
  event: 'desktop_package_integrity_verified',
  components: 6,
  trusted_attestation: false,
  external_attestation_required: true,
})}\n`);

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

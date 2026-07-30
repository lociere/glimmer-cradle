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

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const artifactRoot = path.resolve(process.argv[2] || '');
const expectedCommit = option('--expected-commit');
const expectedManifestDigest = option('--expected-manifest-digest');
const expectedBuilder = option('--expected-builder');
const expectedIssuer = option('--expected-issuer');
const expectedOciDigest = option('--expected-oci-digest');
if (!artifactRoot || !expectedCommit || !expectedManifestDigest || !expectedBuilder
  || !expectedIssuer || !expectedOciDigest) {
  throw new Error(
    '用法: verify-release.mjs <artifact-root> --expected-commit <sha> '
    + '--expected-manifest-digest <sha256> --expected-builder <owner-task> '
    + '--expected-issuer github-actions-sigstore --expected-oci-digest sha256:<digest>',
  );
}
if (!/^[0-9a-f]{40,64}$/.test(expectedCommit)
  || !/^[0-9a-f]{64}$/.test(expectedManifestDigest)
  || !/^sha256:[0-9a-f]{64}$/.test(expectedOciDigest)) {
  throw new Error('独立 expected commit/digest 格式无效');
}

const manifestBytes = await fs.readFile(path.join(artifactRoot, 'artifact-manifest.json'));
const manifest = JSON.parse(manifestBytes);
const provenance = JSON.parse(await fs.readFile(path.join(artifactRoot, 'provenance.json'), 'utf8'));
const buildClaim = JSON.parse(await fs.readFile(path.join(artifactRoot, 'build-claim.json'), 'utf8'));
const sbom = JSON.parse(await fs.readFile(path.join(artifactRoot, 'sbom.spdx.json'), 'utf8'));
const manifestDigest = createHash('sha256').update(manifestBytes).digest('hex');
if (manifestDigest !== expectedManifestDigest
  || manifest.schema_version !== 1
  || manifest.product !== 'personal-server'
  || manifest.platform !== 'linux-amd64'
  || manifest.source_commit !== expectedCommit
  || manifest.oci_digest !== expectedOciDigest
  || !String(manifest.oci_image || '').endsWith(`@${expectedOciDigest}`)
  || !Array.isArray(manifest.files)
  || manifest.files.length === 0
  || provenance.subject?.sha256 !== expectedManifestDigest
  || provenance.source?.commit !== expectedCommit
  || provenance.oci_subject?.digest !== expectedOciDigest
  || provenance.builder?.id !== expectedBuilder
  || buildClaim.trust_level !== 'unsigned-build-claim'
  || buildClaim.external_verification_required !== true
  || buildClaim.external_attestation?.provider !== expectedIssuer
  || buildClaim.subject?.sha256 !== expectedManifestDigest
  || buildClaim.source?.commit !== expectedCommit
  || buildClaim.builder?.id !== expectedBuilder
  || sbom.spdxVersion !== 'SPDX-2.3'
  || !Array.isArray(sbom.packages)
  || sbom.packages.length < 4) {
  throw new Error('固定制品未绑定独立 expected commit/digest/builder 或 SBOM 不完整');
}
const sbomFiles = new Map((sbom.files || []).map((file) => [
  file.fileName,
  file.checksums?.find((checksum) => checksum.algorithm === 'SHA256')?.checksumValue,
]));
const seen = new Set();
for (const file of manifest.files) {
  if (typeof file.path !== 'string'
    || path.isAbsolute(file.path)
    || path.basename(file.path) !== file.path
    || seen.has(file.path)
    || sbomFiles.get(file.path) !== file.sha256) {
    throw new Error(`制品路径或 SBOM 无效: ${file.path}`);
  }
  seen.add(file.path);
  const target = path.resolve(artifactRoot, file.path);
  const stat = await fs.lstat(target);
  const bytes = stat.isFile() && !stat.isSymbolicLink() ? await fs.readFile(target) : Buffer.alloc(0);
  if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error(`制品校验失败: ${file.path}`);
  }
}
process.stdout.write(`${JSON.stringify({
  event: 'personal_server_release_integrity_verified',
  files: manifest.files.length,
  trusted_attestation: false,
  external_attestation_required: true,
})}\n`);

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

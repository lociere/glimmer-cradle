#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const artifactRoot = path.resolve(process.argv[2] || '');
const version = process.argv[3] || process.env.npm_package_version;
const sourceCommit = process.env.GLIMMER_CRADLE_SOURCE_COMMIT
  || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const ociImage = process.env.GLIMMER_CRADLE_OCI_IMAGE || '';
if (!artifactRoot || !version) throw new Error('用法: release-manifest.mjs <artifact-root> <version>');
if (!/^[0-9a-f]{40,64}$/.test(sourceCommit)) throw new Error('source commit 必须是完整 Git object id');
if (!/^.+@sha256:[0-9a-f]{64}$/.test(ociImage)) throw new Error('OCI image 必须绑定 digest');
const ociDigest = ociImage.slice(ociImage.lastIndexOf('@') + 1);

const excluded = new Set(['artifact-manifest.json', 'provenance.json', 'sbom.spdx.json', 'build-claim.json']);
const files = [];
for (const name of (await fs.readdir(artifactRoot)).sort()) {
  if (excluded.has(name)) continue;
  const target = path.join(artifactRoot, name);
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) throw new Error(`固定制品不得包含 symlink: ${name}`);
  if (!stat.isFile()) continue;
  const bytes = await fs.readFile(target);
  files.push({ path: name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
if (files.length === 0) throw new Error('固定制品目录为空');

const manifest = {
  schema_version: 1,
  product: 'personal-server',
  version,
  platform: 'linux-amd64',
  source_commit: sourceCommit,
  oci_image: ociImage,
  oci_digest: ociDigest,
  files,
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const manifestDigest = createHash('sha256').update(manifestBytes).digest('hex');
const provenance = {
  schema_version: 1,
  subject: { path: 'artifact-manifest.json', sha256: manifestDigest },
  oci_subject: { name: ociImage.slice(0, ociImage.lastIndexOf('@')), digest: ociDigest },
  source: { commit: sourceCommit, dirty: process.env.GLIMMER_CRADLE_SOURCE_DIRTY === '1' },
  builder: {
    id: 'products/personal-server/scripts/package-release.mjs',
    node: process.version,
    pnpm: process.env.npm_config_user_agent || 'unknown',
  },
  invocation: { task: 'products/personal-server/scripts/package-release.mjs', publish: false },
};
const componentPackages = await collectComponentPackages([
  'package.json',
  'core/kernel/package.json',
  'hosts/extension-host/package.json',
  'packages/extension-sdk/package.json',
  'products/personal-server/package.json',
]);
const sbom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `glimmer-cradle-personal-server-${version}`,
  documentNamespace: `https://glimmer-cradle.local/spdx/personal-server/${version}/${manifestDigest}`,
  files: files.map((file, index) => ({
    SPDXID: `SPDXRef-File-${index + 1}`,
    fileName: file.path,
    checksums: [{ algorithm: 'SHA256', checksumValue: file.sha256 }],
  })),
  packages: componentPackages,
};
const buildClaim = {
  schema_version: 1,
  trust_level: 'unsigned-build-claim',
  external_verification_required: true,
  external_attestation: { provider: 'github-actions-sigstore' },
  subject: { path: 'artifact-manifest.json', sha256: manifestDigest },
  source: { commit: sourceCommit },
  builder: { id: provenance.builder.id },
};
await fs.writeFile(path.join(artifactRoot, 'artifact-manifest.json'), manifestBytes);
await fs.writeFile(path.join(artifactRoot, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
await fs.writeFile(path.join(artifactRoot, 'sbom.spdx.json'), `${JSON.stringify(sbom, null, 2)}\n`);
await fs.writeFile(path.join(artifactRoot, 'build-claim.json'), `${JSON.stringify(buildClaim, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ event: 'personal_server_manifest_created', manifest_digest: manifestDigest })}\n`);

async function collectComponentPackages(manifestPaths) {
  const packages = [];
  const dependencies = new Map();
  for (const manifestPath of manifestPaths) {
    const parsed = JSON.parse(await fs.readFile(path.join(repositoryRoot, manifestPath), 'utf8'));
    packages.push({
      SPDXID: `SPDXRef-Package-${packages.length + 1}`,
      name: parsed.name,
      versionInfo: parsed.version,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
    });
    for (const [name, dependencyVersion] of Object.entries({
      ...parsed.dependencies,
      ...parsed.optionalDependencies,
    })) dependencies.set(name, dependencyVersion);
  }
  for (const [name, dependencyVersion] of [...dependencies].sort(([left], [right]) => left.localeCompare(right))) {
    packages.push({
      SPDXID: `SPDXRef-Dependency-${packages.length + 1}`,
      name,
      versionInfo: dependencyVersion,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      externalRefs: [{
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(dependencyVersion)}`,
      }],
    });
  }
  return packages;
}

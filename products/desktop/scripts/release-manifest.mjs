#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
if (!process.argv[2]) throw new Error('用法: release-manifest.mjs <artifact-root> <version>');
const root = path.resolve(process.argv[2]);
const version = process.argv[3] || process.env.npm_package_version;
const sourceCommit = process.env.GLIMMER_CRADLE_SOURCE_COMMIT
  || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40,64}$/.test(sourceCommit)) throw new Error('source commit 必须是完整 Git object id');

const files = await collectFiles(root);
if (!files.some((file) => file.path === 'GlimmerCradle-Setup.exe')) {
  throw new Error('Desktop installer 缺失');
}
const componentManifestPath = 'win-unpacked/resources/component-manifest.json';
if (!files.some((file) => file.path === componentManifestPath)) {
  throw new Error('Desktop installer staging 缺少 component-manifest.json');
}
const manifest = {
  schema_version: 2,
  product: 'desktop',
  version,
  platform: 'windows-x64',
  source_commit: sourceCommit,
  component_manifest: componentManifestPath,
  files,
  install_projection: {
    program_root: '%LOCALAPPDATA%\\Programs\\Glimmer Cradle',
    data_root: '%APPDATA%\\Glimmer Cradle',
    transient_root: '%LOCALAPPDATA%\\Glimmer Cradle',
  },
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const digest = createHash('sha256').update(manifestBytes).digest('hex');
const builderId = 'products/desktop/scripts/package.mjs';
await fs.writeFile(path.join(root, 'artifact-manifest.json'), manifestBytes);
await fs.writeFile(path.join(root, 'provenance.json'), `${JSON.stringify({
  schema_version: 1,
  subject: { path: 'artifact-manifest.json', sha256: digest },
  source: { commit: manifest.source_commit },
  builder: { id: builderId, node: process.version },
  publish: false,
}, null, 2)}\n`);
const componentManifest = JSON.parse(
  await fs.readFile(path.join(root, componentManifestPath), 'utf8'),
);
const dependencyPackages = await collectDependencyPackages();
await fs.writeFile(path.join(root, 'sbom.spdx.json'), `${JSON.stringify({
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `glimmer-cradle-desktop-${version}`,
  documentNamespace: `https://glimmer-cradle.local/spdx/desktop/${version}/${digest}`,
  files: files.map((file, index) => ({
    SPDXID: `SPDXRef-File-${index + 1}`,
    fileName: file.path,
    checksums: [{ algorithm: 'SHA256', checksumValue: file.sha256 }],
  })),
  packages: [
    ...componentManifest.components.map((component, index) => ({
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name: `glimmer-cradle-${component.id}`,
    versionInfo: version,
    supplier: `Organization: ${component.owner}`,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: true,
    })),
    ...dependencyPackages,
  ],
}, null, 2)}\n`);
await fs.writeFile(path.join(root, 'build-claim.json'), `${JSON.stringify({
  schema_version: 1,
  trust_level: 'unsigned-build-claim',
  external_verification_required: true,
  external_attestation: { provider: 'github-actions-sigstore' },
  subject: { path: 'artifact-manifest.json', sha256: digest },
  source: { commit: sourceCommit },
  builder: { id: builderId },
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ event: 'desktop_manifest_created', manifest_digest: digest })}\n`);

async function collectFiles(directory, relative = '') {
  const files = [];
  const excluded = new Set(['artifact-manifest.json', 'provenance.json', 'sbom.spdx.json', 'build-claim.json']);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!relative && excluded.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    const artifactPath = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Desktop fixed artifact 不接受 symlink: ${artifactPath}`);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(target, artifactPath));
    } else if (entry.isFile()) {
      const bytes = await fs.readFile(target);
      files.push({
        path: artifactPath,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectDependencyPackages() {
  const dependencies = new Map();
  for (const manifestPath of [
    'package.json',
    'core/kernel/package.json',
    'packages/extension-sdk/package.json',
    'products/desktop/package.json',
  ]) {
    const manifest = JSON.parse(await fs.readFile(path.join(repositoryRoot, manifestPath), 'utf8'));
    for (const [name, version] of Object.entries({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    })) dependencies.set(name, version);
  }
  return [...dependencies]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, version], index) => ({
      SPDXID: `SPDXRef-Dependency-${index + 1}`,
      name,
      versionInfo: version,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      externalRefs: [{
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`,
      }],
    }));
}

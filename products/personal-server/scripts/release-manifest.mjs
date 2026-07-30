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
if (!artifactRoot || !version) throw new Error('用法: release-manifest.mjs <artifact-root> <version>');
if (!/^[0-9a-f]{40,64}$/.test(sourceCommit)) throw new Error('source commit 必须是完整 Git object id');

const excluded = new Set(['artifact-manifest.json', 'provenance.json', 'sbom.spdx.json', 'attestation.json']);
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
  files,
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const manifestDigest = createHash('sha256').update(manifestBytes).digest('hex');
const provenance = {
  schema_version: 1,
  subject: { path: 'artifact-manifest.json', sha256: manifestDigest },
  source: { commit: sourceCommit, dirty: process.env.GLIMMER_CRADLE_SOURCE_DIRTY === '1' },
  builder: { node: process.version, pnpm: process.env.npm_config_user_agent || 'unknown' },
  invocation: { task: 'products/personal-server/scripts/package-release.mjs', publish: false },
};
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
};
const attestation = {
  _type: 'https://in-toto.io/Statement/v1',
  subject: [{ name: 'artifact-manifest.json', digest: { sha256: manifestDigest } }],
  predicateType: 'https://slsa.dev/provenance/v1',
  predicate: provenance,
};
await fs.writeFile(path.join(artifactRoot, 'artifact-manifest.json'), manifestBytes);
await fs.writeFile(path.join(artifactRoot, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
await fs.writeFile(path.join(artifactRoot, 'sbom.spdx.json'), `${JSON.stringify(sbom, null, 2)}\n`);
await fs.writeFile(path.join(artifactRoot, 'attestation.json'), `${JSON.stringify(attestation, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ event: 'personal_server_manifest_created', manifest_digest: manifestDigest })}\n`);

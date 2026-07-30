#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const artifactRoot = path.resolve(process.argv[2] || '');
if (!artifactRoot) throw new Error('用法: verify-release.mjs <artifact-root>');
const manifestBytes = await fs.readFile(path.join(artifactRoot, 'artifact-manifest.json'));
const manifest = JSON.parse(manifestBytes);
const provenance = JSON.parse(await fs.readFile(path.join(artifactRoot, 'provenance.json'), 'utf8'));
const attestation = JSON.parse(await fs.readFile(path.join(artifactRoot, 'attestation.json'), 'utf8'));
const sbom = JSON.parse(await fs.readFile(path.join(artifactRoot, 'sbom.spdx.json'), 'utf8'));
const manifestDigest = createHash('sha256').update(manifestBytes).digest('hex');
if (manifest.schema_version !== 1
  || manifest.product !== 'personal-server'
  || manifest.platform !== 'linux-amd64'
  || !/^[0-9a-f]{40,64}$/.test(manifest.source_commit)
  || !Array.isArray(manifest.files)
  || manifest.files.length === 0
  || provenance.subject?.sha256 !== manifestDigest
  || provenance.source?.commit !== manifest.source_commit
  || attestation.subject?.[0]?.digest?.sha256 !== manifestDigest
  || attestation.predicate?.source?.commit !== manifest.source_commit
  || sbom.spdxVersion !== 'SPDX-2.3') {
  throw new Error('provenance/attestation 未绑定 artifact manifest');
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
process.stdout.write(`${JSON.stringify({ event: 'personal_server_release_verified', files: manifest.files.length })}\n`);

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

if (!process.argv[2]) throw new Error('用法: verify-package.mjs <artifact-root>');
const root = path.resolve(process.argv[2]);
const manifestBytes = await fs.readFile(path.join(root, 'artifact-manifest.json'));
const manifest = JSON.parse(manifestBytes);
const provenance = JSON.parse(await fs.readFile(path.join(root, 'provenance.json'), 'utf8'));
const attestation = JSON.parse(await fs.readFile(path.join(root, 'attestation.json'), 'utf8'));
const sbom = JSON.parse(await fs.readFile(path.join(root, 'sbom.spdx.json'), 'utf8'));
const digest = createHash('sha256').update(manifestBytes).digest('hex');
if (manifest.product !== 'desktop' || manifest.platform !== 'windows-x64'
  || manifest.schema_version !== 1
  || !/^[0-9a-f]{40,64}$/.test(manifest.source_commit)
  || !Array.isArray(manifest.files)
  || manifest.files.length !== 1
  || provenance.subject?.sha256 !== digest
  || provenance.source?.commit !== manifest.source_commit
  || attestation.subject?.[0]?.digest?.sha256 !== digest
  || attestation.predicate?.source?.commit !== manifest.source_commit
  || sbom.spdxVersion !== 'SPDX-2.3') {
  throw new Error('Desktop manifest/provenance 无效');
}
const sbomFiles = new Map((sbom.files || []).map((file) => [
  file.fileName,
  file.checksums?.find((checksum) => checksum.algorithm === 'SHA256')?.checksumValue,
]));
for (const file of manifest.files) {
  if (file.path !== 'GlimmerCradle-Setup.exe' || sbomFiles.get(file.path) !== file.sha256) {
    throw new Error(`Desktop 制品路径或 SBOM 无效: ${file.path}`);
  }
  const target = path.resolve(root, file.path);
  const stat = await fs.lstat(target);
  const bytes = stat.isFile() && !stat.isSymbolicLink() ? await fs.readFile(target) : Buffer.alloc(0);
  if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error(`Desktop 制品校验失败: ${file.path}`);
  }
}
process.stdout.write(`${JSON.stringify({ event: 'desktop_package_verified' })}\n`);

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
const installer = path.join(root, 'GlimmerCradle-Setup.exe');
const installerStat = await fs.lstat(installer);
if (!installerStat.isFile() || installerStat.isSymbolicLink()) {
  throw new Error('Desktop installer 必须是普通文件');
}
const bytes = await fs.readFile(installer);
const file = {
  path: 'GlimmerCradle-Setup.exe',
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
const manifest = {
  schema_version: 1,
  product: 'desktop',
  version,
  platform: 'windows-x64',
  source_commit: sourceCommit,
  files: [file],
  install_projection: {
    program_root: '%LOCALAPPDATA%\\Programs\\Glimmer Cradle',
    data_root: '%APPDATA%\\Glimmer Cradle',
    transient_root: '%LOCALAPPDATA%\\Glimmer Cradle',
  },
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const digest = createHash('sha256').update(manifestBytes).digest('hex');
await fs.writeFile(path.join(root, 'artifact-manifest.json'), manifestBytes);
await fs.writeFile(path.join(root, 'provenance.json'), `${JSON.stringify({
  schema_version: 1,
  subject: { path: 'artifact-manifest.json', sha256: digest },
  source: { commit: manifest.source_commit },
  builder: { node: process.version, task: 'products/desktop/scripts/package.mjs' },
  publish: false,
}, null, 2)}\n`);
await fs.writeFile(path.join(root, 'sbom.spdx.json'), `${JSON.stringify({
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `glimmer-cradle-desktop-${version}`,
  documentNamespace: `https://glimmer-cradle.local/spdx/desktop/${version}/${digest}`,
  files: [{
    SPDXID: 'SPDXRef-Installer',
    fileName: file.path,
    checksums: [{ algorithm: 'SHA256', checksumValue: file.sha256 }],
  }],
}, null, 2)}\n`);
await fs.writeFile(path.join(root, 'attestation.json'), `${JSON.stringify({
  _type: 'https://in-toto.io/Statement/v1',
  subject: [{ name: 'artifact-manifest.json', digest: { sha256: digest } }],
  predicateType: 'https://slsa.dev/provenance/v1',
  predicate: {
    source: { commit: sourceCommit },
    builder: { node: process.version, task: 'products/desktop/scripts/package.mjs' },
    publish: false,
  },
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ event: 'desktop_manifest_created', manifest_digest: digest })}\n`);

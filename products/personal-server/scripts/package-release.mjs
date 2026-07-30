#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const version = process.argv[2] || process.env.npm_package_version;
const image = process.argv[3];
if (!version || !image?.includes('@sha256:')) {
  throw new Error('用法: package-release.mjs <version> <image@sha256:digest> [image-archive] [archive-ref] [image-id]');
}
const output = path.join(repoRoot, 'dist', 'personal-server', version, 'linux-amd64');
process.env.GLIMMER_CRADLE_OCI_IMAGE = image;
await run(path.join(repoRoot, 'deploy', 'personal-server', 'package-release.sh'), [
  version, output, image, ...process.argv.slice(4),
]);
const manifestOutput = await runCapture(process.execPath, [
  path.join(repoRoot, 'products', 'personal-server', 'scripts', 'release-manifest.mjs'),
  output,
  version,
]);
const manifestDigest = JSON.parse(manifestOutput.trim()).manifest_digest;
const sourceCommit = process.env.GLIMMER_CRADLE_SOURCE_COMMIT
  || (await runCapture('git', ['rev-parse', 'HEAD'])).trim();
await run(process.execPath, [
  path.join(repoRoot, 'products', 'personal-server', 'scripts', 'verify-release.mjs'),
  output,
  '--expected-commit',
  sourceCommit,
  '--expected-manifest-digest',
  manifestDigest,
  '--expected-builder',
  'products/personal-server/scripts/package-release.mjs',
  '--expected-issuer',
  'github-actions-sigstore',
  '--expected-oci-digest',
  image.slice(image.lastIndexOf('@') + 1),
]);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}`)));
  });
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve(stdout)
      : reject(new Error(`${command} 退出码 ${code}`)));
  });
}

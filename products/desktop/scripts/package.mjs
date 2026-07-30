#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const version = process.env.npm_package_version
  || JSON.parse(await readFile(path.join(repoRoot, 'products', 'desktop', 'package.json'), 'utf8')).version;
const output = path.join(repoRoot, 'dist', 'desktop', version, 'windows-x64');
const packageArgs = [
  '--filter', '@glimmer-cradle/desktop', 'exec', 'electron-builder',
  '--win', 'nsis', '--x64', '--publish', 'never',
  `--config.directories.output=${output}`,
  '--config.artifactName=GlimmerCradle-Setup.exe',
];
if (process.argv.includes('--dry-run')) {
  process.stdout.write(`${JSON.stringify({
    product: 'desktop',
    platform: 'windows-x64',
    inputs: [
      'products/desktop/dist',
      'core/kernel/dist',
      'core/cognition',
      'engines/audio',
      'build/components/avatar/unity-host/windows-x64',
      'build/extension-host/modules',
      'build/components/native/composition-host/windows-x64',
    ],
    output,
    command: 'pnpm',
    args: packageArgs,
    side_effects: [output],
    publish: false,
  }, null, 2)}\n`);
  process.exit(0);
}
if (process.platform !== 'win32') throw new Error('Desktop installer 只允许在 Windows runner 构建');
await run('pnpm.cmd', ['build']);
await run('pnpm.cmd', ['prepare:runtime']);
await run('pnpm.cmd', ['avatar:build']);
await run(process.execPath, [
  path.join(repoRoot, 'products', 'desktop', 'scripts', 'prepare-package.mjs'),
]);
await run('pnpm.cmd', packageArgs);
const manifestOutput = await runCapture(process.execPath, [
  path.join(repoRoot, 'products', 'desktop', 'scripts', 'release-manifest.mjs'),
  output,
  version,
]);
const manifestDigest = JSON.parse(manifestOutput.trim()).manifest_digest;
const sourceCommit = process.env.GLIMMER_CRADLE_SOURCE_COMMIT
  || await runCapture('git', ['rev-parse', 'HEAD']);
await run(process.execPath, [
  path.join(repoRoot, 'products', 'desktop', 'scripts', 'verify-package.mjs'),
  output,
  '--expected-commit',
  sourceCommit.trim(),
  '--expected-manifest-digest',
  manifestDigest,
  '--expected-builder',
  'products/desktop/scripts/package.mjs',
  '--expected-issuer',
  'github-actions-sigstore',
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

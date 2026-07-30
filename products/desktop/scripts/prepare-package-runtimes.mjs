#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const runtimeRoot = path.join(repoRoot, 'build', 'runtime', 'desktop', 'windows-x64');
const temporaryRoot = `${runtimeRoot}.prepare-${randomUUID()}`;
const pythonVersion = '3.12.13';
const commands = [
  ['pnpm.cmd', [
    '--filter', '@glimmer-cradle/kernel', '--prod', 'deploy', '--legacy',
    path.join(temporaryRoot, 'kernel'),
  ]],
  ['uv', ['venv', path.join(temporaryRoot, 'python'), '--python', pythonVersion, '--seed']],
];

if (process.argv.includes('--dry-run')) {
  process.stdout.write(`${JSON.stringify({
    event: 'desktop_runtime_bundle_plan',
    platform: 'windows-x64',
    node_runtime: process.execPath,
    python_version: pythonVersion,
    lock_inputs: ['pnpm-lock.yaml', 'core/cognition/uv.lock', 'engines/audio/uv.lock'],
    commands,
    output: path.relative(repoRoot, runtimeRoot).replaceAll('\\', '/'),
  }, null, 2)}\n`);
  process.exit(0);
}
if (process.platform !== 'win32') throw new Error('Desktop runtime bundle 只允许在 Windows runner 构建');

await fs.mkdir(temporaryRoot, { recursive: true });
try {
  await run(commands[0][0], commands[0][1]);
  await fs.mkdir(path.join(temporaryRoot, 'node'), { recursive: true });
  await fs.copyFile(process.execPath, path.join(temporaryRoot, 'node', 'node.exe'));
  await run(commands[1][0], commands[1][1]);

  const cognitionRequirements = path.join(temporaryRoot, 'cognition-requirements.txt');
  const audioRequirements = path.join(temporaryRoot, 'audio-requirements.txt');
  await run('uv', [
    'export', '--project', path.join(repoRoot, 'core', 'cognition'),
    '--frozen', '--no-dev', '--no-emit-project', '--format', 'requirements-txt',
    '--output-file', cognitionRequirements,
  ]);
  await run('uv', [
    'export', '--project', path.join(repoRoot, 'engines', 'audio'),
    '--frozen', '--no-dev', '--all-extras', '--no-emit-project', '--format', 'requirements-txt',
    '--output-file', audioRequirements,
  ]);
  const python = path.join(temporaryRoot, 'python', 'Scripts', 'python.exe');
  await run('uv', [
    'pip', 'install', '--python', python, '--strict',
    '--requirement', cognitionRequirements,
    '--requirement', audioRequirements,
  ]);
  await run('uv', [
    'pip', 'install', '--python', python, '--strict', '--no-deps',
    path.join(repoRoot, 'core', 'cognition'),
    path.join(repoRoot, 'engines', 'audio'),
  ]);
  await fs.rm(cognitionRequirements, { force: true });
  await fs.rm(audioRequirements, { force: true });

  for (const required of [
    path.join(temporaryRoot, 'node', 'node.exe'),
    path.join(temporaryRoot, 'kernel', 'dist', 'index.js'),
    path.join(temporaryRoot, 'kernel', 'node_modules'),
    python,
    path.join(temporaryRoot, 'python', 'Lib', 'site-packages', 'glimmer_cradle', 'cognition'),
    path.join(temporaryRoot, 'python', 'Lib', 'site-packages', 'glimmer_cradle', 'audio'),
  ]) {
    const entry = await fs.lstat(required).catch(() => null);
    if (!entry || entry.isSymbolicLink()) throw new Error(`Desktop runtime bundle 缺失或不可信: ${required}`);
  }
  await fs.writeFile(path.join(temporaryRoot, 'runtime-manifest.json'), `${JSON.stringify({
    schema_version: 1,
    platform: 'windows-x64',
    node: { version: process.version, executable: 'node/node.exe' },
    python: { version: pythonVersion, executable: 'python/Scripts/python.exe' },
    kernel: { entry: 'kernel/dist/index.js', dependencies: 'kernel/node_modules' },
    cognition: { module: 'glimmer_cradle.cognition.host.process' },
    audio: { module: 'glimmer_cradle.audio.main' },
    lock_inputs: ['pnpm-lock.yaml', 'core/cognition/uv.lock', 'engines/audio/uv.lock'],
  }, null, 2)}\n`);
  await fs.rm(runtimeRoot, { recursive: true, force: true });
  await fs.mkdir(path.dirname(runtimeRoot), { recursive: true });
  await fs.rename(temporaryRoot, runtimeRoot);
} catch (error) {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
  throw error;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} 退出码 ${code ?? 'null'}`)));
  });
}

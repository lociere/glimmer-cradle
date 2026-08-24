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
    '--config.node-linker=hoisted', '--filter', '@glimmer-cradle/kernel', '--prod', 'deploy',
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
    lock_inputs: ['pnpm-lock.yaml', 'products/desktop/runtime-python/uv.lock', 'contracts/pyproject.toml'],
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

  const pythonRequirements = path.join(temporaryRoot, 'python-requirements.txt');
  await run('uv', [
    'export', '--project', path.join(repoRoot, 'products', 'desktop', 'runtime-python'),
    '--frozen', '--no-dev', '--no-emit-project', '--no-emit-local', '--format', 'requirements-txt',
    '--output-file', pythonRequirements,
  ]);
  const python = path.join(temporaryRoot, 'python', 'Scripts', 'python.exe');
  const bundledNode = path.join(temporaryRoot, 'node', 'node.exe');
  const kernelContracts = path.join(
    temporaryRoot,
    'kernel',
    'node_modules',
    '@glimmer-cradle',
    'contracts',
    'dist',
    'glimmer',
    'cognition',
    'v1',
    'cognition_service_pb.js',
  );
  const extensionHostEntry = path.join(
    temporaryRoot,
    'kernel',
    'node_modules',
    '@glimmer-cradle',
    'extension-host',
    'dist',
    'main.js',
  );
  await run('uv', [
    'pip', 'install', '--python', python, '--strict',
    '--requirement', pythonRequirements,
  ]);
  await run('uv', [
    'pip', 'install', '--python', python, '--strict', '--no-deps',
    path.join(repoRoot, 'contracts'),
    path.join(repoRoot, 'core', 'cognition'),
    path.join(repoRoot, 'engines', 'audio'),
  ]);
  await fs.rm(pythonRequirements, { force: true });

  for (const required of [
    bundledNode,
    path.join(temporaryRoot, 'kernel', 'dist', 'index.js'),
    path.join(temporaryRoot, 'kernel', 'node_modules'),
    kernelContracts,
    extensionHostEntry,
    python,
    path.join(temporaryRoot, 'python', 'Lib', 'site-packages', 'glimmer_cradle', 'cognition'),
    path.join(temporaryRoot, 'python', 'Lib', 'site-packages', 'glimmer_cradle', 'audio'),
    path.join(temporaryRoot, 'python', 'Lib', 'site-packages', 'glimmer', 'cognition', 'v1', 'cognition_service_pb2.py'),
  ]) {
    const entry = await fs.lstat(required).catch(() => null);
    if (!entry || entry.isSymbolicLink()) throw new Error(`Desktop runtime bundle 缺失或不可信: ${required}`);
  }
  await run(bundledNode, [
    '-e',
    "const service=require(process.argv[1]); if(service.CognitionService.typeName!=='glimmer.cognition.v1.CognitionService') process.exit(2)",
    kernelContracts,
  ]);
  await run(python, ['-I', '-c', 'from glimmer.cognition.v1 import cognition_service_pb2; print(cognition_service_pb2.DESCRIPTOR.package)']);
  await run(python, ['-I', '-m', 'glimmer_cradle.cognition.host.process', '--help']);
  await fs.writeFile(path.join(temporaryRoot, 'runtime-manifest.json'), `${JSON.stringify({
    schema_version: 1,
    platform: 'windows-x64',
    node: { version: process.version, executable: 'node/node.exe' },
    python: { version: pythonVersion, executable: 'python/Scripts/python.exe' },
    kernel: { entry: 'kernel/dist/index.js', dependencies: 'kernel/node_modules' },
    extension_host: { entry: 'kernel/node_modules/@glimmer-cradle/extension-host/dist/main.js' },
    cognition: { module: 'glimmer_cradle.cognition.host.process' },
    audio: { module: 'glimmer_cradle.audio.main' },
    contracts: {
      typescript_module: 'kernel/node_modules/@glimmer-cradle/contracts/dist/glimmer/cognition/v1/cognition_service_pb.js',
      python_module: 'glimmer.cognition.v1.cognition_service_pb2',
    },
    lock_inputs: ['pnpm-lock.yaml', 'products/desktop/runtime-python/uv.lock', 'contracts/pyproject.toml'],
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
      shell: process.platform === 'win32' && command.endsWith('.cmd'),
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} 退出码 ${code ?? 'null'}`)));
  });
}

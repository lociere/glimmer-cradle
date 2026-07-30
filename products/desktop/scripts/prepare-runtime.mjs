#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  digestRuntimeInputs,
  digestRuntimeOutputs,
} from './runtime-output-manifest.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const statePath = path.join(repoRoot, 'build', 'reports', 'checks', 'runtime-output-manifest.json');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const sharedTaskInputs = [
  path.join(repoRoot, 'pnpm-lock.yaml'),
  path.join(repoRoot, 'pnpm-workspace.yaml'),
  path.join(repoRoot, 'package.json'),
  path.join(repoRoot, '.nvmrc'),
];

const previousState = await readJson(statePath, { schema_version: 1, tasks: {} });
const nextState = { schema_version: 1, tasks: {} };

const protocolDigest = await ensureTask({
  id: 'protocol',
  inputs: [
    ...sharedTaskInputs,
    path.join(repoRoot, 'protocol', 'src'),
    path.join(repoRoot, 'protocol', 'package.json'),
    path.join(repoRoot, 'protocol', 'tsconfig.json'),
  ],
  outputs: [path.join(repoRoot, 'protocol', 'dist', 'index.js')],
  run: () => run(pnpmCommand, ['--filter', '@glimmer-cradle/protocol', 'exec', 'tsc', '-p', 'tsconfig.json']),
});

const extensionSdkDigest = await ensureTask({
  id: 'extension-sdk',
  dependencyDigests: [protocolDigest],
  inputs: [
    ...sharedTaskInputs,
    path.join(repoRoot, 'packages', 'extension-sdk', 'src'),
    path.join(repoRoot, 'packages', 'extension-sdk', 'package.json'),
    path.join(repoRoot, 'packages', 'extension-sdk', 'tsconfig.json'),
  ],
  outputs: [path.join(repoRoot, 'packages', 'extension-sdk', 'dist', 'index.js')],
  run: () => run(pnpmCommand, ['--filter', '@glimmer-cradle/extension-sdk', 'exec', 'tsc', '-p', 'tsconfig.json']),
});

await ensureTask({
  id: 'extension-host-modules',
  dependencyDigests: [extensionSdkDigest],
  inputs: [
    ...sharedTaskInputs,
    path.join(repoRoot, 'packages', 'extension-sdk', 'scripts', 'stage-host-modules.mjs'),
    path.join(repoRoot, 'packages', 'extension-sdk', 'package.json'),
  ],
  outputs: [
    path.join(repoRoot, 'build', 'extension-host', 'modules', '@glimmer-cradle', 'extension-sdk', 'dist', 'index.js'),
  ],
  run: () => run(process.execPath, [path.join(repoRoot, 'packages', 'extension-sdk', 'scripts', 'stage-host-modules.mjs')]),
});

await ensureTask({
  id: 'desktop-assets',
  inputs: [
    ...sharedTaskInputs,
    path.join(repoRoot, 'assets'),
    path.join(repoRoot, 'products', 'desktop', 'package.json'),
    path.join(repoRoot, 'products', 'desktop', 'scripts', 'sync-assets.mjs'),
    path.join(repoRoot, 'core', 'avatar', 'scripts', 'avatar-package-catalog.mjs'),
  ],
  outputs: [
    path.join(
      repoRoot,
      'products',
      'desktop',
      'src',
      'renderer',
      'public',
      'assets',
      'avatar',
      'avatar-packages.json',
    ),
  ],
  run: () => run(process.execPath, [path.join(repoRoot, 'products', 'desktop', 'scripts', 'sync-assets.mjs')]),
});

await fs.mkdir(path.dirname(statePath), { recursive: true });
await fs.writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');

async function ensureTask(task) {
  const digest = await digestRuntimeInputs(
    repoRoot,
    task.inputs,
    task.dependencyDigests ?? [],
    task.inputFilter,
  );
  const currentOutputs = await digestRuntimeOutputs(repoRoot, task.outputs);
  const previousTask = previousState.tasks?.[task.id];
  if (currentOutputs && previousTask?.input_digest === digest
    && previousTask?.output_digest === currentOutputs.digest) {
    console.log(`[prepare:runtime] ${task.id} 未变化，复用现有产物`);
  } else {
    console.log(`[prepare:runtime] ${task.id} 已变化或产物缺失，开始准备`);
    await task.run();
  }
  const outputs = await digestRuntimeOutputs(repoRoot, task.outputs);
  if (!outputs) {
    throw new Error(`[prepare:runtime] ${task.id} 未生成完整 outputs`);
  }
  nextState.tasks[task.id] = {
    input_digest: digest,
    output_digest: outputs.digest,
    outputs: outputs.entries,
  };
  return outputs.digest;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 1}`));
    });
  });
}

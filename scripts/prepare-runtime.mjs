#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const statePath = path.join(repoRoot, 'data', 'cache', 'startup', 'preparation-state.json');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const previousState = await readJson(statePath, { version: 1, tasks: {} });
const nextState = { version: 1, tasks: {} };

const protocolDigest = await ensureTask({
  id: 'protocol',
  inputs: [
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
    path.join(repoRoot, 'scripts', 'stage-extension-host-modules.mjs'),
    path.join(repoRoot, 'pnpm-lock.yaml'),
  ],
  outputs: [
    path.join(repoRoot, 'build', 'extension-host', 'modules', '@glimmer-cradle', 'extension-sdk', 'dist', 'index.js'),
  ],
  run: () => run(process.execPath, [path.join(repoRoot, 'scripts', 'stage-extension-host-modules.mjs')]),
});

await ensureTask({
  id: 'desktop-assets',
  inputs: [
    path.join(repoRoot, 'assets'),
    path.join(repoRoot, 'scripts', 'sync-assets.mjs'),
    path.join(repoRoot, 'scripts', 'lib', 'avatar-package-catalog.mjs'),
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
  run: () => run(process.execPath, [path.join(repoRoot, 'scripts', 'sync-assets.mjs')]),
});

await fs.mkdir(path.dirname(statePath), { recursive: true });
await fs.writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');

async function ensureTask(task) {
  const digest = await digestInputs(task.inputs, task.inputFilter, task.dependencyDigests ?? []);
  const outputsExist = (await Promise.all(task.outputs.map(fileExists))).every(Boolean);
  if (outputsExist && previousState.tasks?.[task.id]?.digest === digest) {
    console.log(`[prepare:runtime] ${task.id} 未变化，复用现有产物`);
  } else {
    console.log(`[prepare:runtime] ${task.id} 已变化或产物缺失，开始准备`);
    await task.run();
  }
  nextState.tasks[task.id] = { digest };
  return digest;
}

async function digestInputs(inputs, inputFilter, dependencyDigests) {
  const files = [];
  for (const input of inputs) {
    const stat = await fs.stat(input).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      files.push(...await findFiles(input, inputFilter));
    } else if (!inputFilter || inputFilter(input)) {
      files.push(input);
    }
  }
  files.sort((left, right) => left.localeCompare(right));
  const hash = createHash('sha256');
  for (const dependencyDigest of dependencyDigests) hash.update(`dependency:${dependencyDigest}\n`);
  for (const filePath of files) {
    hash.update(`${path.relative(repoRoot, filePath).replaceAll('\\', '/')}\0`);
    hash.update(await fs.readFile(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function findFiles(root, predicate = () => true) {
  const result = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      result.push(...await findFiles(filePath, predicate));
    } else if (entry.isFile() && predicate(filePath)) {
      result.push(filePath);
    }
  }
  return result;
}

async function fileExists(filePath) {
  return Boolean(await fs.stat(filePath).catch(() => null));
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

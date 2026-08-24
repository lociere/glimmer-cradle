#!/usr/bin/env node
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const source = path.join(repoRoot, 'products', 'desktop', 'native', 'process-tree-bridge', 'DesktopProcessTreeBridge.cpp');
const sourceRoot = path.dirname(source);
const buildRoot = path.join(repoRoot, 'build', 'native', 'desktop-process-tree-bridge', 'windows-x64');
const outputRoot = path.join(repoRoot, 'build', 'components', 'native', 'composition-host', 'windows-x64');
const output = path.join(outputRoot, 'DesktopProcessTreeBridge.exe');
if (process.platform !== 'win32') throw new Error('Desktop native process-tree helper 只允许在 Windows runner 编译');
await mkdir(outputRoot, { recursive: true });
await run('cmake', ['-S', sourceRoot, '-B', buildRoot, '-A', 'x64']);
await run('cmake', ['--build', buildRoot, '--config', 'Release']);
const candidates = [
  path.join(buildRoot, 'bin', 'DesktopProcessTreeBridge.exe'),
  path.join(buildRoot, 'bin', 'Release', 'DesktopProcessTreeBridge.exe'),
  path.join(buildRoot, 'Release', 'DesktopProcessTreeBridge.exe'),
];
const built = candidates.find((candidate) => existsSync(candidate));
if (!built) throw new Error(`Desktop native process-tree helper 产物缺失: ${candidates.join(', ')}`);
await copyFile(built, output);
process.stdout.write(`${JSON.stringify({ event: 'desktop_process_tree_helper_built', output })}\n`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}`)));
  });
}

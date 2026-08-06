#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const source = path.join(repoRoot, 'products', 'desktop', 'native', 'process-tree-bridge', 'DesktopProcessTreeBridge.cpp');
const outputRoot = path.join(repoRoot, 'build', 'components', 'native', 'composition-host', 'windows-x64');
const output = path.join(outputRoot, 'DesktopProcessTreeBridge.exe');
if (process.platform !== 'win32') throw new Error('Desktop native process-tree helper 只允许在 Windows runner 编译');
await mkdir(outputRoot, { recursive: true });
await rm(output, { force: true });
await new Promise((resolve, reject) => {
  const child = spawn('cl.exe', ['/nologo', '/O2', '/EHsc', '/DUNICODE', '/D_UNICODE', source, `/Fe${output}`, '/link', '/SUBSYSTEM:CONSOLE'], { cwd: repoRoot, stdio: 'inherit', windowsHide: true });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`cl.exe 退出码 ${code}`)));
});
process.stdout.write(`${JSON.stringify({ event: 'desktop_process_tree_helper_built', output })}\n`);

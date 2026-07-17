#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePnpmInvocation } from './lib/package-manager-command.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleRoot = path.resolve(process.argv[2] || path.join(repoRoot, 'build', 'extension-host', 'modules'));
const sdkTarget = path.join(moduleRoot, '@glimmer-cradle', 'extension-sdk');
const packageManager = resolvePnpmInvocation({
  platform: process.platform,
  execPath: process.execPath,
  repoRoot,
});

await fs.rm(sdkTarget, { recursive: true, force: true });
await fs.mkdir(path.dirname(sdkTarget), { recursive: true });
await run([
  ...packageManager.prefix,
  '--filter',
  '@glimmer-cradle/extension-sdk',
  'deploy',
  '--prod',
  sdkTarget,
]);
console.log(`[extension-host] 宿主模块已暂存: ${moduleRoot}`);

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(packageManager.command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      windowsHide: true,
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Extension Host 模块暂存失败: ${code ?? 1}`));
    });
  });
}

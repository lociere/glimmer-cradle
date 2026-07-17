import fs from 'node:fs';
import path from 'node:path';

export function resolvePnpmInvocation({
  platform,
  execPath,
  repoRoot,
  existsSync = fs.existsSync,
}) {
  if (platform !== 'win32') {
    return { command: 'corepack', prefix: ['pnpm'] };
  }

  const candidates = [
    path.join(path.dirname(execPath), 'node_modules', 'corepack', 'dist', 'pnpm.js'),
    path.join(repoRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
  ];
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry) {
    throw new Error('无法定位 pnpm 启动入口；请安装项目要求的 Node.js 并运行 corepack enable');
  }
  return { command: execPath, prefix: [entry] };
}

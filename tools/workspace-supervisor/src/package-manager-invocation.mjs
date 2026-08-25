import fs from 'node:fs';
import path from 'node:path';
import { PackageManagerUnavailableError } from './errors.mjs';

export function resolvePnpmInvocation({
  platform,
  execPath,
  repositoryRoot,
  existsSync = fs.existsSync,
}) {
  if (platform !== 'win32') return { command: 'corepack', prefix: ['pnpm'] };

  const candidates = [
    path.join(path.dirname(execPath), 'node_modules', 'corepack', 'dist', 'pnpm.js'),
    path.join(repositoryRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
  ];
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry) {
    throw new PackageManagerUnavailableError(
      '无法定位 pnpm 启动入口；请安装仓库要求的 Node.js 并运行 corepack enable',
    );
  }
  return { command: execPath, prefix: [entry] };
}

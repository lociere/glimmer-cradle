import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function resolveRepositoryRoot(explicitRoot) {
  return path.resolve(explicitRoot ?? path.join(packageRoot, '..', '..'));
}

export function parseRepositoryRootOption(args) {
  const remaining = [];
  let explicitRoot;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--repository-root') {
      explicitRoot = args[index + 1];
      if (!explicitRoot) throw new Error('--repository-root 需要路径参数');
      index += 1;
    } else {
      remaining.push(args[index]);
    }
  }
  if (remaining.length > 0) throw new Error(`未知参数: ${remaining.join(' ')}`);
  return resolveRepositoryRoot(explicitRoot);
}

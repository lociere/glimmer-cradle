import fs from 'node:fs';
import path from 'node:path';
import { toRepoPath, walkFiles } from '../file-system.mjs';

const genericRoots = [
  'core/kernel/src',
  'products/desktop/src',
  'packages/extension-sdk/src',
  'tools/repo-checks/src',
  'tools/workspace-supervisor/src',
];

export function checkPlatformBoundaries(repositoryRoot) {
  const violations = [];
  const skip = new Set(['node_modules', 'dist', 'build']);
  for (const relativeRoot of genericRoots) {
    for (const filePath of walkFiles(path.join(repositoryRoot, relativeRoot), { skip })) {
      const relativePath = toRepoPath(repositoryRoot, filePath);
      if (!/\.(?:ts|tsx|js|jsx|mjs|json|py)$/.test(filePath)) continue;
      if (/\.test\.[^.]+$/.test(filePath)) continue;
      if (relativePath === 'tools/repo-checks/src/architecture/rules/platform-boundaries.mjs') continue;
      if (relativePath.startsWith('products/desktop/src/renderer/public/assets/')) continue;
      const text = fs.readFileSync(filePath, 'utf8');
      for (const match of text.matchAll(/\bselrena\b|月见/gi)) {
        const line = text.slice(0, match.index).split(/\r?\n/).length;
        violations.push(`${relativePath}:${line}: 平台通用源码不得硬编码默认角色`);
      }
    }
  }
  return violations;
}

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const requiredIgnoreLines = [
  'node_modules/',
  'build/',
  'dist/',
  '/data/*',
  '/configs/secrets/*',
  '/hosts/unity-avatar-host/Library/',
];

export function checkDerivedBoundaries(repositoryRoot, { runGit = spawnSync } = {}) {
  const violations = [];
  const ignoreLines = new Set(fs.readFileSync(path.join(repositoryRoot, '.gitignore'), 'utf8').split(/\r?\n/));
  for (const line of requiredIgnoreLines) {
    if (!ignoreLines.has(line)) violations.push(`.gitignore: 缺少 derived/private 边界 ${line}`);
  }
  const result = runGit('git', ['ls-files', '-z'], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    violations.push('git inventory: 无法验证 derived output 未进入 tracked source');
    return violations;
  }
  for (const relativePath of result.stdout.toString('utf8').split('\0').filter(Boolean)) {
    const normalized = relativePath.replaceAll('\\', '/');
    if (/^(?:build|dist|node_modules)\//.test(normalized)) {
      violations.push(`${normalized}: derived output 不得进入 tracked source`);
    }
    if (normalized.startsWith('data/') && normalized !== 'data/README.md') {
      violations.push(`${normalized}: runtime data 不得进入 tracked source`);
    }
  }
  return violations;
}

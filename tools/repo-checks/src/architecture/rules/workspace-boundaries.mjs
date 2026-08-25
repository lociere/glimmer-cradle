import fs from 'node:fs';
import path from 'node:path';
import { readJson, toRepoPath, walkFiles } from '../file-system.mjs';

const packageRoots = [
  'contracts', 'core', 'engines', 'hosts/extension-host', 'packages', 'products', 'templates', 'tools',
];
const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const forbiddenPackages = ['@glimmer-cradle/protocol', '@glimmer-cradle/extension-contracts'];
const repositoryTools = ['@glimmer-cradle/repo-checks', '@glimmer-cradle/workspace-supervisor'];

export function checkWorkspaceBoundaries(repositoryRoot) {
  const violations = [];
  const skip = new Set(['node_modules', 'dist', 'build', '.venv', 'Library', 'Temp']);
  const manifests = packageRoots.flatMap((relativeRoot) => [...walkFiles(path.join(repositoryRoot, relativeRoot), { skip })])
    .filter((filePath) => path.basename(filePath) === 'package.json')
    .filter((filePath) => !toRepoPath(repositoryRoot, filePath).includes('/tests/fixtures/'));

  for (const manifestPath of manifests) {
    const relativePath = toRepoPath(repositoryRoot, manifestPath);
    const manifest = readJson(manifestPath);
    for (const field of dependencyFields) {
      for (const packageName of forbiddenPackages) {
        if (manifest[field]?.[packageName]) {
          violations.push(`${relativePath}: ${field} 不得依赖已删除的 ${packageName}`);
        }
      }
      if (!relativePath.startsWith('tools/')) {
        for (const packageName of repositoryTools) {
          if (manifest[field]?.[packageName]) {
            violations.push(`${relativePath}: runtime/package manifest 不得依赖私有仓库工具 ${packageName}`);
          }
        }
      }
    }
  }
  const extensionSdkManifest = readJson(path.join(repositoryRoot, 'packages', 'extension-sdk', 'package.json'));
  if (extensionSdkManifest.dependencies?.['@glimmer-cradle/contracts'] !== 'workspace:*') {
    violations.push('packages/extension-sdk/package.json: Extension SDK 必须单向依赖 Contract Spine');
  }

  for (const filePath of walkFiles(path.join(repositoryRoot, 'deploy'), { skip })) {
    if (!/\.(?:json|ya?ml|mjs|js|sh|Dockerfile)$/i.test(filePath) && path.basename(filePath) !== 'Dockerfile') continue;
    const text = fs.readFileSync(filePath, 'utf8');
    for (const packageName of repositoryTools) {
      if (text.includes(packageName)) {
        violations.push(`${toRepoPath(repositoryRoot, filePath)}: deploy manifest/实现不得依赖 ${packageName}`);
      }
    }
  }

  const sourceRoots = ['core', 'hosts/extension-host', 'packages', 'products', 'templates'];
  for (const relativeRoot of sourceRoots) {
    for (const filePath of walkFiles(path.join(repositoryRoot, relativeRoot), { skip })) {
      if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(filePath) || /\.test\.[^.]+$/.test(filePath)) continue;
      const text = fs.readFileSync(filePath, 'utf8');
      if (/(?:from\s+|import\s*\(|require\s*\()\s*['"]@glimmer-cradle\/(?:protocol|extension-contracts)(?:\/[^'"]*)?['"]/.test(text)) {
        violations.push(`${toRepoPath(repositoryRoot, filePath)}: production source 不得 import legacy package`);
      }
    }
  }
  for (const filePath of walkFiles(path.join(repositoryRoot, 'tools', 'workspace-supervisor', 'src'), { skip })) {
    if (!/\.mjs$/.test(filePath)) continue;
    const text = fs.readFileSync(filePath, 'utf8');
    if (/packages[\\/]extension-sdk[\\/]scripts|products[\\/]desktop[\\/]scripts/.test(text)) {
      violations.push(`${toRepoPath(repositoryRoot, filePath)}: Supervisor 不得 import owner-local internal script`);
    }
  }
  return violations;
}

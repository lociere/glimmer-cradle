import fs from 'node:fs';
import path from 'node:path';
import { readJson } from '../file-system.mjs';

const requiredRoots = [
  'assets', 'configs', 'contracts', 'core', 'data', 'deploy', 'docs', 'engines', 'hosts',
  'native', 'packages', 'products', 'templates', 'tools',
];

const requiredOwnerPaths = [
  'core/kernel/src/domain',
  'core/kernel/src/application',
  'core/kernel/src/ports',
  'core/kernel/src/adapters',
  'core/kernel/src/runtime',
  'core/kernel/src/composition',
  'core/cognition/src/glimmer_cradle/cognition/domain',
  'core/cognition/src/glimmer_cradle/cognition/application',
  'core/cognition/src/glimmer_cradle/cognition/ports',
  'core/cognition/src/glimmer_cradle/cognition/adapters',
  'core/cognition/src/glimmer_cradle/cognition/host',
  'core/avatar',
  'hosts/extension-host',
  'hosts/unity-avatar-host',
  'products/desktop',
  'products/personal-server',
  'packages/extension-sdk',
];

const requiredToolPackages = new Set([
  '@glimmer-cradle/repo-checks',
  '@glimmer-cradle/workspace-supervisor',
]);

const requiredFacade = {
  'check:encoding': 'pnpm --filter @glimmer-cradle/repo-checks --fail-if-no-match run check:encoding',
  'check:architecture': 'pnpm --filter @glimmer-cradle/repo-checks --fail-if-no-match run check:architecture',
  'dev': 'pnpm --filter @glimmer-cradle/workspace-supervisor --fail-if-no-match run dev -- desktop',
  'dev:all': 'pnpm --filter @glimmer-cradle/workspace-supervisor --fail-if-no-match run dev -- desktop',
  'dev:desktop': 'pnpm --filter @glimmer-cradle/workspace-supervisor --fail-if-no-match run dev -- desktop',
  'dev:personal-server': 'pnpm --filter @glimmer-cradle/workspace-supervisor --fail-if-no-match run dev -- personal-server',
  'start:desktop': 'pnpm --filter @glimmer-cradle/workspace-supervisor --fail-if-no-match run start -- desktop',
  'start:personal-server': 'pnpm --filter @glimmer-cradle/workspace-supervisor --fail-if-no-match run start -- personal-server',
  'chat': 'pnpm --filter @glimmer-cradle/workspace-supervisor --fail-if-no-match run dev -- desktop --kernel-only',
};

export function checkRepositoryTopology(repositoryRoot) {
  const violations = [];
  for (const relativePath of [...requiredRoots, ...requiredOwnerPaths]) {
    if (!fs.existsSync(path.join(repositoryRoot, relativePath))) {
      violations.push(`${relativePath}: canonical 物理边界缺失`);
    }
  }
  if (fs.existsSync(path.join(repositoryRoot, 'scripts'))) {
    violations.push('scripts/: 被替代的 root scripts 不得保留或恢复');
  }

  const toolsRoot = path.join(repositoryRoot, 'tools');
  const discoveredPackages = new Set();
  if (fs.existsSync(toolsRoot)) {
    for (const entry of fs.readdirSync(toolsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        violations.push(`tools/${entry.name}: grouping root 只容纳有 owner 的叶子 workspace`);
        continue;
      }
      const leaf = path.join(toolsRoot, entry.name);
      for (const required of ['package.json', 'src', 'tests']) {
        if (!fs.existsSync(path.join(leaf, required))) {
          violations.push(`tools/${entry.name}/${required}: 工具叶子必须有 manifest、src 与 tests`);
        }
      }
      const manifestPath = path.join(leaf, 'package.json');
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = readJson(manifestPath);
      if (manifest.private !== true) violations.push(`tools/${entry.name}/package.json: 工具 workspace 必须 private`);
      if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
        violations.push(`tools/${entry.name}/package.json: 工具 workspace 必须声明 package owner 名称`);
      } else {
        discoveredPackages.add(manifest.name);
      }
      if (!manifest.scripts?.test) violations.push(`tools/${entry.name}/package.json: 工具 workspace 必须有 test 入口`);
    }
  }
  for (const packageName of requiredToolPackages) {
    if (!discoveredPackages.has(packageName)) violations.push(`${packageName}: 必需工具 workspace 缺失`);
  }

  const workspaceText = fs.readFileSync(path.join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8');
  if (!/^\s*-\s*['"]tools\/\*['"]\s*$/m.test(workspaceText)) {
    violations.push('pnpm-workspace.yaml: 必须纳入 tools/*，且不能枚举固定工具数量');
  }
  const rootManifest = readJson(path.join(repositoryRoot, 'package.json'));
  for (const [name, expected] of Object.entries(requiredFacade)) {
    if (rootManifest.scripts?.[name] !== expected) {
      violations.push(`package.json#scripts.${name}: root façade 必须通过完整 package name 与 --fail-if-no-match 路由`);
    }
  }
  for (const command of ['@glimmer-cradle/repo-checks', '@glimmer-cradle/workspace-supervisor']) {
    if (!rootManifest.scripts?.['test:tooling']?.includes(`--filter ${command} --fail-if-no-match`)) {
      violations.push(`package.json#scripts.test:tooling: 必须包含 ${command} 的公共测试入口`);
    }
  }
  return violations;
}

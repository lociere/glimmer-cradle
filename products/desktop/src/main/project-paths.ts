import { existsSync } from 'fs';
import path from 'path';

export interface DesktopProjectRoots {
  readonly repoRoot: string;
  readonly dataRoot: string;
  readonly runRoot: string;
  readonly configRoot: string;
  readonly extensionsRoot: string;
}

export interface ResolveDesktopProjectRootsOptions {
  readonly cwd: string;
  readonly dirName: string;
  readonly resourcesPath?: string;
  readonly exeDir?: string;
  readonly fallbackRoot?: string;
  readonly configuredAppRoot?: string;
  readonly configuredRepoRoot?: string;
  readonly configuredDataRoot?: string;
  readonly configuredRunRoot?: string;
}

export function resolveDesktopProjectRoots(
  options: ResolveDesktopProjectRootsOptions,
): DesktopProjectRoots {
  const configuredRoot = options.configuredAppRoot?.trim()
    || options.configuredRepoRoot?.trim()
    || '';
  const repoRoot = configuredRoot
    ? path.resolve(configuredRoot)
    : resolveApplicationRoot(options);
  const configuredDataRoot = options.configuredDataRoot?.trim() || '';
  const dataRoot = configuredDataRoot
    ? path.resolve(configuredDataRoot)
    : path.join(repoRoot, 'data');
  const configuredRunRoot = options.configuredRunRoot?.trim() || '';
  const runRoot = configuredRunRoot
    ? path.resolve(configuredRunRoot)
    : path.join(dataRoot, 'run');

  return {
    repoRoot,
    dataRoot,
    runRoot,
    configRoot: path.join(repoRoot, 'configs'),
    extensionsRoot: path.join(dataRoot, 'packages', 'extensions'),
  };
}

export function resolveDesktopConfigChildPath(
  roots: DesktopProjectRoots,
  ...segments: string[]
): string {
  const configRoot = path.resolve(roots.configRoot);
  const target = path.resolve(configRoot, ...segments);
  const relative = path.relative(configRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('配置路径必须位于 configs 目录内');
  }
  return target;
}

export function resolveDesktopRepoChildPath(
  roots: DesktopProjectRoots,
  ...segments: string[]
): string {
  const repoRoot = path.resolve(roots.repoRoot);
  const target = path.resolve(repoRoot, ...segments);
  const relative = path.relative(repoRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('项目路径必须位于 repo root 内');
  }
  return target;
}

export function resolveDesktopProjectPath(
  roots: DesktopProjectRoots,
  value: string,
  fallback = '',
): string {
  const resolvedValue = value.trim() || fallback;
  if (!resolvedValue) return '';
  if (path.isAbsolute(resolvedValue)) return resolvedValue;

  const normalized = resolvedValue.replace(/\\/g, '/');
  if (normalized === 'data') return roots.dataRoot;
  if (normalized.startsWith('data/')) {
    return path.join(roots.dataRoot, normalized.slice('data/'.length));
  }
  return path.join(roots.repoRoot, resolvedValue);
}

export function resolveDesktopStatePath(
  roots: DesktopProjectRoots,
  ...segments: string[]
): string {
  return path.join(roots.dataRoot, 'state', ...segments);
}

export function resolveDesktopWorkPath(
  roots: DesktopProjectRoots,
  ...segments: string[]
): string {
  return path.join(roots.dataRoot, 'work', ...segments);
}

export function resolveDesktopRunPath(
  roots: DesktopProjectRoots,
  ...segments: string[]
): string {
  return path.join(roots.runRoot, ...segments);
}

export function resolveDesktopPackagePath(
  roots: DesktopProjectRoots,
  ...segments: string[]
): string {
  return path.join(roots.dataRoot, 'packages', ...segments);
}

export function resolveDesktopObservabilityPath(
  roots: DesktopProjectRoots,
  ...segments: string[]
): string {
  return path.join(roots.dataRoot, 'observability', ...segments);
}

export function fileExistsSync(filePath: string): boolean {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}

function resolveApplicationRoot(options: ResolveDesktopProjectRootsOptions): string {
  const seeds = [
    options.cwd,
    options.dirName,
    options.resourcesPath || '',
    options.exeDir || '',
  ].filter(Boolean);

  for (const seed of seeds) {
    const detected = findApplicationRoot(seed);
    if (detected) return detected;
  }

  return path.resolve(options.fallbackRoot ?? options.dirName, '..', '..', '..', '..');
}

function findApplicationRoot(seed: string): string | null {
  let current = path.resolve(seed);
  while (true) {
    if (
      fileExistsSync(path.join(current, 'pnpm-workspace.yaml')) ||
      (fileExistsSync(path.join(current, 'configs')) && fileExistsSync(path.join(current, 'products')))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

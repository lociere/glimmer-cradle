import fs from 'fs-extra';
import path from 'path';

/**
 * 解析仓库根目录。
 *
 * 发布产品通过 GLIMMER_CRADLE_APP_ROOT 显式注入只读安装根；开发环境才向上查找 workspace。
 */
export function resolveRepoRoot(): string {
  const configured = process.env.GLIMMER_CRADLE_APP_ROOT?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  let dir = process.cwd();
  let lastPackageJson: string | null = null;

  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      lastPackageJson = dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return lastPackageJson || process.cwd();
}

/**
 * 统一计算 Local Data Domain 根目录。
 *
 * - 未设置部署环境变量时返回 <repoRoot>/data
 * - 绝对路径直接返回
 * - 相对路径按仓库根目录解释
 */
export function resolveDataDir(): string {
  const repoRoot = resolveRepoRoot();
  const configured = process.env.GLIMMER_CRADLE_DATA_ROOT?.trim() || '';
  if (!configured) {
    return path.join(repoRoot, 'data');
  }
  if (path.isAbsolute(configured)) {
    return configured;
  }
  return path.join(repoRoot, configured);
}

/** 统一计算配置根目录。 */
export function resolveConfigDir(repoRoot?: string): string {
  const resolvedRepoRoot = repoRoot
    ? (path.isAbsolute(repoRoot) ? repoRoot : path.resolve(resolveRepoRoot(), repoRoot))
    : resolveRepoRoot();
  const configured = process.env.GLIMMER_CRADLE_CONFIG_ROOT?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(resolvedRepoRoot, configured);
  }
  return path.join(resolvedRepoRoot, 'configs');
}

export function resolveConfigPath(relativePath = '', repoRoot?: string): string {
  const base = resolveConfigDir(repoRoot);
  return relativePath ? path.join(base, relativePath) : base;
}

/** 长期状态域：数据库、经历、扩展持久化等需要保护的数据。 */
export function resolveStateDir(): string {
  return path.join(resolveDataDir(), 'state');
}

/** 短生命周期工作材料域：输入媒体、导出中间文件和单次任务暂存。 */
export function resolveWorkDir(): string {
  return path.join(resolveDataDir(), 'work');
}

export function resolvePackagesDir(): string {
  return path.join(resolveDataDir(), 'packages');
}

export function resolvePackageDir(packageName: string): string {
  return path.join(resolvePackagesDir(), packageName);
}

export function resolvePackagePath(
  packageName: string,
  relativePath = '',
): string {
  const base = resolvePackageDir(packageName);
  return relativePath ? path.join(base, relativePath) : base;
}

export function resolveModelsDir(): string {
  return path.join(resolveDataDir(), 'models');
}

export function resolveModelsPath(relativePath = ''): string {
  const base = resolveModelsDir();
  return relativePath ? path.join(base, relativePath) : base;
}

/** 可重建缓存域：下载缓存、预处理缓存、索引缓存。 */
export function resolveCacheDir(): string {
  return path.join(resolveDataDir(), 'cache');
}

export function resolveCachePath(relativePath = ''): string {
  const base = resolveCacheDir();
  return relativePath ? path.join(base, relativePath) : base;
}

/** 可观测性域：logs / metrics / traces。 */
export function resolveObservabilityDir(): string {
  return path.join(resolveDataDir(), 'observability');
}

export function resolveStatePath(relativePath = ''): string {
  const base = resolveStateDir();
  return relativePath ? path.join(base, relativePath) : base;
}

export function resolveWorkPath(relativePath = ''): string {
  const base = resolveWorkDir();
  return relativePath ? path.join(base, relativePath) : base;
}

/** 短生命周期协调域：动态端点、锁和进程代际信息，不具备跨启动保留契约。 */
export function resolveRunDir(): string {
  const configured = process.env.GLIMMER_CRADLE_RUN_ROOT?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(resolveRepoRoot(), configured);
  }
  return path.join(resolveDataDir(), 'run');
}

export function resolveRunPath(relativePath = ''): string {
  const base = resolveRunDir();
  return relativePath ? path.join(base, relativePath) : base;
}

export interface ConfiguredProjectPathOptions {
  readonly repoRoot?: string;
}

export function resolveConfiguredProjectPath(
  value: string,
  options: ConfiguredProjectPathOptions = {},
): string {
  if (path.isAbsolute(value)) return value;

  const normalized = value.replace(/\\/g, '/');
  const repoRoot = path.resolve(options.repoRoot ?? resolveRepoRoot());
  const configuredDataRoot = process.env.GLIMMER_CRADLE_DATA_ROOT?.trim() || '';
  const dataRoot = configuredDataRoot
    ? path.resolve(repoRoot, configuredDataRoot)
    : path.join(repoRoot, 'data');

  if (normalized === 'data') {
    return dataRoot;
  }
  if (normalized.startsWith('data/')) {
    return path.resolve(dataRoot, normalized.slice('data/'.length));
  }
  return path.resolve(repoRoot, value);
}

/**
 * 统一计算项目日志目录。
 *
 * 日志是 Local Data Domain 的固定子域，不接受独立配置。
 */
export function resolveLogDir(): string {
  return path.join(resolveObservabilityDir(), 'logs');
}

export function resolveMetricsDir(): string {
  return path.join(resolveObservabilityDir(), 'metrics');
}

export function resolveTracesDir(): string {
  return path.join(resolveObservabilityDir(), 'traces');
}

export function resolveEventsDir(): string {
  return path.join(resolveLogDir(), 'events');
}

export function resolveAuditDir(): string {
  return path.join(resolveLogDir(), 'audit');
}

export function resolveModelInvocationsDir(): string {
  return path.join(resolveObservabilityDir(), 'model-invocations');
}

export function resolveObservabilityIndexDir(): string {
  return path.join(resolveObservabilityDir(), 'index');
}

export function resolveObservabilityBundlesDir(): string {
  return path.join(resolveObservabilityDir(), 'bundles');
}

export function resolveKernelDbPath(): string {
  return path.join(resolveStateDir(), 'kernel', 'kernel.db');
}

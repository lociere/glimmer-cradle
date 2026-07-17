import fs from 'node:fs';
import path from 'node:path';
import type { RuntimeReadinessSnapshot } from '../runtime-readiness';
import type { RuntimeResourceSnapshot } from '../runtime-reconciler';
import { strongestRuntimeResourceState } from '../runtime-reconciler';
import {
  inspectRuntimeDirectoryResource,
  inspectRuntimeFileResource,
  mapRuntimeResourceStateToReadinessState,
} from '../resource-resolver';
import { resolvePackagePath, resolveRepoRoot } from '../utils/path-utils';

interface NativePackageManifest {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly packageDirectory: string;
  readonly artifacts: Record<string, string>;
  readonly source?: string;
  readonly license?: string;
}

export interface PlatformNativePackageSnapshot {
  readonly manifest: NativePackageManifest;
  readonly repoRoot: string;
  readonly packageDir: string;
  readonly libraryPath: string;
  readonly usingOverride: boolean;
  readonly overridePath?: string;
}

export function getPlatformNativePackageSnapshot(): PlatformNativePackageSnapshot {
  const repoRoot = resolveRepoRoot();
  const manifest = readManifest(repoRoot);
  const overridePath = process.env.GLIMMER_CRADLE_NATIVE_LIB?.trim();
  const usingOverride = Boolean(overridePath);
  const libraryRelativePath = manifest.artifacts[process.platform] ?? manifest.artifacts.linux;
  const packageDir = resolvePackagePath(manifest.packageDirectory);
  const libraryPath = usingOverride
    ? path.resolve(overridePath as string)
    : path.join(packageDir, libraryRelativePath);

  return {
    manifest,
    repoRoot,
    packageDir,
    libraryPath,
    usingOverride,
    overridePath: overridePath ? path.resolve(overridePath) : undefined,
  };
}

export function resolvePlatformNativeLibraryPath(): string {
  return getPlatformNativePackageSnapshot().libraryPath;
}

export function buildNativeRuntimeReadinessSnapshot(): RuntimeReadinessSnapshot {
  const snapshot = getPlatformNativePackageSnapshot();
  const resources: RuntimeResourceSnapshot[] = [
    inspectRuntimeDirectoryResource({
      resourceId: 'native.package',
      resourceKind: 'package_directory',
      path: snapshot.packageDir,
      label: `${snapshot.manifest.displayName} 包目录`,
      recoveryActions: ['确认 native 构建产物已投影到 data/packages/native。'],
    }),
    inspectRuntimeFileResource({
      resourceId: 'native.library',
      resourceKind: 'native_library',
      path: snapshot.libraryPath,
      label: `${snapshot.manifest.displayName} 动态库`,
      recoveryActions: snapshot.usingOverride
        ? ['检查 GLIMMER_CRADLE_NATIVE_LIB 是否指向当前平台可加载的库文件。']
        : ['构建或安装当前平台的 native 动态库到 data/packages/native。'],
    }),
  ];
  const readiness = strongestRuntimeResourceState(resources);

  return {
    runtime_id: 'native.host',
    owner: 'kernel',
    phase: 'capability_plane',
    state: mapRuntimeResourceStateToReadinessState(readiness),
    blocking: false,
    summary: readiness === 'ready'
      ? `${snapshot.manifest.displayName} ${snapshot.manifest.version} 已就绪`
      : `${snapshot.manifest.displayName} ${snapshot.manifest.version} 存在待收口项`,
    reconciler: {
      desired: 'native-runtime-ready',
      actual: snapshot.usingOverride ? 'override-library' : 'managed-package',
      readiness,
      resources,
    },
  };
}

function readManifest(repoRoot: string): NativePackageManifest {
  const manifestPath = path.join(repoRoot, 'native', 'package.manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as NativePackageManifest;
}

import fs from 'node:fs';
import path from 'node:path';
import type { RuntimeResourceSnapshot } from '../../../foundation/runtime-reconciler';
import {
  countFilesByExtension,
  inspectRuntimeDirectoryResource,
  inspectRuntimeFileResource,
} from '../../../foundation/resource-resolver';
import { resolveConfiguredProjectPath, resolveRepoRoot } from '../../../foundation/utils/path-utils';

interface AvatarPackageManifestLike {
  preferredBackend?: string;
  live2dVersion?: string;
}

interface AvatarSdkDescriptorLike {
  id?: string;
  displayName?: string;
  modelFormats?: unknown;
  status?: string;
  sdkVersion?: string;
  installMode?: string;
  sourcePath?: string;
  sourceEnv?: string;
  importMarkerPath?: string;
  artifactExtensions?: unknown;
  installHint?: string;
  licenseNote?: string;
}

export interface AvatarResourceOptions {
  readonly repoRoot?: string;
  readonly commandPath?: string;
  readonly workingDir?: string;
}

export function buildAvatarResourceSnapshots(
  options: AvatarResourceOptions = {},
): RuntimeResourceSnapshot[] {
  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  const resources: RuntimeResourceSnapshot[] = [];

  const registryPath = path.join(
    repoRoot,
    'core',
    'avatar',
    'unity-host',
    'Assets',
    'StreamingAssets',
    'avatar-package-registry.json',
  );
  resources.push(inspectRuntimeFileResource({
    resourceId: 'avatar.package-registry',
    resourceKind: 'avatar_package_registry',
    path: registryPath,
    label: 'Avatar Package Registry 投影',
    recoveryActions: ['运行 pnpm sync:unity-assets。'],
  }));

  if (options.commandPath?.trim()) {
    resources.push(inspectRuntimeFileResource({
      resourceId: 'avatar.host.executable',
      resourceKind: 'hostProcess_executable',
      path: options.commandPath,
      label: 'Avatar 构建产物',
      recoveryActions: ['运行 pnpm avatar:build 生成 UnityAvatarHost。'],
    }));
  }

  if (options.workingDir?.trim()) {
    resources.push(inspectRuntimeDirectoryResource({
      resourceId: 'avatar.host.working-dir',
      resourceKind: 'hostProcess_workdir',
      path: options.workingDir,
      label: 'Avatar 工作目录',
      recoveryActions: ['确认 Unity Avatar Host.cwd 指向已生成的包目录。'],
    }));
    resources.push(inspectRuntimeFileResource({
      resourceId: 'avatar.host.player',
      resourceKind: 'hostProcess_executable',
      path: path.join(options.workingDir, 'UnityAvatarHost.exe'),
      label: 'Unity Avatar Player',
      recoveryActions: ['运行 pnpm avatar:build 生成 Unity Player。'],
    }));
  }

  resources.push(...buildAvatarSdkResources(repoRoot));
  return resources;
}

function buildAvatarSdkResources(repoRoot: string): RuntimeResourceSnapshot[] {
  const sdkCatalogPath = path.join(repoRoot, 'core', 'avatar', 'unity-host', 'avatar-sdk-catalog.json');
  const sdkCatalog = readJsonFile<{ sdks?: AvatarSdkDescriptorLike[] }>(sdkCatalogPath);
  if (!sdkCatalog) {
    return [inspectRuntimeFileResource({
      resourceId: 'avatar.sdk.catalog',
      resourceKind: 'sdk_catalog',
      path: sdkCatalogPath,
      label: 'Avatar SDK catalog',
      recoveryActions: ['确认 avatar-sdk-catalog.json 已存在且为有效 JSON。'],
    })];
  }

  const requiredModelFormats = collectRequiredUnityModelFormats(repoRoot);
  if (requiredModelFormats.length === 0) {
    return [{
      resource_id: 'avatar.sdk.catalog',
      resource_kind: 'sdk_catalog',
      desired_state: 'ready',
      actual_state: 'ready',
      readiness: 'ready',
      summary: '当前没有需要 Unity SDK 的 Avatar Avatar Package。',
      recovery_actions: [],
    }];
  }

  const resources: RuntimeResourceSnapshot[] = [];
  for (const modelFormat of requiredModelFormats) {
    const descriptor = (sdkCatalog.sdks ?? []).find((item) => toStringArray(item.modelFormats).includes(modelFormat));
    if (!descriptor) {
      resources.push({
        resource_id: `avatar.sdk.${modelFormat}`,
        resource_kind: 'unity_sdk',
        desired_state: 'ready',
        actual_state: 'missing',
        readiness: 'missing',
        summary: `SDK catalog 未声明 ${modelFormat} 所需的 Unity SDK。`,
        recovery_actions: ['补齐 avatar-sdk-catalog.json 中对应模型格式的 SDK 声明。'],
      });
      continue;
    }

    const descriptorId = typeof descriptor.id === 'string' && descriptor.id.trim()
      ? descriptor.id.trim()
      : modelFormat;
    const displayName = typeof descriptor.displayName === 'string' && descriptor.displayName.trim()
      ? descriptor.displayName.trim()
      : descriptorId;
    const sourceEnvValue = typeof descriptor.sourceEnv === 'string' && descriptor.sourceEnv.trim()
      ? process.env[descriptor.sourceEnv.trim()]
      : undefined;
    const sourcePath = typeof descriptor.sourcePath === 'string'
      ? resolveConfiguredProjectPath(sourceEnvValue || descriptor.sourcePath, { repoRoot })
      : '';
    const importMarkerPath = typeof descriptor.importMarkerPath === 'string'
      ? resolveConfiguredProjectPath(descriptor.importMarkerPath, { repoRoot })
      : '';
    const installMode = typeof descriptor.installMode === 'string' ? descriptor.installMode : 'copy';
    const artifactExtensions = toStringArray(descriptor.artifactExtensions).map((item) => item.toLowerCase());
    const artifactCount = sourcePath ? countFilesByExtension(sourcePath, new Set(artifactExtensions)) : 0;
    const imported = installMode === 'unitypackage'
      ? markerMatchesVersion(importMarkerPath, descriptor.sdkVersion)
      : artifactCount > 0;

    let actualState: RuntimeResourceSnapshot['actual_state'] = 'missing';
    let readiness: RuntimeResourceSnapshot['readiness'] = 'missing';
    let summary = `${displayName} 缺失`;
    if (imported) {
      actualState = 'ready';
      readiness = 'ready';
      summary = `${displayName} 已导入 Unity 项目`;
    } else if (artifactCount > 0) {
      actualState = 'pending';
      readiness = 'pending';
      summary = `${displayName} 安装包已准备，等待 Unity 导入`;
    } else if (typeof descriptor.status === 'string' && descriptor.status !== 'supported') {
      actualState = 'degraded';
      readiness = 'degraded';
      summary = `${displayName} 当前标记为 ${descriptor.status}`;
    }

    const recoveryActions = [
      descriptor.installHint,
      descriptor.licenseNote,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (recoveryActions.length === 0) {
      recoveryActions.push(`确认 ${displayName} 已安装到 ${sourcePath || '声明目录'}。`);
    }

    resources.push({
      resource_id: `avatar.sdk.${descriptorId}`,
      resource_kind: 'unity_sdk',
      desired_state: 'ready',
      actual_state: actualState,
      readiness,
      summary,
      recovery_actions: recoveryActions,
    });
  }
  return resources;
}

function collectRequiredUnityModelFormats(repoRoot: string): string[] {
  const root = path.join(repoRoot, 'assets', 'avatar', 'avatar-packages');
  if (!fs.existsSync(root)) {
    return [];
  }

  const formats = new Set<string>();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = readJsonFile<AvatarPackageManifestLike>(
      path.join(root, entry.name, 'avatar-package.json'),
    );
    if (!manifest || manifest.preferredBackend !== 'unity' || typeof manifest.live2dVersion !== 'string') {
      continue;
    }
    formats.add(manifest.live2dVersion);
  }
  return [...formats].sort();
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function markerMatchesVersion(markerPath: string, sdkVersion?: string): boolean {
  if (!markerPath || !fs.existsSync(markerPath)) {
    return false;
  }
  try {
    const marker = fs.readFileSync(markerPath, 'utf8');
    return !sdkVersion || marker.includes(`version: ${sdkVersion}`);
  } catch {
    return false;
  }
}

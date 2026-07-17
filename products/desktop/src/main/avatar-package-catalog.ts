import fs from 'fs/promises';
import path from 'path';

export interface AvatarPackageRecord {
  id: string;
  default: boolean;
  characterId: string;
  modelId: string;
  displayName: string;
  kind: 'live2d';
  preferredBackend: 'unity';
  previewImagePath?: string;
  live2dVersion: 'cubism4' | 'cubism5';
  assetRootPath: string;
  modelPath: string;
  emotionMapPath?: string;
  actionsPath?: string;
  behaviorPath?: string;
  presentation?: {
    defaultPlacement: string;
    placementPresets: Record<string, {
      visibleRatio: number;
      rightInset?: number;
      bottomInset?: number;
    }>;
  };
  idleMotionGroup?: string;
  interactionMotions?: Record<string, string>;
  scaleFactor?: number;
  license?: string;
}

export interface AvatarPackageCatalogSnapshot {
  defaultAvatarPackageId: string;
  defaultModelId: string;
  packages: AvatarPackageRecord[];
}

export async function loadAvatarPackageCatalog(repoRoot: string): Promise<AvatarPackageCatalogSnapshot> {
  const root = path.join(repoRoot, 'assets', 'avatar', 'avatar-packages');
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const packages: AvatarPackageRecord[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, entry.name, 'avatar-package.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    packages.push(validateManifest(repoRoot, manifest, manifestPath));
  }

  if (packages.length === 0) {
    return {
      defaultAvatarPackageId: '',
      defaultModelId: '',
      packages: [],
    };
  }

  const defaults = packages.filter((item) => item.default);
  if (defaults.length !== 1) {
    throw new Error('角色Avatar Package必须且只能声明一个 default=true');
  }

  const avatarPackageIds = new Set<string>();
  const modelIds = new Set<string>();
  for (const item of packages) {
    if (avatarPackageIds.has(item.id)) {
      throw new Error(`Avatar Package ID 重复: ${item.id}`);
    }
    if (modelIds.has(item.modelId)) {
      throw new Error(`身体模型 ID 重复: ${item.modelId}`);
    }
    avatarPackageIds.add(item.id);
    modelIds.add(item.modelId);
  }

  return {
    defaultAvatarPackageId: defaults[0].id,
    defaultModelId: defaults[0].modelId,
    packages,
  };
}

export function resolveAvatarPackage(
  catalog: AvatarPackageCatalogSnapshot,
  modelId: string,
): AvatarPackageRecord {
  const targetModelId = modelId || catalog.defaultModelId;
  const matched = catalog.packages.find((item) => item.modelId === targetModelId);
  if (!matched) {
    throw new Error(`Avatar Package目录未声明模型: ${targetModelId}`);
  }
  return matched;
}

export function resolveRepoAssetPath(repoRoot: string, value: string, fieldName: string): string {
  if (!value.trim()) {
    throw new Error(`${fieldName} 不能为空`);
  }
  const assetsRoot = path.join(repoRoot, 'assets');
  const resolved = path.resolve(repoRoot, value);
  const relative = path.relative(assetsRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${fieldName} 越过 assets 边界: ${value}`);
  }
  return resolved;
}

function validateManifest(
  repoRoot: string,
  value: Record<string, unknown>,
  manifestPath: string,
): AvatarPackageRecord {
  const id = readString(value.id, 'id', manifestPath);
  const characterId = readString(value.characterId, 'characterId', manifestPath);
  const modelId = readString(value.modelId, 'modelId', manifestPath);
  const displayName = readString(value.displayName, 'displayName', manifestPath);
  const kind = readEnum(value.kind, ['live2d'] as const, 'kind', manifestPath);
  const preferredBackend = readEnum(value.preferredBackend, ['unity'] as const, 'preferredBackend', manifestPath);
  const live2dVersion = readEnum(value.live2dVersion, ['cubism4', 'cubism5'] as const, 'live2dVersion', manifestPath);
  const assetRootPath = readString(value.assetRootPath, 'assetRootPath', manifestPath);
  const modelPath = readString(value.modelPath, 'modelPath', manifestPath);
  resolveRepoAssetPath(repoRoot, assetRootPath, `${id}.assetRootPath`);
  resolveRepoAssetPath(repoRoot, modelPath, `${id}.modelPath`);

  const previewImagePath = readOptionalString(value.previewImagePath);
  const emotionMapPath = readOptionalString(value.emotionMapPath);
  const actionsPath = readOptionalString(value.actionsPath);
  const behaviorPath = readOptionalString(value.behaviorPath);
  if (previewImagePath) resolveRepoAssetPath(repoRoot, previewImagePath, `${id}.previewImagePath`);
  if (emotionMapPath) resolveRepoAssetPath(repoRoot, emotionMapPath, `${id}.emotionMapPath`);
  if (actionsPath) resolveRepoAssetPath(repoRoot, actionsPath, `${id}.actionsPath`);
  if (behaviorPath) resolveRepoAssetPath(repoRoot, behaviorPath, `${id}.behaviorPath`);

  return {
    id,
    default: value.default === true,
    characterId,
    modelId,
    displayName,
    kind,
    preferredBackend,
    previewImagePath: previewImagePath || undefined,
    live2dVersion,
    assetRootPath,
    modelPath,
    emotionMapPath: emotionMapPath || undefined,
    actionsPath: actionsPath || undefined,
    behaviorPath: behaviorPath || undefined,
    presentation: isRecord(value.presentation)
      ? value.presentation as AvatarPackageRecord['presentation']
      : undefined,
    idleMotionGroup: readOptionalString(value.idleMotionGroup) || undefined,
    interactionMotions: isStringMap(value.interactionMotions)
      ? value.interactionMotions
      : undefined,
    scaleFactor: typeof value.scaleFactor === 'number' ? value.scaleFactor : undefined,
    license: readOptionalString(value.license) || undefined,
  };
}

function readString(value: unknown, fieldName: string, manifestPath: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${manifestPath} 缺少 ${fieldName}`);
  }
  return value.trim();
}

function readOptionalString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fieldName: string,
  manifestPath: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value as T[number])) {
    throw new Error(`${manifestPath} 的 ${fieldName} 无效`);
  }
  return value as T[number];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

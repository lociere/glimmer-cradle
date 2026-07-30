import { promises as fs } from 'node:fs';
import path from 'node:path';

const AVATAR_PACKAGE_ROOT = path.join('assets', 'avatar', 'avatar-packages');

export async function loadAvatarPackageCatalog(repoRoot) {
  const avatarPackageRoot = path.join(repoRoot, AVATAR_PACKAGE_ROOT);
  const entries = await fs.readdir(avatarPackageRoot, { withFileTypes: true }).catch(() => []);
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(avatarPackageRoot, entry.name, 'avatar-package.json');
    const manifest = await readJson(manifestPath);
    packages.push(validateAvatarPackageManifest(repoRoot, manifest, manifestPath));
  }

  if (packages.length === 0) {
    return {
      defaultAvatarPackageId: '',
      defaultModelId: '',
      packages: [],
    };
  }

  const defaultPackages = packages.filter((item) => item.default === true);
  if (defaultPackages.length !== 1) {
    throw new Error('[avatar-package] exactly one Avatar Package must declare default=true');
  }

  const avatarPackageIds = new Set();
  const modelIds = new Set();
  for (const descriptor of packages) {
    if (avatarPackageIds.has(descriptor.id)) {
      throw new Error(`[avatar-package] duplicate Avatar Package id: ${descriptor.id}`);
    }
    if (modelIds.has(descriptor.modelId)) {
      throw new Error(`[avatar-package] duplicate model id: ${descriptor.modelId}`);
    }
    avatarPackageIds.add(descriptor.id);
    modelIds.add(descriptor.modelId);
  }

  return {
    defaultAvatarPackageId: defaultPackages[0].id,
    defaultModelId: defaultPackages[0].modelId,
    packages,
  };
}

export function resolveRepositoryAssetPath(repoRoot, value, fieldName, boundary = path.join(repoRoot, 'assets')) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`[avatar-package] ${fieldName} must be a non-empty repository path`);
  }

  const resolved = path.resolve(repoRoot, value);
  const relative = path.relative(boundary, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`[avatar-package] ${fieldName} escapes assets boundary: ${value}`);
  }
  return resolved;
}

export function assertInside(parent, child, fieldName) {
  const relative = path.relative(parent, child);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`[avatar-package] ${fieldName} must stay inside ${parent}: ${child}`);
  }
  return relative;
}

async function readJson(filePath) {
  const document = await fs.readFile(filePath, 'utf8');
  return JSON.parse(document);
}

function validateAvatarPackageManifest(repoRoot, value, manifestPath) {
  const id = readString(value.id, 'id', manifestPath);
  const characterId = readString(value.characterId, 'characterId', manifestPath);
  const modelId = readString(value.modelId, 'modelId', manifestPath);
  const displayName = readString(value.displayName, 'displayName', manifestPath);
  const kind = readEnum(value.kind, ['live2d'], 'kind', manifestPath);
  const preferredBackend = readEnum(value.preferredBackend, ['unity'], 'preferredBackend', manifestPath);
  const live2dVersion = readEnum(value.live2dVersion, ['cubism4', 'cubism5'], 'live2dVersion', manifestPath);
  const assetRootPath = readString(value.assetRootPath, 'assetRootPath', manifestPath);
  const modelPath = readString(value.modelPath, 'modelPath', manifestPath);

  const previewImagePath = readOptionalString(value.previewImagePath);
  const emotionMapPath = readOptionalString(value.emotionMapPath);
  const actionsPath = readOptionalString(value.actionsPath);
  const behaviorPath = readOptionalString(value.behaviorPath);

  resolveRepositoryAssetPath(repoRoot, assetRootPath, `${id}.assetRootPath`);
  resolveRepositoryAssetPath(repoRoot, modelPath, `${id}.modelPath`);
  if (previewImagePath) resolveRepositoryAssetPath(repoRoot, previewImagePath, `${id}.previewImagePath`);
  if (emotionMapPath) resolveRepositoryAssetPath(repoRoot, emotionMapPath, `${id}.emotionMapPath`);
  if (actionsPath) resolveRepositoryAssetPath(repoRoot, actionsPath, `${id}.actionsPath`);
  if (behaviorPath) resolveRepositoryAssetPath(repoRoot, behaviorPath, `${id}.behaviorPath`);

  return {
    id,
    default: value.default === true,
    characterId,
    modelId,
    displayName,
    kind,
    preferredBackend,
    previewImagePath,
    live2dVersion,
    assetRootPath,
    modelPath,
    emotionMapPath,
    actionsPath,
    behaviorPath,
    presentation: value.presentation ?? undefined,
    idleMotionGroup: readOptionalString(value.idleMotionGroup),
    interactionMotions: readOptionalStringMap(value.interactionMotions),
    scaleFactor: typeof value.scaleFactor === 'number' ? value.scaleFactor : undefined,
    license: readOptionalString(value.license),
  };
}

function readString(value, fieldName, manifestPath) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`[avatar-package] ${fieldName} is required in ${manifestPath}`);
  }
  return value.trim();
}

function readEnum(value, allowed, fieldName, manifestPath) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`[avatar-package] ${fieldName} must be one of ${allowed.join(', ')} in ${manifestPath}`);
  }
  return value;
}

function readOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function readOptionalStringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([, item]) => typeof item === 'string' && item.trim().length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

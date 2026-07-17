import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertInside,
  loadAvatarPackageCatalog,
  resolveRepositoryAssetPath,
} from './lib/avatar-package-catalog.mjs';
import {
  resolveAvatarPackageRegistryPath,
  resolveAvatarStreamingAssetsPath,
  resolveAvatarUnityProjectPath,
} from './lib/avatar-paths.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const avatarSourceRoot = path.join(repoRoot, 'assets', 'avatar');
const unityProjectRoot = resolveAvatarUnityProjectPath(repoRoot);
const streamingAssetsRoot = resolveAvatarStreamingAssetsPath(repoRoot);
const avatarProjectionRoot = path.join(streamingAssetsRoot, 'avatar');
const unityResourcesRoot = path.join(
  unityProjectRoot,
  'Assets',
  'Resources',
  'AvatarModels',
);
const registryProjectionPath = resolveAvatarPackageRegistryPath(repoRoot);
const legacyRegistryProjectionPath = path.join(streamingAssetsRoot, 'avatar-registry.json');

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

async function requireFile(filePath, fieldName) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`[sync-unity-assets] ${fieldName} does not exist: ${filePath}`);
  }
}

const catalog = await loadAvatarPackageCatalog(repoRoot);
const unityPackages = catalog.packages.filter((item) => item.preferredBackend === 'unity');
if (unityPackages.length === 0) {
  throw new Error('[sync-unity-assets] avatar Avatar Package catalog has no Unity package');
}

await fs.rm(avatarProjectionRoot, { recursive: true, force: true });
await fs.rm(legacyRegistryProjectionPath, { force: true });
await fs.mkdir(avatarProjectionRoot, { recursive: true });
await fs.mkdir(unityResourcesRoot, { recursive: true });

const registeredModelIds = new Set(unityPackages.map((item) => item.modelId));
for (const entry of await fs.readdir(unityResourcesRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && !registeredModelIds.has(entry.name)) {
    await fs.rm(path.join(unityResourcesRoot, entry.name), { recursive: true, force: true });
  }
}

const projectedModels = [];
for (const avatarPackage of unityPackages) {
  const sourceDirectory = resolveRepositoryAssetPath(
    repoRoot,
    avatarPackage.assetRootPath,
    `${avatarPackage.id}.assetRootPath`,
  );
  const sourceStat = await fs.stat(sourceDirectory).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new Error(`[sync-unity-assets] ${avatarPackage.id}.assetRootPath does not exist: ${sourceDirectory}`);
  }
  assertInside(avatarSourceRoot, sourceDirectory, `${avatarPackage.id}.assetRootPath`);

  const manifestPath = resolveRepositoryAssetPath(repoRoot, avatarPackage.modelPath, `${avatarPackage.id}.modelPath`);
  await requireFile(manifestPath, `${avatarPackage.id}.modelPath`);
  const manifestFile = toPosixPath(
    assertInside(sourceDirectory, manifestPath, `${avatarPackage.id}.modelPath`),
  );

  const targetDirectory = path.join(avatarProjectionRoot, avatarPackage.modelId);
  const resourceDirectory = path.join(unityResourcesRoot, avatarPackage.modelId);
  await fs.mkdir(targetDirectory, { recursive: true });
  await fs.mkdir(resourceDirectory, { recursive: true });
  await fs.cp(sourceDirectory, resourceDirectory, { recursive: true });

  let emotionMapFile = '';
  if (avatarPackage.emotionMapPath) {
    const emotionMapPath = resolveRepositoryAssetPath(
      repoRoot,
      avatarPackage.emotionMapPath,
      `${avatarPackage.id}.emotionMapPath`,
    );
    await requireFile(emotionMapPath, `${avatarPackage.id}.emotionMapPath`);
    emotionMapFile = toPosixPath(assertInside(sourceDirectory, emotionMapPath, `${avatarPackage.id}.emotionMapPath`));
    const emotionTargetPath = path.join(targetDirectory, emotionMapFile);
    await fs.mkdir(path.dirname(emotionTargetPath), { recursive: true });
    await fs.copyFile(emotionMapPath, emotionTargetPath);
  }

  let actionsFile = '';
  if (avatarPackage.actionsPath) {
    const actionsPath = resolveRepositoryAssetPath(repoRoot, avatarPackage.actionsPath, `${avatarPackage.id}.actionsPath`);
    await requireFile(actionsPath, `${avatarPackage.id}.actionsPath`);
    await validateActionCatalog(actionsPath, avatarPackage.id);
    actionsFile = toPosixPath(assertInside(sourceDirectory, actionsPath, `${avatarPackage.id}.actionsPath`));
    const actionsTargetPath = path.join(targetDirectory, actionsFile);
    await fs.mkdir(path.dirname(actionsTargetPath), { recursive: true });
    await fs.copyFile(actionsPath, actionsTargetPath);
  }

  let behaviorFile = '';
  if (avatarPackage.behaviorPath) {
    const behaviorPath = resolveRepositoryAssetPath(repoRoot, avatarPackage.behaviorPath, `${avatarPackage.id}.behaviorPath`);
    await requireFile(behaviorPath, `${avatarPackage.id}.behaviorPath`);
    await validateBehaviorProfile(behaviorPath, avatarPackage.id);
    behaviorFile = toPosixPath(assertInside(sourceDirectory, behaviorPath, `${avatarPackage.id}.behaviorPath`));
    const behaviorTargetPath = path.join(targetDirectory, behaviorFile);
    await fs.mkdir(path.dirname(behaviorTargetPath), { recursive: true });
    await fs.copyFile(behaviorPath, behaviorTargetPath);
  }

  const presentation = projectPresentation(avatarPackage);
  const motionGroups = await projectMotionGroups(manifestPath, avatarPackage.id);

  projectedModels.push({
    avatarPackageId: avatarPackage.id,
    characterId: avatarPackage.characterId,
    id: avatarPackage.modelId,
    displayName: avatarPackage.displayName,
    metadataRoot: `avatar/${avatarPackage.modelId}`,
    emotionMapFile,
    actionsFile,
    behaviorFile,
    resourceKey: `AvatarModels/${avatarPackage.modelId}/${path.basename(manifestFile, '.model3.json')}`,
    modelFormat: avatarPackage.live2dVersion,
    idleMotionGroup: avatarPackage.idleMotionGroup ?? '',
    motionGroups,
    presentation,
  });
  console.log(`[sync-unity-assets] projected avatar Avatar Package:${avatarPackage.id}`);
}

await fs.writeFile(
  registryProjectionPath,
  `${JSON.stringify({
    defaultAvatarPackageId: catalog.defaultAvatarPackageId,
    defaultModelId: catalog.defaultModelId,
    models: projectedModels,
  }, null, 2)}\n`,
  'utf8',
);

console.log(`[sync-unity-assets] wrote ${path.relative(repoRoot, registryProjectionPath)}`);

async function projectMotionGroups(manifestPath, avatarPackageId) {
  let document;
  try {
    document = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`[sync-unity-assets] ${avatarPackageId}.modelPath 不是有效 JSON: ${error.message}`);
  }

  const motions = document?.FileReferences?.Motions;
  if (!motions || typeof motions !== 'object' || Array.isArray(motions)) {
    return [];
  }

  return Object.entries(motions).flatMap(([id, entries]) => {
    if (!Array.isArray(entries)) return [];
    const clips = entries
      .map((entry) => typeof entry?.File === 'string' ? entry.File : '')
      .map((file) => path.basename(file).replace(/\.motion3\.json$/i, ''))
      .filter(Boolean);
    return clips.length > 0 ? [{ id, clips }] : [];
  });
}

function projectPresentation(avatarPackage) {
  const source = avatarPackage.presentation;
  if (!source) {
    return {
      defaultPlacement: 'full-body',
      placementPresets: [
        { id: 'full-body', visibleRatio: 1, rightInset: 24, bottomInset: 16 },
      ],
    };
  }

  const entries = Object.entries(source.placementPresets ?? {}).map(([id, preset]) => ({
    id,
    visibleRatio: preset.visibleRatio,
    rightInset: preset.rightInset ?? 24,
    bottomInset: preset.bottomInset ?? 0,
  }));
  if (!entries.some((preset) => preset.id === source.defaultPlacement)) {
    throw new Error(
      `[sync-unity-assets] ${avatarPackage.id}.presentation.defaultPlacement is not registered: ${source.defaultPlacement}`,
    );
  }
  return {
    defaultPlacement: source.defaultPlacement,
    placementPresets: entries,
  };
}

async function validateBehaviorProfile(filePath, avatarPackageId) {
  let profile;
  try {
    profile = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`[sync-unity-assets] ${avatarPackageId}.behaviorPath is not valid JSON: ${error.message}`);
  }

  if (profile?.version !== 1) {
    throw new Error(`[sync-unity-assets] ${avatarPackageId}.behaviorPath must declare version=1`);
  }

  const gaze = profile.gaze;
  if (gaze == null) {
    return;
  }
  if (!Array.isArray(gaze.bindings)) {
    throw new Error(`[sync-unity-assets] ${avatarPackageId}.behaviorPath.gaze.bindings must be an array`);
  }
  for (const binding of gaze.bindings) {
    const valid = binding
      && typeof binding.parameterId === 'string'
      && binding.parameterId.trim().length > 0
      && (binding.axis === 'x' || binding.axis === 'y')
      && Number.isFinite(binding.factor);
    if (!valid) {
      throw new Error(`[sync-unity-assets] ${avatarPackageId}.behaviorPath contains an invalid gaze binding`);
    }
  }
}

async function validateActionCatalog(filePath, avatarPackageId) {
  let catalog;
  try {
    catalog = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`[sync-unity-assets] ${avatarPackageId}.actionsPath 不是有效 JSON: ${error.message}`);
  }

  if (catalog?.version !== 1 || !Array.isArray(catalog.actions)) {
    throw new Error(`[sync-unity-assets] ${avatarPackageId}.actionsPath 必须声明 version=1 和 actions 数组`);
  }

  const actions = new Map();
  for (const action of catalog.actions) {
    const validId = typeof action?.id === 'string' && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/i.test(action.id);
    const validTarget = action?.targetKind === 'expression' || action?.targetKind === 'motion';
    const validToggle = typeof action?.toggle === 'boolean'
      && (!action.toggle || action.targetKind === 'expression');
    const validLabel = typeof action?.label === 'string' && action.label.trim().length > 0;
    const validCategory = typeof action?.category === 'string' && action.category.trim().length > 0;
    const validTargetId = typeof action?.targetId === 'string' && action.targetId.trim().length > 0;
    const validRequires = action?.requires == null || (
      Array.isArray(action.requires)
      && action.requires.every((value) => typeof value === 'string' && value.trim().length > 0)
      && new Set(action.requires).size === action.requires.length
    );
    const validExclusiveGroup = action?.exclusiveGroup == null || (
      typeof action.exclusiveGroup === 'string'
      && action.exclusiveGroup.trim().length > 0
      && action.toggle === true
    );
    if (!validId || !validLabel || !validCategory || !validTarget || !validTargetId || !validToggle || !validRequires || !validExclusiveGroup) {
      throw new Error(`[sync-unity-assets] ${avatarPackageId}.actionsPath 包含无效动作声明`);
    }
    if (actions.has(action.id)) {
      throw new Error(`[sync-unity-assets] ${avatarPackageId}.actionsPath 存在重复动作 ID: ${action.id}`);
    }
    actions.set(action.id, action);
  }

  for (const action of actions.values()) {
    for (const requirement of action.requires ?? []) {
      if (requirement === action.id || !actions.has(requirement)) {
        throw new Error(`[sync-unity-assets] ${avatarPackageId}.actionsPath 的依赖无效: ${action.id} -> ${requirement}`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (actionId) => {
    if (visiting.has(actionId)) {
      throw new Error(`[sync-unity-assets] ${avatarPackageId}.actionsPath 存在循环依赖: ${actionId}`);
    }
    if (visited.has(actionId)) return;
    visiting.add(actionId);
    for (const requirement of actions.get(actionId).requires ?? []) visit(requirement);
    visiting.delete(actionId);
    visited.add(actionId);
  };
  for (const actionId of actions.keys()) visit(actionId);
}

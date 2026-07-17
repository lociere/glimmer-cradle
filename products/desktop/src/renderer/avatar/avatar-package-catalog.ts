import { resolvePublicAssetUrl } from './public-assets';

export type AvatarBackendPreference = 'unity';

export interface AvatarPlacementPreset {
  visibleRatio: number;
  rightInset?: number;
  bottomInset?: number;
}

export interface AvatarPresentationProfile {
  defaultPlacement: string;
  placementPresets: Record<string, AvatarPlacementPreset>;
}

export interface AvatarLive2DAvatarPackage {
  id: string;
  default: boolean;
  characterId: string;
  modelId: string;
  displayName: string;
  kind: 'live2d';
  preferredBackend: AvatarBackendPreference;
  previewImagePath?: string;
  scaleFactor?: number;
  license?: string;
  live2dVersion: 'cubism4' | 'cubism5';
  assetRootPath: string;
  modelPath: string;
  emotionMapPath?: string;
  actionsPath?: string;
  presentation?: AvatarPresentationProfile;
  idleMotionGroup?: string;
  interactionMotions?: Record<string, string>;
}

export interface AvatarPackageCatalog {
  defaultAvatarPackageId: string;
  defaultModelId: string;
  packages: AvatarLive2DAvatarPackage[];
}

let cachedCatalog: AvatarPackageCatalog | null = null;
let cachedPromise: Promise<AvatarPackageCatalog> | null = null;

export async function loadAvatarPackageCatalog(): Promise<AvatarPackageCatalog> {
  if (cachedCatalog) return cachedCatalog;
  if (cachedPromise) return cachedPromise;

  cachedPromise = (async () => {
    try {
      const response = await fetch(resolvePublicAssetUrl('assets/avatar/avatar-packages.json'), {
        cache: 'no-cache',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const catalog = validateCatalog(await response.json());
      cachedCatalog = catalog;
      return catalog;
    } finally {
      cachedPromise = null;
    }
  })();

  return cachedPromise;
}

export function resolveRegisteredAvatarPackage(
  catalog: AvatarPackageCatalog,
  requestedModelId: string,
): AvatarLive2DAvatarPackage {
  const targetModelId = requestedModelId || catalog.defaultModelId;
  const avatarPackage = catalog.packages.find((item) => item.modelId === targetModelId);
  if (!avatarPackage) {
    throw new Error(`Avatar Package目录未声明模型: ${targetModelId}`);
  }
  return avatarPackage;
}

function validateCatalog(value: unknown): AvatarPackageCatalog {
  if (!isRecord(value)
    || typeof value.defaultAvatarPackageId !== 'string'
    || typeof value.defaultModelId !== 'string'
    || !Array.isArray(value.packages)) {
    throw new Error('Avatar Package目录结构无效');
  }

  const packages = value.packages.map(validateAvatarPackage);
  if (packages.length === 0) {
    if (value.defaultAvatarPackageId !== '' || value.defaultModelId !== '') {
      throw new Error('空 Avatar Package目录不能声明默认项');
    }
    return {
      defaultAvatarPackageId: '',
      defaultModelId: '',
      packages: [],
    };
  }
  const avatarPackageIds = new Set(packages.map((item) => item.id));
  const modelIds = new Set(packages.map((item) => item.modelId));
  if (avatarPackageIds.size !== packages.length) {
    throw new Error('Avatar Package目录包含重复 Avatar Package id');
  }
  if (modelIds.size !== packages.length) {
    throw new Error('Avatar Package目录包含重复 model id');
  }
  if (!packages.some((item) => item.id === value.defaultAvatarPackageId && item.default)) {
    throw new Error(`默认Avatar Package未声明: ${value.defaultAvatarPackageId}`);
  }
  if (!packages.some((item) => item.modelId === value.defaultModelId)) {
    throw new Error(`默认模型未声明: ${value.defaultModelId}`);
  }

  return {
    defaultAvatarPackageId: value.defaultAvatarPackageId,
    defaultModelId: value.defaultModelId,
    packages,
  };
}

function validateAvatarPackage(value: unknown): AvatarLive2DAvatarPackage {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.characterId !== 'string'
    || typeof value.modelId !== 'string'
    || typeof value.displayName !== 'string'
    || value.kind !== 'live2d'
    || value.preferredBackend !== 'unity'
    || (value.live2dVersion !== 'cubism4' && value.live2dVersion !== 'cubism5')
    || typeof value.assetRootPath !== 'string'
    || typeof value.modelPath !== 'string') {
    throw new Error('Avatar Package条目缺少必要字段');
  }

  return {
    id: value.id,
    default: value.default === true,
    characterId: value.characterId,
    modelId: value.modelId,
    displayName: value.displayName,
    kind: 'live2d',
    preferredBackend: 'unity',
    previewImagePath: typeof value.previewImagePath === 'string' ? value.previewImagePath : undefined,
    scaleFactor: typeof value.scaleFactor === 'number' ? value.scaleFactor : undefined,
    license: typeof value.license === 'string' ? value.license : undefined,
    live2dVersion: value.live2dVersion,
    assetRootPath: value.assetRootPath,
    modelPath: value.modelPath,
    emotionMapPath: typeof value.emotionMapPath === 'string' ? value.emotionMapPath : undefined,
    actionsPath: typeof value.actionsPath === 'string' ? value.actionsPath : undefined,
    presentation: validatePresentation(value.presentation),
    idleMotionGroup: typeof value.idleMotionGroup === 'string' ? value.idleMotionGroup : undefined,
    interactionMotions: isStringMap(value.interactionMotions)
      ? value.interactionMotions
      : undefined,
  };
}

function validatePresentation(value: unknown): AvatarPresentationProfile | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)
    || typeof value.defaultPlacement !== 'string'
    || !isRecord(value.placementPresets)) {
    throw new Error('Avatar Package presentation 配置无效');
  }

  const placementPresets: Record<string, AvatarPlacementPreset> = {};
  for (const [id, rawPreset] of Object.entries(value.placementPresets)) {
    if (!isRecord(rawPreset)
      || typeof rawPreset.visibleRatio !== 'number'
      || rawPreset.visibleRatio < 0.25
      || rawPreset.visibleRatio > 1) {
      throw new Error(`Avatar Package驻留预设无效: ${id}`);
    }
    placementPresets[id] = {
      visibleRatio: rawPreset.visibleRatio,
      rightInset: typeof rawPreset.rightInset === 'number' ? rawPreset.rightInset : undefined,
      bottomInset: typeof rawPreset.bottomInset === 'number' ? rawPreset.bottomInset : undefined,
    };
  }

  if (!placementPresets[value.defaultPlacement]) {
    throw new Error(`默认驻留预设未声明: ${value.defaultPlacement}`);
  }
  return { defaultPlacement: value.defaultPlacement, placementPresets };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

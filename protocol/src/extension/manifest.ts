import type {
  ActivationProfileRequirements,
  ExtensionActivationProfile,
  ContributionDeclaration,
  ContributionPointDefinition,
  ExtensionManifest,
  ExtensionPlatform,
  ExtensionProductTarget,
  ManagedResourceContribution,
  ProductFeatureId,
} from '../generated/extension/ExtensionManifest';
import type { ExtensionPermission } from '../generated/extension/ExtensionPermission';

export const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;
export const EXTENSION_VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const BuiltInContributionPoint = {
  capability: 'glimmer.capability',
  command: 'glimmer.command',
  diagnostic: 'glimmer.diagnostic',
  managedResource: 'glimmer.managedResource',
  managementSurface: 'glimmer.managementSurface',
  protocolBridge: 'glimmer.protocolBridge',
  provider: 'glimmer.provider',
  setting: 'glimmer.setting',
  skill: 'glimmer.skill',
  view: 'glimmer.view',
  automation: 'glimmer.automation',
} as const;

export type BuiltInContributionPointId =
  typeof BuiltInContributionPoint[keyof typeof BuiltInContributionPoint];

export const BuiltInContributionPointDefinitions = [
  definition(BuiltInContributionPoint.capability, 'Capability', '扩展声明的可用业务能力或生态能力节点。', 'capability'),
  definition(BuiltInContributionPoint.command, 'Command', '用户或平台可发起的受控动作入口。', 'command', 'command'),
  definition(BuiltInContributionPoint.setting, 'Setting', '扩展公开的普通配置项。', 'setting'),
  definition(BuiltInContributionPoint.skill, 'Skill', '进入 Skill Plane 的 tools、resources 与 prompts。', 'skill'),
  definition(BuiltInContributionPoint.managedResource, 'Managed Resource', '由 Host 或扩展监督的包、进程、服务或外部资源。', 'managed_resource'),
  definition(BuiltInContributionPoint.protocolBridge, 'Protocol Bridge', '把外部协议连接映射到摇篮受控边界。', 'protocol_bridge'),
  definition(BuiltInContributionPoint.managementSurface, 'Management Surface', '扩展提供给控制面板的管理表面。', 'management_surface'),
  definition(BuiltInContributionPoint.diagnostic, 'Diagnostic', '扩展诊断入口、日志位置和恢复建议。', 'diagnostic'),
  definition(BuiltInContributionPoint.provider, 'Provider', '外部能力 Provider 或协议服务来源。', 'provider'),
  definition(BuiltInContributionPoint.view, 'View', '扩展声明的只读界面投影入口。', 'view'),
  definition(BuiltInContributionPoint.automation, 'Automation', '扩展声明的自动化触发器、工作流或调度贡献。', 'automation'),
] as const satisfies readonly ContributionPointDefinition[];

export type ExtensionManifestInput = Omit<
  ExtensionManifest,
  'products' | 'platforms' | 'tags' | 'minAppVersion' | 'permissions' | 'activationEvents' | 'requires' | 'engines' | 'contributionPoints' | 'activationProfiles' | 'contributes'
> & Partial<Pick<
  ExtensionManifest,
  'products' | 'platforms' | 'tags' | 'minAppVersion' | 'permissions' | 'activationEvents' | 'requires' | 'engines' | 'contributionPoints' | 'activationProfiles'
>> & {
  contributes?: Record<string, unknown[]>;
};

export interface ExtensionActivationProfileContext {
  readonly productId: Exclude<ExtensionProductTarget, 'any'>;
  readonly platform: Exclude<ExtensionPlatform, 'any'>;
  readonly features?: Iterable<ProductFeatureId>;
}

export interface ExtensionActivationProfileAvailability extends ExtensionActivationProfile {
  readonly supported: boolean;
  readonly disabled_reason?: string;
}

export interface ExtensionActivationProfileResolution {
  readonly selected: ExtensionActivationProfileAvailability;
  readonly available: readonly ExtensionActivationProfileAvailability[];
}

export function getExtensionContributions<T = ContributionDeclaration>(
  manifestOrContributes: { contributes?: Record<string, unknown> } | Record<string, unknown>,
  pointId: string,
): T[] {
  const contributes = (
    'contributes' in manifestOrContributes
      ? manifestOrContributes.contributes ?? {}
      : manifestOrContributes
  ) as Record<string, unknown>;
  const values = contributes[pointId];
  return Array.isArray(values) ? values as T[] : [];
}

export function getManagedResourceContributions(
  manifest: { contributes?: Record<string, unknown> },
): ManagedResourceContribution[] {
  return [
    ...getExtensionContributions<ManagedResourceContribution>(manifest, BuiltInContributionPoint.managedResource),
    ...getExtensionContributions<ManagedResourceContribution>(manifest, BuiltInContributionPoint.protocolBridge),
  ];
}

export function listExtensionActivationProfiles(
  manifest: ExtensionManifest,
  context: ExtensionActivationProfileContext,
): readonly ExtensionActivationProfileAvailability[] {
  const profiles = manifest.activationProfiles.length > 0
    ? manifest.activationProfiles
    : [syntheticDefaultProfile()];
  return profiles.map((profile) => {
    const supported = matchesActivationProfileRequirements(profile.requirements, context);
    return {
      ...profile,
      supported,
      disabled_reason: supported ? undefined : describeActivationProfileMismatch(profile.requirements, context),
    };
  });
}

export function resolveExtensionActivationProfile(
  manifest: ExtensionManifest,
  context: ExtensionActivationProfileContext,
  requestedId?: string,
): ExtensionActivationProfileResolution {
  const available = listExtensionActivationProfiles(manifest, context);
  if (requestedId?.trim()) {
    const selected = available.find((profile) => profile.id === requestedId.trim());
    if (!selected) {
      throw new Error(`扩展未声明 activation profile: ${requestedId}`);
    }
    if (!selected.supported) {
      throw new Error(selected.disabled_reason || `activation profile ${selected.id} 不兼容当前产品环境`);
    }
    return { selected, available };
  }

  const supported = available.filter((profile) => profile.supported);
  const defaultSupported = supported.find((profile) => profile.default) ?? null;
  const selected = defaultSupported ?? (supported.length === 1 ? supported[0] : null);
  if (!selected) {
    throw new Error(supported.length === 0
      ? '扩展当前没有兼容的 activation profile'
      : '扩展存在多个兼容 activation profile，必须显式选择或声明唯一 default');
  }
  return { selected, available };
}

export function materializeManifestForActivationProfile(
  manifest: ExtensionManifest,
  context: ExtensionActivationProfileContext,
  requestedId?: string,
): {
  readonly manifest: ExtensionManifest;
  readonly profile: ExtensionActivationProfileAvailability;
  readonly availableProfiles: readonly ExtensionActivationProfileAvailability[];
} {
  const resolution = resolveExtensionActivationProfile(manifest, context, requestedId);
  const contributes = Object.fromEntries(Object.entries(manifest.contributes).map(([pointId, value]) => {
    if (!Array.isArray(value)) return [pointId, value];
    return [pointId, value.filter((entry) => matchesContributionRequirements(asRequirements(entry), context, resolution.selected.id))];
  })) as ExtensionManifest['contributes'];
  return {
    manifest: {
      ...manifest,
      permissions: uniquePermissions([...manifest.permissions, ...resolution.selected.permissions]),
      contributes,
    },
    profile: resolution.selected,
    availableProfiles: resolution.available,
  };
}

export function getEffectiveContributionIds(
  manifest: ExtensionManifest,
  pointId: string,
  context: ExtensionActivationProfileContext,
  requestedId?: string,
): string[] {
  const { selected } = resolveExtensionActivationProfile(manifest, context, requestedId);
  return getExtensionContributions<Record<string, unknown>>(manifest, pointId)
    .filter((entry) => matchesContributionRequirements(asRequirements(entry), context, selected.id))
    .map((entry) => typeof entry.id === 'string' ? entry.id : typeof entry.key === 'string' ? entry.key : typeof entry.command === 'string' ? entry.command : '')
    .filter(Boolean);
}

function definition(
  id: BuiltInContributionPointId,
  title: string,
  description: string,
  nodeKind: string,
  actionKind?: string,
): ContributionPointDefinition {
  return {
    id,
    title,
    description,
    owner: 'platform',
    activationEvents: [],
    requiredPermissions: [],
    nodeKind,
    ...(actionKind ? { actionKind } : {}),
  };
}

function syntheticDefaultProfile(): ExtensionActivationProfile {
  return {
    id: 'default',
    title: 'Default',
    default: true,
    requirements: {
      products: ['any'],
      platforms: ['any'],
      features: [],
    },
    permissions: [],
  };
}

function matchesActivationProfileRequirements(
  requirements: ActivationProfileRequirements | undefined,
  context: ExtensionActivationProfileContext,
): boolean {
  const products = requirements?.products ?? ['any'];
  if (!products.includes('any') && !products.includes(context.productId)) return false;
  const platforms = requirements?.platforms ?? ['any'];
  if (!platforms.includes('any') && !platforms.includes(context.platform)) return false;
  const featureSet = new Set(context.features ?? []);
  return (requirements?.features ?? []).every((feature) => featureSet.has(feature));
}

function matchesContributionRequirements(
  requirements: {
    readonly products?: readonly ExtensionProductTarget[];
    readonly platforms?: readonly ExtensionPlatform[];
    readonly features?: readonly ProductFeatureId[];
    readonly profiles?: readonly string[];
  },
  context: ExtensionActivationProfileContext,
  profileId: string,
): boolean {
  const products = requirements.products ?? ['any'];
  if (!products.includes('any') && !products.includes(context.productId)) return false;
  const platforms = requirements.platforms ?? ['any'];
  if (!platforms.includes('any') && !platforms.includes(context.platform)) return false;
  const profiles = requirements.profiles ?? [];
  if (profiles.length > 0 && !profiles.includes(profileId)) return false;
  const featureSet = new Set(context.features ?? []);
  return (requirements.features ?? []).every((feature) => featureSet.has(feature));
}

function asRequirements(value: unknown): {
  readonly products?: readonly ExtensionProductTarget[];
  readonly platforms?: readonly ExtensionPlatform[];
  readonly features?: readonly ProductFeatureId[];
  readonly profiles?: readonly string[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const requirements = (value as { requirements?: unknown }).requirements;
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) return {};
  return requirements as {
    readonly products?: readonly ExtensionProductTarget[];
    readonly platforms?: readonly ExtensionPlatform[];
    readonly features?: readonly ProductFeatureId[];
    readonly profiles?: readonly string[];
  };
}

function uniquePermissions(permissions: readonly ExtensionPermission[]): ExtensionPermission[] {
  return [...new Set(permissions)];
}

function describeActivationProfileMismatch(
  requirements: ActivationProfileRequirements | undefined,
  context: ExtensionActivationProfileContext,
): string {
  const products = requirements?.products ?? ['any'];
  if (!products.includes('any') && !products.includes(context.productId)) {
    return `仅支持产品：${products.join(', ')}`;
  }
  const platforms = requirements?.platforms ?? ['any'];
  if (!platforms.includes('any') && !platforms.includes(context.platform)) {
    return `仅支持平台：${platforms.join(', ')}`;
  }
  const featureSet = new Set(context.features ?? []);
  const missingFeatures = (requirements?.features ?? []).filter((feature) => !featureSet.has(feature));
  if (missingFeatures.length > 0) {
    return `缺少产品能力：${missingFeatures.join(', ')}`;
  }
  return '当前环境不满足 activation profile 要求';
}

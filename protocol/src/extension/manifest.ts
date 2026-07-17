import type {
  ContributionDeclaration,
  ContributionPointDefinition,
  ExtensionManifest,
  ManagedResourceContribution,
} from '../generated/extension/ExtensionManifest';

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
  'products' | 'platforms' | 'tags' | 'minAppVersion' | 'permissions' | 'activationEvents' | 'requires' | 'engines' | 'contributionPoints' | 'contributes'
> & Partial<Pick<
  ExtensionManifest,
  'products' | 'platforms' | 'tags' | 'minAppVersion' | 'permissions' | 'activationEvents' | 'requires' | 'engines' | 'contributionPoints'
>> & {
  contributes?: Record<string, unknown[]>;
};

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

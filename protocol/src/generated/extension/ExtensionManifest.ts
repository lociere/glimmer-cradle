/* 自动生成 — 从 ExtensionManifest.schema.json 生成，勿手动修改 */

import type { CapabilityScope } from '../models/CapabilityScope';
import type { ExtensionPermission } from './ExtensionPermission';

export type ExtensionId = string;
export type ExtensionVersion = string;
export type ExtensionProductTarget = 'any' | 'desktop' | 'personal-server';
export type ExtensionPlatform =
  | 'any'
  | 'windows-x64'
  | 'windows-arm64'
  | 'linux-x64'
  | 'linux-arm64'
  | 'darwin-x64'
  | 'darwin-arm64';
/**
 * Extension Host 可授予扩展的权限。
 */

export type ExtensionHostPortId =
  | 'storage'
  | 'evidenceProposal'
  | 'perception'
  | 'sceneAttention'
  | 'events'
  | 'agents'
  | 'commands'
  | 'runtime';
export type ContributionPointId = string;
export type ExtensionCapabilityContribution = ContributionDeclaration & {
  id: string;
  title: string;
  audience?: 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';
  required?: boolean;
  resourceIds?: string[];
  [k: string]: unknown;
};
export type CapabilityAudience = 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';
/**
 * 能力在全局、来源、场景或会话边界内的可见范围。
 */

export type ProductFeatureId =
  | 'control_surface_gateway'
  | 'local_device_actions'
  | 'avatar'
  | 'audio.tts'
  | 'audio.asr'
  | 'extensions';
export type ExtensionCommandContribution = ContributionDeclaration & {
  command: string;
  title: string;
  audience?: 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';
  category?: string;
  actionKind?: string;
  preconditions?: ExtensionCommandPrecondition[];
  [k: string]: unknown;
};
export type ManagedResourceContribution = ContributionDeclaration & {
  id: string;
  title?: string;
  displayName?: string;
  kind: 'package' | 'managedProcess' | 'localService' | 'protocolBridge' | 'managementEndpoint';
  audience?: 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';
  required?: boolean;
  package?: ManagedResourcePackage;
  process?: ManagedResourceProcess;
  readiness?: ReadinessProbe;
  readinessGates?: ReadinessGateDeclaration[];
  [k: string]: unknown;
};
export type ExtensionManagementSurfaceContribution = ContributionDeclaration & {
  id: string;
  title: string;
  audience?: 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';
  kind?: 'status' | 'management' | 'diagnostics' | 'settings';
  resourceIds?: string[];
  capabilityIds?: string[];
  [k: string]: unknown;
};
export type ProtocolBridgeContribution = ManagedResourceContribution & {
  audience?: 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';
  [k: string]: unknown;
};
export type ExtensionSettingContribution = ContributionDeclaration & {
  key: string;
  title: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  default?: unknown;
  requiresRestart?: boolean;
  secret?: boolean;
  [k: string]: unknown;
};
export type ExtensionSkillContribution = ContributionDeclaration & {
  id: string;
  name: string;
  description: string;
  audience?: 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';
  tools?: ExtensionSkillToolContribution[];
  resources?: ExtensionSkillResourceContribution[];
  prompts?: ExtensionSkillPromptContribution[];
  policy?: ExtensionSkillPolicyContribution;
  [k: string]: unknown;
};
/**
 * 能力在全局、来源、场景或会话边界内的可见范围。
 */
export type CapabilityScope1 =
  | {
      kind: 'global';
    }
  | {
      kind: 'source_provider' | 'scene' | 'conversation';
      /**
       * @minItems 1
       */
      ids: [string, ...string[]];
    };

/**
 * 扩展身份、目标环境、权限、宿主端口需求和贡献声明。
 */
export interface ExtensionManifest {
  id: ExtensionId;
  name: string;
  version: ExtensionVersion;
  publisher: string;
  license: string;
  repository: string;
  homepage?: string;
  /**
   * @minItems 1
   */
  products: [ExtensionProductTarget, ...ExtensionProductTarget[]];
  /**
   * @minItems 1
   */
  platforms: [ExtensionPlatform, ...ExtensionPlatform[]];
  description?: string;
  author?: string;
  category?: string;
  tags: string[];
  main: string;
  minAppVersion: string;
  permissions: ExtensionPermission[];
  activationEvents: string[];
  requires: ExtensionHostPortId[];
  engines: ExtensionEngineConstraint;
  contributionPoints: ContributionPointDefinition[];
  contributes: ExtensionContributions;
}
export interface ExtensionEngineConstraint {
  glimmerCradle?: string;
  extensionSdk?: string;
  node?: string;
}
export interface ContributionPointDefinition {
  id: ContributionPointId;
  title: string;
  description?: string;
  owner: 'platform' | 'extension' | 'thirdParty';
  schema?: unknown;
  activationEvents: string[];
  requiredPermissions: string[];
  nodeKind?: string;
  actionKind?: string;
}
export interface ExtensionContributions {
  'glimmer.capability'?: ExtensionCapabilityContribution[];
  'glimmer.command'?: ExtensionCommandContribution[];
  'glimmer.managedResource'?: ManagedResourceContribution[];
  'glimmer.managementSurface'?: ExtensionManagementSurfaceContribution[];
  'glimmer.protocolBridge'?: ProtocolBridgeContribution[];
  'glimmer.setting'?: ExtensionSettingContribution[];
  'glimmer.skill'?: ExtensionSkillContribution[];
  [k: string]: unknown;
}
export interface ContributionDeclaration {
  id?: string;
  title?: string;
  description?: string;
  audience?: CapabilityAudience;
  scope: CapabilityScope;
  requirements: ContributionRequirements;
  permissions: string[];
  dependsOn: ContributionDependency[];
  metadata: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
export interface ContributionRequirements {
  /**
   * @minItems 1
   */
  products: [ExtensionProductTarget, ...ExtensionProductTarget[]];
  /**
   * @minItems 1
   */
  platforms: [ExtensionPlatform, ...ExtensionPlatform[]];
  features: ProductFeatureId[];
}
export interface ContributionDependency {
  nodeId: string;
  requiredState?: string;
  relation: string;
}
export interface ExtensionCommandPrecondition {
  nodeId: string;
  requiredState?: string;
  relation: string;
}
export interface ManagedResourcePackage {
  source: ExternalDependencySource;
  installDir?: string;
}
export interface ExternalDependencySource {
  type: 'githubRelease' | 'downloadUrl' | 'localPath' | 'manual';
  repository?: string;
  assetName?: string;
  url?: string;
  version?: string;
  checksum?: string;
  license?: string;
  homepage?: string;
}
export interface ManagedResourceProcess {
  owner?: 'extensionHost' | 'extension' | 'user' | 'externalManager' | 'system';
  launchMode?: 'direct' | 'shell' | 'custom' | 'external' | 'service' | 'container' | 'manual';
  windowPolicy?: 'hidden' | 'visible' | 'service' | 'external';
  readinessPolicy?: 'probeRequired' | 'externalDeclared' | 'manual';
  command?: string;
  args: string[];
  cwd?: string;
}
export interface ReadinessProbe {
  type: 'none' | 'tcp' | 'http' | 'websocket' | 'onebot11' | 'custom';
  endpoint?: string;
  action?: string;
  timeoutMs?: number;
}
export interface ReadinessGateDeclaration {
  id?: string;
  kind: string;
  type: 'none' | 'tcp' | 'http' | 'websocket' | 'onebot11' | 'custom';
  endpoint?: string;
  action?: string;
  timeoutMs?: number;
}
export interface ExtensionSkillToolContribution {
  name: string;
  description: string;
  audience: 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';
  scope?: CapabilityScope1;
  requirements: ContributionRequirements1;
  parameters: {
    [k: string]: unknown;
  };
}
export interface ContributionRequirements1 {
  /**
   * @minItems 1
   */
  products?: [ExtensionProductTarget, ...ExtensionProductTarget[]];
  /**
   * @minItems 1
   */
  platforms?: [ExtensionPlatform, ...ExtensionPlatform[]];
  features?: ProductFeatureId[];
}
export interface ExtensionSkillResourceContribution {
  id: string;
  description: string;
  audience: 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';
  scope?: CapabilityScope1;
  requirements: ContributionRequirements2;
}
export interface ContributionRequirements2 {
  /**
   * @minItems 1
   */
  products?: [ExtensionProductTarget, ...ExtensionProductTarget[]];
  /**
   * @minItems 1
   */
  platforms?: [ExtensionPlatform, ...ExtensionPlatform[]];
  features?: ProductFeatureId[];
}
export interface ExtensionSkillPromptContribution {
  id: string;
  description: string;
  audience: 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';
  scope?: CapabilityScope1;
  requirements: ContributionRequirements3;
  template: string;
}
export interface ContributionRequirements3 {
  /**
   * @minItems 1
   */
  products?: [ExtensionProductTarget, ...ExtensionProductTarget[]];
  /**
   * @minItems 1
   */
  platforms?: [ExtensionPlatform, ...ExtensionPlatform[]];
  features?: ProductFeatureId[];
}
export interface ExtensionSkillPolicyContribution {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  confirmationRequired: boolean;
  sideEffects: string[];
  audit: boolean;
}

import type {
  SkillCatalogEntry as ProtocolSkillCatalogEntry,
  SkillCatalogSnapshot as ProtocolSkillCatalogSnapshot,
  SkillProviderRef as ProtocolSkillProviderRef,
  SkillProviderRuntimeSnapshot as ProtocolSkillProviderRuntimeSnapshot,
  CapabilityScope,
  ExtensionPlatform,
  ExtensionProductTarget,
  ProductFeatureId,
} from '@glimmer-cradle/protocol';

export type SkillProviderKind = 'core' | 'extension' | 'mcp_server' | 'user';

export type SkillRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type SkillRuntimeStatus = 'ready' | 'contract_only';

export type SkillAudience = 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';

export interface SkillAvailabilityContext {
  readonly productId: Exclude<ExtensionProductTarget, 'any'>;
  readonly platform: Exclude<ExtensionPlatform, 'any'>;
  readonly features: ReadonlySet<ProductFeatureId>;
}

export type SkillProviderRef = ProtocolSkillProviderRef;

export interface SkillPolicy {
  riskLevel: SkillRiskLevel;
  confirmationRequired: boolean;
  sideEffects: string[];
  audit: boolean;
}

export interface SkillTool<TArgs = unknown> {
  name: string;
  description: string;
  audience?: SkillAudience;
  scope?: CapabilityScope;
  parameters: unknown;
  handler: (args: TArgs) => Promise<unknown> | unknown;
  policy?: SkillPolicy;
}

export interface SkillResource<TArgs = unknown> {
  id: string;
  description: string;
  audience?: SkillAudience;
  scope?: CapabilityScope;
  parameters?: unknown;
  read: (args?: TArgs) => Promise<unknown> | unknown;
}

export interface SkillPrompt<TArgs = unknown> {
  id: string;
  description: string;
  audience?: SkillAudience;
  scope?: CapabilityScope;
  template: string;
  parameters?: unknown;
  render?: (args?: TArgs) => Promise<unknown> | unknown;
}

export interface SkillDescriptor {
  id: string;
  name: string;
  description: string;
  audience?: SkillAudience;
  scope?: CapabilityScope;
  provider: SkillProviderRef;
  tools: SkillTool[];
  resources?: SkillResource[];
  prompts?: SkillPrompt[];
  policy: SkillPolicy;
  metadata?: SkillMetadata;
}

export interface RegisteredSkill {
  providerId: string;
  skill: SkillDescriptor;
}

export interface SkillMetadata extends Record<string, unknown> {
  runtime_status?: SkillRuntimeStatus;
  implementation?: string;
  audience?: SkillAudience;
}

export interface SkillRegistrationTarget {
  registerSkill(skill: SkillDescriptor): void;
  unregisterSkill(skillId: string): void;
  upsertProviderRuntime?(runtime: SkillProviderRuntimeSnapshot): void;
  removeProviderRuntime?(provider: SkillProviderRef): void;
}

export interface SkillProvider {
  readonly provider: SkillProviderRef;
  start(target: SkillRegistrationTarget): Promise<void> | void;
  stop(target: SkillRegistrationTarget): Promise<void> | void;
  listSkills(): SkillDescriptor[];
}

export interface SkillToolSummary {
  name: string;
  description: string;
  audience: SkillAudience;
  parameters: unknown;
}

export interface SkillResourceSummary {
  id: string;
  description: string;
  audience: SkillAudience;
  parameters?: unknown;
}

export interface SkillPromptSummary {
  id: string;
  description: string;
  audience: SkillAudience;
  parameters?: unknown;
}

export type SkillCatalogEntry = ProtocolSkillCatalogEntry;

export type SkillProviderRuntimeSnapshot = ProtocolSkillProviderRuntimeSnapshot;

export type SkillCatalogSnapshot = ProtocolSkillCatalogSnapshot;

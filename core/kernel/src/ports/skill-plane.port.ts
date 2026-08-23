import type { ConversationContext } from './application-models';

export type ExtensionProductTarget = 'any' | 'desktop' | 'personal-server';
export type ExtensionPlatform = 'any' | 'windows-x64' | 'windows-arm64' | 'linux-x64' | 'linux-arm64' | 'darwin-x64' | 'darwin-arm64';
export type ProductFeatureId = 'control_surface_gateway' | 'local_device_actions' | 'avatar' | 'audio.tts' | 'audio.asr' | 'extensions';

export type CapabilityScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'source_provider' | 'scene' | 'conversation'; readonly ids: [string, ...string[]] };

export interface ContributionRequirements {
  readonly products?: [ExtensionProductTarget, ...ExtensionProductTarget[]];
  readonly platforms?: [ExtensionPlatform, ...ExtensionPlatform[]];
  readonly features?: ProductFeatureId[];
  readonly profiles?: string[];
}

export type SkillProviderKind = 'core' | 'extension' | 'mcp_server' | 'user';
export interface SkillProviderRef { readonly kind: SkillProviderKind; readonly id: string }
export interface SkillProviderRuntimeSnapshot {
  readonly provider: SkillProviderRef;
  readonly display_name?: string;
  readonly state: 'ready' | 'contract_only' | 'connecting' | 'degraded' | 'unavailable' | 'stopped';
  readonly summary: string;
  readonly skill_count: number;
  readonly tool_count: number;
  readonly resource_count: number;
  readonly prompt_count: number;
  readonly error?: string;
  readonly recovery_actions: string[];
  readonly metadata: Record<string, unknown>;
  readonly updated_at: string;
}

export type SkillRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type SkillRuntimeStatus = 'ready' | 'contract_only';
export type SkillAudience = 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';

export interface SkillAvailabilityContext {
  readonly productId: Exclude<ExtensionProductTarget, 'any'>;
  readonly platform: Exclude<ExtensionPlatform, 'any'>;
  readonly features: ReadonlySet<ProductFeatureId>;
}

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
  handler: (args: TArgs, context?: { readonly signal?: AbortSignal; readonly invocationId?: string }) => Promise<unknown> | unknown;
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

export interface SkillCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly audience: SkillAudience;
  readonly scope: CapabilityScope;
  readonly provider: SkillProviderRef;
  readonly tools: SkillToolSummary[];
  readonly resources: SkillResourceSummary[];
  readonly prompts: SkillPromptSummary[];
  readonly policy: SkillPolicy;
  readonly metadata: Record<string, unknown>;
}

export interface SkillCatalogSnapshot {
  readonly generatedAt: string;
  readonly totalSkills: number;
  readonly providerCounts: Record<SkillProviderKind, number>;
  readonly runtimeStatusCounts: Record<SkillRuntimeStatus, number>;
  readonly totalTools: number;
  readonly totalResources: number;
  readonly totalPrompts: number;
  readonly providerRuntimes: SkillProviderRuntimeSnapshot[];
  readonly entries: SkillCatalogEntry[];
}

export interface RegisteredSkill { providerId: string; skill: SkillDescriptor }
export interface SkillMetadata extends Record<string, unknown> { runtime_status?: SkillRuntimeStatus; implementation?: string; audience?: SkillAudience }
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
export interface SkillToolSummary { name: string; description: string; audience: SkillAudience; scope: CapabilityScope; parameters?: unknown }
export interface SkillResourceSummary { id: string; description: string; audience: SkillAudience; scope: CapabilityScope; parameters?: unknown }
export interface SkillPromptSummary { id: string; description: string; audience: SkillAudience; scope: CapabilityScope; parameters?: unknown }

export interface SkillPlanePolicyPort {
  isContributionAvailable(requirements: Partial<ContributionRequirements> | undefined, context: SkillAvailabilityContext): boolean;
  resolveExtensionScope(scope: CapabilityScope | undefined, extensionId: string, inherited?: CapabilityScope): CapabilityScope;
}

export interface SkillConfirmationRequest {
  readonly traceId: string;
  readonly skillId: string;
  readonly targetKind: 'tool' | 'resource' | 'prompt';
  readonly targetName: string;
  readonly riskLevel: SkillRiskLevel;
  readonly sideEffects: string[];
  readonly args?: unknown;
}

export type SkillConfirmationRequester = (request: SkillConfirmationRequest) => Promise<boolean>;

export interface CorePlatformBridge {
  openUrl(url: string, invocationId?: string): Promise<unknown>;
  showNotification(title: string, body: string, invocationId?: string): Promise<unknown>;
  readClipboardText(invocationId?: string): Promise<unknown>;
  writeClipboardText(text: string, invocationId?: string): Promise<unknown>;
  requestConfirmation(request: SkillConfirmationRequest): Promise<boolean>;
}

export interface ConversationScopePolicyPort {
  isVisible(scope: CapabilityScope | undefined, conversation: ConversationContext | undefined): boolean;
}

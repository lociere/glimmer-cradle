/* 自动生成 — 从 SkillCatalogSnapshot.schema.json 生成，勿手动修改 */

import type { CapabilityScope } from './CapabilityScope';

export type SkillProviderKind = 'core' | 'extension' | 'mcp_server' | 'user';
export type SkillProviderRuntimeState =
  | 'ready'
  | 'contract_only'
  | 'connecting'
  | 'degraded'
  | 'unavailable'
  | 'stopped';
export type SkillAudience = 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';
/**
 * 能力在全局、来源、场景或会话边界内的可见范围。
 */

export type SkillRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Kernel 向 Desktop 等跨进程消费者广播的 Skill Plane 统一能力目录与 provider runtime 投影。
 */
export interface SkillCatalogSnapshot {
  generatedAt: string;
  totalSkills: number;
  providerCounts: {
    core: number;
    extension: number;
    mcp_server: number;
    user: number;
  };
  runtimeStatusCounts: {
    ready: number;
    contract_only: number;
  };
  totalTools: number;
  totalResources: number;
  totalPrompts: number;
  providerRuntimes: SkillProviderRuntimeSnapshot[];
  entries: SkillCatalogEntry[];
}
export interface SkillProviderRuntimeSnapshot {
  provider: SkillProviderRef;
  display_name?: string;
  state: SkillProviderRuntimeState;
  summary: string;
  skill_count: number;
  tool_count: number;
  resource_count: number;
  prompt_count: number;
  error?: string;
  recovery_actions: string[];
  metadata: {
    [k: string]: unknown;
  };
  updated_at: string;
}
export interface SkillProviderRef {
  kind: SkillProviderKind;
  id: string;
}
export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  audience: SkillAudience;
  scope: CapabilityScope;
  provider: SkillProviderRef;
  tools: SkillToolSummary[];
  resources: SkillResourceSummary[];
  prompts: SkillPromptSummary[];
  policy: SkillPolicy;
  metadata: {
    [k: string]: unknown;
  };
}
export interface SkillToolSummary {
  name: string;
  description: string;
  audience: SkillAudience;
  scope: CapabilityScope;
  parameters?: unknown;
}
export interface SkillResourceSummary {
  id: string;
  description: string;
  audience: SkillAudience;
  scope: CapabilityScope;
  parameters?: unknown;
}
export interface SkillPromptSummary {
  id: string;
  description: string;
  audience: SkillAudience;
  scope: CapabilityScope;
  parameters?: unknown;
}
export interface SkillPolicy {
  riskLevel: SkillRiskLevel;
  confirmationRequired: boolean;
  sideEffects: string[];
  audit: boolean;
}

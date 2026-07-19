/* 自动生成 — 从 SkillCatalogResponse.schema.json 生成，勿手动修改 */

import type { SkillCatalogSnapshot, SkillProviderKind, SkillProviderRuntimeState, SkillAudience, SkillRiskLevel, SkillProviderRuntimeSnapshot, SkillProviderRef, SkillCatalogEntry, SkillToolSummary, SkillResourceSummary, SkillPromptSummary, SkillPolicy } from './SkillCatalogSnapshot';

/**
 * 能力在全局、来源、场景或会话边界内的可见范围。
 */

export interface SkillCatalogResponse {
  request_id: string;
  status: 'success' | 'error';
  snapshot?: SkillCatalogSnapshot;
  message?: string;
}

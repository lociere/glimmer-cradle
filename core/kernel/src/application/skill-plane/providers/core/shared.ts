import type { SkillPolicy, SkillProviderRef, SkillTool } from '../../types';

export const CORE_SKILL_PROVIDER_ID = 'kernel-builtin-skills';

export const CORE_SKILL_PROVIDER: SkillProviderRef = {
  kind: 'core',
  id: CORE_SKILL_PROVIDER_ID,
};

export const CORE_CONTRACT_METADATA = {
  runtime_status: 'contract_only',
  implementation: 'pending_platform_service',
} as const;

export const CORE_READY_METADATA = {
  runtime_status: 'ready',
  implementation: 'desktop_bridge',
} as const;

export interface ContractOnlyToolResult {
  ok: false;
  error_code: 'SKILL_NOT_IMPLEMENTED';
  capability: string;
  message: string;
}

export function createContractOnlyTool(
  name: string,
  description: string,
  capability: string,
  parameters: unknown,
): SkillTool {
  return {
    name,
    description,
    parameters,
    handler: (): ContractOnlyToolResult => ({
      ok: false,
      error_code: 'SKILL_NOT_IMPLEMENTED',
      capability,
      message: `内置技能 ${capability} 已注册契约，但尚未接入对应平台服务`,
    }),
  };
}

export function createPolicy(
  riskLevel: SkillPolicy['riskLevel'],
  confirmationRequired: boolean,
  sideEffects: string[],
): SkillPolicy {
  return {
    riskLevel,
    confirmationRequired,
    sideEffects,
    audit: true,
  };
}

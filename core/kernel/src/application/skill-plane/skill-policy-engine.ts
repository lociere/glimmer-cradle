import type { SkillDescriptor, SkillPolicy } from './types';

export interface SkillPolicyDecision {
  allowed: boolean;
  reason?: string;
  confirmationRequired: boolean;
}

export class SkillPolicyEngine {
  public evaluate(skill: SkillDescriptor, policy: SkillPolicy = skill.policy): SkillPolicyDecision {
    if (skill.metadata?.runtime_status === 'contract_only') {
      return {
        allowed: false,
        reason: `技能 ${skill.id} 目前只注册了契约，运行时服务尚未接入`,
        confirmationRequired: policy.confirmationRequired,
      };
    }

    return {
      allowed: true,
      confirmationRequired: policy.confirmationRequired,
    };
  }
}

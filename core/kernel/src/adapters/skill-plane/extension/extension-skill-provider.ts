import type { ExtensionSkillContribution } from '@glimmer-cradle/protocol';
import type { ExtensionAgentRegistration } from '../../../ports';
import type { SkillDescriptor, SkillAvailabilityContext, SkillPlanePolicyPort } from '../../../ports/skill-plane.port';

function createExtensionSkillId(extensionId: string, localId: string): string {
  return `extension:${extensionId}:${localId}`;
}

export function createExtensionSkillFromSubAgent(
  extensionId: string,
  profile: ExtensionAgentRegistration,
  availabilityContext: SkillAvailabilityContext,
  skillPolicy: SkillPlanePolicyPort,
): SkillDescriptor | null {
  if (profile.audience !== 'character' || !skillPolicy.isContributionAvailable(profile.requirements, availabilityContext)) {
    return null;
  }
  const tools = profile.tools.filter((tool) => (
    (tool.audience ?? profile.audience) === 'character'
    && skillPolicy.isContributionAvailable(tool.requirements, availabilityContext)
  ));
  if (!tools.length) {
    return null;
  }
  const localId = profile.id || profile.name;
  const skillId = createExtensionSkillId(extensionId, localId);
  const scope = skillPolicy.resolveExtensionScope(profile.scope, extensionId);

  return {
    id: skillId,
    name: profile.name,
    description: profile.description,
    audience: 'character',
    scope,
    provider: {
      kind: 'extension',
      id: extensionId,
    },
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      audience: 'character',
      scope: skillPolicy.resolveExtensionScope(tool.scope, extensionId, scope),
      parameters: tool.parameters,
      handler: tool.handler,
    })),
    policy: {
      riskLevel: profile.memoryImpact ? 'medium' : 'low',
      confirmationRequired: false,
      sideEffects: profile.memoryImpact ? ['memory'] : [],
      audit: true,
    },
    metadata: {
      implementation: 'extension-sub-agent-profile',
      audience: 'character',
      source_profile_id: profile.id,
      source_profile_name: profile.name,
      allow_interrupt: profile.allowInterrupt ?? true,
      memory_impact: profile.memoryImpact ?? false,
    },
  };
}

export function createDeclaredExtensionSkill(
  extensionId: string,
  contribution: ExtensionSkillContribution,
  availabilityContext: SkillAvailabilityContext,
  skillPolicy: SkillPlanePolicyPort,
): SkillDescriptor | null {
  if (
    contribution.audience !== 'character'
    || !skillPolicy.isContributionAvailable(contribution.requirements, availabilityContext)
  ) {
    return null;
  }
  const tools = (contribution.tools ?? []).filter((tool) => (
    tool.audience === 'character' && skillPolicy.isContributionAvailable(tool.requirements, availabilityContext)
  ));
  const resources = (contribution.resources ?? []).filter((resource) => (
    resource.audience === 'character' && skillPolicy.isContributionAvailable(resource.requirements, availabilityContext)
  ));
  const prompts = (contribution.prompts ?? []).filter((prompt) => (
    prompt.audience === 'character' && skillPolicy.isContributionAvailable(prompt.requirements, availabilityContext)
  ));
  if (!tools.length && !resources.length && !prompts.length) {
    return null;
  }
  const scope = skillPolicy.resolveExtensionScope(contribution.scope, extensionId);
  const policy = contribution.policy ?? {
    riskLevel: 'low',
    confirmationRequired: false,
    sideEffects: [],
    audit: true,
  };
  return {
    id: createExtensionSkillId(extensionId, contribution.id),
    name: contribution.name,
    description: contribution.description,
    audience: 'character',
    scope,
    provider: {
      kind: 'extension',
      id: extensionId,
    },
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      audience: 'character',
      scope: skillPolicy.resolveExtensionScope(tool.scope, extensionId, scope),
      parameters: tool.parameters,
      handler: () => {
        throw new Error(`扩展 ${extensionId} 的声明式技能 ${contribution.id} 尚未绑定运行时实现`);
      },
    })),
    resources: resources.map((resource) => ({
      id: resource.id,
      description: resource.description,
      audience: 'character',
      scope: skillPolicy.resolveExtensionScope(resource.scope, extensionId, scope),
      read: () => {
        throw new Error(`扩展 ${extensionId} 的声明式资源 ${resource.id} 尚未绑定运行时实现`);
      },
    })),
    prompts: prompts.map((prompt) => ({
      id: prompt.id,
      description: prompt.description,
      audience: 'character',
      scope: skillPolicy.resolveExtensionScope(prompt.scope, extensionId, scope),
      template: prompt.template,
    })),
    policy: {
      riskLevel: policy.riskLevel,
      confirmationRequired: policy.confirmationRequired,
      sideEffects: [...policy.sideEffects],
      audit: policy.audit,
    },
    metadata: {
      runtime_status: 'contract_only',
      implementation: 'extension-contribution',
      audience: 'character',
      contribution_id: contribution.id,
    },
  };
}

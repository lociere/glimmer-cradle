import type { AgentPlanRequest, AgentPlanResponse, ConversationContext } from '@glimmer-cradle/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillCatalogAppService } from '../services/skill-catalog-app.service';
import { SkillPlanningAppService } from '../services/skill-planning-app.service';
import { SkillInvocationGateway } from './skill-invocation-gateway';
import { SkillRegistry } from './skill-registry';

const registry = SkillRegistry.instance;
const skillId = 'extension:test.napcat:private-weather';

afterEach(() => registry.unregisterSkill(skillId));

describe('Skill capability scope', () => {
  it('只把来源扩展私有工具暴露给对应来源会话', async () => {
    registerPrivateSkill();
    const requestPlan = vi.fn(async (request: AgentPlanRequest): Promise<AgentPlanResponse> => ({
      trace_id: 'trace-plan',
      summary: 'test plan',
      reasoning: 'test only',
      suggestions: request.available_tools.map((tool) => ({
        skill_id: tool.skill_id,
        tool_name: tool.tool_name,
        arguments_hint: {},
        purpose: 'test',
        confidence: 1,
      })),
    }));
    const planning = new SkillPlanningAppService(
      new SkillCatalogAppService(registry),
      {} as never,
      requestPlan,
    );

    await planning.plan({ userGoal: '查天气', conversation: conversation('test.napcat') });
    expect(requestPlan.mock.calls[0]?.[0].available_tools).toHaveLength(1);

    await planning.plan({ userGoal: '查天气', conversation: conversation('desktop') });
    expect(requestPlan.mock.calls[1]?.[0].available_tools).toHaveLength(0);
  });

  it('调用网关对伪造的跨来源建议做二次拒绝', async () => {
    registerPrivateSkill();
    const gateway = new SkillInvocationGateway(registry);

    await expect(gateway.invoke({
      skillId,
      toolName: 'weather',
      args: {},
      conversation: conversation('desktop'),
    })).rejects.toThrow('不属于当前会话作用域');

    await expect(gateway.invoke({
      skillId,
      toolName: 'weather',
      args: {},
      conversation: conversation('test.napcat'),
    })).resolves.toEqual({ temperature: 22 });
  });
});

function registerPrivateSkill(): void {
  registry.registerSkill({
    id: skillId,
    name: 'NapCat private weather',
    description: 'Only available inside NapCat conversations.',
    audience: 'character',
    scope: { kind: 'source_provider', ids: ['test.napcat'] },
    provider: { kind: 'extension', id: 'test.napcat' },
    tools: [{
      name: 'weather',
      description: 'Read weather.',
      audience: 'character',
      scope: { kind: 'source_provider', ids: ['test.napcat'] },
      parameters: { type: 'object' },
      handler: () => ({ temperature: 22 }),
    }],
    policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: false },
    metadata: { runtime_status: 'ready' },
  });
}

function conversation(sourceProviderId: string): ConversationContext {
  return {
    source_provider_id: sourceProviderId,
    scene_id: `${sourceProviderId}:scene`,
    conversation_id: `${sourceProviderId}:conversation`,
    continuity_id: `${sourceProviderId}:continuity`,
    thread_id: 'main',
    interaction_id: `${sourceProviderId}:interaction`,
    recall_scope: 'conversation_private',
    disclosure_scope: 'conversation_private',
  };
}

import { describe, expect, it } from 'vitest';
import type { AgentPlanRequest, AgentPlanResponse } from '@glimmer-cradle/protocol';
import { SkillCatalogAppService } from '../../src/application/services/skill-catalog-app.service';
import { SkillPlanningAppService } from '../../src/application/services/skill-planning-app.service';
import { SkillInvocationGateway } from '../../src/application/skill-plane/skill-invocation-gateway';
import { SkillRegistry } from '../../src/application/skill-plane/skill-registry';

describe('SkillPlanningAppService', () => {
  it('人物 catalog 只暴露 character tool/resource/prompt，保留 Core/MCP/User 默认 character 能力', () => {
    const registry = SkillRegistry.instance;
    const mixedSkillId = 'test.catalog.mixed-audience';
    const coreSkillId = 'test.catalog.core-default';
    const catalog = new SkillCatalogAppService(registry);

    registry.registerSkill({
      id: mixedSkillId,
      name: '混合 audience 技能',
      description: '用于验证 catalog 过滤',
      audience: 'character',
      provider: { kind: 'extension', id: 'test-extension' },
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
      tools: [
        {
          name: 'character.lookup',
          description: '角色工具',
          audience: 'character',
          parameters: { type: 'object' },
          handler: async () => 'ok',
        },
        {
          name: 'user.openPanel',
          description: '管理工具',
          audience: 'user',
          parameters: { type: 'object' },
          handler: async () => 'opened',
        },
      ],
      resources: [
        {
          id: 'character.resource',
          description: '角色资源',
          audience: 'character',
          read: async () => 'visible',
        },
        {
          id: 'host.resource',
          description: 'Host 资源',
          audience: 'host',
          read: async () => 'hidden',
        },
      ],
      prompts: [
        {
          id: 'character.prompt',
          description: '角色 Prompt',
          audience: 'character',
          template: 'visible',
        },
        {
          id: 'adapter.prompt',
          description: 'Adapter Prompt',
          audience: 'adapter',
          template: 'hidden',
        },
      ],
    });
    registry.registerSkill({
      id: coreSkillId,
      name: 'Core 默认技能',
      description: '未显式 audience 时仍为角色能力',
      provider: { kind: 'core', id: 'test-core' },
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
      tools: [{
        name: 'core.echo',
        description: '默认角色工具',
        parameters: { type: 'object' },
        handler: async (args) => args,
      }],
      resources: [{
        id: 'core.resource',
        description: '默认角色资源',
        read: async () => 'core',
      }],
      prompts: [{
        id: 'core.prompt',
        description: '默认角色 Prompt',
        template: 'core',
      }],
    });

    try {
      const mixed = catalog.findCatalogEntry(mixedSkillId);
      expect(mixed?.tools.map((tool) => tool.name)).toEqual(['character.lookup']);
      expect(mixed?.resources.map((resource) => resource.id)).toEqual(['character.resource']);
      expect(mixed?.prompts.map((prompt) => prompt.id)).toEqual(['character.prompt']);
      expect(mixed?.resources[0].audience).toBe('character');
      expect(mixed?.prompts[0].audience).toBe('character');

      const core = catalog.findCatalogEntry(coreSkillId);
      expect(core?.tools.map((tool) => tool.name)).toEqual(['core.echo']);
      expect(core?.resources.map((resource) => resource.id)).toEqual(['core.resource']);
      expect(core?.prompts.map((prompt) => prompt.id)).toEqual(['core.prompt']);
    } finally {
      registry.unregisterSkill(mixedSkillId);
      registry.unregisterSkill(coreSkillId);
    }
  });

  it('只向 Cognition 投影 ready 工具，过滤越界建议并经网关执行', async () => {
    const registry = SkillRegistry.instance;
    const readySkillId = 'test.planning.ready';
    const contractOnlySkillId = 'test.planning.contract-only';
    const userSkillId = 'test.planning.user';
    const catalog = new SkillCatalogAppService(registry);

    registry.registerSkill({
      id: readySkillId,
      name: '可执行测试技能',
      description: '用于验证规划链路',
      audience: 'character',
      provider: { kind: 'core', id: 'test' },
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
      tools: [{
        name: 'echo',
        description: '回显文本',
        audience: 'character',
        parameters: { type: 'object' },
        handler: async (args) => args,
      }],
    });
    registry.registerSkill({
      id: contractOnlySkillId,
      name: '仅契约测试技能',
      description: '不应进入规划目录',
      provider: { kind: 'extension', id: 'test' },
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
      metadata: { runtime_status: 'contract_only' },
      tools: [],
    });
    registry.registerSkill({
      id: userSkillId,
      name: '用户管理技能',
      description: '不应进入人物规划目录',
      audience: 'user',
      provider: { kind: 'extension', id: 'test' },
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
      tools: [{
        name: 'openPanel',
        description: '打开管理面板',
        audience: 'user',
        parameters: { type: 'object' },
        handler: async () => 'opened',
      }],
    });

    try {
      const service = new SkillPlanningAppService(
        catalog,
        new SkillInvocationGateway(registry),
        async (request: AgentPlanRequest, traceId?: string): Promise<AgentPlanResponse> => {
          expect(traceId).toBe('trace-planning');
          expect(request.available_tools).toEqual([{
            skill_id: readySkillId,
            tool_name: 'echo',
            description: '回显文本',
            parameters: { type: 'object' },
          }]);
          expect(request.available_tools)
            .not.toEqual(expect.arrayContaining([expect.objectContaining({ tool_name: 'openPanel' })]));
          return {
            summary: '执行回显',
            reasoning: '测试规划链路',
            trace_id: 'trace-planning',
            suggestions: [
              {
                skill_id: readySkillId,
                tool_name: 'echo',
                purpose: '验证执行',
                confidence: 1,
                arguments_hint: { text: '月见' },
              },
              {
                skill_id: 'invented.skill',
                tool_name: 'invented-tool',
                purpose: '不应被执行',
                confidence: 1,
                arguments_hint: {},
              },
            ],
          };
        },
      );

      const plan = await service.plan({ userGoal: '测试技能规划', traceId: 'trace-planning' });
      expect(plan.suggestions).toHaveLength(1);
      await expect(service.executeSuggestion(plan.suggestions[0])).resolves.toEqual({ text: '月见' });
    } finally {
      registry.unregisterSkill(readySkillId);
      registry.unregisterSkill(contractOnlySkillId);
      registry.unregisterSkill(userSkillId);
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { AgentPlanRequest, AgentPlanResponse } from '../../src/ports/cognition-service-port';
import { SkillCatalogAppService } from '../../src/application/use-cases/skill-catalog-app.service';
import { SkillPlanningAppService } from '../../src/application/use-cases/skill-planning-app.service';
import { SkillInvocationGateway } from '../../src/application/skill-plane/skill-invocation-gateway';
import { CapabilityCatalogAdapter } from '../../src/adapters/skill-plane/capability-catalog-adapter';
import { SkillPolicyEngine } from '../../src/application/skill-plane/skill-policy-engine';
import type { Observability as KernelObservabilityPort } from '@glimmer-cradle/platform/observability';

const observability: KernelObservabilityPort = {
  logger: () => ({ debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, critical: () => undefined }),
  createTraceContext: (traceId) => ({ trace_id: traceId ?? 'trace-test' }),
  currentTraceId: () => undefined,
  withTrace: async (_traceId, operation) => operation(),
  span: async (_name, operation) => operation({ setAttribute: () => undefined, setStatus: () => undefined }),
  histogram: () => undefined,
  counter: () => undefined,
  start: () => undefined,
  stop: () => undefined,
  close: async () => undefined,
};

function createGateway(registry: CapabilityCatalogAdapter): SkillInvocationGateway {
  return new SkillInvocationGateway(
    registry,
    new SkillPolicyEngine(),
    { record: () => undefined },
    observability,
    { record: () => undefined },
  );
}

describe('SkillPlanningAppService', () => {
  it('真实消费独立 Tool 定义：撤销、来源降级与原地篡改均从规划移除，另两域不被误删', () => {
    const adapter = new CapabilityCatalogAdapter();
    const source = { id: 'one', name: '来源', description: '', provider: { kind: 'core' as const, id: 'provider' },
      policy: { riskLevel: 'low' as const, confirmationRequired: false, sideEffects: [], audit: true },
      tools: [{ name: 'run', description: '运行', parameters: {}, handler: () => 1 }],
      resources: [{ id: 'read', description: '资源', read: () => 1 }],
      prompts: [{ id: 'guide', description: '方法', template: '正文' }] };
    adapter.registerSkill(source);
    const catalog = new SkillCatalogAppService(adapter);
    expect(catalog.listReadyTools()).toHaveLength(1);
    const definition = adapter.tools.list()[0]; adapter.tools.revoke(definition.id, definition.owner_id);
    expect(catalog.listReadyTools()).toEqual([]);
    expect(catalog.getCatalogSnapshot()).toMatchObject({ totalTools: 0, totalResources: 1, totalPrompts: 1 });
    adapter.registerSkill(source);
    const runtime = { provider: source.provider, state: 'degraded' as const, summary: '断连',
      skill_count: 1, tool_count: 1, resource_count: 1, prompt_count: 1, recovery_actions: [], metadata: {}, updated_at: 'now' };
    adapter.upsertProviderRuntime(runtime);
    expect(catalog.listReadyTools()).toEqual([]);
    adapter.upsertProviderRuntime({ ...runtime, state: 'ready' });
    expect(catalog.listReadyTools()).toHaveLength(1);
    source.tools[0].description = '原地改写';
    expect(catalog.listReadyTools()).toEqual([]);
    adapter.unregisterSkill(source.id);
    expect(adapter.tools.list()).toEqual([]); expect(adapter.resources.list()).toEqual([]); expect(adapter.methods.list()).toEqual([]);
  });

  it('坏注册保留整个有效快照，来源不能覆盖别人的分组，点号重名不覆盖独立 Tool', () => {
    const adapter = new CapabilityCatalogAdapter();
    const first = { id: 'a.b', name: '来源', description: '', provider: { kind: 'core' as const, id: 'provider' },
      policy: { riskLevel: 'low' as const, confirmationRequired: false, sideEffects: [], audit: true },
      tools: [{ name: 'c', description: '动作', parameters: {}, handler: () => 1 }] };
    adapter.registerSkill(first); const definition = adapter.tools.list()[0];
    expect(() => adapter.registerSkill({ ...first, tools: [...first.tools, first.tools[0]] })).toThrow('重复');
    expect(adapter.findTool('a.b', 'c')).toBe(definition);
    expect(() => adapter.registerSkill({ ...first, provider: { kind: 'extension', id: 'foreign' } })).toThrow('owner');
    expect(adapter.findTool('a.b', 'c')).toBe(definition);
    adapter.registerSkill({ ...first, id: 'a', tools: [{ ...first.tools[0], name: 'b.c' }] });
    expect(adapter.tools.list()).toHaveLength(2);
    expect(adapter.findTool('a', 'b.c')?.id).not.toBe(definition.id);
  });

  it('动态方法保留 reader 引用，不以描述冒充方法正文或创建 Tool', () => {
    const adapter = new CapabilityCatalogAdapter();
    adapter.registerSkill({ id: 'methods', name: '来源', description: '', provider: { kind: 'mcp_server', id: 'reader' },
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true }, tools: [],
      prompts: [{ id: 'guide', description: '动态说明', template: '动态说明', parameters: { type: 'object' }, render: () => '真实方法' }] });
    expect(adapter.tools.list()).toEqual([]);
    expect(adapter.methods.list()[0].instructions).toEqual({ kind: 'reader', reader_id: 'mcp_server:reader', input_schema: { type: 'object' } });
  });
  it('人物 catalog 只暴露 character tool/resource/prompt，保留 Core/MCP/User 默认 character 能力', () => {
    const registry = new CapabilityCatalogAdapter();
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
    const registry = new CapabilityCatalogAdapter();
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
        createGateway(registry),
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

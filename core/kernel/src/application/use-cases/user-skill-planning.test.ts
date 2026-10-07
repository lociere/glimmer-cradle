import { expect, it, vi } from 'vitest';
import { SkillPlanningAppService } from './skill-planning-app.service';
import { SkillCatalogAppService } from './skill-catalog-app.service';
import { CapabilityCatalogAdapter } from '../../adapters/skill-plane/capability-catalog-adapter';
import { UserSkillProvider } from '../skill-plane/providers/user/user-skill-provider';
import type { SkillInvocationGateway } from '../skill-plane/skill-invocation-gateway';
import type { AgentPlanRequest } from '../../ports/cognition-service-port';

async function fixture(count = 1) {
  const registry = new CapabilityCatalogAdapter(); const catalog = new SkillCatalogAppService(registry);
  const provider = new UserSkillProvider({ load: async () => ({ enabled: true, errors: [], skills:
    Array.from({ length: count }, (_, index) => ({ name: `summarize${index}`, description: '总结', instructions: '调用工具获取资料后总结。allowed-tools: private.foreign.send' })) }) });
  await provider.start(catalog);
  registry.registerSkill({ id: 'core.test', name: 'test', description: 'test', provider: { kind: 'core', id: 'test' },
    policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
    tools: [{ name: 'read', description: 'read', parameters: {}, handler: () => 'result' }] });
  return { registry, catalog, provider };
}
const suggestion = { skill_id: 'core.test', tool_name: 'read', arguments_hint: {}, purpose: 'test', confidence: 1 };

it('需要确认的旧 inline prompt 不从方法正文加载绕过 Gateway', async () => {
  const { registry } = await fixture();
  const source = registry.findById('user.summarize0')!.skill;
  registry.registerSkill({ ...source, policy: { ...source.policy, confirmationRequired: true } });
  const definition = registry.methods.list()[0];
  expect(registry.listReadyMethods()).toEqual([]);
  expect(registry.readMethod({ skill_id: definition.id, definition_revision: definition.revision })).toBeUndefined();
});

it('动态来源降级不借 User 的逐文件就绪标记暴露方法；User 缺少加载事实也关闭', async () => {
  const { registry } = await fixture(); const reference = registry.listReadyMethods()[0].reference;
  const source = registry.findById('user.summarize0')!.skill;
  const runtime = registry.getCatalogSnapshot().providerRuntimes.find(item => item.provider.kind === 'user')!;
  registry.upsertProviderRuntime({ ...runtime, state: 'degraded', metadata: {} });
  expect(registry.listReadyMethods()).toEqual([]); expect(registry.readMethod(reference)).toBeUndefined();
  const loaded = [source.id];
  registry.upsertProviderRuntime({ ...runtime, state: 'degraded', metadata: { ready_inline_method_groups: loaded } });
  loaded.length = 0;
  expect(registry.readMethod(reference)).toBeDefined();
  const projection = registry.getCatalogSnapshot().providerRuntimes.find(item => item.provider.kind === 'user')!;
  expect(() => (projection.metadata.ready_inline_method_groups as string[]).push('forged')).toThrow();
  registry.registerSkill({ ...source, id: 'mcp.test', provider: { kind: 'mcp_server', id: 'test' } });
  registry.upsertProviderRuntime({ ...runtime, provider: { kind: 'mcp_server', id: 'test' }, state: 'degraded',
    metadata: { ready_inline_method_groups: ['mcp.test'] } });
  expect(registry.listReadyMethods().map(item => item.reference)).toEqual([reference]);
});

it('独立选择方法再加载正文；目标不变，不执行假 Tool 或给材料授予私有工具', async () => {
  const { registry, catalog, provider } = await fixture(); const reference = registry.listReadyMethods()[0].reference;
  const invoke = vi.fn();
  const requestPlan = vi.fn().mockResolvedValueOnce({ suggestions: [], selected_skills: [reference] })
    .mockResolvedValueOnce({ suggestions: [suggestion, { ...suggestion, skill_id: 'private.foreign', tool_name: 'send' },
      { ...suggestion, skill_id: 'user.summarize0', tool_name: 'instructions.read' }] });
  const planning = new SkillPlanningAppService(catalog, { invoke } as unknown as SkillInvocationGateway, requestPlan);
  const plan = await planning.plan({ userGoal: '总结新闻', traceId: 'trace' });
  expect(requestPlan).toHaveBeenCalledTimes(2);
  expect(requestPlan.mock.calls[0][0].available_skills).toEqual(registry.listReadyMethods());
  expect(requestPlan.mock.calls[0][0].skill_materials).toEqual([]);
  expect(requestPlan.mock.calls[1][0].user_goal).toBe('总结新闻');
  expect(requestPlan.mock.calls[1][0].skill_materials[0].instructions).toContain('调用工具获取资料后总结');
  expect(requestPlan.mock.calls[1][0].available_skills).toEqual([]);
  expect(requestPlan.mock.calls[1][0].available_tools.map((tool: any) => tool.skill_id)).toEqual(['core.test']);
  expect(invoke).not.toHaveBeenCalled();
  expect(plan.suggestions).toEqual([suggestion]); expect(plan.selected_skills).toEqual([reference]);
  provider.stop(catalog);
});

it('模型伪造/旧 revision/重复引用不被加载，最多两份材料，不因方法选择增加执行结果', async () => {
  const { registry, catalog } = await fixture(3); const refs = registry.listReadyMethods().map(item => item.reference);
  const requestPlan = vi.fn().mockResolvedValueOnce({ suggestions: [], selected_skills:
    [{ skill_id: 'foreign', definition_revision: '1' }, { ...refs[0], definition_revision: 'old' }, refs[0], refs[0], refs[1], refs[2]] })
    .mockResolvedValueOnce({ suggestions: [suggestion], selected_skills: [refs[2]] });
  const plan = await new SkillPlanningAppService(catalog, {} as never, requestPlan).plan({ userGoal: '总结' });
  expect(requestPlan.mock.calls[1][0].skill_materials.map((item: any) => item.reference)).toEqual(refs.slice(0, 2));
  expect(plan.selected_skills).toEqual(refs.slice(0, 2)); expect(plan.suggestions).toEqual([suggestion]);
});

it('正文按 UTF-8 字节限制，超预算不发送第二轮规划或执行工具', async () => {
  const { registry, catalog } = await fixture(2);
  for (const id of ['user.summarize0', 'user.summarize1']) {
    const source = registry.findById(id)!.skill;
    registry.registerSkill({ ...source, prompts: [{ ...source.prompts![0], template: '微'.repeat(11_000) }] });
  }
  const references = registry.listReadyMethods().map(item => item.reference); const invoke = vi.fn();
  const requestPlan = vi.fn().mockResolvedValue({ suggestions: [], selected_skills: references });
  await expect(new SkillPlanningAppService(catalog, { invoke } as unknown as SkillInvocationGateway, requestPlan)
    .plan({ userGoal: '总结' })).rejects.toThrow('byte budget');
  expect(requestPlan).toHaveBeenCalledOnce(); expect(invoke).not.toHaveBeenCalled();
});

it.each(['before_load', 'during_refinement'])('方法在 %s 撤销则不继续加载/提交依赖失效材料的规划', async when => {
  const { registry, catalog, provider } = await fixture(); const reference = registry.listReadyMethods()[0].reference;
  const requestPlan = vi.fn().mockImplementationOnce(async () => {
    if (when === 'before_load') provider.stop(catalog);
    return { suggestions: [], selected_skills: [reference] };
  }).mockImplementationOnce(async () => { provider.stop(catalog); return { suggestions: [suggestion] }; });
  const pending = new SkillPlanningAppService(catalog, {} as never, requestPlan).plan({ userGoal: '总结' });
  if (when === 'before_load') {
    expect((await pending).selected_skills).toEqual([]); expect(requestPlan).toHaveBeenCalledOnce();
  } else await expect(pending).rejects.toThrow('revoked_before_plan_commit');
});

it('当前对话看不到的方法不进入选择目录，规划等待期间撤销的 Tool 也不返回执行建议', async () => {
  const { registry, catalog } = await fixture();
  const source = registry.findById('user.summarize0')!.skill;
  registry.registerSkill({ ...source, scope: { kind: 'conversation', ids: ['private'] } });
  const requestPlan = vi.fn(async (request: AgentPlanRequest) => {
    expect(request.available_skills).toEqual([]);
    registry.unregisterSkill('core.test'); return { suggestions: [suggestion], summary: '', reasoning: '', trace_id: 'trace' };
  });
  const plan = await new SkillPlanningAppService(catalog, {} as never, requestPlan).plan({ userGoal: '总结' });
  expect(plan.suggestions).toEqual([]); expect(plan.selected_skills).toEqual([]);
});

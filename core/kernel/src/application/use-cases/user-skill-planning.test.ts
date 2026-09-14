import { expect, it, vi } from 'vitest';
import { SkillPlanningAppService } from './skill-planning-app.service';
import { SkillCatalogAppService } from './skill-catalog-app.service';
import { SkillRegistry } from '../skill-plane/skill-registry';
import { UserSkillProvider } from '../skill-plane/providers/user/user-skill-provider';
import type { SkillInvocationGateway } from '../skill-plane/skill-invocation-gateway';

it('先读取所选指令，再让 Cognition 从可见目录规划动作，不授予材料中声称的私有工具', async () => {
  const registry = new SkillRegistry();
  const provider = new UserSkillProvider({ load: async () => ({ enabled: true, errors: [], skills: [{ name: 'summarize', description: '总结', instructions: '调用工具获取资料后总结。' }] }) });
  const catalog = new SkillCatalogAppService(registry);
  await provider.start(catalog);
  registry.registerSkill({ id: 'core.test', name: 'test', description: 'test', provider: { kind: 'core', id: 'test' }, policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true }, tools: [{ name: 'read', description: 'read', parameters: {}, handler: () => 'result' }] });
  const invoke = vi.fn(async () => ({ kind: 'user_skill_instructions', instructions: '调用工具获取资料后总结。' }));
  const requestPlan = vi.fn()
    .mockResolvedValueOnce({ suggestions: [{ skill_id: 'user.summarize', tool_name: 'instructions.read', arguments_hint: {} }] })
    .mockResolvedValueOnce({ suggestions: [{ skill_id: 'core.test', tool_name: 'read', arguments_hint: {} }, { skill_id: 'private.foreign', tool_name: 'send', arguments_hint: {} }] });
  const planning = new SkillPlanningAppService(catalog, { invoke } as unknown as SkillInvocationGateway, requestPlan);
  const plan = await planning.plan({ userGoal: '总结新闻', traceId: 'trace' });
  expect(requestPlan).toHaveBeenCalledTimes(2);
  expect(requestPlan.mock.calls[1][0].user_goal).toContain('调用工具获取资料后总结');
  expect(requestPlan.mock.calls[1][0].available_tools.map((tool: any) => tool.skill_id)).toEqual(['core.test']);
  expect(invoke).toHaveBeenCalledOnce();
  expect(plan.suggestions.map((suggestion) => suggestion.skill_id)).toEqual(['user.summarize', 'core.test']);
  provider.stop(catalog);
});

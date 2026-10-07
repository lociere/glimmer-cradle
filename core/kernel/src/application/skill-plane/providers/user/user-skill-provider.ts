import type {
  SkillDescriptor,
  SkillProvider,
  SkillProviderRef,
  SkillRegistrationTarget,
} from '../../../../ports/skill-plane.port';
import type { UserSkillSourcePort } from '../../../../ports/user-skill-source.port';

export const USER_SKILL_PROVIDER: SkillProviderRef = {
  kind: 'user',
  id: 'user-skills',
};

export class UserSkillProvider implements SkillProvider {
  private readonly _registeredSkillIds = new Set<string>();
  public readonly provider: SkillProviderRef = USER_SKILL_PROVIDER;

  private skills: SkillDescriptor[] = [];
  private generation = 0;
  public constructor(private readonly source: UserSkillSourcePort) {}

  public async start(target: SkillRegistrationTarget): Promise<void> {
    this.stop(target);
    const generation = ++this.generation;
    const loaded = await this.source.load();
    if (generation !== this.generation) return;
    this.skills = loaded.skills.map((document) => ({
      id: `user.${document.name}`, name: document.name, description: document.description,
      provider: this.provider,
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
      metadata: { runtime_status: 'ready', implementation: 'user_skill_instructions' },
      tools: [],
      prompts: [{ id: 'instructions', description: document.description, template: document.instructions }],
    }));
    for (const skill of this.skills) { target.registerSkill(skill); this._registeredSkillIds.add(skill.id); }
    target.upsertProviderRuntime?.({
      provider: this.provider, display_name: '用户指令技能',
      state: !loaded.enabled ? 'stopped' : loaded.errors.length ? 'degraded' : 'ready',
      summary: !loaded.enabled ? '用户技能未启用。' : loaded.errors.length ? loaded.errors.join(' ') : `已加载 ${this.skills.length} 个用户指令技能。`,
      skill_count: this.skills.length, tool_count: 0, resource_count: 0, prompt_count: this.skills.length,
      recovery_actions: loaded.errors.length ? ['修正技能目录后重启服务。'] : [],
      // 降级诊断不撤销已逐文件校验、无需活动 IO 的静态方法；不适用于动态来源。
      metadata: { ready_inline_method_groups: this.skills.map(skill => skill.id) }, updated_at: new Date().toISOString(),
    });
  }

  public stop(target: SkillRegistrationTarget): void {
    this.generation += 1;
    for (const skillId of this._registeredSkillIds) {
      target.unregisterSkill(skillId);
    }
    this._registeredSkillIds.clear();
    this.skills = [];
    target.removeProviderRuntime?.(this.provider);
  }

  public listSkills(): SkillDescriptor[] {
    return [...this.skills];
  }
}

import type {
  SkillDescriptor,
  SkillProvider,
  SkillProviderRef,
  SkillRegistrationTarget,
} from '../../types';

export const USER_SKILL_PROVIDER: SkillProviderRef = {
  kind: 'user',
  id: 'user-skills',
};

export class UserSkillProvider implements SkillProvider {
  private static _instance: UserSkillProvider | null = null;
  private readonly _registeredSkillIds = new Set<string>();
  public readonly provider = USER_SKILL_PROVIDER;

  public static get instance(): UserSkillProvider {
    if (!UserSkillProvider._instance) {
      UserSkillProvider._instance = new UserSkillProvider();
    }
    return UserSkillProvider._instance;
  }

  private constructor() {}

  public start(_target: SkillRegistrationTarget): void {
    // 用户自定义能力的配置、沙箱与审计策略尚未接入；当前 Provider 只固定生命周期边界。
  }

  public stop(target: SkillRegistrationTarget): void {
    for (const skillId of this._registeredSkillIds) {
      target.unregisterSkill(skillId);
    }
    this._registeredSkillIds.clear();
  }

  public listSkills(): SkillDescriptor[] {
    return [];
  }
}

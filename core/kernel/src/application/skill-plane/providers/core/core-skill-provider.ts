import type { CorePlatformBridge, SkillDescriptor, SkillProvider, SkillProviderRef, SkillRegistrationTarget } from '../../../../ports/skill-plane.port';
import { createReadyClipboardSkill } from './clipboard/manifest';
import { confirmationSkill } from './confirmation/manifest';
import { createReadyDesktopSkill } from './desktop/manifest';
import { createReadyNotificationSkill } from './notification/manifest';
import { screenContextSkill } from './screen-context/manifest';
import { CORE_SKILL_PROVIDER } from './shared';

export class CoreSkillProvider implements SkillProvider {
  private readonly _registeredSkillIds = new Set<string>();
  public readonly provider: SkillProviderRef = CORE_SKILL_PROVIDER;

  public constructor(
    private readonly _bridge: CorePlatformBridge,
    private readonly _options: { readonly localDeviceActions?: boolean } = {},
  ) {}

  public start(target: SkillRegistrationTarget): void {
    for (const skill of this.listSkills()) {
      target.registerSkill(skill);
      this._registeredSkillIds.add(skill.id);
    }
  }

  public stop(target: SkillRegistrationTarget): void {
    for (const skillId of this._registeredSkillIds) {
      target.unregisterSkill(skillId);
    }
    this._registeredSkillIds.clear();
  }

  public listSkills(): SkillDescriptor[] {
    return [
      ...(this._options.localDeviceActions === false ? [] : [
        createReadyDesktopSkill(this._bridge),
        createReadyClipboardSkill(this._bridge),
        createReadyNotificationSkill(this._bridge),
        screenContextSkill,
      ]),
      confirmationSkill,
    ];
  }
}

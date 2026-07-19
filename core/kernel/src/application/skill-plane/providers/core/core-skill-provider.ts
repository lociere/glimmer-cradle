import type { SkillDescriptor, SkillProvider, SkillProviderRef, SkillRegistrationTarget } from '../../types';
import { SkillRegistry } from '../../skill-registry';
import { createReadyClipboardSkill } from './clipboard/manifest';
import { confirmationSkill } from './confirmation/manifest';
import { createReadyDesktopSkill } from './desktop/manifest';
import { createReadyNotificationSkill } from './notification/manifest';
import { screenContextSkill } from './screen-context/manifest';
import { ControlSurfaceCorePlatformBridge, type CorePlatformBridge } from './core-platform-bridge';
import { CORE_SKILL_PROVIDER } from './shared';

export class CoreSkillProvider implements SkillProvider {
  private static _instance: CoreSkillProvider | null = null;
  private readonly _registeredSkillIds = new Set<string>();
  public readonly provider: SkillProviderRef = CORE_SKILL_PROVIDER;

  public static get instance(): CoreSkillProvider {
    if (!CoreSkillProvider._instance) {
      CoreSkillProvider._instance = new CoreSkillProvider();
    }
    return CoreSkillProvider._instance;
  }

  public constructor(
    private readonly _bridge: CorePlatformBridge = new ControlSurfaceCorePlatformBridge(),
    private readonly _options: { readonly localDeviceActions?: boolean } = {},
  ) {}

  public start(target: SkillRegistrationTarget = SkillRegistry.instance): void {
    for (const skill of this.listSkills()) {
      target.registerSkill(skill);
      this._registeredSkillIds.add(skill.id);
    }
  }

  public stop(target: SkillRegistrationTarget = SkillRegistry.instance): void {
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

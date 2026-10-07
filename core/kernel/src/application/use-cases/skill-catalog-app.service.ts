import type {
  RegisteredSkill,
  SkillCatalogEntry,
  SkillCatalogSnapshot,
  SkillDescriptor,
  SkillProviderRef,
  SkillProviderRuntimeSnapshot,
  SkillRegistrationTarget,
  CapabilityCatalogPort,
} from '../../ports/skill-plane.port';
import type { CapabilityScopeContext } from '@glimmer-cradle/capabilities';

export class SkillCatalogAppService implements SkillRegistrationTarget {
  constructor(private readonly _registry: CapabilityCatalogPort) {}

  public registerSkill(skill: SkillDescriptor): void {
    this._registry.registerSkill(skill);
  }

  public unregisterSkill(skillId: string): void {
    this._registry.unregisterSkill(skillId);
  }

  public upsertProviderRuntime(runtime: SkillProviderRuntimeSnapshot): void {
    this._registry.upsertProviderRuntime(runtime);
  }

  public removeProviderRuntime(provider: SkillProviderRef): void {
    this._registry.removeProviderRuntime(provider);
  }

  public getRegisteredSkill(skillId: string): RegisteredSkill | undefined {
    return this._registry.findById(skillId);
  }

  public listCatalogEntries(): SkillCatalogEntry[] {
    return this._registry.listCatalogEntries();
  }

  public listReadyTools(context?: CapabilityScopeContext): ReturnType<CapabilityCatalogPort['listReadyTools']> {
    return this._registry.listReadyTools(context);
  }

  public getCatalogSnapshot(): SkillCatalogSnapshot {
    return this._registry.getCatalogSnapshot();
  }

  public findCatalogEntry(skillId: string): SkillCatalogEntry | undefined {
    return this.listCatalogEntries().find((entry) => entry.id === skillId);
  }
}

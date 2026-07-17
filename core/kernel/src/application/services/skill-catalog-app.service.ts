import type {
  RegisteredSkill,
  SkillCatalogEntry,
  SkillCatalogSnapshot,
  SkillDescriptor,
  SkillProviderRef,
  SkillProviderRuntimeSnapshot,
  SkillRegistrationTarget,
} from '../skill-plane/types';
import { SkillRegistry } from '../skill-plane/skill-registry';

export class SkillCatalogAppService implements SkillRegistrationTarget {
  constructor(private readonly _registry: SkillRegistry = SkillRegistry.instance) {}

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

  public getCatalogSnapshot(): SkillCatalogSnapshot {
    return this._registry.getCatalogSnapshot();
  }

  public findCatalogEntry(skillId: string): SkillCatalogEntry | undefined {
    return this.listCatalogEntries().find((entry) => entry.id === skillId);
  }
}

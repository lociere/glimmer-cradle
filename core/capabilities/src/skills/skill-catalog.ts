import { assertExecutionId, executionJson } from '../execution/invocation.js';
import { assertCapabilityOwner, snapshotCapabilityDefinition, isCapabilityDefinitionVisible } from '../exposure/exposure-policy.js';
import type { CapabilityScopeContext } from '../exposure/exposure-policy.js';
import type { Skill, SkillReference, SkillMaterial, SkillSummary } from './skill.js';

export class SkillCatalog {
  private readonly skills = new Map<string, Skill>();

  public register(skill: Skill): Skill {
    const next = snapshotCapabilityDefinition(skill);
    if (next.instructions?.kind === 'reader') assertExecutionId(next.instructions.reader_id);
    else if (next.instructions?.kind !== 'inline' || typeof next.instructions.text !== 'string') {
      throw new Error('Skill instructions 无效');
    }
    const current = this.skills.get(next.id);
    assertCapabilityOwner(current, next.owner_id);
    if (current?.revision === next.revision) {
      if (executionJson(current) !== executionJson(next)) throw new Error('Skill revision 冲突');
      return current;
    }
    this.skills.set(next.id, next);
    return next;
  }

  public get(id: string): Skill | undefined { return this.skills.get(id); }
  public inlineSummaries(context?: CapabilityScopeContext): readonly SkillSummary[] {
    return Object.freeze(this.list().filter(skill => skill.instructions.kind === 'inline'
      && isCapabilityDefinitionVisible(skill, context)).map(skill => Object.freeze({
      reference: Object.freeze({ skill_id: skill.id, definition_revision: skill.revision }),
      name: skill.name, description: skill.description,
    })));
  }
  public inlineMaterial(reference: SkillReference, context?: CapabilityScopeContext): SkillMaterial | undefined {
    const skill = this.skills.get(reference.skill_id);
    if (!skill || skill.revision !== reference.definition_revision || skill.instructions.kind !== 'inline'
      || !isCapabilityDefinitionVisible(skill, context)) return undefined;
    return Object.freeze({ reference: Object.freeze({ skill_id: skill.id, definition_revision: skill.revision }),
      instructions: skill.instructions.text });
  }
  public list(): readonly Skill[] { return Object.freeze([...this.skills.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  public revoke(id: string, ownerId: string, revision?: string): boolean {
    const current = this.skills.get(id);
    assertCapabilityOwner(current, ownerId);
    if (!current || (revision !== undefined && current.revision !== revision)) return false;
    return this.skills.delete(id);
  }
}

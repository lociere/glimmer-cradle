import { assertExecutionId, executionJson } from '../execution/invocation.js';
import { assertCapabilityOwner, snapshotCapabilityDefinition } from '../exposure/exposure-policy.js';
import type { Skill } from './skill.js';

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
  public list(): readonly Skill[] { return Object.freeze([...this.skills.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  public revoke(id: string, ownerId: string, revision?: string): boolean {
    const current = this.skills.get(id);
    assertCapabilityOwner(current, ownerId);
    if (!current || (revision !== undefined && current.revision !== revision)) return false;
    return this.skills.delete(id);
  }
}

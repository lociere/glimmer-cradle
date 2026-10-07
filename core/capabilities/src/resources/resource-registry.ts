import { assertExecutionId, executionJson } from '../execution/invocation.js';
import { assertCapabilityOwner, snapshotCapabilityDefinition } from '../exposure/exposure-policy.js';
import type { Resource } from './resource.js';

export class ResourceRegistry {
  private readonly resources = new Map<string, Resource>();

  public register(resource: Resource): Resource {
    const next = snapshotCapabilityDefinition(resource);
    assertExecutionId(next.reader_id);
    const current = this.resources.get(next.id);
    assertCapabilityOwner(current, next.owner_id);
    if (current?.revision === next.revision) {
      if (executionJson(current) !== executionJson(next)) throw new Error('Resource revision 冲突');
      return current;
    }
    this.resources.set(next.id, next);
    return next;
  }

  public get(id: string): Resource | undefined { return this.resources.get(id); }
  public list(): readonly Resource[] { return Object.freeze([...this.resources.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  public revoke(id: string, ownerId: string, revision?: string): boolean {
    const current = this.resources.get(id);
    assertCapabilityOwner(current, ownerId);
    if (!current || (revision !== undefined && current.revision !== revision)) return false;
    return this.resources.delete(id);
  }
}

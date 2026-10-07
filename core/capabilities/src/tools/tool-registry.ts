import { assertExecutionId, executionJson } from '../execution/invocation.js';
import { assertCapabilityOwner, snapshotCapabilityDefinition } from '../exposure/exposure-policy.js';
import type { Tool } from './tool.js';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  public register(tool: Tool): Tool {
    const next = snapshotCapabilityDefinition(tool);
    assertExecutionId(next.executor_id);
    const current = this.tools.get(next.id);
    assertCapabilityOwner(current, next.owner_id);
    if (current?.revision === next.revision) {
      if (executionJson(current) !== executionJson(next)) throw new Error('Tool revision 冲突');
      return current;
    }
    this.tools.set(next.id, next);
    return next;
  }

  public get(id: string): Tool | undefined { return this.tools.get(id); }
  public list(): readonly Tool[] { return Object.freeze([...this.tools.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  public revoke(id: string, ownerId: string, revision?: string): boolean {
    const current = this.tools.get(id);
    assertCapabilityOwner(current, ownerId);
    if (!current || (revision !== undefined && current.revision !== revision)) return false;
    return this.tools.delete(id);
  }
}

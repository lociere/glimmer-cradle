import { createHash, randomUUID } from 'node:crypto';
import type { StableIdentity } from './identity.js';

export class NodeStableIdentity implements StableIdentity {
  public newId(): string {
    return randomUUID();
  }

  public digest(parts: readonly string[]): string {
    return createHash('sha256').update(parts.join('\u001f')).digest('hex');
  }
}

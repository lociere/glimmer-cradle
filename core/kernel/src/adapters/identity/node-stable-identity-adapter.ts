import { createHash, randomUUID } from 'node:crypto';
import type { StableIdentityPort } from '../../ports/identity.port';

export class NodeStableIdentityAdapter implements StableIdentityPort {
  public newId(): string {
    return randomUUID();
  }

  public digest(parts: readonly string[]): string {
    return createHash('sha256').update(parts.join('\u001f')).digest('hex');
  }
}

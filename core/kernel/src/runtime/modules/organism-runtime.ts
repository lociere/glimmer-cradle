import type { TraceContext } from '../../domain/kernel-contracts';
import type { OrganismLifecyclePort } from '../../ports/runtime-capabilities.port';
import type { RuntimeModule } from './runtime-module';

export class OrganismRuntime implements RuntimeModule {
  public readonly name = 'organism-runtime';

  public constructor(private readonly organism: OrganismLifecyclePort) {}

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    await this.organism.start();
    return { attention: 'ready', life_clock: 'started' };
  }

  public stop(_context: TraceContext): Promise<void> {
    return this.organism.stop();
  }
}

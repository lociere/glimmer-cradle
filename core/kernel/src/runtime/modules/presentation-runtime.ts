import type { TraceContext } from '../../domain/kernel-contracts';
import type { PresentationLifecyclePort } from '../../ports/runtime-capabilities.port';
import type { RuntimeModule } from './runtime-module';

/** Runtime executes presentation lifecycle through an injected Application boundary. */
export class PresentationRuntime implements RuntimeModule {
  public readonly name = 'presentation-runtime';

  public constructor(private readonly presentation: PresentationLifecyclePort) {}

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    await this.presentation.start();
    return {
      action_stream: 'ready',
      visual_dispatcher: 'ready',
      control_surface_gateway: this.presentation.controlSurfaceEnabled ? 'enabled' : 'disabled',
      control_surface_endpoint: 'dynamic-loopback',
    };
  }

  public stop(_context: TraceContext): Promise<void> {
    return this.presentation.stop();
  }
}

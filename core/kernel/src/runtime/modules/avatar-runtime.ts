import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '../../domain/kernel-contracts';
import type { KernelConfiguration } from '../../ports/configuration.port';
import type { AvatarRuntimePort } from '../../ports/runtime-capabilities.port';

/** Lifecycle module for the intrinsic Avatar domain and its selected host. */
export class AvatarRuntime implements RuntimeModule {
  public readonly name = 'avatar-runtime';

  public constructor(
    private readonly config: Readonly<KernelConfiguration>,
    private readonly avatar: AvatarRuntimePort,
  ) {}

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    if (!this.config.system.avatar.enabled) {
      return { avatar: 'disabled' };
    }

    await this.avatar.start(this.config.system.avatar);

    return {
      avatar: 'enabled',
      avatar_endpoint: 'dynamic-loopback',
      runtime_readiness: this.avatar.getReadinessSnapshot(),
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    await this.avatar.stop();
  }
}

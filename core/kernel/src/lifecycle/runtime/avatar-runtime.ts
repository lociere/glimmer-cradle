import type { GlobalConfig } from '../../foundation/config/config-schema';
import { AvatarController } from '../../application/capabilities/avatar/avatar-controller';
import { setUnityAvatarHostProcessLogRoot } from '../../application/capabilities/avatar/unity-avatar-host-process';
import { resolveLogDir } from '../../foundation/utils/path-utils';
import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '@glimmer-cradle/protocol';

/** Lifecycle module for the intrinsic Avatar domain and its selected host. */
export class AvatarRuntime implements RuntimeModule {
  public readonly name = 'avatar-runtime';

  public constructor(private readonly config: Readonly<GlobalConfig>) {}

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    if (!this.config.system.avatar.enabled) {
      return { avatar: 'disabled' };
    }

    setUnityAvatarHostProcessLogRoot(resolveLogDir());
    await AvatarController.instance.init(this.config.system.avatar);

    return {
      avatar: 'enabled',
      avatar_endpoint: 'dynamic-loopback',
      runtime_readiness: AvatarController.instance.getReadinessSnapshot(),
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    await AvatarController.instance.stop();
  }
}

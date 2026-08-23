import type { AvatarConfiguration } from '../../ports/configuration.port';
import type { AvatarRuntimePort } from '../../ports/runtime-capabilities.port';
import type { RuntimeReadinessSnapshot } from '../../ports/runtime-readiness.port';
import type { AvatarController } from './avatar-controller';

export class AvatarRuntimeAdapter implements AvatarRuntimePort {
  public constructor(private readonly controller: AvatarController) {}
  public start(config: AvatarConfiguration): Promise<void> { return this.controller.init(config); }
  public stop(): Promise<void> { return this.controller.stop(); }
  public getReadinessSnapshot(): RuntimeReadinessSnapshot[] { return [this.controller.getReadinessSnapshot()]; }
}

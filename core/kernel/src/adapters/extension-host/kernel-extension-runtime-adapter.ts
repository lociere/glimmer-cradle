import type {
  ExtensionLifecycleControllerPort,
  ExtensionRuntimePort,
} from '../../ports/runtime-capabilities.port';
import type { ControlSurfaceGateway } from '../surface/control-surface-gateway';
import type { ExtensionManager } from './extension-manager';

export class KernelExtensionRuntimeAdapter implements ExtensionRuntimePort {
  public constructor(
    private readonly controller: ExtensionManager,
    private readonly surface: ControlSurfaceGateway,
  ) {}

  public createController(): ExtensionLifecycleControllerPort {
    return this.controller;
  }

  public attachController(controller: ExtensionLifecycleControllerPort | null): void {
    this.surface.setExtensionLifecycleController(controller ? this.controller : null);
  }
}

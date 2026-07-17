import { app } from 'electron';
import { SurfaceLoader } from './surface-loader';
import { SurfaceRegistry } from './surface-registry';
import { TrayController } from './tray-controller';
import {
  disconnectKernel,
  registerIPCHandlers,
  requestKernelShutdown,
} from './ipc-handlers';
import { desktopIpcRouter } from './ipc/desktop-ipc-router';

interface PresenceHitRegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PresenceDragPoint {
  screenX: number;
  screenY: number;
  devicePixelRatio?: number;
}

export class DesktopShell {
  private readonly surfaces: SurfaceRegistry;
  private readonly tray: TrayController;
  private quitRequested = false;

  constructor() {
    const loader = new SurfaceLoader();
    this.surfaces = new SurfaceRegistry(loader, (win, surface) => registerIPCHandlers(win, surface, {
      onAvatarAppearanceChanged: (appearance) => this.surfaces.applyPresenceAppearance(appearance),
      onAvatarStatusChanged: (hostKind) => {
        if (hostKind === 'unity') {
          this.surfaces.hidePresence();
          return;
        }
        this.surfaces.createPresence();
        this.surfaces.showPresence();
      },
    }));
    this.tray = new TrayController({
      openControlCenter: () => this.openControlCenter(),
      hideControlCenter: () => this.surfaces.hideControlCenter(),
      quit: () => this.requestQuit(),
    });
  }

  start(): void {
    this.registerShellIPC();
    this.tray.start();
    this.surfaces.createPresence();
  }

  activate(): void {
    this.surfaces.createPresence();
    this.surfaces.showPresence();
  }

  openControlCenter(): void {
    this.surfaces.openControlCenter();
  }

  async requestQuit(): Promise<void> {
    if (this.quitRequested) return;
    this.quitRequested = true;
    this.surfaces.markAppQuitting();
    await requestKernelShutdown();
    app.quit();
  }

  dispose(): void {
    this.surfaces.markAppQuitting();
    disconnectKernel();
  }

  private registerShellIPC(): void {
    desktopIpcRouter.handle('ui:open-control-center', async () => {
      this.openControlCenter();
    });

    desktopIpcRouter.handle('ui:update-presence-hit-region', async (_event, rects: PresenceHitRegionRect[]) => {
      this.surfaces.updatePresenceHitRegion(rects);
    });

    desktopIpcRouter.handle('ui:set-presence-interaction-policy', async (_event, policy: unknown) => {
      if (policy !== 'full-window' && policy !== 'alpha-shape' && policy !== 'transparent') return;
      this.surfaces.setPresenceInteractionPolicy(policy);
    });

    desktopIpcRouter.on('ui:begin-presence-drag', (_event, point?: PresenceDragPoint) => {
      this.surfaces.beginPresenceDrag(point);
    });

    desktopIpcRouter.on('ui:move-presence-window-to', (_event, point: PresenceDragPoint) => {
      this.surfaces.movePresenceWindowTo(point);
    });

    desktopIpcRouter.on('ui:end-presence-drag', () => {
      this.surfaces.endPresenceDrag();
    });

  }
}

export function createDesktopShell(): DesktopShell {
  return new DesktopShell();
}

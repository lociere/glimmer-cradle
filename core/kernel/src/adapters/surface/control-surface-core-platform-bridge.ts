import type { CorePlatformBridge, SkillConfirmationRequest } from '../../ports/skill-plane.port';

export interface CoreSkillSurfacePort {
  requestCoreSkillAction(action: string, args: unknown, invocationId?: string): Promise<unknown>;
  requestSkillConfirmation(request: SkillConfirmationRequest): Promise<boolean>;
}

export class ControlSurfaceCorePlatformBridge implements CorePlatformBridge {
  public constructor(private readonly surface: CoreSkillSurfacePort) {}

  public openUrl(url: string, invocationId?: string): Promise<unknown> {
    return this.surface.requestCoreSkillAction('desktop.open_url', { url }, invocationId);
  }

  public showNotification(title: string, body: string, invocationId?: string): Promise<unknown> {
    return this.surface.requestCoreSkillAction('notification.show', { title, body }, invocationId);
  }

  public readClipboardText(invocationId?: string): Promise<unknown> {
    return this.surface.requestCoreSkillAction('clipboard.read', {}, invocationId);
  }

  public writeClipboardText(text: string, invocationId?: string): Promise<unknown> {
    return this.surface.requestCoreSkillAction('clipboard.write', { text }, invocationId);
  }

  public requestConfirmation(request: SkillConfirmationRequest): Promise<boolean> {
    return this.surface.requestSkillConfirmation(request);
  }
}

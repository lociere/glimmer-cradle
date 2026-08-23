import { ControlSurfaceGateway } from '../../../capabilities/control-surface/control-surface-gateway';
import type { SkillConfirmationRequest } from '../../skill-invocation-gateway';

export interface CorePlatformBridge {
  openUrl(url: string, invocationId?: string): Promise<unknown>;
  showNotification(title: string, body: string, invocationId?: string): Promise<unknown>;
  readClipboardText(invocationId?: string): Promise<unknown>;
  writeClipboardText(text: string, invocationId?: string): Promise<unknown>;
  requestConfirmation(request: SkillConfirmationRequest): Promise<boolean>;
}

export class ControlSurfaceCorePlatformBridge implements CorePlatformBridge {
  public openUrl(url: string, invocationId?: string): Promise<unknown> {
    return ControlSurfaceGateway.instance.requestCoreSkillAction('desktop.open_url', { url }, invocationId);
  }

  public showNotification(title: string, body: string, invocationId?: string): Promise<unknown> {
    return ControlSurfaceGateway.instance.requestCoreSkillAction('notification.show', { title, body }, invocationId);
  }

  public readClipboardText(invocationId?: string): Promise<unknown> {
    return ControlSurfaceGateway.instance.requestCoreSkillAction('clipboard.read', {}, invocationId);
  }

  public writeClipboardText(text: string, invocationId?: string): Promise<unknown> {
    return ControlSurfaceGateway.instance.requestCoreSkillAction('clipboard.write', { text }, invocationId);
  }

  public requestConfirmation(request: SkillConfirmationRequest): Promise<boolean> {
    return ControlSurfaceGateway.instance.requestSkillConfirmation(request);
  }
}

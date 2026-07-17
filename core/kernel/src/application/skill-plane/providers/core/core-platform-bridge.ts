import { ControlSurfaceGateway } from '../../../capabilities/control-surface/control-surface-gateway';
import type { SkillConfirmationRequest } from '../../skill-invocation-gateway';

export interface CorePlatformBridge {
  openUrl(url: string): Promise<unknown>;
  showNotification(title: string, body: string): Promise<unknown>;
  readClipboardText(): Promise<unknown>;
  writeClipboardText(text: string): Promise<unknown>;
  requestConfirmation(request: SkillConfirmationRequest): Promise<boolean>;
}

export class ControlSurfaceCorePlatformBridge implements CorePlatformBridge {
  public openUrl(url: string): Promise<unknown> {
    return ControlSurfaceGateway.instance.requestCoreSkillAction('desktop.open_url', { url });
  }

  public showNotification(title: string, body: string): Promise<unknown> {
    return ControlSurfaceGateway.instance.requestCoreSkillAction('notification.show', { title, body });
  }

  public readClipboardText(): Promise<unknown> {
    return ControlSurfaceGateway.instance.requestCoreSkillAction('clipboard.read', {});
  }

  public writeClipboardText(text: string): Promise<unknown> {
    return ControlSurfaceGateway.instance.requestCoreSkillAction('clipboard.write', { text });
  }

  public requestConfirmation(request: SkillConfirmationRequest): Promise<boolean> {
    return ControlSurfaceGateway.instance.requestSkillConfirmation(request);
  }
}

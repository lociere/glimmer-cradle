import {
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';

type DesktopIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: any[]
) => any;

type DesktopIpcListener = (
  event: IpcMainEvent,
  ...args: any[]
) => void;

type DesktopIpcEvent = IpcMainEvent | IpcMainInvokeEvent;

export class DesktopIpcRouter {
  private readonly trustedWebContents = new Set<number>();

  public trustWindow(window: BrowserWindow): void {
    const webContentsId = window.webContents.id;
    this.trustedWebContents.add(webContentsId);
    window.once('closed', () => this.trustedWebContents.delete(webContentsId));
  }

  public handle(channel: string, handler: DesktopIpcHandler): void {
    ipcMain.handle(channel, (event, ...args) => {
      this.assertTrustedSender(channel, event);
      return handler(event, ...args);
    });
  }

  public on(channel: string, listener: DesktopIpcListener): void {
    ipcMain.on(channel, (event, ...args) => {
      if (!this.hasTrustedSender(event)) return;
      listener(event, ...args);
    });
  }

  private assertTrustedSender(channel: string, event: DesktopIpcEvent): void {
    if (!this.hasTrustedSender(event)) {
      throw new Error(`拒绝未受信任的 Desktop IPC: ${channel}`);
    }
  }

  private hasTrustedSender(event: DesktopIpcEvent): boolean {
    return this.isTrustedWebContents(event.sender) && event.senderFrame === event.sender.mainFrame;
  }

  private isTrustedWebContents(webContents: WebContents): boolean {
    if (!this.trustedWebContents.has(webContents.id)) return false;
    const owner = BrowserWindow.fromWebContents(webContents);
    return owner !== null && !owner.isDestroyed();
  }
}

export const desktopIpcRouter = new DesktopIpcRouter();

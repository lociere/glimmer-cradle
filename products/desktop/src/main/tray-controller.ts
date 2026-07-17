import { Menu, Tray } from 'electron';
import { getTrayIcon } from './icon-assets';

export interface TrayControllerActions {
  openControlCenter: () => void;
  hideControlCenter: () => void;
  quit: () => Promise<void>;
}

export class TrayController {
  private tray: Tray | null = null;

  constructor(private readonly actions: TrayControllerActions) {}

  start(): void {
    this.tray = new Tray(getTrayIcon());
    this.tray.setToolTip('Glimmer Cradle');
    this.tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: '打开管理面板',
        click: this.actions.openControlCenter,
      },
      { type: 'separator' },
      {
        label: '隐藏管理面板',
        click: this.actions.hideControlCenter,
      },
      { type: 'separator' },
      {
        label: '退出 Glimmer Cradle',
        click: () => {
          void this.actions.quit();
        },
      },
    ]));

    this.tray.on('click', this.actions.openControlCenter);
    this.tray.on('double-click', this.actions.openControlCenter);
  }
}

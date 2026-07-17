import { app, nativeImage } from 'electron';
import fs from 'fs';
import path from 'path';

const ICON_DIR = path.join('assets', 'icons');

function resolveIconPath(fileName: string): string {
  const candidates = [
    path.join(app.getAppPath(), ICON_DIR, fileName),
    path.join(process.cwd(), ICON_DIR, fileName),
    path.join(__dirname, '..', '..', ICON_DIR, fileName),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

export function getAppIconPath(): string {
  return resolveIconPath(process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png');
}

export function getTrayIcon(): Electron.NativeImage {
  const image = nativeImage.createFromPath(resolveIconPath('tray-icon.png'));
  return image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 });
}

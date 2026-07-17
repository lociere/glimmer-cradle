import { BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import type { SurfaceId } from './surface-registry';

const DEV_URL = process.env.GLIMMER_CRADLE_RENDERER_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';
const RETRY_DELAY_MS = 600;
const MAX_ATTEMPTS = 60;

const ENTRY_BY_SURFACE: Record<SurfaceId, string> = {
  presence: 'presence.html',
  controlCenter: 'control-center.html',
};

function surfaceDevURL(surface: SurfaceId): string {
  return `${DEV_URL}/${ENTRY_BY_SURFACE[surface]}`;
}

export class SurfaceLoader {
  private readonly isDev = process.env.VITE_DEV === '1';

  load(win: BrowserWindow, surface: SurfaceId, reveal: () => void): void {
    if (this.isDev) {
      this.loadDev(win, surface, reveal);
      return;
    }
    this.loadBuilt(win, surface, reveal);
  }

  private loadDev(win: BrowserWindow, surface: SurfaceId, reveal: () => void): void {
    let attempts = 0;
    let succeeded = false;
    let currentAttemptFailed = false;
    const url = surfaceDevURL(surface);

    const tryLoad = (): void => {
      if (succeeded || win.isDestroyed()) return;
      currentAttemptFailed = false;
      attempts += 1;
      win.loadURL(url).catch(() => {
        // did-fail-load drives retry scheduling.
      });
    };

    const onFail = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame || succeeded || win.isDestroyed()) return;
      if (validatedURL && !validatedURL.startsWith(DEV_URL)) return;

      currentAttemptFailed = true;
      if (attempts >= MAX_ATTEMPTS) {
        process.stderr.write(
          `[surface-loader] giving up loading ${url} after ${attempts} attempts: ${errorDescription} (${errorCode})\n`,
        );
        return;
      }
      setTimeout(tryLoad, RETRY_DELAY_MS);
    };

    const onFinish = (): void => {
      if (currentAttemptFailed || succeeded || win.isDestroyed()) return;
      succeeded = true;
      win.webContents.off('did-fail-load', onFail);
      win.webContents.off('did-finish-load', onFinish);
      reveal();
      process.stderr.write(
        attempts > 1
          ? `[surface-loader] ${surface} loaded after ${attempts} attempts\n`
          : `[surface-loader] ${surface} loaded\n`,
      );
    };

    win.webContents.on('did-fail-load', onFail);
    win.webContents.on('did-finish-load', onFinish);
    process.stderr.write(`[surface-loader] loading ${surface} from ${url}\n`);
    tryLoad();
  }

  private loadBuilt(win: BrowserWindow, surface: SurfaceId, reveal: () => void): void {
    const htmlPath = path.join(__dirname, '..', 'renderer', ENTRY_BY_SURFACE[surface]);
    if (!fs.existsSync(htmlPath)) {
      process.stderr.write(`[surface-loader] ${htmlPath} not found. Run pnpm run build first.\n`);
      return;
    }

    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) {
        reveal();
      }
    });
    win.loadFile(htmlPath).catch((error: Error) => {
      process.stderr.write(`[surface-loader] failed to load ${htmlPath}: ${error.message}\n`);
    });
  }
}

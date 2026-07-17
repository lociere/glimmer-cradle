import { BrowserWindow, screen } from 'electron';
import path from 'path';
import { getAppIconPath } from './icon-assets';
import { SurfaceLoader } from './surface-loader';

export type SurfaceId = 'presence' | 'controlCenter';
export type PresenceInteractionPolicy = 'full-window' | 'alpha-shape' | 'transparent';

type SurfaceCreatedHandler = (win: BrowserWindow, surface: SurfaceId) => void;

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

interface PresenceDragSession {
  startPointer: Electron.Point;
  startBounds: Electron.Rectangle;
}

interface AvatarAppearanceSettings {
  displayScale: number;
}

const PRESENCE_BASE_SIZE = { width: 360, height: 520 };
const PRESENCE_MIN_SIZE = { width: 180, height: 260 };
const PRESENCE_MAX_SIZE = { width: 900, height: 1300 };
const PRESENCE_MARGIN = 32;

export class SurfaceRegistry {
  private presenceWindow: BrowserWindow | null = null;
  private controlCenterWindow: BrowserWindow | null = null;
  private allowRealClose = false;
  private presenceInteractionPolicy: PresenceInteractionPolicy = 'full-window';
  private presenceHitRegionShape: Electron.Rectangle[] = [];
  private presenceHitRegionKey = '';
  private presenceDragging = false;
  private presenceDragSession: PresenceDragSession | null = null;
  private presenceDisplayScale = 1.2;
  private readonly surfaceDebug = isSurfaceDebugEnabled();

  constructor(
    private readonly loader: SurfaceLoader,
    private readonly onSurfaceCreated: SurfaceCreatedHandler,
  ) {}

  createPresence(): BrowserWindow {
    if (this.presenceWindow && !this.presenceWindow.isDestroyed()) {
      return this.presenceWindow;
    }

    const bounds = this.presenceBounds();
    const win = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      minWidth: PRESENCE_MIN_SIZE.width,
      minHeight: PRESENCE_MIN_SIZE.height,
      x: bounds.x,
      y: bounds.y,
      show: false,
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      acceptFirstMouse: true,
      backgroundColor: '#00000000',
      icon: getAppIconPath(),
      webPreferences: this.webPreferences(),
    });
    this.presenceWindow = win;
    this.secureWebContents(win);
    this.resetPresenceInputState();
    this.attachHideOnClose(win);
    win.on('closed', () => {
      this.presenceWindow = null;
      this.resetPresenceInputState();
    });
    // 桌面身体属于用户主动可见内容，不应阻止系统级截图与录屏。
    win.setContentProtection(false);
    this.onSurfaceCreated(win, 'presence');
    this.attachSurfaceDiagnostics(win, 'presence');
    this.loader.load(win, 'presence', () => this.showPresence());
    return win;
  }

  openControlCenter(): BrowserWindow {
    if (this.controlCenterWindow && !this.controlCenterWindow.isDestroyed()) {
      this.showControlCenter();
      return this.controlCenterWindow;
    }

    const workArea = screen.getPrimaryDisplay().workArea;
    const width = Math.min(workArea.width, Math.max(1120, Math.min(1440, Math.round(workArea.width * 0.84))));
    const height = Math.min(workArea.height, Math.max(680, Math.min(920, Math.round(workArea.height * 0.88))));
    const win = new BrowserWindow({
      width,
      height,
      minWidth: Math.min(1024, workArea.width),
      minHeight: Math.min(640, workArea.height),
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 2),
      show: false,
      transparent: false,
      backgroundColor: '#0d0f10',
      backgroundMaterial: 'mica',
      frame: false,
      // 窗口标题留空；产品标识仅在导航品牌区出现一次。
      title: '',
      hasShadow: true,
      resizable: true,
      maximizable: true,
      minimizable: true,
      skipTaskbar: false,
      alwaysOnTop: false,
      icon: getAppIconPath(),
      webPreferences: this.webPreferences(),
    });
    win.setContentProtection(false);

    this.controlCenterWindow = win;
    this.secureWebContents(win);
    this.attachHideOnClose(win);
    win.on('closed', () => {
      this.controlCenterWindow = null;
    });
    this.onSurfaceCreated(win, 'controlCenter');
    this.attachSurfaceDiagnostics(win, 'controlCenter');
    this.loader.load(win, 'controlCenter', () => this.showControlCenter());
    return win;
  }

  showPresence(): void {
    const win = this.presenceWindow;
    if (!win || win.isDestroyed()) return;

    win.setAlwaysOnTop(true);
    win.setIgnoreMouseEvents(false);
    if (win.isMinimized()) {
      win.restore();
    }
    win.showInactive();
    this.applyPresenceInteractionPolicy();
    this.writeSurfaceDebug(`show presence ${JSON.stringify(win.getBounds())} visible=${win.isVisible()}`);
  }

  hidePresence(): void {
    const win = this.presenceWindow;
    if (!win || win.isDestroyed()) return;
    win.hide();
  }

  togglePresence(): void {
    const win = this.presenceWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isVisible()) {
      win.hide();
    } else {
      this.showPresence();
    }
  }

  applyPresenceAppearance(appearance: AvatarAppearanceSettings): void {
    const displayScale = clamp(appearance.displayScale, 0.5, 2.5, 1.2);
    if (Math.abs(displayScale - this.presenceDisplayScale) < 0.001) {
      return;
    }

    this.presenceDisplayScale = displayScale;
    this.resizePresenceShell();
  }

  setPresenceInteractionPolicy(policy: PresenceInteractionPolicy): void {
    if (this.presenceInteractionPolicy === policy) return;
    this.presenceInteractionPolicy = policy;
    this.applyPresenceInteractionPolicy();
  }

  updatePresenceHitRegion(rects: PresenceHitRegionRect[]): void {
    const win = this.presenceWindow;
    if (!win || win.isDestroyed() || this.presenceInteractionPolicy !== 'alpha-shape') return;

    const shape = this.normalizePresenceHitRegion(rects);
    if (shape.length === 0) {
      this.writeSurfaceDebug('ignore empty presence hit region');
      return;
    }
    const shapeKey = this.presenceShapeKey(shape);
    if (shapeKey === this.presenceHitRegionKey) {
      return;
    }

    this.presenceHitRegionShape = shape;
    this.presenceHitRegionKey = shapeKey;
    if (!this.presenceDragging) {
      this.applyPresenceInteractionPolicy();
    }
  }

  beginPresenceDrag(point?: PresenceDragPoint): void {
    const win = this.presenceWindow;
    if (!win || win.isDestroyed() || this.presenceDragging) return;

    this.presenceDragging = true;
    this.presenceDragSession = point
      ? {
          startPointer: this.normalizePresencePointer(point),
          startBounds: win.getBounds(),
        }
      : null;

    win.setAlwaysOnTop(true);
    win.setIgnoreMouseEvents(false);
    this.clearPresenceShape();
  }

  movePresenceWindowTo(point: PresenceDragPoint): void {
    const win = this.presenceWindow;
    if (!win || win.isDestroyed()) return;
    if (!this.presenceDragging || !this.presenceDragSession) return;

    const pointer = this.normalizePresencePointer(point);
    const { startPointer, startBounds } = this.presenceDragSession;
    win.setPosition(
      Math.round(startBounds.x + pointer.x - startPointer.x),
      Math.round(startBounds.y + pointer.y - startPointer.y),
      false,
    );
  }

  endPresenceDrag(): void {
    const win = this.presenceWindow;
    if (!win || win.isDestroyed() || !this.presenceDragging) return;

    this.presenceDragging = false;
    this.presenceDragSession = null;
    this.applyPresenceInteractionPolicy();
  }

  showControlCenter(): void {
    const win = this.controlCenterWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) {
      win.restore();
    }
    win.setAlwaysOnTop(false);
    win.show();
    win.moveTop();
    win.focus();
  }

  hideControlCenter(): void {
    const win = this.controlCenterWindow;
    if (!win || win.isDestroyed()) return;
    win.hide();
  }

  getWindows(): BrowserWindow[] {
    return [this.presenceWindow, this.controlCenterWindow].filter(
      (win): win is BrowserWindow => !!win && !win.isDestroyed(),
    );
  }

  markAppQuitting(): void {
    this.allowRealClose = true;
  }

  private resetPresenceInputState(): void {
    this.presenceInteractionPolicy = 'full-window';
    this.presenceHitRegionShape = [];
    this.presenceHitRegionKey = '';
    this.presenceDragging = false;
    this.presenceDragSession = null;
  }

  private attachHideOnClose(win: BrowserWindow): void {
    win.on('close', (event) => {
      if (this.allowRealClose) return;
      event.preventDefault();
      win.hide();
    });
  }

  private attachSurfaceDiagnostics(win: BrowserWindow, surface: SurfaceId): void {
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (!this.surfaceDebug && level < 2) return;
      process.stderr.write(
        `[renderer:${surface}] console(${level}) ${message} (${sourceId}:${line})\n`,
      );
    });

    win.webContents.on('did-fail-load', (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    ) => {
      process.stderr.write(
        `[renderer:${surface}] did-fail-load main=${isMainFrame} code=${errorCode} `
        + `desc=${errorDescription} url=${validatedURL}\n`,
      );
    });

    win.webContents.on('render-process-gone', (_event, details) => {
      process.stderr.write(
        `[renderer:${surface}] render-process-gone ${JSON.stringify(details)}\n`,
      );
    });
  }

  private presenceBounds(displayScale = this.presenceDisplayScale): Electron.Rectangle {
    const workArea = screen.getPrimaryDisplay().workArea;
    const width = Math.round(clamp(
      PRESENCE_BASE_SIZE.width * displayScale,
      PRESENCE_MIN_SIZE.width,
      PRESENCE_MAX_SIZE.width,
      PRESENCE_BASE_SIZE.width,
    ));
    const height = Math.round(clamp(
      PRESENCE_BASE_SIZE.height * displayScale,
      PRESENCE_MIN_SIZE.height,
      PRESENCE_MAX_SIZE.height,
      PRESENCE_BASE_SIZE.height,
    ));
    return {
      width,
      height,
      x: Math.round(workArea.x + workArea.width - width - PRESENCE_MARGIN),
      y: Math.round(workArea.y + workArea.height - height - PRESENCE_MARGIN),
    };
  }

  private resizePresenceShell(): void {
    const win = this.presenceWindow;
    if (!win || win.isDestroyed()) return;

    const current = win.getBounds();
    const nextSize = this.presenceBounds(this.presenceDisplayScale);
    if (current.width === nextSize.width && current.height === nextSize.height) {
      return;
    }

    const display = screen.getDisplayMatching(current);
    const workArea = display.workArea;
    const right = current.x + current.width;
    const bottom = current.y + current.height;
    const nextBounds = {
      width: nextSize.width,
      height: nextSize.height,
      x: clamp(
        right - nextSize.width,
        workArea.x,
        workArea.x + workArea.width - nextSize.width,
        workArea.x + workArea.width - nextSize.width - PRESENCE_MARGIN,
      ),
      y: clamp(
        bottom - nextSize.height,
        workArea.y,
        workArea.y + workArea.height - nextSize.height,
        workArea.y + workArea.height - nextSize.height - PRESENCE_MARGIN,
      ),
    };

    this.presenceHitRegionShape = [];
    this.presenceHitRegionKey = '';

    try {
      win.setBounds({
        x: Math.round(nextBounds.x),
        y: Math.round(nextBounds.y),
        width: nextBounds.width,
        height: nextBounds.height,
      }, false);
      this.applyPresenceInteractionPolicy();
      this.writeSurfaceDebug(`resize presence shell ${JSON.stringify(win.getBounds())}`);
    } catch (error) {
      process.stderr.write(
        `[surface-registry] failed to resize presence shell ${String(error)}\n`,
      );
    }
  }

  private applyPresenceInteractionPolicy(): void {
    const win = this.presenceWindow;
    if (!win || win.isDestroyed()) return;

    try {
      if (this.presenceInteractionPolicy === 'transparent') {
        this.clearPresenceShape();
        win.setIgnoreMouseEvents(true, { forward: true });
        return;
      }

      if (this.presenceDragging || this.presenceInteractionPolicy === 'full-window') {
        this.clearPresenceShape();
        win.setIgnoreMouseEvents(false);
        return;
      }

      if (this.presenceHitRegionShape.length > 0) {
        win.setShape(this.presenceHitRegionShape);
        win.setIgnoreMouseEvents(false);
        return;
      }

      this.clearPresenceShape();
      win.setIgnoreMouseEvents(false);
    } catch (error) {
      process.stderr.write(
        `[surface-registry] failed to apply presence interaction policy ${String(error)}\n`,
      );
    }
  }

  private clearPresenceShape(): void {
    const win = this.presenceWindow;
    if (!win || win.isDestroyed()) return;
    try {
      win.setShape([]);
    } catch (error) {
      process.stderr.write(`[surface-registry] failed to clear presence shape ${String(error)}\n`);
    }
  }

  private normalizePresenceHitRegion(rects: PresenceHitRegionRect[]): Electron.Rectangle[] {
    const win = this.presenceWindow;
    if (!win || win.isDestroyed()) return [];

    const bounds = win.getBounds();
    return rects
      .filter((rect) => Number.isFinite(rect.x)
        && Number.isFinite(rect.y)
        && Number.isFinite(rect.width)
        && Number.isFinite(rect.height)
        && rect.width > 0
        && rect.height > 0)
      .slice(0, 700)
      .map((rect) => {
        const x = Math.max(0, Math.floor(rect.x));
        const y = Math.max(0, Math.floor(rect.y));
        const right = Math.min(bounds.width, Math.ceil(rect.x + rect.width));
        const bottom = Math.min(bounds.height, Math.ceil(rect.y + rect.height));
        return {
          x,
          y,
          width: Math.max(1, right - x),
          height: Math.max(1, bottom - y),
        };
      })
      .filter((rect) => rect.width > 0 && rect.height > 0);
  }

  private normalizePresencePointer(point: PresenceDragPoint): Electron.Point {
    const raw = {
      x: Number(point.screenX),
      y: Number(point.screenY),
    };
    if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) {
      return { x: 0, y: 0 };
    }

    if (this.isPointInsideDisplayBounds(raw)) {
      return raw;
    }

    const dpr = Number(point.devicePixelRatio);
    if (Number.isFinite(dpr) && dpr > 0) {
      const scaled = { x: raw.x / dpr, y: raw.y / dpr };
      if (this.isPointInsideDisplayBounds(scaled)) {
        return scaled;
      }
    }

    return raw;
  }

  private isPointInsideDisplayBounds(point: Electron.Point): boolean {
    return screen.getAllDisplays().some((display) => {
      const bounds = display.bounds;
      return point.x >= bounds.x
        && point.y >= bounds.y
        && point.x <= bounds.x + bounds.width
        && point.y <= bounds.y + bounds.height;
    });
  }

  private presenceShapeKey(shape: Electron.Rectangle[]): string {
    return shape
      .map((rect) => `${rect.x},${rect.y},${rect.width},${rect.height}`)
      .join(';');
  }

  private writeSurfaceDebug(message: string): void {
    if (!this.surfaceDebug) return;
    process.stderr.write(`[surface-registry] ${message}\n`);
  }

  private webPreferences(): Electron.BrowserWindowConstructorOptions['webPreferences'] {
    return {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    };
  }

  private secureWebContents(win: BrowserWindow): void {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-attach-webview', (event) => event.preventDefault());
    win.webContents.on('will-navigate', (event, targetUrl) => {
      const currentUrl = win.webContents.getURL();
      if (currentUrl && targetUrl !== currentUrl) {
        event.preventDefault();
      }
    });
  }
}

function isSurfaceDebugEnabled(): boolean {
  const value = process.env.GLIMMER_CRADLE_SURFACE_DEBUG?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

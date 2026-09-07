import type { ExtensionInstallPrepareRequest, ExtensionInstallPreview, ExtensionInstallResult, ExtensionLifecycleRequest, ExtensionLifecycleResult, ExtensionRuntimeProjectionResult, ExtensionUninstallResult } from '../../../shared/control-center-models';
import type { LocalExtensionUploadResult, SurfaceFrame } from '../../shared/api/personal-server-client';

export interface ExtensionsPort {
  read(): Promise<ExtensionRuntimeProjectionResult>;
  prepare(request: ExtensionInstallPrepareRequest): Promise<ExtensionInstallPreview>;
  commit(preview: ExtensionInstallPreview): Promise<ExtensionInstallResult>;
  cancel(transactionId: string): Promise<ExtensionInstallResult>;
  lifecycle(id: string, operation: ExtensionLifecycleRequest['operation'], version?: string): Promise<ExtensionLifecycleResult>;
  uninstall(id: string, version: string): Promise<ExtensionUninstallResult>;
  upload(file: File): Promise<LocalExtensionUploadResult>;
}
export interface ExtensionsSnapshot {
  connected: boolean;
  loading: boolean;
  initialized: boolean;
  catalog: ExtensionRuntimeProjectionResult | null;
  preview: ExtensionInstallPreview | null;
  upload: LocalExtensionUploadResult | null;
  busy: boolean;
  error: string;
  readError: string;
  message: string;
}
const initial = (): ExtensionsSnapshot => ({ connected: false, loading: false, initialized: false, catalog: null, preview: null, upload: null, busy: false, error: '', readError: '', message: '' });

export class ExtensionsController {
  private snapshot = initial();
  private readonly listeners = new Set<() => void>();
  private port: ExtensionsPort | null = null;
  private epoch = 0;
  private reading = false;
  private queued = false;
  private committing = false;
  public readonly getSnapshot = (): ExtensionsSnapshot => this.snapshot;
  public readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  public connect(port: ExtensionsPort | null): void {
    this.releasePreview();
    this.epoch++;
    this.port = port;
    this.reading = false; this.queued = false; this.committing = false;
    this.patch({ connected: Boolean(port), loading: false, busy: false, preview: null, upload: null });
    if (port) void this.reload();
  }
  public stop(): void { this.connect(null); this.snapshot = initial(); }
  public handleFrame(frame: SurfaceFrame): void {
    if (frame.kind === 'extension_runtime_projection_changed') void this.reload();
  }
  public async reload(): Promise<void> {
    const port = this.port;
    if (!port) return;
    if (this.reading) { this.queued = true; return; }
    this.reading = true;
    const epoch = this.epoch;
    this.patch({ loading: true });
    try {
      const catalog = await port.read();
      if (epoch !== this.epoch) return;
      if (catalog.status !== 'success') throw new Error(catalog.message || '扩展目录暂时不可读。');
      this.patch({ catalog, initialized: true, readError: '' });
    } catch (error) {
      if (epoch === this.epoch) this.patch({ readError: describe(error) });
    } finally {
      if (epoch === this.epoch) {
        this.reading = false; this.patch({ loading: false });
        if (this.queued) { this.queued = false; void this.reload(); }
      }
    }
  }
  public async prepare(request: ExtensionInstallPrepareRequest): Promise<void> {
    if (this.snapshot.preview) return;
    await this.run(async (port, epoch) => {
      const preview = await port.prepare(request);
      // A late prepare still owns a server transaction and must release it on its original connection.
      if (epoch !== this.epoch) { if (preview.transaction_id) this.cancelReleased(port, preview.transaction_id); return; }
      this.patch({ preview, upload: null });
      if (preview.status !== 'ready') throw new Error(preview.message || '安装预览失败。');
      this.patch({ message: preview.message || '请核对版本、权限与来源后确认安装。' });
    });
  }
  public async upload(file: File): Promise<void> {
    if (this.snapshot.preview) return;
    await this.run(async (port, epoch) => {
      this.patch({ upload: null });
      const upload = await port.upload(file);
      if (epoch === this.epoch) this.patch({ upload, message: `已上传 ${upload.file_name}` });
    });
  }
  public async commit(): Promise<void> {
    const preview = this.snapshot.preview;
    if (preview?.status !== 'ready' || !preview.transaction_id) return;
    await this.run(async (port, epoch) => {
      this.committing = true;
      try {
        const result = await port.commit(preview);
        if (epoch !== this.epoch) return;
        // Every result consumes the Host transaction; only a transport failure remains uncertain.
        this.patch({ preview: null });
        if (result.status === 'error') throw new Error(result.message || '扩展安装失败。');
        this.patch({ preview: null, message: result.message || '安装事务已完成。' });
        await this.reload();
      } finally { if (epoch === this.epoch) this.committing = false; }
    });
  }
  public async cancel(): Promise<void> {
    const preview = this.snapshot.preview;
    if (!preview?.transaction_id) { if (!this.snapshot.busy) this.patch({ preview: null }); return; }
    await this.run(async (port, epoch) => {
      const result = await port.cancel(preview.transaction_id!);
      if (epoch !== this.epoch) return;
      this.patch({ preview: null });
      if (result.status === 'error') throw new Error(result.message || '取消失败，请重试。');
      this.patch({ preview: null, message: '安装预览已取消。' });
    });
  }
  public async lifecycle(id: string, operation: ExtensionLifecycleRequest['operation'], version?: string): Promise<void> {
    await this.run(async (port, epoch) => {
      const result = await port.lifecycle(id, operation, version);
      if (epoch !== this.epoch) return;
      if (result.status !== 'success') throw new Error(result.message || '扩展操作失败。');
      this.patch({ message: result.message || '扩展操作已完成。' }); await this.reload();
    });
  }
  public async uninstall(id: string, version: string): Promise<void> {
    await this.run(async (port, epoch) => {
      const result = await port.uninstall(id, version);
      if (epoch !== this.epoch) return;
      if (result.status !== 'success') throw new Error(result.message || '卸载失败。');
      this.patch({ message: result.message || '版本已卸载。' }); await this.reload();
    });
  }
  private async run(action: (port: ExtensionsPort, epoch: number) => Promise<void>): Promise<void> {
    const port = this.port;
    if (!port || this.snapshot.busy) return;
    const epoch = this.epoch;
    this.patch({ busy: true, error: '', message: '正在处理扩展操作…' });
    try { await action(port, epoch); }
    catch (error) { if (epoch === this.epoch) this.patch({ error: describe(error), message: '' }); }
    finally { if (epoch === this.epoch) this.patch({ busy: false }); }
  }
  private releasePreview(): void {
    const id = this.snapshot.preview?.transaction_id;
    if (id && this.port && !this.committing) this.cancelReleased(this.port, id);
  }
  private cancelReleased(port: ExtensionsPort, id: string): void {
    // Disconnected ports may throw before returning a Promise; Host cleanup owns that fallback.
    void Promise.resolve().then(() => port.cancel(id)).catch(() => undefined);
  }
  private patch(patch: Partial<ExtensionsSnapshot>): void { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
}
function describe(error: unknown): string { return error instanceof Error ? error.message : String(error); }

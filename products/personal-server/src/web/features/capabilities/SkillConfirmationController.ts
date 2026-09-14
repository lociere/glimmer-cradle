import type { SurfaceFrame } from '../../shared/api/personal-server-client';

export type PendingSkillConfirmation = {
  readonly requestId: string;
  readonly confirmation: NonNullable<SurfaceFrame['confirmation']>;
};

/** 确认绑定收到请求时的连接；断线或超时后旧 UI 不得批准新会话动作。 */
export class SkillConfirmationController {
  private pending: PendingSkillConfirmation | null = null;
  private respond: ((approved: boolean) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();

  public constructor(private readonly timeoutMs = 25_000) {}

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  public readonly getSnapshot = (): PendingSkillConfirmation | null => this.pending;

  public receive(frame: SurfaceFrame, respond: (approved: boolean) => void): void {
    if (!frame.request_id || !frame.confirmation) return;
    if (this.pending?.requestId === frame.request_id) return;
    if (this.pending) { respond(false); return; }
    this.pending = { requestId: frame.request_id, confirmation: frame.confirmation };
    this.respond = respond;
    this.timer = setTimeout(() => this.answer(frame.request_id!, false), this.timeoutMs);
    this.emit();
  }

  public answer(requestId: string, approved: boolean): void {
    if (this.pending?.requestId !== requestId) return;
    const respond = this.respond;
    this.clear();
    respond?.(approved);
  }

  public clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.respond = null;
    this.emit();
  }

  private emit(): void { for (const listener of this.listeners) listener(); }
}

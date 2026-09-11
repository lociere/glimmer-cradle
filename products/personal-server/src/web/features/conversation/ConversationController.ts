import type { ConversationHistoryEntry, ConversationHistoryRequest, ConversationHistoryResult } from '../../../shared/control-center-models';
import type { SurfaceFrame } from '../../shared/api/personal-server-client';
import { createRequestId } from '../../shared/request-id';

export interface ConversationEntry {
  readonly id: string;
  readonly role: ConversationHistoryEntry['role'];
  readonly text: string;
  readonly title?: string;
  readonly time: string;
  readonly position?: number;
  readonly traceId?: string;
  readonly interactionId?: string;
  readonly sourceKind?: ConversationHistoryEntry['source_kind'];
  readonly status: ConversationHistoryEntry['status'];
  readonly local?: boolean;
  readonly actionRoute?: string;
  readonly actionLabel?: string;
}

export interface ConversationSnapshot {
  readonly entries: readonly ConversationEntry[];
  readonly connected: boolean;
  readonly loading: boolean;
  readonly loadingOlder: boolean;
  readonly initialized: boolean;
  readonly nextCursor: string | null;
  readonly error: string;
  readonly sendError: string;
}

export interface ConversationPort {
  read(request: ConversationHistoryRequest, signal: AbortSignal): Promise<ConversationHistoryResult>;
  send(text: string, traceId: string): void;
}

const initial: ConversationSnapshot = { entries: [], connected: false, loading: false, loadingOlder: false, initialized: false, nextCursor: null, error: '', sendError: '' };

export class ConversationController {
  private snapshot: ConversationSnapshot = initial;
  private readonly listeners = new Set<() => void>();
  private active = false;
  private latest: AbortController | null = null;
  private older: AbortController | null = null;
  private paged = false;
  private reloadQueued = false;

  public constructor(private readonly port: ConversationPort) {}
  public readonly getSnapshot = (): ConversationSnapshot => this.snapshot;
  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  public start(): void { this.active = true; }
  public stop(): void {
    this.active = false;
    this.cancelReads();
    this.snapshot = initial;
    this.paged = false;
  }

  public setConnected(connected: boolean): void {
    if (!this.active || connected === this.snapshot.connected) return;
    if (!connected) {
      this.cancelReads();
      this.patch({ connected, loading: false, loadingOlder: false, entries: this.snapshot.entries.map((entry) =>
        entry.role === 'user' && isPending(entry) ? { ...entry, status: 'failed' } : entry),
      });
    } else {
      this.patch({ connected });
      void this.refresh();
    }
  }

  public async refresh(): Promise<void> {
    if (!this.active || !this.snapshot.connected) return;
    if (this.latest) { this.reloadQueued = true; return; }
    // 最新页刷新使旧游标请求失效；保留已经加载的历史，不让旧响应覆盖新状态。
    this.older?.abort();
    this.older = null;
    const abort = new AbortController();
    this.latest = abort;
    this.patch({ loading: true, loadingOlder: false, error: '' });
    try {
      const result = await this.port.read({ request_id: requestId('history'), limit: 50 }, abort.signal);
      if (!this.active || abort.signal.aborted) return;
      if (result.status !== 'success') throw new Error(result.message || '历史读取失败。');
      this.patch({ entries: mergeEntries(this.snapshot.entries, result.items), initialized: true,
        nextCursor: this.paged ? this.snapshot.nextCursor : result.has_more ? result.next_cursor ?? null : null,
      });
    } catch (error) {
      if (this.active && !abort.signal.aborted) this.patch({ error: describeError(error) });
    } finally {
      if (this.latest === abort) {
        this.latest = null;
        if (this.active && !abort.signal.aborted) {
          this.patch({ loading: false });
          if (this.reloadQueued) { this.reloadQueued = false; void this.refresh(); }
        }
      }
    }
  }

  public async loadOlder(): Promise<void> {
    if (!this.active || !this.snapshot.connected || !this.snapshot.nextCursor || this.latest || this.older) return;
    const abort = new AbortController();
    this.older = abort;
    this.patch({ loadingOlder: true, error: '' });
    try {
      const result = await this.port.read({ request_id: requestId('older'), limit: 50, cursor: this.snapshot.nextCursor ?? undefined }, abort.signal);
      if (!this.active || abort.signal.aborted) return;
      if (result.status !== 'success') throw new Error(result.message || '更早历史读取失败。');
      this.paged = true;
      this.patch({ entries: mergeEntries(this.snapshot.entries, result.items), nextCursor: result.has_more ? result.next_cursor ?? null : null });
    } catch (error) {
      if (this.active && !abort.signal.aborted) this.patch({ error: describeError(error) });
    } finally {
      if (this.older === abort) {
        this.older = null;
        if (this.active && !abort.signal.aborted) this.patch({ loadingOlder: false });
      }
    }
  }

  public send(text: string, retryId?: string): boolean {
    const trimmed = text.trim();
    if (!this.active || !this.snapshot.connected || !trimmed || trimmed.length > 8000 || this.snapshot.entries.some(isPending)) return false;
    const traceId = requestId('chat');
    const entry: ConversationEntry = { id: `local:${traceId}`, role: 'user', text: trimmed, time: new Date().toISOString(), traceId, interactionId: traceId, sourceKind: 'transient', status: 'pending', local: true };
    // 发送前同步登记 pending，连续点击与迟到刷新都不能丢掉本次发送状态。
    this.patch({ entries: [...this.snapshot.entries, entry], sendError: '' });
    try {
      this.port.send(trimmed, traceId);
      if (retryId) this.patch({ entries: this.snapshot.entries.filter((item) => item.id !== retryId || !item.local) });
      return true;
    } catch (error) {
      this.patch({ entries: this.snapshot.entries.filter((item) => item.id !== entry.id), sendError: describeError(error) });
      return false;
    }
  }

  public retry(id: string): void {
    const entry = this.snapshot.entries.find((item) => item.id === id);
    if (entry?.role === 'user' && entry.status === 'failed') this.send(entry.text, id);
  }

  public handleFrame(frame: SurfaceFrame): void {
    if (!this.active || !this.snapshot.connected) return;
    if (frame.kind === 'thought' && frame.trace_id) {
      this.updateStatus(frame.trace_id, frame.thought?.active ? 'thinking' : 'pending');
    } else if (frame.kind === 'reply') {
      if (frame.trace_id) this.updateStatus(frame.trace_id, 'committed');
      void this.refresh();
    } else if (frame.kind === 'conversation_notice' && frame.conversation_notice) {
      const notice = frame.conversation_notice;
      if (frame.trace_id && notice.level === 'error') this.updateStatus(frame.trace_id, 'failed');
      const id = `notice:${frame.trace_id ?? ''}:${notice.code}`;
      this.patch({ entries: [...this.snapshot.entries.filter((entry) => entry.id !== id), {
        id, role: 'system', text: notice.message, title: notice.title, time: new Date().toISOString(), traceId: frame.trace_id,
        status: 'notice', local: true, actionRoute: notice.action_route, actionLabel: notice.action_label,
      }] });
      void this.refresh();
    }
  }

  private updateStatus(traceId: string, status: ConversationEntry['status']): void {
    this.patch({ entries: this.snapshot.entries.map((entry) => entry.role === 'user' && entry.traceId === traceId && isPending(entry) ? { ...entry, status } : entry) });
  }
  private cancelReads(): void {
    this.latest?.abort(); this.older?.abort();
    this.latest = null; this.older = null; this.reloadQueued = false;
  }
  private patch(patch: Partial<ConversationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export function isPending(entry: ConversationEntry): boolean { return entry.role === 'user' && (entry.status === 'pending' || entry.status === 'thinking'); }

function mergeEntries(current: readonly ConversationEntry[], incoming: readonly ConversationHistoryEntry[]): ConversationEntry[] {
  const mapped = incoming.map((entry): ConversationEntry => ({ id: entry.entry_id, role: entry.role, text: entry.text, title: entry.title,
    time: entry.occurred_at, position: entry.position, traceId: entry.trace_id, interactionId: entry.interaction_id, sourceKind: entry.source_kind, status: entry.status }));
  const entries = new Map(current.filter((entry) => !mapped.some((item) => {
    const identity = entry.interactionId || entry.traceId;
    if (!identity || identity !== (item.interactionId || item.traceId) || item.role !== entry.role) return false;
    if (entry.role === 'system') return entry.local && entry.title === item.title && entry.text === item.text;
    return entry.local || (entry.sourceKind === 'transient' && item.sourceKind !== 'transient');
  })).map((entry) => [entry.id, entry]));
  for (const entry of mapped) entries.set(entry.id, entry);
  return [...entries.values()].sort((left, right) => {
    if (left.position != null && right.position != null) return left.position - right.position;
    return (Date.parse(left.time) || 0) - (Date.parse(right.time) || 0) || left.id.localeCompare(right.id);
  });
}
function requestId(prefix: string): string { return createRequestId(prefix); }
function describeError(error: unknown): string { return error instanceof Error ? error.message : '无法完成请求，请重试。'; }

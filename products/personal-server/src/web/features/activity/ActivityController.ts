import type { ObservabilityLogEntry, ObservabilityLogQuery } from '../../shared/api/personal-server-client';

export interface ActivityPort {
  read(query: ObservabilityLogQuery, signal: AbortSignal): Promise<readonly ObservabilityLogEntry[]>;
  stream(query: ObservabilityLogQuery, handlers: { onEntry(entry: ObservabilityLogEntry): void; onOpen(): void; onError(): void }): { close(): void };
}
export interface ActivitySnapshot {
  entries: readonly ObservabilityLogEntry[];
  buffered: readonly ObservabilityLogEntry[];
  dropped: number;
  query: ObservabilityLogQuery;
  paused: boolean;
  loading: boolean;
  initialized: boolean;
  connection: 'idle' | 'connecting' | 'live' | 'retrying';
  error: string;
}
const initial = (): ActivitySnapshot => ({ entries: [], buffered: [], dropped: 0, query: { limit: 200 }, paused: false, loading: false, initialized: false, connection: 'idle', error: '' });
const capacity = 200;

export class ActivityController {
  private snapshot = initial();
  private listeners = new Set<() => void>();
  private running = false;
  private epoch = 0;
  private abort: AbortController | null = null;
  private stream: { close(): void } | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  public constructor(private readonly port: ActivityPort, private readonly retryDelay = 1500) {}
  public readonly getSnapshot = (): ActivitySnapshot => this.snapshot;
  public readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  public start(): void { if (this.running) return; this.running = true; void this.refresh(); }
  public stop(): void { this.running = false; this.dispose(); }
  public async refresh(query = this.snapshot.query, recovering = false): Promise<void> {
    if (!this.running) return;
    this.dispose();
    const epoch = this.epoch;
    const abort = new AbortController(); this.abort = abort;
    const selected = { ...query, limit: capacity };
    this.patch({ query: selected, loading: true, connection: 'connecting', error: '', ...(recovering ? {} : { entries: [], buffered: [], dropped: 0, initialized: false }) });
    try {
      const entries = await this.port.read(selected, abort.signal);
      if (!this.current(epoch)) return;
      if (recovering && this.snapshot.paused) {
        this.buffer(entries.filter((entry) => !this.snapshot.entries.some((shown) => shown.id === entry.id)));
      } else this.patch({ entries: merge(entries), buffered: [], dropped: 0 });
      this.patch({ loading: false, initialized: true });
      this.stream = this.port.stream(selected, {
        onOpen: () => { if (this.current(epoch)) this.patch({ connection: 'live', error: '' }); },
        onEntry: (entry) => { if (this.current(epoch)) { if (this.snapshot.paused) this.buffer([entry]); else this.patch({ entries: merge([entry, ...this.snapshot.entries]) }); } },
        onError: () => { if (this.current(epoch)) this.scheduleRetry(); },
      });
    } catch (error) {
      if (this.current(epoch)) {
        this.patch({ loading: false, connection: 'idle', error: error instanceof Error ? error.message : String(error) });
        this.scheduleRetry();
      }
    }
  }
  public setPaused(paused: boolean): void {
    this.patch(paused ? { paused } : { paused, entries: merge([...this.snapshot.buffered, ...this.snapshot.entries]), buffered: [], dropped: 0 });
  }
  private buffer(entries: readonly ObservabilityLogEntry[]): void {
    const combined = [...new Map([...entries, ...this.snapshot.buffered].map((entry) => [entry.id, entry])).values()];
    this.patch({ buffered: combined.slice(0, capacity), dropped: this.snapshot.dropped + Math.max(0, combined.length - capacity) });
  }
  private scheduleRetry(): void {
    this.dispose();
    this.patch({ connection: 'retrying', loading: false, error: this.snapshot.error || '日志连接已断开，正在重试。' });
    this.retry = setTimeout(() => { this.retry = null; void this.refresh(this.snapshot.query, true); }, this.retryDelay);
  }
  private current(epoch: number): boolean { return this.running && this.epoch === epoch; }
  private dispose(): void {
    this.epoch++; this.abort?.abort(); this.abort = null;
    this.stream?.close(); this.stream = null;
    if (this.retry) clearTimeout(this.retry); this.retry = null;
  }
  private patch(patch: Partial<ActivitySnapshot>): void { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
}
function merge(entries: readonly ObservabilityLogEntry[]): ObservabilityLogEntry[] {
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id)).slice(0, capacity);
}

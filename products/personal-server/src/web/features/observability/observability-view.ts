import {
  PersonalServerLogStream,
  type ObservabilityLogEntry,
  type ObservabilityLogQuery,
} from '../../shared/api/personal-server-client';

export interface ObservabilityViewOptions {
  readonly listRecent: (query: ObservabilityLogQuery) => Promise<ReadonlyArray<ObservabilityLogEntry>>;
  readonly connectStream: (
    query: ObservabilityLogQuery,
    handlers: {
      readonly onEntry: (entry: ObservabilityLogEntry) => void;
      readonly onError: () => void;
    },
  ) => PersonalServerLogStream;
}

export class ObservabilityView {
  private entries: ObservabilityLogEntry[] = [];
  private buffered: ObservabilityLogEntry[] = [];
  private query: ObservabilityLogQuery = { limit: 200 };
  private paused = false;
  private rawMode = false;
  private autoScroll = true;
  private statusText = '准备连接日志流…';
  private loading = false;
  private stream: PersonalServerLogStream | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private mounted = false;

  public constructor(private readonly root: HTMLElement, private readonly options: ObservabilityViewOptions) {}

  public start(): void {
    if (!this.mounted) {
      this.renderShell();
      this.mounted = true;
    }
    void this.refresh();
  }

  public stop(): void {
    this.clearRetry();
    this.stream?.close();
    this.stream = null;
  }

  private async refresh(): Promise<void> {
    this.loading = true;
    this.statusText = '正在读取最近事件…';
    this.renderStatus();
    this.stream?.close();
    this.stream = null;

    try {
      this.entries = [...await this.options.listRecent(this.query)];
      this.buffered = [];
      this.loading = false;
      this.statusText = `已载入 ${this.entries.length} 条事件，正在持续观察。`;
      this.renderEntries();
      this.renderStatus();
      this.openStream();
    } catch (error) {
      this.loading = false;
      this.statusText = error instanceof Error ? error.message : String(error);
      this.renderStatus();
    }
  }

  private openStream(): void {
    this.stream = this.options.connectStream(this.query, {
      onEntry: (entry) => this.handleEntry(entry),
      onError: () => {
        this.statusText = '日志流暂时断开，正在重连…';
        this.renderStatus();
        this.stream?.close();
        this.stream = null;
        this.clearRetry();
        this.retryTimer = setTimeout(() => void this.refresh(), 1500);
      },
    });
  }

  private handleEntry(entry: ObservabilityLogEntry): void {
    if (this.paused) {
      this.buffered.unshift(entry);
      this.statusText = `已暂停，缓冲 ${this.buffered.length} 条新事件。`;
      this.renderStatus();
      return;
    }

    this.entries.unshift(entry);
    this.entries = this.entries.slice(0, this.query.limit ?? 200);
    this.statusText = `正在观察日志流，共显示 ${this.entries.length} 条事件。`;
    this.renderEntries();
    this.renderStatus();
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <header class="workspace-head">
        <div><span>日志</span><h1>结构化事件流</h1></div>
        <div class="observability-actions">
          <button class="quiet-button" type="button" data-action="refresh">刷新</button>
          <button class="quiet-button" type="button" data-action="export">导出当前结果</button>
        </div>
      </header>
      <div class="observability-scroll">
        <section class="observability-toolbar">
          <label class="field">
            <span>级别</span>
            <select data-field="level">
              <option value="">全部</option>
              <option value="error">error</option>
              <option value="warn">warn</option>
              <option value="info">info</option>
              <option value="debug">debug</option>
            </select>
          </label>
          <label class="field">
            <span>模块</span>
            <input type="text" data-field="module" placeholder="config-owner">
          </label>
          <label class="field">
            <span>trace_id</span>
            <input type="text" data-field="trace-id" placeholder="trace-...">
          </label>
          <div class="observability-toggles">
            <label class="toggle-line"><input type="checkbox" data-field="pause">暂停</label>
            <label class="toggle-line"><input type="checkbox" data-field="raw-mode">原始</label>
            <label class="toggle-line"><input type="checkbox" data-field="auto-scroll" checked>自动滚动</label>
          </div>
          <button class="primary-button" type="button" data-action="apply">应用筛选</button>
        </section>
        <section class="observability-status" data-role="status-line"></section>
        <section class="observability-log-list" data-role="log-list"></section>
      </div>
    `;

    this.root.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
      void this.refresh();
    });
    this.root.querySelector('[data-action="apply"]')?.addEventListener('click', () => {
      const level = this.querySelector<HTMLSelectElement>('[data-field="level"]').value;
      const module = this.querySelector<HTMLInputElement>('[data-field="module"]').value.trim();
      const trace_id = this.querySelector<HTMLInputElement>('[data-field="trace-id"]').value.trim();
      this.query = { ...this.query, level, module, trace_id };
      void this.refresh();
    });
    this.root.querySelector('[data-field="pause"]')?.addEventListener('change', (event) => {
      this.paused = (event.currentTarget as HTMLInputElement).checked;
      if (!this.paused && this.buffered.length > 0) {
        this.entries = [...this.buffered, ...this.entries].slice(0, this.query.limit ?? 200);
        this.buffered = [];
        this.renderEntries();
      }
      this.statusText = this.paused ? '日志流已暂停。' : `正在观察日志流，共显示 ${this.entries.length} 条事件。`;
      this.renderStatus();
    });
    this.root.querySelector('[data-field="raw-mode"]')?.addEventListener('change', (event) => {
      this.rawMode = (event.currentTarget as HTMLInputElement).checked;
      this.renderEntries();
    });
    this.root.querySelector('[data-field="auto-scroll"]')?.addEventListener('change', (event) => {
      this.autoScroll = (event.currentTarget as HTMLInputElement).checked;
    });
    this.root.querySelector('[data-action="export"]')?.addEventListener('click', () => {
      const blob = new Blob([this.entries.map((entry) => entry.raw).join('\n')], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `personal-server-observability-${Date.now()}.ndjson`;
      anchor.click();
      URL.revokeObjectURL(url);
    });

    this.renderStatus();
    this.renderEntries();
  }

  private renderStatus(): void {
    const element = this.querySelector<HTMLElement>('[data-role="status-line"]');
    element.textContent = this.loading ? '正在加载…' : this.statusText;
  }

  private renderEntries(): void {
    const list = this.querySelector<HTMLElement>('[data-role="log-list"]');
    if (this.entries.length === 0) {
      list.innerHTML = '<div class="status-empty"><strong>暂无日志结果</strong><p>调整筛选条件后仍为空时，说明当前控制面还没有匹配的结构化事件。</p></div>';
      return;
    }

    list.innerHTML = this.entries.map((entry) => `
      <article class="observability-row level-${entry.level}">
        <div class="observability-row-head">
          <strong>${escapeHtml(entry.module)}</strong>
          <span>${escapeHtml(entry.level)} · ${escapeHtml(entry.source)} · ${escapeHtml(new Date(entry.timestamp).toLocaleTimeString())}</span>
        </div>
        <p>${escapeHtml(entry.message)}</p>
        <div class="observability-row-meta">
          <span>${escapeHtml(entry.event_type)}</span>
          <span>${escapeHtml(entry.trace_id || 'no-trace')}</span>
          <span>${escapeHtml(entry.summary || entry.runtime_id)}</span>
        </div>
        ${this.rawMode ? `<pre>${escapeHtml(entry.raw)}</pre>` : ''}
      </article>
    `).join('');

    if (this.autoScroll) {
      list.scrollTop = 0;
    }
  }

  private querySelector<TElement extends Element>(selector: string): TElement {
    const element = this.root.querySelector<TElement>(selector);
    if (!element) throw new Error(`missing observability element: ${selector}`);
    return element;
  }

  private clearRetry(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

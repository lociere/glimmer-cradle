import type {
  ConversationHistoryEntry,
  ConversationHistoryRequest,
  ConversationHistoryResult,
} from '@glimmer-cradle/protocol';
import type { PersonalServerSurface, SurfaceFrame } from '../../shared/api/personal-server-client';

interface ConversationItem {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly sourceKind: 'conversation' | 'notice' | 'transient';
  text: string;
  title?: string;
  occurredAt: string;
  position?: number;
  traceId?: string;
  status: 'committed' | 'pending' | 'thinking' | 'failed' | 'notice';
}

export class ConversationView {
  private entries: ConversationItem[] = [];
  private nextCursor: string | null = null;
  private loading = false;
  private loadingOlder = false;
  private connected = false;
  private lastError = '';
  private requestSequence = 0;
  private readonly emptyState: HTMLElement;

  public constructor(
    private readonly root: HTMLElement,
    private readonly options: {
      readonly getSurface: () => PersonalServerSurface | null;
    },
  ) {
    this.renderSkeleton();
    this.emptyState = this.query<HTMLElement>('[data-role="empty-state"]');
    this.root.addEventListener('submit', (event) => {
      const form = event.target;
      if (form instanceof HTMLFormElement && form.dataset.role === 'composer-form') {
        event.preventDefault();
        void this.handleSubmit();
      }
    });
    this.root.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.action === 'load-older') {
        void this.loadOlder();
        return;
      }
      if (target.dataset.action === 'retry') {
        const entryId = target.dataset.entryId;
        if (entryId) void this.retryEntry(entryId);
      }
    });
  }

  public async handleSurfaceOpen(): Promise<void> {
    this.connected = true;
    this.lastError = '';
    await this.reloadLatest();
  }

  public handleSurfaceClose(): void {
    this.connected = false;
    let changed = false;
    for (const entry of this.entries) {
      if (entry.role === 'user' && (entry.status === 'pending' || entry.status === 'thinking')) {
        entry.status = 'failed';
        changed = true;
      }
    }
    if (changed) {
      this.entries.push({
        id: `disconnect:${Date.now()}`,
        role: 'system',
        sourceKind: 'notice',
        text: '有未完成的对话请求在连接断开时中止。恢复连接后可以重试。',
        title: '连接已断开',
        occurredAt: new Date().toISOString(),
        status: 'notice',
      });
    }
    this.render();
  }

  public handleFrame(frame: SurfaceFrame): void {
    if (frame.kind === 'thought' && frame.trace_id) {
      const active = frame.thought?.active === true;
      this.updateUserStatus(frame.trace_id, active ? 'thinking' : 'pending');
      this.render();
      return;
    }
    if (frame.kind === 'reply') {
      if (frame.trace_id) {
        this.updateUserStatus(frame.trace_id, 'committed');
      }
      void this.reloadLatest();
      return;
    }
    if (frame.kind === 'conversation_notice') {
      if (frame.trace_id && frame.conversation_notice?.level === 'error') {
        this.updateUserStatus(frame.trace_id, 'failed');
      }
      if (frame.conversation_notice) {
        this.upsertNotice(frame.trace_id, frame.conversation_notice);
        this.render();
      }
      void this.reloadLatest();
      return;
    }
  }

  public reset(): void {
    this.entries = [];
    this.nextCursor = null;
    this.loading = false;
    this.loadingOlder = false;
    this.connected = false;
    this.lastError = '';
    this.render();
  }

  private async handleSubmit(): Promise<void> {
    const surface = this.options.getSurface();
    const input = this.query<HTMLTextAreaElement>('[data-role="message-input"]');
    const text = input.value.trim();
    if (!surface || surface.readyState !== WebSocket.OPEN || !text) return;

    const traceId = createTraceId('chat');
    this.entries.push({
      id: `transient:user:${traceId}`,
      role: 'user',
      sourceKind: 'transient',
      text,
      occurredAt: new Date().toISOString(),
      traceId,
      status: 'pending',
    });
    input.value = '';
    surface.sendChatInput(text, traceId);
    this.lastError = '';
    this.render();
  }

  private async retryEntry(entryId: string): Promise<void> {
    const entry = this.entries.find((item) => item.id === entryId);
    if (!entry || entry.role !== 'user' || !entry.text.trim()) return;
    const surface = this.options.getSurface();
    if (!surface || surface.readyState !== WebSocket.OPEN) return;
    const traceId = createTraceId('retry');
    this.entries.push({
      id: `transient:user:${traceId}`,
      role: 'user',
      sourceKind: 'transient',
      text: entry.text,
      occurredAt: new Date().toISOString(),
      traceId,
      status: 'pending',
    });
    this.lastError = '';
    surface.sendChatInput(entry.text, traceId);
    this.render();
  }

  private async reloadLatest(): Promise<void> {
    const surface = this.options.getSurface();
    if (!surface || surface.readyState !== WebSocket.OPEN) {
      this.connected = false;
      this.render();
      return;
    }
    const requestId = createTraceId('history');
    const sequence = ++this.requestSequence;
    this.loading = true;
    this.render();
    try {
      const result = await surface.requestConversationHistory({
        request_id: requestId,
        limit: 50,
      });
      if (sequence !== this.requestSequence) return;
      this.applyHistoryResult(result, { replace: true });
      this.connected = true;
      this.lastError = '';
    } catch (error) {
      if (sequence !== this.requestSequence) return;
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      if (sequence === this.requestSequence) {
        this.loading = false;
        this.render();
      }
    }
  }

  private async loadOlder(): Promise<void> {
    if (!this.nextCursor || this.loadingOlder) return;
    const surface = this.options.getSurface();
    if (!surface || surface.readyState !== WebSocket.OPEN) return;
    this.loadingOlder = true;
    this.render();
    try {
      const result = await surface.requestConversationHistory({
        request_id: createTraceId('history-older'),
        limit: 50,
        cursor: this.nextCursor,
      });
      this.applyHistoryResult(result, { replace: false });
      this.lastError = '';
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.loadingOlder = false;
      this.render();
    }
  }

  private applyHistoryResult(
    result: ConversationHistoryResult,
    mode: { replace: boolean },
  ): void {
    const incoming = result.items.map(mapHistoryEntry);
    this.nextCursor = result.has_more ? result.next_cursor ?? null : null;
    if (mode.replace) {
      this.entries = incoming;
    } else {
      const merged = new Map<string, ConversationItem>();
      for (const item of [...incoming, ...this.entries]) {
        merged.set(item.id, item);
      }
      this.entries = [...merged.values()].sort(compareConversationItems);
    }
  }

  private updateUserStatus(traceId: string, status: ConversationItem['status']): void {
    const message = [...this.entries]
      .reverse()
      .find((entry) => entry.role === 'user' && entry.traceId === traceId);
    if (message) {
      message.status = status;
    }
  }

  private upsertNotice(
    traceId: string | undefined,
    notice: NonNullable<SurfaceFrame['conversation_notice']>,
  ): void {
    const id = traceId ? `notice:${traceId}:${notice.code}` : `notice:${notice.code}`;
    const existing = this.entries.find((entry) => entry.id === id);
    if (existing) {
      existing.title = notice.title;
      existing.text = notice.message;
      existing.occurredAt = new Date().toISOString();
      existing.status = 'notice';
      return;
    }
    this.entries.push({
      id,
      role: 'system',
      sourceKind: 'notice',
      title: notice.title,
      text: notice.message,
      occurredAt: new Date().toISOString(),
      traceId,
      status: 'notice',
    });
    this.entries.sort(compareConversationItems);
  }

  private renderSkeleton(): void {
    this.root.innerHTML = `
      <header class="workspace-head"><div><span>对话</span><h1>当前对话</h1></div></header>
      <div class="conversation-toolbar">
        <button type="button" class="ghost-button" data-action="load-older">加载更早消息</button>
        <div class="conversation-banner" data-role="conversation-banner"></div>
      </div>
      <div class="message-list" data-role="message-list">
        <div class="empty-state" data-role="empty-state"><span>G</span><h2>开始一段对话</h2><p>对话历史由服务端 Conversation 投影提供；未配置默认模型时会给出明确告警，不会伪造回复。</p></div>
      </div>
      <form class="composer" data-role="composer-form">
        <textarea rows="1" maxlength="8000" placeholder="和当前角色说点什么…" aria-label="消息" data-role="message-input"></textarea>
        <button type="submit" data-role="send-button">发送</button>
      </form>
    `;
  }

  private render(): void {
    const list = this.query<HTMLElement>('[data-role="message-list"]');
    const empty = this.emptyState;
    const loadOlder = this.query<HTMLButtonElement>('[data-action="load-older"]');
    const banner = this.query<HTMLElement>('[data-role="conversation-banner"]');
    const input = this.query<HTMLTextAreaElement>('[data-role="message-input"]');
    const sendButton = this.query<HTMLButtonElement>('[data-role="send-button"]');

    loadOlder.hidden = !this.nextCursor;
    loadOlder.disabled = !this.nextCursor || this.loadingOlder;
    loadOlder.textContent = this.loadingOlder ? '正在读取更早消息…' : '加载更早消息';
    input.disabled = !this.connected;
    sendButton.disabled = !this.connected;

    list.replaceChildren();
    if (this.entries.length === 0) {
      list.append(empty);
      empty.hidden = false;
    } else {
      empty.hidden = true;
      for (const item of this.entries) {
        const row = document.createElement('div');
        row.className = `message ${item.role}${item.status ? ` is-${item.status}` : ''}`;
        const article = document.createElement('article');
        article.innerHTML = renderMessageBody(item);
        if (item.role === 'user' && item.status === 'failed' && this.connected) {
          const actions = document.createElement('div');
          actions.className = 'message-actions';
          actions.innerHTML = `
            <button type="button" class="inline-button" data-action="retry" data-entry-id="${escapeHtml(item.id)}">重试</button>
          `;
          article.append(actions);
        }
        row.append(article);
        list.append(row);
      }
    }

    if (!this.connected) {
      banner.textContent = '控制面已断开连接。历史仍可见，但暂时不能发送新消息。';
      banner.dataset.state = 'warning';
    } else if (this.loading) {
      banner.textContent = '正在从服务端恢复最新历史…';
      banner.dataset.state = 'info';
    } else if (this.lastError) {
      banner.textContent = `历史读取失败：${this.lastError}`;
      banner.dataset.state = 'error';
    } else if (this.nextCursor) {
      banner.textContent = '已恢复最新一页历史，可继续向前翻页。';
      banner.dataset.state = 'info';
    } else {
      banner.textContent = '当前历史已完整恢复。';
      banner.dataset.state = 'quiet';
    }
  }

  private query<TElement extends Element>(selector: string): TElement {
    const element = this.root.querySelector<TElement>(selector);
    if (!element) throw new Error(`missing conversation element: ${selector}`);
    return element;
  }
}

function mapHistoryEntry(entry: ConversationHistoryEntry): ConversationItem {
  return {
    id: entry.entry_id,
    role: entry.role,
    sourceKind: entry.source_kind,
    text: entry.text,
    title: entry.title,
    occurredAt: entry.occurred_at,
    position: entry.position,
    traceId: entry.trace_id,
    status: entry.status,
  };
}

function compareConversationItems(left: ConversationItem, right: ConversationItem): number {
  const leftTime = Date.parse(left.occurredAt) || 0;
  const rightTime = Date.parse(right.occurredAt) || 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER;
  const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  return left.id.localeCompare(right.id);
}

function renderMessageBody(item: ConversationItem): string {
  const title = item.title ? `<strong>${escapeHtml(item.title)}</strong>` : '';
  const meta = renderMessageMeta(item);
  return `
    ${title}
    <div>${escapeHtml(item.text)}</div>
    ${meta}
  `;
}

function renderMessageMeta(item: ConversationItem): string {
  const time = new Date(item.occurredAt).toLocaleTimeString();
  const status = describeMessageStatus(item.status);
  const meta = [time, status].filter(Boolean).join(' · ');
  return meta ? `<div class="message-meta">${escapeHtml(meta)}</div>` : '';
}

function describeMessageStatus(status: ConversationItem['status']): string {
  switch (status) {
    case 'pending':
      return '已提交';
    case 'thinking':
      return '处理中';
    case 'failed':
      return '未完成';
    case 'notice':
      return '提示';
    case 'committed':
    default:
      return '';
  }
}

function createTraceId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

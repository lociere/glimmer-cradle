import {
  type ConversationHistoryEntry,
  type ConversationHistoryIPCRequest,
  type ConversationHistoryQuery,
  type ConversationHistoryResponse,
  type ConversationNotice,
} from '@glimmer-cradle/protocol';
import { CognitionManager } from '../inference/cognition-manager';
import type { ConversationDirectory, ResolvedConversation } from '../conversation/conversation-directory';

interface ControlSurfaceTraceProjection {
  user?: ConversationHistoryEntry;
  assistant?: ConversationHistoryEntry;
  notices: ConversationHistoryEntry[];
}

const CONTROL_SURFACE_ADDRESS = {
  provider_id: 'desktop-ui',
  provider_account_id: 'local',
  space_kind: 'personal',
  external_space_key: 'primary',
  actor_endpoint_key: 'local-user',
  actor_display_name: '本地用户',
  continuity_key: 'local-user',
  visibility: 'private',
} as const;

export class ConversationHistoryService {
  private readonly traces = new Map<string, ControlSurfaceTraceProjection>();
  private noticeSequence = 0;

  public constructor(private readonly conversationDirectory: ConversationDirectory) {}

  public recordSubmittedUserMessage(text: string, traceId: string): void {
    const normalized = text.trim();
    if (!normalized || !traceId) return;
    const resolved = this.resolveConversation(traceId);
    const projection = this.projectionFor(traceId);
    projection.user = {
      entry_id: `transient:user:${traceId}`,
      source_kind: 'transient',
      role: 'user',
      status: 'pending',
      text: normalized,
      occurred_at: new Date().toISOString(),
      trace_id: traceId,
      interaction_id: traceId,
      conversation_id: resolved.context.conversation_id,
      scene_id: resolved.context.scene_id,
      thread_id: resolved.context.thread_id,
      actor_id: resolved.actor_id,
      actor_name: resolved.actor_name,
      recall_scope: resolved.context.recall_scope,
      disclosure_scope: resolved.context.disclosure_scope,
    };
    this.pruneOverflow();
  }

  public updateThought(traceId: string, active: boolean): void {
    const projection = this.traces.get(traceId);
    if (!projection?.user) return;
    if (projection.user.status === 'failed') return;
    projection.user.status = active ? 'thinking' : 'pending';
  }

  public recordReply(traceId: string, text: string): void {
    if (!traceId || !text.trim()) return;
    const resolved = this.resolveConversation(traceId);
    const projection = this.projectionFor(traceId);
    if (projection.user) {
      projection.user.status = 'committed';
    }
    projection.assistant = {
      entry_id: `transient:assistant:${traceId}`,
      source_kind: 'transient',
      role: 'assistant',
      status: 'committed',
      text: text.trim(),
      occurred_at: new Date().toISOString(),
      trace_id: traceId,
      interaction_id: traceId,
      conversation_id: resolved.context.conversation_id,
      scene_id: resolved.context.scene_id,
      thread_id: resolved.context.thread_id,
      recall_scope: resolved.context.recall_scope,
      disclosure_scope: resolved.context.disclosure_scope,
    };
  }

  public recordNotice(traceId: string, notice: ConversationNotice): void {
    const noticeTraceId = traceId || `notice-${Date.now()}`;
    const resolved = this.resolveConversation(noticeTraceId);
    const projection = this.projectionFor(noticeTraceId);
    if (projection.user && notice.level !== 'info' && projection.user.status !== 'committed') {
      projection.user.status = 'failed';
    }
    projection.notices.push({
      entry_id: `notice:${traceId || 'system'}:${++this.noticeSequence}`,
      source_kind: 'notice',
      role: 'system',
      status: 'notice',
      text: notice.message,
      title: notice.title,
      occurred_at: new Date().toISOString(),
      trace_id: traceId || undefined,
      interaction_id: traceId || undefined,
      conversation_id: resolved.context.conversation_id,
      scene_id: resolved.context.scene_id,
      thread_id: resolved.context.thread_id,
      recall_scope: resolved.context.recall_scope,
      disclosure_scope: resolved.context.disclosure_scope,
    });
    this.pruneOverflow();
  }

  public async readHistory(request: ConversationHistoryQuery): Promise<ConversationHistoryResponse> {
    const resolved = this.resolveConversation(request.request_id);
    const allowedScopes = [
      resolved.context.recall_scope,
      ...(resolved.context.disclosure_scope !== resolved.context.recall_scope
        ? [resolved.context.disclosure_scope]
        : []),
    ] as [string, ...string[]];
    const payload: ConversationHistoryIPCRequest = {
      request_id: request.request_id,
      conversation_id: request.conversation_id?.trim() || resolved.context.conversation_id,
      scene_id: request.scene_id?.trim() || resolved.context.scene_id,
      thread_id: request.thread_id?.trim() || resolved.context.thread_id,
      actor_id: request.actor_id?.trim() || resolved.actor_id,
      actor_name: resolved.actor_name,
      source_provider_id: request.source_provider_id?.trim() || resolved.context.source_provider_id || 'desktop-ui',
      cursor: request.cursor?.trim() || undefined,
      limit: request.limit ?? 50,
      allowed_scopes: allowedScopes,
    };
    const persisted = await CognitionManager.instance.getConversationHistory(payload, request.request_id);
    if (persisted.status !== 'success') {
      return persisted;
    }
    if (request.cursor) {
      return persisted;
    }
    return this.mergeTransientEntries(persisted);
  }

  private mergeTransientEntries(
    persisted: ConversationHistoryResponse,
  ): ConversationHistoryResponse {
    this.prunePersistedEntries(persisted.items);
    const conversationId = persisted.conversation?.conversation_id;
    const transient = conversationId
      ? this.currentEntries().filter((entry) => entry.conversation_id === conversationId)
      : [];
    if (transient.length === 0) {
      return persisted;
    }

    const merged = new Map<string, ConversationHistoryEntry>();
    for (const item of persisted.items) merged.set(item.entry_id, item);
    for (const item of transient) {
      if (!merged.has(item.entry_id)) merged.set(item.entry_id, item);
    }

    return {
      ...persisted,
      items: [...merged.values()].sort(compareHistoryEntries),
    };
  }

  private prunePersistedEntries(persisted: readonly ConversationHistoryEntry[]): void {
    const byTrace = new Map<string, Set<'user' | 'assistant'>>();
    for (const item of persisted) {
      if (!item.interaction_id) continue;
      if (item.role !== 'user' && item.role !== 'assistant') continue;
      const roles = byTrace.get(item.interaction_id) ?? new Set<'user' | 'assistant'>();
      roles.add(item.role);
      byTrace.set(item.interaction_id, roles);
    }

    for (const [traceId, roles] of byTrace) {
      const projection = this.traces.get(traceId);
      if (!projection) continue;
      if (roles.has('user')) projection.user = undefined;
      if (roles.has('assistant')) projection.assistant = undefined;
      if (!projection.user && !projection.assistant && projection.notices.length === 0) {
        this.traces.delete(traceId);
      }
    }
  }

  private currentEntries(): ConversationHistoryEntry[] {
    const entries: ConversationHistoryEntry[] = [];
    for (const projection of this.traces.values()) {
      if (projection.user) entries.push(projection.user);
      if (projection.assistant) entries.push(projection.assistant);
      entries.push(...projection.notices);
    }
    return entries;
  }

  private projectionFor(traceId: string): ControlSurfaceTraceProjection {
    const existing = this.traces.get(traceId);
    if (existing) return existing;
    const created: ControlSurfaceTraceProjection = { notices: [] };
    this.traces.set(traceId, created);
    return created;
  }

  private resolveConversation(traceId: string): ResolvedConversation {
    return this.conversationDirectory.resolve(CONTROL_SURFACE_ADDRESS, traceId || `control-surface-${Date.now()}`);
  }

  private pruneOverflow(): void {
    while (this.traces.size > 200) {
      const oldest = this.traces.keys().next().value as string | undefined;
      if (!oldest) return;
      this.traces.delete(oldest);
    }
  }
}

function compareHistoryEntries(left: ConversationHistoryEntry, right: ConversationHistoryEntry): number {
  const leftTime = Date.parse(left.occurred_at) || 0;
  const rightTime = Date.parse(right.occurred_at) || 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER;
  const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  return left.entry_id.localeCompare(right.entry_id);
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PerceptionEvent } from '../../ports/application-models';
import type { KernelObservabilityPort } from '../../ports/observability.port';
import { AttentionLeaseStore } from '../../domain/attention/attention-lease-store';
import { AttentionSessionManager } from './attention-session-manager';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), critical: vi.fn() };
const observability: KernelObservabilityPort = {
  logger: () => logger,
  createTraceContext: (traceId) => ({ trace_id: traceId ?? 'trace-test' }),
  currentTraceId: () => undefined,
  withTrace: async (_traceId, operation) => operation(),
  span: async (_name, operation) => operation({ setAttribute: () => undefined, setStatus: () => undefined }),
  histogram: () => undefined,
  counter: () => undefined,
  start: () => undefined,
  stop: () => undefined,
  close: async () => undefined,
};
const manager = new AttentionSessionManager({
  ingress_debounce_ms: 1,
  ingress_focused_debounce_ms: 1,
  ingress_max_batch_messages: 4,
  ingress_max_batch_items: 24,
  focus_duration_ms: 1,
  focus_on_any_chat: false,
  heartbeat_enabled: false,
  heartbeat_interval_ms: 1,
  summon_keywords: [],
}, observability, new AttentionLeaseStore());

function perception(overrides: Partial<PerceptionEvent> = {}): PerceptionEvent {
  const id = overrides.id ?? 'event-1';
  return {
    id,
    trace_id: overrides.trace_id ?? id,
    sensoryType: 'text',
    source: 'desktop-ui:user',
    timestamp: 1,
    familiarity: 10,
    address_mode: 'direct',
    response_policy: 'reply_allowed',
    conversation: {
      source_provider_id: 'desktop-ui',
      scene_id: 'scene:desktop:local',
      conversation_id: 'conversation:desktop:local',
      continuity_id: 'continuity:desktop:user',
      thread_id: 'main',
      interaction_id: id,
      recall_scope: 'conversation_private',
      disclosure_scope: 'conversation_private',
    },
    origin: {
      provider_kind: 'user',
      provider_id: 'desktop-ui',
      source_event_id: id,
      schema_ref: 'glimmer://desktop/text-input/v1',
      trust_tier: 'user_asserted',
      privacy_class: 'private',
      cognitive_effect: 'observation',
    },
    retention_ceiling: 'memory_candidate',
    content: {
      text: '测试输入',
      modality: ['text'],
      actor_id: 'desktop-ui:user',
      actor_name: '本地用户',
    },
    ...overrides,
  };
}

describe('AttentionSessionManager 感知契约', () => {
  afterEach(async () => {
    await manager.stop();
  });

  it('批处理后保留权威 PerceptionEvent 的 trace、来源和留存上限', () => {
    const subject = manager as unknown as {
      mergeRequests(requests: PerceptionEvent[]): PerceptionEvent;
    };
    const event = perception();

    const merged = subject.mergeRequests([event]);

    expect(merged.trace_id).toBe(event.trace_id);
    expect(merged.origin).toEqual(event.origin);
    expect(merged.retention_ceiling).toBe('memory_candidate');
  });

  it('合并不同留存上限时采用最严格上限', () => {
    const subject = manager as unknown as {
      mergeRequests(requests: PerceptionEvent[]): PerceptionEvent;
    };

    const merged = subject.mergeRequests([
      perception({ id: 'event-1', retention_ceiling: 'memory_candidate' }),
      perception({ id: 'event-2', retention_ceiling: 'transient' }),
    ]);

    expect(merged.retention_ceiling).toBe('transient');
  });

  it('首个 operation 未终态时第二次 ingress 会取消真实 operation 后再处理合并输入', async () => {
    let finishFirst!: (value: {
      operation_id: string;
      state: 'cancelled';
      terminal: true;
    }) => void;
    const firstCompletion = new Promise<{
      operation_id: string;
      state: 'cancelled';
      terminal: true;
    }>((resolve) => { finishFirst = resolve; });
    const sendPerceptionMessage = vi.fn(async (_request: PerceptionEvent, traceId?: string) => {
      if (traceId === 'trace-1') {
        return {
          operation_id: 'perception:event-1', state: 'running' as const, terminal: false,
          trace_id: 'trace-1', completion: firstCompletion,
        };
      }
      const terminal = { operation_id: 'perception:event-2', state: 'succeeded' as const, terminal: true };
      return { ...terminal, trace_id: traceId ?? 'trace-2', completion: Promise.resolve(terminal) };
    });
    const cancelPerception = vi.fn(async (request: { target_trace_id: string }) => {
      expect(request.target_trace_id).toBe('trace-1');
      finishFirst({ operation_id: 'perception:event-1', state: 'cancelled', terminal: true });
    });
    const actionStream = {
      startThinkingStream: vi.fn(async () => undefined),
      completeStream: vi.fn(async () => undefined),
      cancelStream: vi.fn(async () => undefined),
    };
    const subject = manager as unknown as {
      _initialized: boolean;
      _debounceMs: number;
      _focusedDebounceMs: number;
      _aiProxy: unknown;
      _actionStream: unknown;
      ingest(request: PerceptionEvent): Promise<void>;
    };
    subject._initialized = true;
    subject._debounceMs = 1;
    subject._focusedDebounceMs = 1;
    subject._aiProxy = { isReady: true, sendPerceptionMessage, cancelPerception, sendLifeHeartbeat: vi.fn() };
    subject._actionStream = actionStream;

    const first = subject.ingest(perception({ id: 'event-1', trace_id: 'trace-1' }));
    await vi.waitFor(() => expect(sendPerceptionMessage).toHaveBeenCalledTimes(1));
    const second = subject.ingest(perception({ id: 'event-2', trace_id: 'trace-2' }));
    await Promise.all([first, second]);

    expect(cancelPerception).toHaveBeenCalledTimes(1);
    expect(sendPerceptionMessage).toHaveBeenCalledTimes(2);
    expect(actionStream.cancelStream).toHaveBeenCalledWith(
      'conversation:desktop:local', 'trace-1', expect.any(String),
    );
    expect(actionStream.completeStream).toHaveBeenCalledTimes(1);
    expect(actionStream.completeStream).toHaveBeenCalledWith(
      'conversation:desktop:local', 'trace-2', 'calm', 0,
    );
  });
});

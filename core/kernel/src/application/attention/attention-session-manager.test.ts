import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PerceptionEvent } from '../../ports/application-models';
import type { Observability as KernelObservabilityPort } from '@glimmer-cradle/platform/observability';
import { SystemClockAdapter } from '../../adapters/time/system-clock-adapter';
import { AttentionLeaseStore } from './attention-lease-store';
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
const clock = new SystemClockAdapter();
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
}, observability, new AttentionLeaseStore(clock), clock);

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
    const event = perception({ content: { text: '测试输入', modality: ['text', 'image'], parts: [
      { content: { kind: 'image', asset: { assetId: '00000000-0000-4000-8000-000000000001', mediaType: 'image/png', sizeBytes: 3, sha256: 'a'.repeat(64) } } },
    ] } });

    const merged = subject.mergeRequests([event]);

    expect(merged.trace_id).toBe(event.trace_id);
    expect(merged.origin).toEqual(event.origin);
    expect(merged.retention_ceiling).toBe('memory_candidate');
    expect(merged.content.parts).toEqual(event.content.parts);
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

  it('媒体不因消息批次上限丢失，且不同留存级别分别送入 Cognition', async () => {
    const sent: PerceptionEvent[] = [];
    const subject = manager as unknown as {
      _initialized: boolean; _stopping: boolean; _debounceMs: number; _focusedDebounceMs: number;
      _maxBatchMessages: number; _maxBatchItems: number; _aiProxy: unknown; _actionStream: unknown;
      ingest(request: PerceptionEvent): Promise<void>;
    };
    subject._initialized = true;
    subject._stopping = false;
    subject._debounceMs = 5;
    subject._focusedDebounceMs = 5;
    subject._maxBatchMessages = 2;
    subject._maxBatchItems = 2;
    subject._aiProxy = { isReady: true, sendPerceptionMessage: async (request: PerceptionEvent) => {
      sent.push(request);
      return { operation_id: request.id, state: 'succeeded', terminal: true,
        completion: Promise.resolve({ operation_id: request.id, state: 'succeeded', terminal: true }) };
    }, cancelPerception: async () => undefined };
    subject._actionStream = { startThinkingStream: async () => undefined,
      completeStream: async () => undefined, cancelStream: async () => undefined };

    const events = Array.from({ length: 5 }, (_, index) => perception({
      id: `media-${index}`,
      retention_ceiling: index === 2 ? 'transient' : 'experience',
      content: { text: `media ${index}`, modality: ['image'], parts: [{ content: { kind: 'image', asset: {
        assetId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        mediaType: 'image/png', sizeBytes: 3, sha256: 'a'.repeat(64),
      } } }] },
    }));
    await Promise.all(events.map((event) => subject.ingest(event)));
    expect(sent).toHaveLength(5);
    expect(sent.map((event) => event.retention_ceiling)).toEqual([
      'experience', 'experience', 'transient', 'experience', 'experience',
    ]);
    expect(sent.map((event) => event.content.parts?.[0].content.kind)).toEqual(Array(5).fill('image'));
  });

  it('拒绝超出 parts 上限的媒体请求，不把截尾当作成功', async () => {
    const subject = manager as unknown as {
      _initialized: boolean; _stopping: boolean; _debounceMs: number; _focusedDebounceMs: number;
      _maxBatchItems: number; _aiProxy: unknown; _actionStream: unknown;
      ingest(request: PerceptionEvent): Promise<void>;
    };
    subject._initialized = true;
    subject._stopping = false;
    subject._debounceMs = 1;
    subject._focusedDebounceMs = 1;
    subject._maxBatchItems = 1;
    const sendPerceptionMessage = vi.fn();
    subject._aiProxy = { isReady: true, sendPerceptionMessage, cancelPerception: async () => undefined };
    subject._actionStream = { startThinkingStream: async () => undefined,
      completeStream: async () => undefined, cancelStream: async () => undefined };
    const image = { content: { kind: 'image' as const, asset: {
      assetId: '00000000-0000-4000-8000-000000000001', mediaType: 'image/png', sizeBytes: 3, sha256: 'a'.repeat(64),
    } } };
    await expect(subject.ingest(perception({ content: { modality: ['image'], parts: [image, image] } })))
      .rejects.toThrow('Content parts/items 超过批次上限');
    expect(sendPerceptionMessage).not.toHaveBeenCalled();
  });

  it('拒绝超出 items 上限的旧 URI 媒体，不静默截尾', async () => {
    const subject = manager as any;
    subject._initialized = true;
    subject._stopping = false;
    subject._debounceMs = 1;
    subject._focusedDebounceMs = 1;
    subject._maxBatchItems = 1;
    const sendPerceptionMessage = vi.fn();
    subject._aiProxy = { isReady: true, sendPerceptionMessage, cancelPerception: async () => undefined };
    subject._actionStream = { startThinkingStream: async () => undefined,
      completeStream: async () => undefined, cancelStream: async () => undefined };
    const legacy = { modality: 'image' as const, uri: 'https://expired.example/image', mime_type: 'image/png' };
    await expect(subject.ingest(perception({ content: { modality: ['image'], items: [legacy, legacy] } })))
      .rejects.toThrow('parts/items 超过批次上限');
    expect(sendPerceptionMessage).not.toHaveBeenCalled();
  });

  it('settles ingress when thinking stream startup or cancel cleanup fails', async () => {
    const subject = manager as any;
    subject._initialized = true;
    subject._stopping = false;
    subject._debounceMs = 1;
    subject._focusedDebounceMs = 1;
    subject._maxBatchItems = 24;
    subject._aiProxy = { isReady: true, sendPerceptionMessage: vi.fn(), cancelPerception: async () => undefined };
    subject._actionStream = {
      startThinkingStream: async () => { throw new Error('stream start failed'); },
      completeStream: async () => undefined,
      cancelStream: async () => { throw new Error('stream cleanup failed'); },
    };
    await expect(subject.ingest(perception())).rejects.toThrow('stream start failed');
    expect(subject._aiProxy.sendPerceptionMessage).not.toHaveBeenCalled();
  });

  it('rejects an in-flight ingress when stop cancels it', async () => {
    let finish!: (value: any) => void;
    let releaseCancellation!: () => void;
    const completion = new Promise((resolve) => { finish = resolve; });
    const cancellationHeld = new Promise<void>((resolve) => { releaseCancellation = resolve; });
    const subject = manager as any;
    subject._initialized = true;
    subject._stopping = false;
    subject._debounceMs = 1;
    subject._focusedDebounceMs = 1;
    subject._maxBatchItems = 24;
    const sendPerceptionMessage = vi.fn(async () => (
      { operation_id: 'operation', state: 'running', terminal: false, completion }
    ));
    subject._aiProxy = {
      isReady: true,
      sendPerceptionMessage,
      cancelPerception: async () => {
        finish({ operation_id: 'operation', state: 'cancelled', terminal: true });
        await cancellationHeld;
      },
    };
    subject._actionStream = { startThinkingStream: async () => undefined,
      completeStream: async () => undefined, cancelStream: async () => undefined };
    const ingress = subject.ingest(perception());
    await vi.waitFor(() => expect(subject._sceneStates.get('conversation:desktop:local')?.inFlightTraceId).toBeTruthy());
    const stopped = manager.stop();
    await expect(ingress).rejects.toThrow('stopped');
    await expect(subject.ingest(perception({ id: 'late-ingress' }))).rejects.toThrow('正在停止');
    expect(sendPerceptionMessage).toHaveBeenCalledTimes(1);
    releaseCancellation();
    await expect(stopped).resolves.toBeUndefined();
    expect(sendPerceptionMessage).toHaveBeenCalledTimes(1);
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
      _initialized: boolean; _stopping: boolean;
      _debounceMs: number;
      _focusedDebounceMs: number;
      _aiProxy: unknown;
      _actionStream: unknown;
      ingest(request: PerceptionEvent): Promise<void>;
    };
    subject._initialized = true;
    subject._stopping = false;
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

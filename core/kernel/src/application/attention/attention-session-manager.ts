import type { PerceptionEvent } from '../../ports/application-models';
import type { PerceptionCancelRequest } from '../../ports/cognition-service-port';
import { IAICapabilityPort, IActionStreamPort } from '../../ports';
import type { AttentionProjectionMode } from '../../domain/attention/attention-lease';
import type { LifeClockConfiguration } from '../../ports/configuration.port';
import type { Logger as KernelLoggerPort, Observability as KernelObservabilityPort } from '@glimmer-cradle/platform/observability';
import type { AttentionLeasePort } from '../../ports/application-capabilities.port';
import type { Clock as KernelClockPort, ScheduledTask as ScheduledTaskPort } from '@glimmer-cradle/platform/time';

type PendingIngress = {
  request: PerceptionEvent;
  resolve: (value: void) => void;
  reject: (reason?: unknown) => void;
  queued_at_ms: number;
};

type SceneIngressState = {
  pending: PendingIngress[];
  interruptedPending: PendingIngress[];
  timer: ScheduledTaskPort | null;
  chain: Promise<void>;
  inFlightTraceId: string | null;
  inFlightHasMedia: boolean;
  inFlightPending: PendingIngress[];
  cancelRequested: boolean;
};

export class AttentionSessionManager {
  private readonly _sceneStates: Map<string, SceneIngressState> = new Map();
  private _initialized: boolean = false;
  private _debounceMs: number = 1400;
  private _focusedDebounceMs: number = 700;
  private _maxBatchMessages: number = 4;
  private _maxBatchItems: number = 24;
  private _stopping = false;
  private readonly logger: KernelLoggerPort;
  private _aiProxy!: IAICapabilityPort;
  private _actionStream!: IActionStreamPort;

  public constructor(
    private readonly config: LifeClockConfiguration,
    private readonly observability: KernelObservabilityPort,
    private readonly _attentionLeaseStore: AttentionLeasePort,
    private readonly clock: KernelClockPort,
  ) {
    this.logger = observability.logger('attention-session-manager');
  }

  public init(aiProxy: IAICapabilityPort, actionStream: IActionStreamPort): void {
    this._aiProxy = aiProxy;
    this._actionStream = actionStream;
    const lifeClock = this.config;
    this._debounceMs = lifeClock.ingress_debounce_ms;
    this._focusedDebounceMs = lifeClock.ingress_focused_debounce_ms;
    this._maxBatchMessages = lifeClock.ingress_max_batch_messages;
    this._maxBatchItems = lifeClock.ingress_max_batch_items;
    this._initialized = true;
    this._stopping = false;

    this.logger.info('注意力会话管理器初始化完成', {
      ingress_debounce_ms: this._debounceMs,
      ingress_focused_debounce_ms: this._focusedDebounceMs,
      ingress_max_batch_messages: this._maxBatchMessages,
      ingress_max_batch_items: this._maxBatchItems,
    });
  }

  public async ingest(request: PerceptionEvent): Promise<void> {
    if (!this._initialized) {
      throw new Error('AttentionSessionManager 未初始化，请先调用 init()');
    }
    if (this._stopping) {
      throw new Error('AttentionSessionManager 正在停止');
    }

    const source = request.conversation.conversation_id;
    const state = this.getSceneState(source);
    this.tryInterruptInFlight(source, state, request);

    return new Promise<void>((resolve, reject) => {
      state.pending.push({ request, resolve, reject, queued_at_ms: this.clock.monotonicNowMs() });
      this.scheduleFlush(source, state);
    });
  }

  public async stop(): Promise<void> {
    this._stopping = true;
    // 先取消所有定时器和拒绝所有待处理请求
    const cancellations: Promise<unknown>[] = [];
    for (const [source, state] of this._sceneStates.entries()) {
      if (state.timer) {
        state.timer.cancel();
      }
      for (const pending of state.pending) {
        pending.reject(new Error('Attention session manager stopped'));
      }
      for (const pending of state.interruptedPending) {
        pending.reject(new Error('Attention session manager stopped'));
      }
      for (const pending of state.inFlightPending) {
        pending.reject(new Error('Attention session manager stopped'));
      }
      state.pending = [];
      state.interruptedPending = [];
      state.inFlightPending = [];
      if (state.inFlightTraceId) {
        const traceId = state.inFlightTraceId;
        state.cancelRequested = true;
        cancellations.push(this._actionStream.cancelStream(source, traceId, 'attention_stopped'));
        cancellations.push(this._aiProxy.cancelPerception({
          scene_id: source,
          target_trace_id: traceId,
          reason: 'attention_stopped',
        }));
      }
      this.logger.debug('注意力会话状态已清理', { scene_id: source });
    }
    await Promise.allSettled(cancellations);
    // 等待所有 in-flight 的 flushScene 链完成
    const chains = Array.from(this._sceneStates.values()).map((s) => s.chain);
    await Promise.allSettled(chains);
    this._sceneStates.clear();
    this._initialized = false;
  }

  private getSceneState(source: string): SceneIngressState {
    const existing = this._sceneStates.get(source);
    if (existing) {
      return existing;
    }

    const created: SceneIngressState = {
      pending: [],
      interruptedPending: [],
      timer: null,
      chain: Promise.resolve(),
      inFlightTraceId: null,
      inFlightHasMedia: false,
      inFlightPending: [],
      cancelRequested: false,
    };
    this._sceneStates.set(source, created);
    return created;
  }

  private scheduleFlush(source: string, state: SceneIngressState): void {
    if (state.timer) {
      state.timer.cancel();
      state.timer = null;
    }

    const debounceMs = this.resolveDebounceMs();
    state.timer = this.clock.schedule(debounceMs, () => {
      state.timer = null;
      state.chain = state.chain
        .then(() => this.flushScene(source, state))
        .catch((error: unknown) => {
          this.logger.error('注意力场景刷新失败', {
            scene_id: source,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
  }

  private tryInterruptInFlight(source: string, state: SceneIngressState, request: PerceptionEvent): void {
    if (!state.inFlightTraceId || state.cancelRequested) {
      return;
    }
    // 媒体租约须等真实 Cognition 终态；不把新旧留存级别的媒体合并重放。
    if (state.inFlightHasMedia || this.hasMedia(request)) return;

    state.cancelRequested = true;
    const cancelRequest: PerceptionCancelRequest = {
      scene_id: source,
      target_trace_id: state.inFlightTraceId,
      reason: 'new_ingress_interrupt',
    };

    void this._actionStream.cancelStream(source, state.inFlightTraceId, 'new_ingress_interrupt').catch(() => {});

    void this._aiProxy.cancelPerception(cancelRequest).catch((error: unknown) => {
      this.logger.warn('发送生成中断请求失败', {
        scene_id: source,
        target_trace_id: state.inFlightTraceId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    this.logger.info('已触发生成中断请求', {
      scene_id: source,
      target_trace_id: state.inFlightTraceId,
    });
  }

  private resolveDebounceMs(): number {
    const mode = this.resolveAttentionProjectionMode();
    if (mode === 'focused') {
      return this._focusedDebounceMs;
    }
    return this._debounceMs;
  }

  private resolveAttentionProjectionMode(): AttentionProjectionMode {
    return this._attentionLeaseStore.getProjection().mode;
  }

  private hasMedia(request: PerceptionEvent): boolean {
    return Boolean(
      request.content.parts?.some((part) => part.content.kind !== 'text')
      || request.content.items?.length,
    );
  }

  private async flushScene(source: string, state: SceneIngressState): Promise<void> {
    const queue = [...state.interruptedPending.splice(0), ...state.pending.splice(0)];
    if (queue.length === 0) return;
    const groups: PendingIngress[][] = [];
    for (const entry of queue) {
      const last = groups[groups.length - 1];
      if (!last || last.length >= this._maxBatchMessages
        || last[0].request.retention_ceiling !== entry.request.retention_ceiling
        || this.hasMedia(entry.request) || last.some((candidate) => this.hasMedia(candidate.request))) {
        groups.push([entry]);
      } else {
        last.push(entry);
      }
    }
    for (let index = 0; index < groups.length; index += 1) {
      const interrupted = await this.flushBatch(source, state, groups[index]);
      if (!interrupted) continue;
      state.pending.unshift(...groups.slice(index + 1).flat());
      return;
    }
  }

  private async flushBatch(source: string, state: SceneIngressState, batch: PendingIngress[]): Promise<boolean> {
    if (batch.some((entry) => (
      (entry.request.content.parts?.length ?? 0) > this._maxBatchItems
      || (entry.request.content.items?.length ?? 0) > this._maxBatchItems
    ))) {
      const error = new Error('感知 Content parts/items 超过批次上限');
      for (const entry of batch) entry.reject(error);
      this.logger.warn('感知批次拒绝超限 Content', { scene_id: source, batch_size: batch.length });
      return false;
    }
    const queueWaitMs = this.clock.monotonicNowMs() - Math.min(...batch.map((entry) => entry.queued_at_ms));
    const attentionProjectionMode = this.resolveAttentionProjectionMode();
    const mergedRequest = this.mergeRequests(batch.map((entry) => entry.request));
    const traceId = mergedRequest.trace_id || mergedRequest.id;
    state.inFlightTraceId = traceId;
    state.inFlightHasMedia = this.hasMedia(mergedRequest);
    state.inFlightPending = batch;
    state.cancelRequested = false;
    let interrupted = false;

    await this.observability.withTrace(traceId, async () => {
      await this.observability.span('attention.flush', async (flushSpan) => {
        flushSpan.setAttribute('scene_id', source);
        flushSpan.setAttribute('batch_size', batch.length);
        flushSpan.setAttribute('dropped_count', 0);
        flushSpan.setAttribute('queue_wait_ms', queueWaitMs);
        flushSpan.setAttribute('attention_projection_mode', attentionProjectionMode);
        flushSpan.setAttribute('address_mode', mergedRequest.address_mode);
        flushSpan.setAttribute('response_policy', mergedRequest.response_policy ?? 'reply_allowed');
        flushSpan.setAttribute('modality', mergedRequest.content?.modality ?? []);
        this.observability.histogram('attention.ingress_wait_ms', queueWaitMs, {
          attention_projection_mode: attentionProjectionMode,
          address_mode: mergedRequest.address_mode,
          response_policy: mergedRequest.response_policy ?? 'reply_allowed',
        });
        this.observability.histogram('attention.batch_size', batch.length, {
          attention_projection_mode: attentionProjectionMode,
          address_mode: mergedRequest.address_mode,
          response_policy: mergedRequest.response_policy ?? 'reply_allowed',
        });

        try {
          await this._actionStream.startThinkingStream(
            source,
            traceId,
            String(mergedRequest.source || 'unknown'),
          );
          await this.observability.span(
            'attention.ipc.perception_message',
            async (ipcSpan) => {
              ipcSpan.setAttribute('scene_id', source);
              ipcSpan.setAttribute('request_id', mergedRequest.id);
              const operation = await this._aiProxy.sendPerceptionMessage(mergedRequest, traceId);
              const terminal = await operation.completion;
              if (terminal.state === 'cancelled') {
                throw new DOMException(terminal.safe_message ?? '感知操作已取消', 'AbortError');
              }
              if (terminal.state !== 'succeeded') {
                throw new Error(terminal.safe_message ?? `感知操作以 ${terminal.state} 结束`);
              }
            },
            {
              attention_projection_mode: attentionProjectionMode,
              address_mode: mergedRequest.address_mode,
              response_policy: mergedRequest.response_policy ?? 'reply_allowed',
              conversation_id: mergedRequest.conversation.conversation_id,
            },
          );
          for (const entry of batch) entry.resolve();
          this.logger.debug('注意力批次完成', {
            scene_id: source,
            batch_size: batch.length,
          });
          try {
            await this._actionStream.completeStream(source, traceId, 'calm', 0);
          } catch (cleanupError) {
            this.logger.warn('注意力完成流清理失败', {
              scene_id: source, trace_id: traceId,
              error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            });
          }
        } catch (error) {
          if (state.cancelRequested && !this._stopping) {
            // 原始请求与完成承诺一同重放，避免语义或媒体引用在截断时丢失。
            state.interruptedPending.push(...batch);
            interrupted = true;
            this.logger.info('in-flight 批次被中断，内容已暂存供下次合并', {
              scene_id: source,
              batch_size: batch.length,
              trace_id: traceId,
            });
          } else {
            flushSpan.setStatus('error', error instanceof Error ? error.name : String(error));
            if (!this._stopping) for (const entry of batch) entry.reject(error);
            this.logger.error('注意力批次失败', {
              scene_id: source,
              batch_size: batch.length,
              trace_id: traceId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          try {
            await this._actionStream.cancelStream(source, traceId, state.cancelRequested ? 'interrupted' : 'generation_failed');
          } catch (cleanupError) {
            this.logger.warn('注意力取消流清理失败', {
              scene_id: source, trace_id: traceId,
              error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            });
          }
        } finally {
          if (state.inFlightTraceId === traceId) {
            state.inFlightTraceId = null;
            state.inFlightHasMedia = false;
            state.inFlightPending = [];
          }
          state.cancelRequested = false;
        }
      });
    });
    return interrupted;
  }

  private mergeRequests(requests: PerceptionEvent[]): PerceptionEvent {
    const tail = requests[requests.length - 1];

    const modalities = new Set<string>();
    const allItems: NonNullable<PerceptionEvent['content']['items']> = [];
    const allParts: Array<NonNullable<PerceptionEvent['content']['parts']>[number]> = [];

    const textParts: string[] = [];
    const actorIds = new Set<string>();
    const actorNames = new Set<string>();

    for (const r of requests) {
      if (r.content?.text) textParts.push(r.content.text);
      r.content?.modality?.forEach(m => modalities.add(m));
      if (r.content?.items) allItems.push(...r.content.items);
      if (r.content?.parts) allParts.push(...r.content.parts);
      if (r.content?.actor_id) actorIds.add(r.content.actor_id);
      if (r.content?.actor_name) actorNames.add(r.content.actor_name);
    }

    return {
      id: tail.id,
      trace_id: tail.trace_id || tail.id,
      sensoryType: tail.sensoryType,
      source: tail.source,
      timestamp: tail.timestamp,
      familiarity: tail.familiarity,
      // 被中断的前缀或当前批次中任一消息是 direct 呼唤，则合并结果为 direct
      address_mode: requests.some(r => r.address_mode === 'direct')
        ? 'direct'
        : 'ambient',
      // 只要合并批次中存在可回复消息，就保留回复资格；纯背景观察保持 observe_only。
      response_policy: (
        requests.some(r => (r.response_policy ?? 'reply_allowed') === 'reply_allowed')
      )
        ? 'reply_allowed'
        : 'observe_only',
      conversation: {
        ...tail.conversation,
        interaction_id: tail.trace_id || tail.id,
      },
      origin: tail.origin,
      retention_ceiling: this.resolveRetentionCeiling(requests),
      content: {
        text: textParts.join('\n') || undefined,
        modality: Array.from(modalities),
        actor_id: actorIds.size === 1 ? Array.from(actorIds)[0] : undefined,
        actor_name: actorNames.size === 1 ? Array.from(actorNames)[0] : undefined,
        items: allItems.length > 0 ? allItems : undefined,
        parts: allParts.length > 0 ? allParts : undefined,
      },
    };
  }

  private resolveRetentionCeiling(
    requests: PerceptionEvent[],
  ): PerceptionEvent['retention_ceiling'] {
    const rank: Record<PerceptionEvent['retention_ceiling'], number> = {
      transient: 0,
      experience: 1,
      memory_candidate: 2,
    };
    const ceilings = [
      ...requests.map((request) => request.retention_ceiling),
    ];
    return ceilings.reduce((strictest, current) => (
      rank[current] < rank[strictest] ? current : strictest
    ), 'memory_candidate');
  }
}

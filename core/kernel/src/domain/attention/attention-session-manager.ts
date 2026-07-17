import { PerceptionCancelRequest, PerceptionEvent } from '@glimmer-cradle/protocol';
import { IAICapabilityPort, IActionStreamPort } from '../../foundation/ports';
import { withTrace } from '../../foundation/logger/trace-context';
import { ConfigManager } from '../../foundation/config/config-manager';
import { getLogger } from '../../foundation/logger/logger';
import { histogram, span } from '../../foundation/logger/telemetry';
import { AttentionLeaseStore, AttentionProjectionMode } from './attention-lease-store';

const logger = getLogger('attention-session-manager');

type PendingIngress = {
  request: PerceptionEvent;
  resolve: (value: void) => void;
  reject: (reason?: unknown) => void;
  queued_at_ms: number;
};

/**
 * 被中断的 in-flight 批次内容快照。
 * 不携带 Promise 回调，仅保留语义内容供下次合并。
 * address_mode / response_policy 也需保存：若被打断批次含可回复 direct 呼唤，
 * 恢复后仍应保持可回复优先级；纯 observe_only 背景不会被合并升级成回复。
 */
type InterruptedContent = {
  text?: string;
  items?: NonNullable<PerceptionEvent['content']['items']>;
  modality: string[];
  actor_id?: string;
  actor_name?: string;
  address_mode: 'direct' | 'ambient';
  response_policy: 'reply_allowed' | 'observe_only';
  conversation: PerceptionEvent['conversation'];
  origin: PerceptionEvent['origin'];
  retention_ceiling: PerceptionEvent['retention_ceiling'];
  trace_id?: string;
};

type SceneIngressState = {
  pending: PendingIngress[];
  timer: NodeJS.Timeout | null;
  chain: Promise<void>;
  inFlightTraceId: string | null;
  cancelRequested: boolean;
  /**
   * 被中断的 in-flight 批次的合并内容，供下一次 flush 时前置拼入。
   * 确保中断后 AI 收到的是「被打断消息 + 新消息」的完整上下文。
   * 级联中断下会持续累积：A 被中断 → interruptedContent=A；
   * A+B 被中断 → interruptedContent=merge(A,B)，最终 AI 看到完整链。
   */
  interruptedContent: InterruptedContent | null;
};

export class AttentionSessionManager {
  private static _instance: AttentionSessionManager | null = null;
  private readonly _sceneStates: Map<string, SceneIngressState> = new Map();
  private _initialized: boolean = false;
  private _debounceMs: number = 1400;
  private _focusedDebounceMs: number = 700;
  private _maxBatchMessages: number = 4;
  private _maxBatchItems: number = 24;
  private readonly _attentionLeaseStore: AttentionLeaseStore = AttentionLeaseStore.instance;
  private _aiProxy!: IAICapabilityPort;
  private _actionStream!: IActionStreamPort;

  public static get instance(): AttentionSessionManager {
    if (!AttentionSessionManager._instance) {
      AttentionSessionManager._instance = new AttentionSessionManager();
    }
    return AttentionSessionManager._instance;
  }

  private constructor() {}

  public init(aiProxy: IAICapabilityPort, actionStream: IActionStreamPort): void {
    this._aiProxy = aiProxy;
    this._actionStream = actionStream;
    const config = ConfigManager.instance.getConfig();
    const lifeClock = config.character.inference.life_clock;
    this._debounceMs = lifeClock.ingress_debounce_ms;
    this._focusedDebounceMs = lifeClock.ingress_focused_debounce_ms;
    this._maxBatchMessages = lifeClock.ingress_max_batch_messages;
    this._maxBatchItems = lifeClock.ingress_max_batch_items;
    this._initialized = true;

    logger.info('注意力会话管理器初始化完成', {
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

    const source = request.conversation.conversation_id;
    const state = this.getSceneState(source);
    this.tryInterruptInFlight(source, state);

    return new Promise<void>((resolve, reject) => {
      state.pending.push({ request, resolve, reject, queued_at_ms: performance.now() });
      this.scheduleFlush(source, state);
    });
  }

  public async stop(): Promise<void> {
    // 先取消所有定时器和拒绝所有待处理请求
    for (const [source, state] of this._sceneStates.entries()) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
      for (const pending of state.pending) {
        pending.reject(new Error('Attention session manager stopped'));
      }
      logger.debug('注意力会话状态已清理', { scene_id: source });
    }
    // 等待所有 in-flight 的 flushScene 链完成
    const chains = Array.from(this._sceneStates.values()).map((s) => s.chain);
    await Promise.allSettled(chains);
    this._sceneStates.clear();
  }

  private getSceneState(source: string): SceneIngressState {
    const existing = this._sceneStates.get(source);
    if (existing) {
      return existing;
    }

    const created: SceneIngressState = {
      pending: [],
      timer: null,
      chain: Promise.resolve(),
      inFlightTraceId: null,
      cancelRequested: false,
      interruptedContent: null,
    };
    this._sceneStates.set(source, created);
    return created;
  }

  private scheduleFlush(source: string, state: SceneIngressState): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    const debounceMs = this.resolveDebounceMs();
    state.timer = setTimeout(() => {
      state.timer = null;
      state.chain = state.chain
        .then(() => this.flushScene(source, state))
        .catch((error: unknown) => {
          logger.error('注意力场景刷新失败', {
            scene_id: source,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }, debounceMs);
  }

  private tryInterruptInFlight(source: string, state: SceneIngressState): void {
    if (!state.inFlightTraceId || state.cancelRequested) {
      return;
    }

    state.cancelRequested = true;
    const cancelRequest: PerceptionCancelRequest = {
      scene_id: source,
      target_trace_id: state.inFlightTraceId,
      reason: 'new_ingress_interrupt',
    };

    void this._actionStream.cancelStream(source, state.inFlightTraceId, 'new_ingress_interrupt').catch(() => {});

    void this._aiProxy.cancelPerception(cancelRequest).catch((error: unknown) => {
      logger.warn('发送生成中断请求失败', {
        scene_id: source,
        target_trace_id: state.inFlightTraceId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    logger.info('已触发生成中断请求', {
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

  private async flushScene(source: string, state: SceneIngressState): Promise<void> {
    const queue = state.pending.splice(0, state.pending.length);
    if (queue.length === 0) {
      return;
    }

    const overflowCount = Math.max(0, queue.length - this._maxBatchMessages);
    for (const dropped of queue.slice(0, overflowCount)) {
      dropped.resolve();
    }

    const batch = queue.slice(overflowCount);
    const queueWaitMs = performance.now() - Math.min(...batch.map((entry) => entry.queued_at_ms));
    const attentionProjectionMode = this.resolveAttentionProjectionMode();

    // 提取并清空上次被中断的内容快照，作为本次合并的前缀。
    // 在构造 mergedRequest 之前置空，避免异常路径重复使用。
    const prefix = state.interruptedContent;
    state.interruptedContent = null;

    const mergedRequest = this.mergeRequests(batch.map((entry) => entry.request), prefix);
    const traceId = mergedRequest.trace_id || mergedRequest.id;
    state.inFlightTraceId = traceId;
    state.cancelRequested = false;

    await withTrace(traceId, async () => {
      await span('attention.flush', async (flushSpan) => {
        flushSpan.setAttribute('scene_id', source);
        flushSpan.setAttribute('batch_size', batch.length);
        flushSpan.setAttribute('dropped_count', overflowCount);
        flushSpan.setAttribute('queue_wait_ms', queueWaitMs);
        flushSpan.setAttribute('attention_projection_mode', attentionProjectionMode);
        flushSpan.setAttribute('address_mode', mergedRequest.address_mode);
        flushSpan.setAttribute('response_policy', mergedRequest.response_policy ?? 'reply_allowed');
        flushSpan.setAttribute('modality', mergedRequest.content?.modality ?? []);
        histogram('attention.ingress_wait_ms', queueWaitMs, {
          attention_projection_mode: attentionProjectionMode,
          address_mode: mergedRequest.address_mode,
          response_policy: mergedRequest.response_policy ?? 'reply_allowed',
        });
        histogram('attention.batch_size', batch.length, {
          attention_projection_mode: attentionProjectionMode,
          address_mode: mergedRequest.address_mode,
          response_policy: mergedRequest.response_policy ?? 'reply_allowed',
        });

        await this._actionStream.startThinkingStream(
          source,
          traceId,
          String(mergedRequest.source || 'unknown'),
        );

        try {
          await span(
            'attention.ipc.perception_message',
            async (ipcSpan) => {
              ipcSpan.setAttribute('scene_id', source);
              ipcSpan.setAttribute('request_id', mergedRequest.id);
              await this._aiProxy.sendPerceptionMessage(mergedRequest, traceId);
            },
            {
              attention_projection_mode: attentionProjectionMode,
              address_mode: mergedRequest.address_mode,
              response_policy: mergedRequest.response_policy ?? 'reply_allowed',
              conversation_id: mergedRequest.conversation.conversation_id,
            },
          );
          for (let index = 0; index < batch.length - 1; index += 1) {
            batch[index].resolve();
          }
          batch[batch.length - 1].resolve();
          logger.debug('注意力批次完成', {
            scene_id: source,
            batch_size: batch.length,
          });
          await this._actionStream.completeStream(
            source,
            traceId,
            'calm',
            0,
          );
        } catch (error) {
          if (state.cancelRequested) {
            // 本次 in-flight 是被后续消息中断的（不是真实错误）。
            // 保存合并内容（已含 prefix + 本批次）供下次 flush 前置拼入，
            // 确保 AI 最终收到「所有未回复消息 + 新消息」的完整上下文。
            state.interruptedContent = {
              text: mergedRequest.content?.text ?? undefined,
              items: mergedRequest.content?.items ? [...mergedRequest.content.items] : undefined,
              modality: mergedRequest.content?.modality ? [...mergedRequest.content.modality] : [],
              actor_id: mergedRequest.content?.actor_id ?? undefined,
              actor_name: mergedRequest.content?.actor_name ?? undefined,
              address_mode: mergedRequest.address_mode,
              response_policy: mergedRequest.response_policy ?? 'reply_allowed',
              conversation: mergedRequest.conversation,
              origin: mergedRequest.origin,
              retention_ceiling: mergedRequest.retention_ceiling,
              trace_id: mergedRequest.trace_id,
            };
            // 优雅结束，不向上层抛错——这些消息内容已被保存，会在下次 flush 中处理
            for (const entry of batch) {
              entry.resolve();
            }
            logger.info('in-flight 批次被中断，内容已暂存供下次合并', {
              scene_id: source,
              batch_size: batch.length,
              trace_id: traceId,
            });
          } else {
            flushSpan.setStatus('error', error instanceof Error ? error.name : String(error));
            for (const entry of batch) {
              entry.reject(error);
            }
            logger.error('注意力批次失败', {
              scene_id: source,
              batch_size: batch.length,
              trace_id: traceId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          await this._actionStream.cancelStream(source, traceId, state.cancelRequested ? 'interrupted' : 'generation_failed');
        } finally {
          if (state.inFlightTraceId === traceId) {
            state.inFlightTraceId = null;
          }
          state.cancelRequested = false;
        }
      });
    });
  }

  private mergeRequests(
    requests: PerceptionEvent[],
    prefix?: InterruptedContent | null,
  ): PerceptionEvent {
    const tail = requests[requests.length - 1];

    const modalities = new Set<string>(prefix?.modality ?? []);
    const allItems: NonNullable<PerceptionEvent['content']['items']> = [
      ...(prefix?.items ?? []),
    ];

    const textParts: string[] = [];
    if (prefix?.text) textParts.push(prefix.text);
    const actorIds = new Set<string>();
    const actorNames = new Set<string>();
    if (prefix?.actor_id) actorIds.add(prefix.actor_id);
    if (prefix?.actor_name) actorNames.add(prefix.actor_name);

    for (const r of requests) {
      if (r.content?.text) textParts.push(r.content.text);
      r.content?.modality?.forEach(m => modalities.add(m));
      if (r.content?.items) allItems.push(...r.content.items);
      if (r.content?.actor_id) actorIds.add(r.content.actor_id);
      if (r.content?.actor_name) actorNames.add(r.content.actor_name);
    }

    // items 总数超出上限时保留最新的
    const trimmedItems =
      allItems.length > this._maxBatchItems
        ? allItems.slice(allItems.length - this._maxBatchItems)
        : allItems;

    return {
      id: tail.id,
      trace_id: tail.trace_id || tail.id,
      sensoryType: tail.sensoryType,
      source: tail.source,
      timestamp: tail.timestamp,
      familiarity: tail.familiarity,
      // 被中断的前缀或当前批次中任一消息是 direct 呼唤，则合并结果为 direct
      address_mode: (prefix?.address_mode === 'direct' || requests.some(r => r.address_mode === 'direct'))
        ? 'direct'
        : 'ambient',
      // 只要合并批次中存在可回复消息，就保留回复资格；纯背景观察保持 observe_only。
      response_policy: (
        prefix?.response_policy === 'reply_allowed' ||
        requests.some(r => (r.response_policy ?? 'reply_allowed') === 'reply_allowed')
      )
        ? 'reply_allowed'
        : 'observe_only',
      conversation: {
        ...tail.conversation,
        interaction_id: tail.trace_id || tail.id,
      },
      origin: tail.origin,
      retention_ceiling: this.resolveRetentionCeiling(requests, prefix),
      content: {
        text: textParts.join('\n') || undefined,
        modality: Array.from(modalities),
        actor_id: actorIds.size === 1 ? Array.from(actorIds)[0] : undefined,
        actor_name: actorNames.size === 1 ? Array.from(actorNames)[0] : undefined,
        items: trimmedItems.length > 0 ? trimmedItems : undefined,
      },
    };
  }

  private resolveRetentionCeiling(
    requests: PerceptionEvent[],
    prefix?: InterruptedContent | null,
  ): PerceptionEvent['retention_ceiling'] {
    const rank: Record<PerceptionEvent['retention_ceiling'], number> = {
      transient: 0,
      experience: 1,
      memory_candidate: 2,
    };
    const ceilings = [
      ...(prefix ? [prefix.retention_ceiling] : []),
      ...requests.map((request) => request.retention_ceiling),
    ];
    return ceilings.reduce((strictest, current) => (
      rank[current] < rank[strictest] ? current : strictest
    ), 'memory_candidate');
  }
}

/**
 * 场景注意力相关事件
 * 发布 Kernel attention projection 派生出的有机体注意力状态。
 */
import { DomainEvent } from './domain-events';
import type { TraceContext } from "@glimmer-cradle/protocol";

/**
 * 有机体注意力状态变化事件
 * 由 LifeClockManager 消费 AttentionLeaseStore projection 后发布，
 * 供 UI、诊断或后续状态投影订阅，不作为 attention domain 的事实源。
 */
export type OrganismAttentionMode = 'ACTIVE' | 'PASSIVE' | 'IDLE';

export class OrganismAttentionChangedEvent extends DomainEvent {
  public readonly event_type = 'OrganismAttentionChangedEvent' as const;
  public readonly mode: OrganismAttentionMode;
  public readonly focusedChannels: string[];
  public readonly trace_context: TraceContext;

  constructor(
    payload: { mode: OrganismAttentionMode; focusedChannels: string[] },
    trace_context?: TraceContext
  ) {
    super();
    this.mode = payload.mode;
    this.focusedChannels = payload.focusedChannels;
    this.trace_context = trace_context ?? { trace_id: '' };
  }
}

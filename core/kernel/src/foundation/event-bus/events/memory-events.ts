/**
 * 状态同步与记忆固化事件。
 *
 * 记忆只通过 Cognition 的受控投影对外发布，不在 Kernel 维护镜像事实源。
 * 记忆事实由 Cognition 的 data/state/cognition/memory/memory.db 独占，不跨进程复制到 Kernel。
 */
import { DomainEvent } from "./domain-events";
import type { TraceContext } from "@glimmer-cradle/protocol";

export interface StateSyncPayload {
  state: Record<string, any>;
}

export class StateSyncEvent extends DomainEvent {
  public readonly event_type = "StateSyncEvent";
  public readonly payload: StateSyncPayload;
  public readonly trace_context: TraceContext;

  constructor(payload: StateSyncPayload, trace_context?: TraceContext, occurredAt?: number) {
    super(occurredAt);
    this.payload = payload;
    this.trace_context = trace_context ?? { trace_id: "" };
  }
}


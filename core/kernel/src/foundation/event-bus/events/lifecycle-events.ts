/**
 * 应用生命周期事件定义
 * 用于内核启动/停止流程中的状态广播。
 */
import { DomainEvent } from "./domain-events";
import type { TraceContext } from "@glimmer-cradle/protocol";

export enum AppLifecycleState {
  UNINITIALIZED = "UNINITIALIZED",
  INITIALIZING = "INITIALIZING",
  RUNNING = "RUNNING",
  STOPPING = "STOPPING",
  STOPPED = "STOPPED",
  ERROR = "ERROR",
}

export interface AppEventPayload {
  [key: string]: any;
}

export abstract class AppEvent extends DomainEvent {
  public readonly type: string;
  public readonly payload: AppEventPayload;
  public readonly trace_context: TraceContext;

  constructor(type: string, payload: AppEventPayload = {}, trace_context?: TraceContext, occurredAt?: number) {
    super(occurredAt);
    this.type = type;
    this.payload = payload;
    this.trace_context = trace_context ?? { trace_id: "" };
  }
}

export class AppStartingEvent extends AppEvent {
  constructor(payload: AppEventPayload = {}, trace_context?: TraceContext) {
    super("AppStartingEvent", payload, trace_context);
  }
}

export class AppStartedEvent extends AppEvent {
  constructor(payload: AppEventPayload = {}, trace_context?: TraceContext) {
    super("AppStartedEvent", payload, trace_context);
  }
}

export class AppStoppingEvent extends AppEvent {
  constructor(payload: AppEventPayload = {}, trace_context?: TraceContext) {
    super("AppStoppingEvent", payload, trace_context);
  }
}

export class AppStoppedEvent extends AppEvent {
  constructor(payload: AppEventPayload = {}, trace_context?: TraceContext) {
    super("AppStoppedEvent", payload, trace_context);
  }
}

export class ModuleStartedEvent extends AppEvent {
  constructor(payload: AppEventPayload = {}, trace_context?: TraceContext) {
    super("ModuleStartedEvent", payload, trace_context);
  }
}

export class ModuleStoppedEvent extends AppEvent {
  constructor(payload: AppEventPayload = {}, trace_context?: TraceContext) {
    super("ModuleStoppedEvent", payload, trace_context);
  }
}

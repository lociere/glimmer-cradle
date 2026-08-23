import { DomainEvent } from './domain-events';
import type { ChannelReplyPayload, TraceContext } from '@glimmer-cradle/protocol';

export interface ExtensionEventPayload {
  [key: string]: unknown;
}

export abstract class ExtensionEvent extends DomainEvent {
  public readonly event_type: string;
  public readonly payload: unknown;
  public readonly trace_context: TraceContext;

  constructor(event_type: string, payload: unknown = {}, trace_context?: TraceContext, occurredAt?: number) {
    super(occurredAt);
    this.event_type = event_type;
    this.payload = payload;
    this.trace_context = trace_context ?? { trace_id: '' };
  }
}

export class ExtensionLoadedEvent extends ExtensionEvent {
  constructor(payload: ExtensionEventPayload = {}, trace_context?: TraceContext) {
    super('ExtensionLoadedEvent', payload, trace_context);
  }
}

export class ExtensionStartedEvent extends ExtensionEvent {
  constructor(payload: ExtensionEventPayload = {}, trace_context?: TraceContext) {
    super('ExtensionStartedEvent', payload, trace_context);
  }
}

export class ExtensionStoppedEvent extends ExtensionEvent {
  constructor(payload: ExtensionEventPayload = {}, trace_context?: TraceContext) {
    super('ExtensionStoppedEvent', payload, trace_context);
  }
}

export class ExtensionUnloadedEvent extends ExtensionEvent {
  constructor(payload: ExtensionEventPayload = {}, trace_context?: TraceContext) {
    super('ExtensionUnloadedEvent', payload, trace_context);
  }
}

export class ExtensionErrorEvent extends ExtensionEvent {
  constructor(payload: ExtensionEventPayload = {}, trace_context?: TraceContext) {
    super('ExtensionErrorEvent', payload, trace_context);
  }
}

export class ChannelReplyEvent extends ExtensionEvent {
  declare readonly payload: ChannelReplyPayload;

  constructor(payload: ChannelReplyPayload, trace_context?: TraceContext) {
    super('action.channel.reply', payload, trace_context);
  }
}


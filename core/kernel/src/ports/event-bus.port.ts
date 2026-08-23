import type { DomainEvent, EventType } from '../domain/events';

export type DomainEventHandler<T extends DomainEvent = DomainEvent> = (event: T) => Promise<void>;

export interface ReplayDeliveryRequest { readonly operation_id: string; readonly payload_digest: string; readonly envelope: DomainEvent; readonly event_type: string; readonly source_record_id: number; readonly trace_id: string }
export interface ReplayDeliveryAck { readonly status: 'committed'; readonly handler_id: string; readonly owner: string; readonly operation_id: string; readonly payload_digest: string; readonly event_type: string; readonly source_record_id: number; readonly trace_id: string; readonly receipt_ref: string }
export interface ReplayHandlerRegistration { readonly handler_id: string; readonly owner: string; readonly deliverOrReadAck: (request: ReplayDeliveryRequest) => Promise<ReplayDeliveryAck> }
export interface ReplayUnsupportedRegistration { readonly replay: 'unsupported'; readonly reason: string }

export interface KernelEventBusPort {
  publish<T extends DomainEvent>(event: T): Promise<void>;
  subscribe<T extends DomainEvent>(
    eventType: EventType | string,
    handler: DomainEventHandler<T>,
    replay?: ReplayHandlerRegistration | ReplayUnsupportedRegistration,
  ): void;
  unsubscribe<T extends DomainEvent>(eventType: EventType | string, handler: DomainEventHandler<T>): void;
  shutdown(): Promise<void>;
}

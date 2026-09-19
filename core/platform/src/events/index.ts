/** In-process live-event key. Durable domain logs keep their own persisted identifiers. */
export type LiveEventType = string;

export type LiveEventHandler<TEvent> = (event: TEvent) => Promise<void>;

export interface LiveEventPublisher<TBaseEvent> {
  publish<TEvent extends TBaseEvent>(event: TEvent): Promise<void>;
}

export interface LiveEventSubscriptions<TBaseEvent, TEventType = LiveEventType> {
  subscribe<TEvent extends TBaseEvent>(
    eventType: TEventType,
    handler: LiveEventHandler<TEvent>,
  ): void;
  unsubscribe<TEvent extends TBaseEvent>(
    eventType: TEventType,
    handler: LiveEventHandler<TEvent>,
  ): void;
}

/**
 * Product-neutral contract for ephemeral in-process notification.
 * Persistence, replay acknowledgement and dead-letter policy belong to their domain owner.
 */
export interface LiveEventBus<TBaseEvent, TEventType = LiveEventType>
  extends LiveEventPublisher<TBaseEvent>, LiveEventSubscriptions<TBaseEvent, TEventType> {
  shutdown(): Promise<void>;
}

// Kernel 领域事件基类；live-event transport contract 由 Platform 拥有。

export abstract class DomainEvent {
  readonly occurredAt: number;

  constructor(occurredAt?: number) {
    this.occurredAt = occurredAt ?? Date.now();
  }
}

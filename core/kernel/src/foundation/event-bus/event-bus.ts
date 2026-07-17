/**
 * 全局事件总线
 * 内核模块间解耦通信的唯一方式
 * 异步非阻塞，支持全链路trace_id透传
 *
 * v4.5: 处理器异常写入 DeadLetterQueue，确保认知流不断裂
 */
import { DomainEvent, EventType } from './events';
import { getLogger } from "../logger/logger";
import { DeadLetterQueue } from "./dead-letter-queue";

const logger = getLogger("event-bus");

// 事件处理器类型
type EventHandler<T extends DomainEvent = DomainEvent> = (event: T) => Promise<void>;

/**
 * 全局事件总线
 * 单例模式
 */
export class EventBus {
  private static _instance: EventBus | null = null;
  private _handlers: Map<string, EventHandler[]> = new Map();
  private _isShuttingDown: boolean = false;

  public static get instance(): EventBus {
    if (!EventBus._instance) {
      EventBus._instance = new EventBus();
    }
    return EventBus._instance;
  }

  private constructor() {
    logger.info("全局事件总线初始化完成");
  }

  public subscribe<T extends DomainEvent>(eventType: EventType | string, handler: EventHandler<T>): void {
    if (this._isShuttingDown) {
      logger.warn("事件总线正在关闭，拒绝新的订阅", { event_type: eventType });
      return;
    }

    if (!this._handlers.has(eventType)) {
      this._handlers.set(eventType, []);
    }
    this._handlers.get(eventType)!.push(handler as EventHandler);
  }

  public unsubscribe<T extends DomainEvent>(eventType: EventType | string, handler: EventHandler<T>): void {
    if (!this._handlers.has(eventType)) return;
    const handlers = this._handlers.get(eventType)!;
    const index = handlers.indexOf(handler as EventHandler);
    if (index > -1) handlers.splice(index, 1);
    if (handlers.length === 0) this._handlers.delete(eventType);
  }

  public async publish<T extends DomainEvent>(event: T): Promise<void> {
    if (this._isShuttingDown) {
      logger.warn("事件总线正在关闭，拒绝新的事件发布", { event_type: (event as any).event_type, event_id: (event as any).event_id });
      return;
    }

    const eventType = (event as any).event_type;
    const traceId = (event as any).trace_context?.trace_id;
    const isStateSyncEvent = eventType === "StateSyncEvent";

    const handlers = [
      ...(this._handlers.get(eventType) || []),
      ...(this._handlers.get("*") || []),
    ];

    if (handlers.length === 0) {
      return;
    }

    const wrapHandler = async (handler: EventHandler, e: T) => {
      try {
        await handler(e);
      } catch (error) {
        logger.error("事件处理器执行异常", {
          event_type: eventType,
          event_id: (e as any).event_id,
          trace_id: traceId,
          error: (error as Error).message,
          stack: (error as Error).stack,
        });

        // v4.5: 写入死信队列
        try {
          DeadLetterQueue.instance.enqueue(
            traceId ?? '',
            eventType ?? 'unknown',
            { event_type: eventType, event_id: (e as any).event_id },
            error as Error,
          );
        } catch {
          // DLQ 自身故障不影响事件总线
        }
      }
    };

    if (!isStateSyncEvent) {
      logger.debug("发布事件", { event_type: eventType, handler_count: handlers.length, trace_id: traceId });
    }

    await Promise.all(handlers.map((h) => wrapHandler(h, event)));
  }

  public async shutdown(): Promise<void> {
    this._isShuttingDown = true;
    this._handlers.clear();
    logger.info("事件总线已关闭");
  }
}

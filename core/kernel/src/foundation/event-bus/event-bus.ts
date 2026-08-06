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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { resolveStatePath } from '../utils/path-utils';

const logger = getLogger("event-bus");

// 事件处理器类型
type EventHandler<T extends DomainEvent = DomainEvent> = (event: T) => Promise<void>;
export interface EventHandlerRegistration {
  readonly handler_id: string;
  readonly owner: string;
}
interface RegisteredHandler { readonly fn: EventHandler; readonly registration: EventHandlerRegistration; }

/**
 * 全局事件总线
 * 单例模式
 */
export class EventBus {
  private static _instance: EventBus | null = null;
  private _handlers: Map<string, RegisteredHandler[]> = new Map();
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

  public subscribe<T extends DomainEvent>(eventType: EventType | string, handler: EventHandler<T>, options?: Partial<EventHandlerRegistration>): void {
    if (this._isShuttingDown) {
      logger.warn("事件总线正在关闭，拒绝新的订阅", { event_type: eventType });
      return;
    }

    if (!this._handlers.has(eventType)) {
      this._handlers.set(eventType, []);
    }
    const list = this._handlers.get(eventType)!;
    const stable = options?.handler_id || `${eventType}:${createHash('sha256').update(String(handler)).digest('hex').slice(0, 16)}:${list.length}`;
    list.push({ fn: handler as EventHandler, registration: { handler_id: stable, owner: options?.owner || 'kernel' } });
  }

  public unsubscribe<T extends DomainEvent>(eventType: EventType | string, handler: EventHandler<T>): void {
    if (!this._handlers.has(eventType)) return;
    const handlers = this._handlers.get(eventType)!;
    const index = handlers.findIndex((entry) => entry.fn === handler);
    if (index > -1) handlers.splice(index, 1);
    if (handlers.length === 0) this._handlers.delete(eventType);
  }

  public async publish<T extends DomainEvent>(event: T): Promise<void> {
    if (this._isShuttingDown) {
      logger.warn("事件总线正在关闭，拒绝新的事件发布", { event_type: (event as any).event_type, event_id: (event as any).event_id });
      if (getReplayContext(event)) throw new Error('event_bus_shutting_down');
      return;
    }

    const eventType = (event as any).event_type;
    const traceId = (event as any).trace_context?.trace_id;
    const isStateSyncEvent = eventType === "StateSyncEvent";
    const replay = getReplayContext(event);

    const handlers = [
      ...(this._handlers.get(eventType) || []),
      ...(this._handlers.get("*") || []),
    ];

    if (handlers.length === 0) {
      if (replay) throw new Error(`event_bus_no_handler:${eventType ?? 'unknown'}`);
      return;
    }

    if (replay) {
      const aggregate = await readReplayEffect(replay.effect_ledger_path);
      if (aggregate) validateReplayEffect(aggregate, replay, eventType, handlers);
      await prepareReplayInventory(replay, eventType, handlers);
      await validateReplayInventory(replay, handlers);
    }

    const wrapHandler = async (entry: RegisteredHandler, e: T): Promise<Error | null> => {
      const handler = entry.fn;
      if (replay) {
        const existing = await readReplayHandlerEffect(replay, entry.registration.handler_id);
        if (existing) {
          validateHandlerEffect(existing, replay, eventType, entry.registration);
          return null;
        }
      }
      try {
        await handler(e);
        if (replay) await writeReplayHandlerEffect(replay, eventType, entry.registration);
        return null;
      } catch (error) {
        if (replay) await writeReplayInventory(replay, eventType, entry.registration).catch(() => undefined);
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
            e,
            error as Error,
            {
              owner: 'kernel',
              sourcePath: 'core/kernel/src/foundation/event-bus/event-bus.ts',
              failurePhase: 'dispatch',
              retryPolicy: 'owner-confirmed',
              replayCommand: 'python core/kernel/tools/dlq.py replay kernel:<id> --confirm --dispatcher kernel.event-bus.v1',
              redactedPayloadSummary: JSON.stringify({
                event_type: eventType,
                event_id: (e as any).event_id,
              }),
            },
          );
        } catch { /* DLQ 自身故障不替代 handler failure */ }
        return error instanceof Error ? error : new Error(String(error));
      }
    };

    if (!isStateSyncEvent) {
      logger.debug("发布事件", { event_type: eventType, handler_count: handlers.length, trace_id: traceId });
    }

    const failures = (await Promise.all(handlers.map((h) => wrapHandler(h, event)))).filter(
      (failure): failure is Error => failure !== null,
    );
    if (failures.length > 0) {
      if (replay) throw new Error(`event_bus_handler_failed:${failures.length}`);
      return;
    }
    if (replay) {
      await writeReplayEffect(replay, eventType, handlers);
      await writeReplayAck(replay, eventType);
    }
  }

  public async shutdown(): Promise<void> {
    this._isShuttingDown = true;
    this._handlers.clear();
    logger.info("事件总线已关闭");
  }
}

interface ReplayContext {
  readonly operation_id: string;
  readonly source_record_id: number;
  readonly trace_id: string;
  readonly payload_digest: string;
  readonly ack_path: string;
  readonly effect_ledger_path: string;
}

function getReplayContext(event: DomainEvent): ReplayContext | null {
  const value = (event as unknown as { replay_context?: Partial<ReplayContext> }).replay_context;
  if (!value) return null;
  const operationId = value.operation_id || '';
  const ackPath = value.ack_path || '';
  const effectLedgerPath = value.effect_ledger_path || '';
  if (!/^dlq_replay_[0-9a-f]{32}$/.test(operationId)
    || !Number.isInteger(value.source_record_id)
    || typeof value.trace_id !== 'string'
    || !/^[0-9a-f]{64}$/.test(value.payload_digest || '')
    || typeof value.ack_path !== 'string'
    || typeof value.effect_ledger_path !== 'string'
    || !isReplayAckPath(ackPath, operationId)
    || !isReplayEffectPath(effectLedgerPath, operationId)) {
    throw new Error('event_bus_replay_context_invalid');
  }
  return value as ReplayContext;
}

function isReplayEffectPath(effectLedgerPath: string, operationId: string): boolean {
  const processedRoot = path.resolve(resolveStatePath('kernel/dlq-replay-inbox/processed'));
  return path.resolve(effectLedgerPath) === path.join(processedRoot, 'effects', `${operationId}.json`);
}

function isReplayAckPath(ackPath: string, operationId: string): boolean {
  const processedRoot = path.resolve(resolveStatePath('kernel/dlq-replay-inbox/processed'));
  const expectedPath = path.join(processedRoot, `${operationId}.receipt.json`);
  return path.resolve(ackPath) === expectedPath;
}

async function readReplayAck(ackPath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(ackPath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeReplayAck(replay: ReplayContext, eventType: string): Promise<void> {
  const ack = {
    schema_version: 1,
    status: 'success',
    receipt_id: `kernel_event_bus_${replay.operation_id}`,
    source: 'kernel',
    record_id: replay.source_record_id,
    owner: 'kernel',
    event_type: eventType,
    trace_id: replay.trace_id,
    payload_digest: replay.payload_digest,
    operation_id: replay.operation_id,
    dispatcher_id: 'kernel.event-bus.v1',
    delivery: 'kernel_event_bus_published',
    delivered_at: new Date().toISOString(),
  };
  await mkdir(path.dirname(replay.ack_path), { recursive: true });
  try {
    await writeFile(replay.ack_path, `${JSON.stringify(ack, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readReplayAck(replay.ack_path);
    validateReplayAck(existing, replay, eventType);
  }
}

async function readReplayEffect(effectLedgerPath: string): Promise<Record<string, unknown> | null> {
  return readReplayAck(effectLedgerPath);
}

async function writeReplayEffect(replay: ReplayContext, eventType: string, handlers: RegisteredHandler[]): Promise<void> {
  const effect = {
    status: 'committed',
    owner: 'kernel.event-bus',
    handler_ids: handlers.map((entry) => entry.registration.handler_id).sort(),
    event_type: eventType,
    record_id: replay.source_record_id,
    trace_id: replay.trace_id,
    payload_digest: replay.payload_digest,
    operation_id: replay.operation_id,
  };
  await mkdir(path.dirname(replay.effect_ledger_path), { recursive: true });
  try {
    await writeFile(replay.effect_ledger_path, `${JSON.stringify(effect, null, 2)}\n`, {
      flag: 'wx', mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    validateReplayEffect(await readReplayEffect(replay.effect_ledger_path), replay, eventType, handlers);
  }
}

function validateReplayEffect(
  effect: Record<string, unknown> | null,
  replay: ReplayContext,
  eventType: string,
  handlers: RegisteredHandler[],
): void {
  if (effect?.status !== 'committed'
    || effect.owner !== 'kernel.event-bus'
    || effect.event_type !== eventType
    || effect.record_id !== replay.source_record_id
    || effect.trace_id !== replay.trace_id
    || effect.payload_digest !== replay.payload_digest
    || effect.operation_id !== replay.operation_id
    || JSON.stringify(effect.handler_ids) !== JSON.stringify(handlers.map((entry) => entry.registration.handler_id).sort())) {
    throw new Error('event_bus_replay_effect_conflict');
  }
}

async function readReplayHandlerEffect(replay: ReplayContext, handlerId: string): Promise<Record<string, unknown> | null> {
  return readReplayAck(path.join(path.dirname(replay.effect_ledger_path), path.basename(replay.effect_ledger_path, '.json'), `${encodeURIComponent(handlerId)}.json`));
}

async function writeReplayHandlerEffect(replay: ReplayContext, eventType: string, registration: EventHandlerRegistration): Promise<void> {
  const target = path.join(path.dirname(replay.effect_ledger_path), path.basename(replay.effect_ledger_path, '.json'), `${encodeURIComponent(registration.handler_id)}.json`);
  const effect = { status: 'committed', owner: registration.owner, handler_id: registration.handler_id, event_type: eventType, record_id: replay.source_record_id, trace_id: replay.trace_id, payload_digest: replay.payload_digest, operation_id: replay.operation_id };
  await mkdir(path.dirname(target), { recursive: true });
  await writeReplayInventory(replay, eventType, registration);
  try { await writeFile(target, `${JSON.stringify(effect, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; validateHandlerEffect(await readReplayAck(target), replay, eventType, registration); }
}

async function writeReplayInventory(replay: ReplayContext, eventType: string, registration: EventHandlerRegistration): Promise<void> {
  const target = path.join(path.dirname(replay.effect_ledger_path), `${path.basename(replay.effect_ledger_path, '.json')}.inventory.json`);
  const existing = await readReplayAck(target);
  const inventory = { status: 'registered', owner: 'kernel.event-bus', event_type: eventType, operation_id: replay.operation_id, handlers: [{ handler_id: registration.handler_id, owner: registration.owner }] };
  let current = existing;
  if (!current) {
    try { await writeFile(target, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; current = await readReplayAck(target); }
  }
  if (!current) throw new Error('event_bus_replay_inventory_missing');
  const handlers = Array.isArray(current.handlers) ? current.handlers as Array<Record<string, unknown>> : [];
  if (!handlers.some((handler) => handler.handler_id === registration.handler_id && handler.owner === registration.owner)) {
    handlers.push({ handler_id: registration.handler_id, owner: registration.owner });
    handlers.sort((left, right) => String(left.handler_id).localeCompare(String(right.handler_id)));
    await writeFile(target, `${JSON.stringify({ ...current, handlers }, null, 2)}\n`);
  }
}

async function prepareReplayInventory(replay: ReplayContext, eventType: string, handlers: RegisteredHandler[]): Promise<void> {
  const effectsRoot = path.join(path.dirname(replay.effect_ledger_path), path.basename(replay.effect_ledger_path, '.json'));
  try { await mkdir(effectsRoot, { recursive: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') return; throw error; }
  const target = path.join(path.dirname(replay.effect_ledger_path), `${path.basename(replay.effect_ledger_path, '.json')}.inventory.json`);
  const inventory = { status: 'registered', owner: 'kernel.event-bus', event_type: eventType, operation_id: replay.operation_id, handlers: handlers.map((entry) => ({ handler_id: entry.registration.handler_id, owner: entry.registration.owner })).sort((left, right) => left.handler_id.localeCompare(right.handler_id)) };
  const existing = await readReplayAck(target);
  if (!existing) { await writeFile(target, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx', mode: 0o600 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; }); return; }
}

async function validateReplayInventory(replay: ReplayContext, handlers: RegisteredHandler[]): Promise<void> {
  const target = path.join(path.dirname(replay.effect_ledger_path), `${path.basename(replay.effect_ledger_path, '.json')}.inventory.json`);
  const existing = await readReplayAck(target);
  if (!existing) return;
  const expected = handlers.map((entry) => `${entry.registration.handler_id}:${entry.registration.owner}`).sort();
  const actual = (Array.isArray(existing.handlers) ? existing.handlers : []).map((entry) => `${(entry as Record<string, unknown>).handler_id}:${(entry as Record<string, unknown>).owner}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('event_bus_replay_handler_inventory_drift');
}

function validateHandlerEffect(effect: Record<string, unknown> | null, replay: ReplayContext, eventType: string, registration: EventHandlerRegistration): void {
  if (effect?.status !== 'committed' || effect.owner !== registration.owner || effect.handler_id !== registration.handler_id || effect.event_type !== eventType || effect.record_id !== replay.source_record_id || effect.trace_id !== replay.trace_id || effect.payload_digest !== replay.payload_digest || effect.operation_id !== replay.operation_id) throw new Error('event_bus_replay_handler_effect_conflict');
}

function validateReplayAck(
  ack: Record<string, unknown> | null,
  replay: ReplayContext,
  eventType: string,
): void {
  if (ack?.status !== 'success'
    || ack.receipt_id !== `kernel_event_bus_${replay.operation_id}`
    || ack.source !== 'kernel'
    || ack.record_id !== replay.source_record_id
    || ack.owner !== 'kernel'
    || ack.event_type !== eventType
    || ack.trace_id !== replay.trace_id
    || ack.payload_digest !== replay.payload_digest
    || ack.operation_id !== replay.operation_id
    || ack.dispatcher_id !== 'kernel.event-bus.v1'
    || ack.delivery !== 'kernel_event_bus_published') {
    throw new Error('event_bus_replay_ack_conflict');
  }
}

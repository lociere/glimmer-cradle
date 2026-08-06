import { DomainEvent, EventType } from './events';
import { getLogger } from '../logger/logger';
import { DeadLetterQueue } from './dead-letter-queue';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveStatePath } from '../utils/path-utils';

const logger = getLogger('event-bus');
type EventHandler<T extends DomainEvent = DomainEvent> = (event: T) => Promise<void>;
export interface ReplayDeliveryRequest { readonly operation_id: string; readonly payload_digest: string; readonly envelope: DomainEvent; readonly event_type: string; readonly source_record_id: number; readonly trace_id: string; }
export interface ReplayDeliveryAck { readonly status: 'committed'; readonly handler_id: string; readonly owner: string; readonly operation_id: string; readonly payload_digest: string; readonly event_type: string; readonly source_record_id: number; readonly trace_id: string; readonly receipt_ref: string; }
export interface ReplayHandlerRegistration { readonly handler_id: string; readonly owner: string; readonly deliverOrReadAck: (request: ReplayDeliveryRequest) => Promise<ReplayDeliveryAck>; }
export interface ReplayUnsupportedRegistration { readonly replay: 'unsupported'; readonly reason: string; }
interface RegisteredHandler { readonly fn: EventHandler; readonly replay?: ReplayHandlerRegistration | ReplayUnsupportedRegistration; }
interface ReplayContext { readonly operation_id: string; readonly source_record_id: number; readonly trace_id: string; readonly payload_digest: string; readonly ack_path: string; }

export class EventBus {
  private static _instance: EventBus | null = null;
  private _handlers = new Map<string, RegisteredHandler[]>();
  private _isShuttingDown = false;
  public static get instance(): EventBus { return EventBus._instance || (EventBus._instance = new EventBus()); }
  private constructor() { logger.info('全局事件总线初始化完成'); }

  public subscribe<T extends DomainEvent>(eventType: EventType | string, handler: EventHandler<T>, replay?: ReplayHandlerRegistration | ReplayUnsupportedRegistration): void {
    if (this._isShuttingDown) return;
    if (replay && 'replay' in replay && (!replay.reason || replay.replay !== 'unsupported')) throw new Error('event_bus_replay_registration_invalid');
    if (replay && !('replay' in replay) && (!replay.handler_id || !replay.owner || typeof replay.deliverOrReadAck !== 'function')) throw new Error('event_bus_replay_registration_invalid');
    const list = this._handlers.get(eventType) || [];
    if (replay && !('replay' in replay) && list.some((entry) => entry.replay && !('replay' in entry.replay) && entry.replay.handler_id === replay.handler_id)) throw new Error('event_bus_replay_handler_id_duplicate');
    list.push({ fn: handler as EventHandler, replay: replay || { replay: 'unsupported', reason: 'owner_durable_replay_ack_missing' } });
    this._handlers.set(eventType, list);
  }
  public unsubscribe<T extends DomainEvent>(eventType: EventType | string, handler: EventHandler<T>): void {
    const list = this._handlers.get(eventType); if (!list) return;
    const index = list.findIndex((entry) => entry.fn === handler); if (index >= 0) list.splice(index, 1);
    if (!list.length) this._handlers.delete(eventType);
  }
  public async publish<T extends DomainEvent>(event: T): Promise<void> {
    const replay = getReplayContext(event);
    if (this._isShuttingDown) { if (replay) throw new Error('event_bus_shutting_down'); return; }
    const eventType = String((event as { event_type?: unknown }).event_type || 'unknown');
    const handlers = [...(this._handlers.get(eventType) || []), ...(this._handlers.get('*') || [])];
    if (!handlers.length) { if (replay) throw new Error(`event_bus_no_handler:${eventType}`); return; }
    if (replay) {
      const results = await Promise.allSettled(handlers.map(async (entry) => {
        if (!entry.replay) throw new Error('event_bus_replay_unsupported:handler_not_registered');
        if ('replay' in entry.replay) throw new Error(`event_bus_replay_unsupported:${entry.replay.reason}`);
        const ack = await entry.replay.deliverOrReadAck({ ...replay, envelope: event, event_type: eventType });
        validateOwnerAck(ack, replay, eventType, entry.replay);
        return ack;
      }));
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (rejected.length) throw new Error(`event_bus_handler_failed:${rejected.length}:${rejected[0].reason instanceof Error ? rejected[0].reason.message : String(rejected[0].reason)}`);
      const acks = results.map((result) => (result as PromiseFulfilledResult<ReplayDeliveryAck>).value);
      await writeReplayAck(replay, eventType, acks);
      return;
    }
    const failures = (await Promise.all(handlers.map((entry) => entry.fn(event).catch((error) => {
      DeadLetterQueue.instance.enqueue('', eventType, event, error as Error, { owner: 'kernel', sourcePath: 'core/kernel/src/foundation/event-bus/event-bus.ts', failurePhase: 'dispatch', retryPolicy: 'owner-confirmed', replayCommand: 'python core/kernel/tools/dlq.py replay kernel:<id> --confirm --dispatcher kernel.event-bus.v1' });
      return error;
    })))).filter(Boolean);
    if (failures.length) logger.error('事件处理器执行异常', { event_type: eventType, failure_count: failures.length });
  }
  public async shutdown(): Promise<void> { this._isShuttingDown = true; this._handlers.clear(); }
}

function getReplayContext(event: DomainEvent): ReplayContext | null {
  const value = (event as unknown as { replay_context?: Partial<ReplayContext> }).replay_context;
  if (!value) return null;
  const operationId = value.operation_id || '';
  if (!/^dlq_replay_[0-9a-f]{32}$/.test(operationId) || !Number.isInteger(value.source_record_id) || typeof value.trace_id !== 'string' || !/^[0-9a-f]{64}$/.test(value.payload_digest || '') || !isReplayAckPath(value.ack_path || '', operationId)) throw new Error('event_bus_replay_context_invalid');
  return value as ReplayContext;
}
function isReplayAckPath(ackPath: string, operationId: string): boolean { return path.resolve(ackPath) === path.join(path.resolve(resolveStatePath('kernel/dlq-replay-inbox/processed')), `${operationId}.receipt.json`); }
function validateOwnerAck(ack: ReplayDeliveryAck, replay: ReplayContext, eventType: string, registration: ReplayHandlerRegistration): void {
  if (ack?.status !== 'committed' || ack.handler_id !== registration.handler_id || ack.owner !== registration.owner || ack.operation_id !== replay.operation_id || ack.payload_digest !== replay.payload_digest || ack.event_type !== eventType || ack.source_record_id !== replay.source_record_id || ack.trace_id !== replay.trace_id || typeof ack.receipt_ref !== 'string' || !ack.receipt_ref) throw new Error('event_bus_replay_owner_ack_conflict');
}
async function readJson(target: string): Promise<Record<string, unknown> | null> { try { return JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
async function writeReplayAck(replay: ReplayContext, eventType: string, handlerAcks: ReplayDeliveryAck[]): Promise<void> {
  const ack = { schema_version: 2, status: 'success', receipt_id: `kernel_event_bus_${replay.operation_id}`, source: 'kernel', record_id: replay.source_record_id, owner: 'kernel', event_type: eventType, trace_id: replay.trace_id, payload_digest: replay.payload_digest, operation_id: replay.operation_id, dispatcher_id: 'kernel.event-bus.v1', delivery: 'kernel_event_bus_published', handler_acks: handlerAcks.map(({ handler_id, owner, receipt_ref }) => ({ handler_id, owner, receipt_ref })).sort((left, right) => left.handler_id.localeCompare(right.handler_id)), delivered_at: new Date().toISOString() };
  await mkdir(path.dirname(replay.ack_path), { recursive: true });
  try { await writeFile(replay.ack_path, `${JSON.stringify(ack, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; const existing = await readJson(replay.ack_path); if (JSON.stringify(existing?.handler_acks) !== JSON.stringify(ack.handler_acks) || existing?.payload_digest !== replay.payload_digest || existing?.operation_id !== replay.operation_id) throw new Error('event_bus_replay_ack_conflict'); }
}

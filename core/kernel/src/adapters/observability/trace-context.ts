/**
 * trace_id 跨异步边界上下文（TypeScript 端）
 * ─────────────────────────────────────────
 * 设计目的：让事件驱动多进程系统中所有相关的日志、IPC、错误能通过同一个
 * trace_id 串联——无需调用方手动透传到每个函数签名。
 *
 * 工作机制：
 * - AsyncLocalStorage 在 Promise / setTimeout / setImmediate / EventEmitter
 *   等异步边界自动延续 store
 * - 入口（如 IPC 入站、扩展回调）用 ``withTrace(traceId, fn)`` 包住业务逻辑
 * - 业务代码不需要感知 trace_id 的存在，logger 自动注入
 *
 * 字段约定：日志字段名固定为 ``trace_id``，与 Cognition / 协议层对齐。
 *
 * 参考：协议设计 docs/architecture/08-记忆与日志架构.md §3.3.1
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface TraceStore {
  trace_id: string;
  /** trace 内当前 span（嵌套原子操作）；无 span 时 undefined。 */
  span_id?: string;
}

const _als = new AsyncLocalStorage<TraceStore>();

/**
 * 当前异步上下文的 trace_id；不在 trace 范围内时返回 undefined。
 */
export function getCurrentTraceId(): string | undefined {
  return _als.getStore()?.trace_id;
}

/**
 * 当前异步上下文的 span_id；不在 span 范围内时返回 undefined。
 */
export function getCurrentSpanId(): string | undefined {
  return _als.getStore()?.span_id;
}

/**
 * 在指定 span 上下文中执行函数 —— 沿用当前 trace_id（无则新建），设置 span_id。
 * span API（tracer）在此之上构建。
 */
export function withSpan<T>(span_id: string, fn: () => T): T {
  const store = _als.getStore();
  const trace_id = store?.trace_id ?? newTraceId();
  return _als.run({ trace_id, span_id }, fn);
}

/**
 * 在 trace 上下文中执行函数；其内部所有日志、Promise 链、定时器都能拿到 trace_id。
 *
 * @example
 * await withTrace(event.trace_id, async () => {
 *   logger.info('开始处理事件');   // 自动带 trace_id
 *   await process(event);
 * });
 *
 * 嵌套使用：内层 withTrace 覆盖外层，外层在内层退出后恢复。
 */
export function withTrace<T>(trace_id: string, fn: () => T): T {
  if (!trace_id) {
    throw new Error('trace_id 不能为空；如需自动生成请使用 newTraceId()');
  }
  return _als.run({ trace_id }, fn);
}

/**
 * 生成新的 trace_id（UUIDv4，无连字符）。
 * 用于系统自发性事件（生命时钟唤醒、定时任务）这种没有上游 trace_id 的入口。
 */
export function newTraceId(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * 创建一个 TraceContext 对象（从 protocol/src/core.ts 搬入，阶段 P.5）。
 *
 * TraceContext 类型本身是 schema 契约（schemas/models/TraceContext）。
 * 这个工厂函数是 TS-only 便利（随机 UUID 填充 trace_id）—— 按铁律 2 不属于 protocol。
 */
import type { TraceContext } from '@glimmer-cradle/protocol';
export function createTraceContext(options?: Partial<TraceContext>): TraceContext {
  return {
    trace_id: options?.trace_id ?? randomUUID(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 合成 trace_id（决策 #5）
// ──────────────────────────────────────────────────────────────────────────────

/** 每模块独立计数器，避免锁竞争 */
const _syntheticCounters = new Map<string, number>();

/**
 * 生成 ``synthetic-{module}-{counter}`` 形式的占位 trace_id。
 *
 * 用于系统自发性事件（启动序列、定时任务等）确实没有上游 trace_id 的情况——
 * 保证日志检索时仍能按"批次"对齐。
 *
 * 见 docs/architecture/08-记忆与日志架构.md §3.3.1 决策 #5。
 */
export function syntheticTraceId(moduleName: string): string {
  const n = (_syntheticCounters.get(moduleName) ?? 0) + 1;
  _syntheticCounters.set(moduleName, n);
  return `synthetic-${moduleName}-${n}`;
}

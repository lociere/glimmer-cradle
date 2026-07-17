/**
 * tracer —— 遥测三支柱之 ③（Kernel 内核侧）
 * ─────────────────────────────────────────
 * span（trace 内一个原子操作）的实现。设计与认知核 `tracer.py` 同构：
 *
 * - span() 廉价：进入 = 新建 + 设当前 span_id；退出 = 入异步缓冲；不阻塞主循环。
 * - 父 span 通过 AsyncLocalStorage 自动延续（沿用 `trace-context.ts` 的 store）。
 * - 跨进程：调用方在 IPC 信封透传 trace_id + span_id；被调方入站时建为父上下文。
 * - 结构对齐 OpenTelemetry Span，未来加 exporter 即可对外。
 * - sink: data/observability/traces/kernel.jsonl；同 metrics 走 fs.appendFileSync 批量落盘。
 *
 * 见 docs/architecture/阶段3-遥测设计.md。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { getLogger } from './logger';
import { resolveTracesDir } from '../utils/path-utils';

const logger = getLogger('tracer');

// 重新使用 trace-context.ts 的同一份 AsyncLocalStorage —— 否则父 span 拿不到。
// 通过反向通道访问：trace-context 已经暴露 with*/getCurrent* 接口；这里需要的是
// 「在已有 store 上叠加 span_id 同时不丢 trace_id」。复用其内部 ALS 比再造一份更稳。
// → 选择：让 tracer 通过 trace-context 的 withSpan 入口去切换上下文。
import { getCurrentSpanId, getCurrentTraceId, newTraceId, withSpan } from './trace-context';

// ──────────────────────────────────────────────────────────────────────────────
// 写入器
// ──────────────────────────────────────────────────────────────────────────────

interface SpanEvent {
  name: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: 'ok' | 'error';
  attributes: Record<string, unknown>;
  error: string | null;
}

const FLUSH_INTERVAL_MS = 2000;
const SEGMENT_MAX_BYTES = 8 * 1024 * 1024;

let _buffer: SpanEvent[] = [];
let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _filePath = '';
let _running = false;

export function startTracer(): void {
  if (_running) return;
  const dir = resolveTracesDir();
  fs.mkdirSync(dir, { recursive: true });
  _filePath = path.join(dir, 'kernel.jsonl');
  _running = true;
  _flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  logger.info('span 写入器已启动', { path: _filePath });
}

export function stopTracer(): void {
  if (!_running) return;
  _running = false;
  if (_flushTimer) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
  flush();
  logger.info('span 写入器已停止');
}

function flush(): void {
  if (_buffer.length === 0) return;
  const pending = _buffer;
  _buffer = [];
  try {
    maybeRotate();
    fs.appendFileSync(_filePath, pending.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
  } catch (error) {
    logger.warn('span flush 失败', { error: (error as Error).message });
  }
}

function maybeRotate(): void {
  try {
    if (fs.existsSync(_filePath) && fs.statSync(_filePath).size >= SEGMENT_MAX_BYTES) {
      fs.renameSync(_filePath, `${_filePath}.${Math.floor(Date.now() / 1000)}`);
    }
  } catch {
    // 轮转失败不致命
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// span API
// ──────────────────────────────────────────────────────────────────────────────

/** 生成新的 span_id（16 hex chars，对齐 OTel）。 */
function newSpanId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

/** span 句柄：在 body 内可追加属性、显式标记状态。 */
export interface SpanHandle {
  readonly span_id: string;
  readonly trace_id: string;
  setAttribute(key: string, value: unknown): void;
  setStatus(status: 'ok' | 'error', error?: string): void;
}

/**
 * 在一个 span 内执行 fn。同步函数走同步路径，异步函数自动 await。
 *
 * @example
 *   await span('llm.generate', async (s) => {
 *     const r = await callLlm();
 *     s.setAttribute('tokens', r.tokens);
 *     return r;
 *   });
 */
export function span<T>(
  name: string,
  fn: (handle: SpanHandle) => T | Promise<T>,
  attributes: Record<string, unknown> = {},
): T | Promise<T> {
  const span_id = newSpanId();
  const parent_span_id = getCurrentSpanId() ?? null;
  // trace_id 缺失时新建（根 span）
  const trace_id = getCurrentTraceId() ?? newTraceId();
  const startedAt = new Date().toISOString();
  const startedMono = performance.now();
  const attrs: Record<string, unknown> = { ...attributes };
  let status: 'ok' | 'error' = 'ok';
  let errorName: string | null = null;

  const handle: SpanHandle = {
    span_id,
    trace_id,
    setAttribute(key, value) {
      attrs[key] = value;
    },
    setStatus(s, e) {
      status = s;
      if (e !== undefined) errorName = e;
    },
  };

  const finish = (thrownError?: unknown): void => {
    if (thrownError !== undefined && status === 'ok') {
      status = 'error';
      errorName = thrownError instanceof Error ? thrownError.name : String(thrownError);
    }
    if (_running) {
      _buffer.push({
        name,
        trace_id,
        span_id,
        parent_span_id,
        started_at: startedAt,
        ended_at: new Date().toISOString(),
        duration_ms: performance.now() - startedMono,
        status,
        attributes: attrs,
        error: errorName,
      });
    }
  };

  return withSpan(span_id, () => {
    try {
      const result = fn(handle);
      if (result && typeof (result as Promise<T>).then === 'function') {
        return (result as Promise<T>).then(
          (v) => {
            finish();
            return v;
          },
          (err) => {
            finish(err);
            throw err;
          },
        );
      }
      finish();
      return result;
    } catch (err) {
      finish(err);
      throw err;
    }
  });
}

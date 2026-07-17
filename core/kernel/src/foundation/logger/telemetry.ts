/**
 * Telemetry Facade（Kernel 内核侧，蓝图阶段 3.5）
 * ─────────────────────────────────────────
 * 把遥测三支柱 `log() / metric() / span()` 统一在一个门面之下。
 *
 * 设计原则：
 * 1. **薄门面**：不重写底层模块（logger / metrics / tracer），仅集中 re-export。
 * 2. **trace 上下文自动注入**：winston 已有 trace_id/span_id 注入；
 *    metric / span 内部自己读 ALS。门面层不引入新的隐式状态。
 * 3. **既有调用方零侵入**：底层模块的命名导出保持不变；门面是可选入口。
 *
 * 用法（推荐）::
 *
 *   import { telemetry } from './foundation/logger/telemetry';
 *
 *   const log = telemetry.getLogger('chat-handler');
 *   log.info('开始对话', { scene_id });
 *
 *   await telemetry.span('memory.retrieve', async (s) => {
 *     const r = await retrieve(query);
 *     s.setAttribute('hit_count', r.length);
 *     return r;
 *   });
 *
 *   telemetry.counter('chat.calls');
 *   telemetry.gauge('emotion.intensity', 0.7, { emotion: 'happy' });
 *   telemetry.histogram('chat.duration_ms', duration);
 */
export { getLogger, initLogger, closeLogger } from './logger';
export type { ILogger } from './logger';

export {
  counter,
  gauge,
  histogram,
  metric,
  startMetrics,
  stopMetrics,
} from './metrics';
export type { MetricKind } from './metrics';

export { span, startTracer, stopTracer } from './tracer';
export type { SpanHandle } from './tracer';

export {
  getCurrentTraceId,
  getCurrentSpanId,
  newTraceId,
  syntheticTraceId,
  withSpan,
  withTrace,
} from './trace-context';

// 默认导出一个聚合命名空间，方便 `import { telemetry } from '.../telemetry'` 用法。
import * as _logger from './logger';
import * as _metrics from './metrics';
import * as _tracer from './tracer';
import * as _traceCtx from './trace-context';

export const telemetry = {
  // logs
  getLogger: _logger.getLogger,
  initLogger: _logger.initLogger,
  closeLogger: _logger.closeLogger,
  // metrics
  metric: _metrics.metric,
  counter: _metrics.counter,
  gauge: _metrics.gauge,
  histogram: _metrics.histogram,
  startMetrics: _metrics.startMetrics,
  stopMetrics: _metrics.stopMetrics,
  // traces
  span: _tracer.span,
  startTracer: _tracer.startTracer,
  stopTracer: _tracer.stopTracer,
  // trace 上下文
  withTrace: _traceCtx.withTrace,
  withSpan: _traceCtx.withSpan,
  newTraceId: _traceCtx.newTraceId,
  syntheticTraceId: _traceCtx.syntheticTraceId,
  getCurrentTraceId: _traceCtx.getCurrentTraceId,
  getCurrentSpanId: _traceCtx.getCurrentSpanId,
} as const;

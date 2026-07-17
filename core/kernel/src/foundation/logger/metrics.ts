/**
 * metrics —— 遥测三支柱之 ②（Kernel 内核侧）
 * ─────────────────────────────────────────
 * counter / gauge / histogram 事件流。设计与认知核 `metrics.py` 同构：
 * - metric() 廉价：仅入内存缓冲，定时批量落盘，不阻塞内核主循环
 * - 事件流而非时序数据库 —— append 到 data/observability/metrics/kernel.jsonl
 * - 每条 metric 自动带 trace_id，与运营日志可对齐
 * - 未启动时 metric() 为无操作
 *
 * 见 docs/architecture/阶段3-遥测设计.md。
 */
import fs from 'fs';
import path from 'path';
import type { MetricKind } from '@glimmer-cradle/protocol';
import { getCurrentTraceId } from './trace-context';
import { getLogger } from './logger';
import { resolveMetricsDir } from '../utils/path-utils';

const logger = getLogger('metrics');

// MetricKind 单一事实源是 protocol/src/schemas/enums/MetricKind.schema.json
// （Protocol 契约铁律 1）。re-export 保持既有 `import { MetricKind }` 调用方可用。
export type { MetricKind };

interface MetricEvent {
  ts: string;
  name: string;
  kind: MetricKind;
  value: number;
  labels: Record<string, string>;
  trace_id: string;
}

const METRIC_LABEL_ALLOWLIST = new Set([
  'action',
  'address_mode',
  'attention_projection_mode',
  'backend',
  'capability_kind',
  'emotion',
  'error_code',
  'error_kind',
  'from',
  'module',
  'op',
  'owner',
  'phase',
  'process_kind',
  'provider',
  'provider_id',
  'provider_kind',
  'reason',
  'risk_level',
  'response_policy',
  'scene_kind',
  'source',
  'skill_id',
  'state',
  'status',
  'target_kind',
  'target_name',
  'tier',
  'tool_name',
  'to',
]);

const FLUSH_INTERVAL_MS = 2000;
const SEGMENT_MAX_BYTES = 8 * 1024 * 1024;

let _buffer: MetricEvent[] = [];
let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _filePath = '';
let _running = false;

export function startMetrics(): void {
  if (_running) {
    return;
  }
  const dir = resolveMetricsDir();
  fs.mkdirSync(dir, { recursive: true });
  _filePath = path.join(dir, 'kernel.jsonl');
  _running = true;
  _flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  logger.info('metrics 写入器已启动', { path: _filePath });
}

export function stopMetrics(): void {
  if (!_running) {
    return;
  }
  _running = false;
  if (_flushTimer) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
  flush();
  logger.info('metrics 写入器已停止');
}

function flush(): void {
  if (_buffer.length === 0) {
    return;
  }
  const pending = _buffer;
  _buffer = [];
  try {
    maybeRotate();
    fs.appendFileSync(_filePath, pending.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
  } catch (error) {
    logger.warn('metrics flush 失败', { error: (error as Error).message });
  }
}

function maybeRotate(): void {
  try {
    if (fs.existsSync(_filePath) && fs.statSync(_filePath).size >= SEGMENT_MAX_BYTES) {
      fs.renameSync(_filePath, `${_filePath}.${Math.floor(Date.now() / 1000)}`);
    }
  } catch {
    // 轮转失败不致命，继续写原文件
  }
}

/** 记录一条 metric。未启动时为无操作 —— 自动带 trace_id。 */
export function metric(
  name: string,
  kind: MetricKind,
  value: number,
  labels: Record<string, string> = {},
): void {
  if (!_running) {
    return;
  }
  _buffer.push({
    ts: new Date().toISOString(),
    name,
    kind,
    value,
    labels: sanitizeMetricLabels(name, labels),
    trace_id: getCurrentTraceId() ?? '',
  });
}

/** 累加计数。 */
export function counter(name: string, value = 1, labels?: Record<string, string>): void {
  metric(name, 'counter', value, labels);
}

/** 瞬时值。 */
export function gauge(name: string, value: number, labels?: Record<string, string>): void {
  metric(name, 'gauge', value, labels);
}

/** 分布采样（延迟、耗时等）。 */
export function histogram(name: string, value: number, labels?: Record<string, string>): void {
  metric(name, 'histogram', value, labels);
}

export function sanitizeMetricLabels(
  metricName: string,
  labels: Record<string, string>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (!METRIC_LABEL_ALLOWLIST.has(key)) {
      logger.warn('metrics label 已丢弃（不在白名单）', { metric_name: metricName, label_key: key });
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

/* 自动生成 — 从 MetricKind.schema.json 生成，勿手动修改 */

/** 遥测指标三类（对齐 OpenTelemetry 语义）。跨层单一事实源，Kernel 内核与 Cognition 认知核共用。counter=单调累加（调用次数/错误数）；gauge=瞬时值（情绪强度/记忆条数/队列深度）；histogram=分布（延迟/耗时/token 数）。 */
export type MetricKind =
  | 'counter'
  | 'gauge'
  | 'histogram';

/** MetricKind 值访问对象（MetricKind.XXX）。 */
export const MetricKind = {
  COUNTER: 'counter',
  GAUGE: 'gauge',
  HISTOGRAM: 'histogram',
} as const satisfies Record<string, MetricKind>;

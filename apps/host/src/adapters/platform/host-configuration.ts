import { openSync, closeSync, readSync } from 'node:fs';
import { TextDecoder } from 'node:util';
import { parseDocument } from 'yaml';
import { ConfigurationValidator } from '@glimmer-cradle/platform/configuration';
import { retryDelay } from '@glimmer-cradle/jobs';
import JobsConfig from '@glimmer-cradle/contracts/json-schema/config/v1/jobs-config.schema.json';
import HostConfig from '@glimmer-cradle/contracts/json-schema/config/v1/host-config.schema.json';
import MemoryConfig from '@glimmer-cradle/contracts/json-schema/config/v1/memory-config.schema.json';
import type { HostJobsOptions } from '../../composition/host.js';
import type { WorkerSupervisorOptions } from '../../supervision/worker-supervisor.js';
import type { HostDataPaths } from './data-paths.js';

export class HostConfigurationError extends Error {
  public constructor(public readonly owner: 'host' | 'jobs' | 'memory') { super(`Host ${owner} 配置无效或不可读取`); }
}
/** 只映射已有内部装配参数，不创建可序列化 Document 的第二类型源。 */
export interface HostCognitionJobsConfiguration {
  readonly jobs: Pick<HostJobsOptions, 'poll_interval_ms' | 'batch_size' | 'lease_ms' | 'retry_policy' | 'submission_policy' | 'terminal_retention_ms'>;
  // 此处为装配参数，不反向 import composition owner，避免包含 type edge 的依赖环。
  readonly authority: { readonly authority_lease_ms: number; readonly renewal_interval_ms: number };
  readonly worker: Pick<WorkerSupervisorOptions, 'startup_timeout_ms' | 'shutdown_timeout_ms' | 'request_timeout_ms'>;
  /** 同一 Memory 事实源同时约束源政策与 Worker 装配，不能保留调用方另一份 Memory 配置。 */
  readonly memory_document: Readonly<Record<string, unknown>>;
}
const validator = new ConfigurationValidator({ JobsConfig, HostConfig, MemoryConfig });
function document(file: string, owner: HostConfigurationError['owner'], schema: 'JobsConfig' | 'HostConfig' | 'MemoryConfig') {
  try {
    const fd = openSync(file, 'r');
    let size = 0;
    const buffer = Buffer.alloc(1_048_577);
    try { while (size < buffer.length) { const count = readSync(fd, buffer, size, buffer.length - size, null); if (!count) break; size += count; } }
    finally { closeSync(fd); }
    if (size > 1_048_576) throw new Error('配置超过读取上限');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size));
    if (text.startsWith('\uFEFF')) throw new Error('配置包含 BOM');
    const parsed = parseDocument(text, { uniqueKeys: true });
    if (parsed.errors.length) throw new Error('配置 YAML 无效');
    const value: unknown = parsed.toJS({ maxAliasCount: 100 });
    if (!validator.validate(schema, value).ok) throw new Error('配置 Schema 无效');
    return value as Record<string, unknown>;
  } catch { throw new HostConfigurationError(owner); }
}
export function loadHostCognitionJobsConfiguration(paths: HostDataPaths): HostCognitionJobsConfiguration {
  const host = document(paths.host_config, 'host', 'HostConfig');
  const jobs = document(paths.jobs_config, 'jobs', 'JobsConfig');
  const memory = document(paths.memory_config, 'memory', 'MemoryConfig');
  const scheduler = jobs.scheduler as Record<string, number>, retry = jobs.retry as Record<string, number>;
  const retention = jobs.retention as Record<string, number>, authority = host.authority as Record<string, number>;
  const cognition = host.cognition as Record<string, number>, consolidation = memory.consolidation as Record<string, number>;
  try {
    retryDelay(1, { base_delay_ms: retry.base_delay_ms, max_delay_ms: retry.max_delay_ms });
    if (authority.renewal_interval_ms >= authority.lease_ms
      || cognition.request_timeout_ms > cognition.startup_timeout_ms) throw new HostConfigurationError('host');
    const debounce = consolidation.debounce_seconds * 1000;
    if (!Number.isSafeInteger(debounce) || debounce < 0) throw new HostConfigurationError('memory');
    freezeDocument(memory);
    return Object.freeze({
      jobs: Object.freeze({ poll_interval_ms: scheduler.poll_interval_ms, batch_size: scheduler.batch_size,
        lease_ms: scheduler.lease_ms, terminal_retention_ms: retention.terminal_ms,
        retry_policy: Object.freeze({ base_delay_ms: retry.base_delay_ms, max_delay_ms: retry.max_delay_ms }),
        submission_policy: Object.freeze({ debounce_ms: debounce, max_attempts: retry.max_attempts }) }),
      authority: Object.freeze({ authority_lease_ms: authority.lease_ms, renewal_interval_ms: authority.renewal_interval_ms }),
      worker: Object.freeze({ startup_timeout_ms: cognition.startup_timeout_ms,
        shutdown_timeout_ms: cognition.shutdown_timeout_ms, request_timeout_ms: cognition.request_timeout_ms }),
      memory_document: memory,
    });
  } catch (error) { if (error instanceof HostConfigurationError) throw error; throw new HostConfigurationError('jobs'); }
}
function freezeDocument(value: unknown): void {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeDocument(child); Object.freeze(value); }
}

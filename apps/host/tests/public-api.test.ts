import { it, expect } from 'vitest';
import * as api from '../src/index.js';
import type { HostJobsOptions } from '../src/index.js';

it('Host 暴露实际 App 装配/adapter，而不暴露 Kernel 内部或底层 DB connection', () => {
  expect(Object.keys(api).sort()).toEqual(['CognitionClient', 'CognitionJobAdapter', 'HostCognitionError', 'HostJobsController',
    'HostJobsOwner', 'SqliteAuthorityStore',
    'MEMORY_JOB_KIND', 'memoryJobEvidence', 'memoryJobIdentity', 'memoryJobRequest'].sort());
});

it('Host 拒绝 Node timer 溢出与非法扫描/authority/政策，不把超长间隔变成 1ms 热循环', () => {
  const options = { epoch: 1, owner_id: 'host', poll_interval_ms: 10, batch_size: 8, lease_ms: 1000,
    submission_policy: { debounce_ms: 0, max_attempts: 3 }, retry_policy: { base_delay_ms: 1, max_delay_ms: 10 } };
  for (const drift of [{ poll_interval_ms: 2_147_483_648 }, { poll_interval_ms: 0 }, { batch_size: 1001 },
    { epoch: 0 }, { lease_ms: -1 }, { owner_id: '' }, { submission_policy: { debounce_ms: -1, max_attempts: 3 } }]) {
    expect(() => new api.HostJobsController({ ...options, ...drift } as HostJobsOptions)).toThrow('装配参数');
  }
});

import { it, expect } from 'vitest';
import * as api from '../src/index.js';
import type { HostJobsOptions } from '../src/index.js';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { create } from '@bufbuild/protobuf';
import { PublishStateResponseSchema } from '@glimmer-cradle/contracts/glimmer/kernel/v1/kernel_control_service_pb';

it('Host 暴露实际 App 装配/adapter，而不暴露 Kernel 内部或底层 DB connection', () => {
  expect(Object.keys(api).sort()).toEqual(['CognitionClient', 'CognitionJobAdapter', 'HostCognitionError', 'HostJobsController',
    'HostJobsOwner', 'HostCognitionJobsOwner', 'WorkerSupervisor', 'SqliteAuthorityStore',
    'MEMORY_JOB_KIND', 'memoryJobEvidence', 'memoryJobIdentity', 'memoryJobRequest'].sort());
});

it('Worker console 按完整 UTF-8 行脱敏，跨 chunk/JSON 转义/超长行不泄露秘密', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-console-'));
  const consolePath = path.join(root, 'console.log');
  const secret = 'secret-"value';
  const supervisor = new api.WorkerSupervisor({ python_executable: path.join(root, 'python.exe'), app_root: root,
    data_root: root, console_path: consolePath, runtime_document: { api_key: secret }, environment: { FIXTURE_TOKEN: 'env-secret' },
    startup_timeout_ms: 100, shutdown_timeout_ms: 100, request_timeout_ms: 100,
    accept_state: async () => create(PublishStateResponseSchema) });
  const capture = supervisor as unknown as { capture(stream: NodeJS.ReadableStream): void };
  const stream = new PassThrough(); capture.capture(stream);
  stream.write('safe secret-'); stream.write('"value env-secret Bearer private-token\n');
  stream.write(JSON.stringify({ api_key: secret }) + '\n');
  stream.write('中'.repeat(23000)); stream.write(secret + '\n');
  stream.end('safe last'); await new Promise(resolve => stream.once('end', resolve));
  const output = readFileSync(consolePath, 'utf8');
  expect(output).toContain('[REDACTED]'); expect(output).toContain('[worker console line omitted]');
  expect(output).toContain('safe last'); expect(output).not.toContain('env-secret');
  expect(output).not.toContain(secret); expect(output).not.toContain(JSON.stringify(secret).slice(1, -1));
  expect(output).not.toContain('private-token'); await supervisor.stop();
});

it('Host 拒绝 Node timer 溢出与非法扫描/authority/政策，不把超长间隔变成 1ms 热循环', () => {
  const options = { epoch: 1, owner_id: 'host', poll_interval_ms: 10, batch_size: 8, lease_ms: 1000,
    submission_policy: { debounce_ms: 0, max_attempts: 3 }, retry_policy: { base_delay_ms: 1, max_delay_ms: 10 } };
  for (const drift of [{ poll_interval_ms: 2_147_483_648 }, { poll_interval_ms: 0 }, { batch_size: 1001 },
    { epoch: 0 }, { lease_ms: -1 }, { owner_id: '' }, { submission_policy: { debounce_ms: -1, max_attempts: 3 } }]) {
    expect(() => new api.HostJobsController({ ...options, ...drift } as HostJobsOptions)).toThrow('装配参数');
  }
});

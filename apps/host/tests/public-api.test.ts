import { it, expect } from 'vitest';
import * as api from '../src/index.js';
import type { HostJobsOptions } from '../src/index.js';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { create } from '@bufbuild/protobuf';
import { PublishStateResponseSchema } from '@glimmer-cradle/contracts/glimmer/kernel/v1/kernel_control_service_pb';

it('Host 暴露实际 App 装配/adapter，而不暴露 Kernel 内部或底层 DB connection', () => {
  expect(Object.keys(api).sort()).toEqual(['CognitionClient', 'CognitionJobAdapter', 'HostCognitionError', 'HostJobsController',
    'HostJobsOwner', 'HostCognitionJobsOwner', 'ConfiguredHostCognitionJobsOwner', 'WorkerSupervisor', 'SqliteAuthorityStore',
    'HostDataPaths', 'HostConfigurationError', 'loadHostCognitionJobsConfiguration',
    'MEMORY_JOB_KIND', 'memoryJobEvidence', 'memoryJobIdentity', 'memoryJobRequest',
    'PermissionBroker', 'HostResourceContributions', 'HostKnowledgeController', 'HostCapabilityRequestError'].sort());
});

function configPaths() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-config-'));
  const paths = new api.HostDataPaths({ app_root: path.join(root, 'installation'), config_root: path.join(root, 'config'), data_root: path.join(root, 'data') });
  mkdirSync(path.dirname(paths.host_config), { recursive: true });
  for (const file of [paths.host_config, paths.jobs_config, paths.memory_config]) writeFileSync(file, '{}\n', 'utf8');
  return paths;
}
const approval = { source_id: 'source:资料', source_revision: 1, declaration_digest: 'a'.repeat(64),
  arguments: {}, max_age_ms: 500, expires_at_ms: 9007199254740991 };
it.each([
  { ...approval, source_id: ' ' }, { ...approval, source_revision: 0 }, { ...approval, source_revision: 9007199254740992 },
  { ...approval, declaration_digest: 'forged' }, { ...approval, max_age_ms: 86400001 },
  { ...approval, expires_at_ms: 0 }, { ...approval, arguments: { value: 'x'.repeat(32768) } },
])('Knowledge 审批拒绝非法绑定/参数，不创建数据', value => {
  const paths = configPaths();
  writeFileSync(paths.host_config, JSON.stringify({ knowledge: { approvals: [value] } }), 'utf8');
  expect(() => api.loadHostCognitionJobsConfiguration(paths)).toThrow(api.HostConfigurationError);
  expect(existsSync(paths.data_root)).toBe(false);
});
it('Knowledge 审批重复和非有限 JSON 拒绝；有审批而无 Resource 装配在建库前失败', async () => {
  const paths = configPaths();
  writeFileSync(paths.host_config, JSON.stringify({ knowledge: { approvals: [approval, approval] } }), 'utf8');
  expect(() => api.loadHostCognitionJobsConfiguration(paths)).toThrow(api.HostConfigurationError);
  writeFileSync(paths.host_config, `knowledge:\n  approvals:\n    - source_id: source:资料\n      source_revision: 1\n      declaration_digest: ${approval.declaration_digest}\n      arguments: { value: .nan }\n      max_age_ms: 500\n      expires_at_ms: 9007199254740991\n`, 'utf8');
  expect(() => api.loadHostCognitionJobsConfiguration(paths)).toThrow(api.HostConfigurationError);
  writeFileSync(paths.host_config, JSON.stringify({ knowledge: { approvals: [approval] } }), 'utf8');
  const owner = new api.ConfiguredHostCognitionJobsOwner({ paths, clock: { now: Date.now }, owner_id: 'no-resource',
    worker: { python_executable: path.join(paths.app_root, 'python.exe'), runtime_document: {}, accept_state: async () => {
      throw new Error('must not start');
    } } });
  await expect(owner.start()).rejects.toThrow('真实 Resource');
  expect(existsSync(paths.data_root)).toBe(false); await owner.stop();
});
it('配置从唯一 Schema 填默认值并冻结；根显式分离，loader 不创建任何数据/安装产物', () => {
  const paths = configPaths(), configuration = api.loadHostCognitionJobsConfiguration(paths);
  expect(configuration).toMatchObject({ jobs: { poll_interval_ms: 1000, batch_size: 8, lease_ms: 180000,
    retry_policy: { base_delay_ms: 30000, max_delay_ms: 3600000 }, terminal_retention_ms: 1209600000,
    submission_policy: { debounce_ms: 120000, max_attempts: 3 } },
  authority: { authority_lease_ms: 60000, renewal_interval_ms: 20000 },
  worker: { startup_timeout_ms: 120000, shutdown_timeout_ms: 30000, request_timeout_ms: 30000 } });
  expect(Object.isFrozen(configuration.jobs.retry_policy)).toBe(true);
  expect(Object.isFrozen(configuration.memory_document.consolidation)).toBe(true);
  expect(configuration.knowledge_approvals).toEqual([]);
  expect(Object.isFrozen(configuration.knowledge_approvals)).toBe(true);
  expect(paths.jobs_database).toBe(path.join(paths.data_root, 'state/jobs/jobs.sqlite'));
  expect(paths.authority_database).toBe(path.join(paths.data_root, 'state/platform/authority.sqlite'));
  expect(existsSync(paths.data_root)).toBe(false); expect(existsSync(paths.app_root)).toBe(false);
  expect(() => new api.HostDataPaths({ app_root: '.', config_root: '.', data_root: '.' })).toThrow('绝对路径');
});
it.each([
  ['jobs', { scheduler: { poll_interval_ms: 0 } }], ['jobs', { scheduler: { poll_interval_ms: 2147483648 } }],
  ['jobs', { scheduler: { batch_size: 1001 } }], ['jobs', { retry: { max_attempts: 0 } }],
  ['jobs', { retry: { base_delay_ms: 100, max_delay_ms: 99 } }], ['jobs', { retention: { terminal_ms: -1 } }],
  ['host', { authority: { lease_ms: 1, renewal_interval_ms: 1 } }],
  ['host', { cognition: { startup_timeout_ms: 1, request_timeout_ms: 2 } }],
  ['memory', { consolidation: { debounce_seconds: 9007199254740991 } }],
  ['jobs', { debounce_ms: 1 }], ['host', { data_root: '/other-root' }], ['memory', { retry: { max_attempts: 1 } }],
  ['jobs', { retry: { max_attempts: 'fixture-private-key' } }],
] as const)('配置非法值/owner 越界拒绝且不泄露输入（%s）', (owner, value) => {
  const paths = configPaths();
  writeFileSync(paths[`${owner}_config`], JSON.stringify(value), 'utf8');
  let error: unknown;
  try { api.loadHostCognitionJobsConfiguration(paths); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(api.HostConfigurationError);
  expect(error).toMatchObject({ owner }); expect(String(error)).not.toContain('fixture-private-key');
  expect(existsSync(paths.data_root)).toBe(false);
});
it.each(['missing', 'duplicate', 'broken', 'utf8', 'bom', 'oversized', 'alias'])('配置读取边界拒绝 %s，不回落另一个源', mode => {
  const paths = configPaths();
  const values = { duplicate: 'retry: {}\nretry: {}\n', broken: 'retry: [\n', utf8: Buffer.from([0xff]),
    bom: '\uFEFF{}', oversized: '#'.repeat(1048577), alias: 'retry: &bad { base_delay_ms: *bad }' };
  if (mode === 'missing') {
    const missing = new api.HostDataPaths({ ...paths, config_root: path.join(paths.config_root, 'missing') });
    expect(() => api.loadHostCognitionJobsConfiguration(missing)).toThrow(api.HostConfigurationError);
  } else {
    writeFileSync(paths.jobs_config, values[mode as keyof typeof values]);
    expect(() => api.loadHostCognitionJobsConfiguration(paths)).toThrow(api.HostConfigurationError);
  }
  expect(existsSync(paths.data_root)).toBe(false);
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

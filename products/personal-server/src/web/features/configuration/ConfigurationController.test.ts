import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigurationController, type ConfigurationPort } from './ConfigurationController';
import { configurationScenario } from '../../../../tests/ui/scenarios/configuration';
import type { ConfigurationUpdateResult } from '../../../shared/control-center-models';
import type { AccessTokenSnapshot, DeploymentOperationResult } from '../../shared/api/personal-server-client';
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const operations = { backup: { supported: false, entries: [] }, service: { restart_supported: false, stop_supported: false }, update: { check_supported: false, apply_supported: false, current_version: 'test', source: 'test' } };
const tokens: AccessTokenSnapshot = { mode: 'open_local', degraded: true, message: 'test', tokens: [] };
function port(overrides: Partial<ConfigurationPort> = {}): ConfigurationPort {
  return { read: async () => configurationScenario(), preview: async () => { throw Error('unused'); }, save: async () => { throw Error('unused'); }, testProvider: async () => { throw Error('unused'); }, tokens: async () => tokens, mutateToken: async () => ({ status: 'success', message: 'created', snapshot: tokens, issued_token: 'one-time' }), operations: async () => operations, runOperation: async () => { throw Error('unused'); }, operationResult: async () => null, skills: async () => ({ status: 'error', request_id: 'test', message: 'unavailable' }), close: () => {}, ...overrides };
}
test('离页中止 Port，迟到读取和令牌不能写回或泄漏到新页面', async () => {
  const read = deferred<ReturnType<typeof configurationScenario>>(); let closed = 0;
  const controller = new ConfigurationController(); controller.connect(port({ read: () => read.promise, close: () => closed++ }));
  controller.stop(); read.resolve(configurationScenario()); await flush();
  assert.equal(closed, 1); assert.equal(controller.getSnapshot().draft, null); assert.equal(controller.getSnapshot().tokens, null);
});
test('刷新和重连保留草稿修订，保存冲突不把新快照套到旧草稿', async () => {
  const controller = new ConfigurationController(); const config = configurationScenario();
  controller.connect(port({ save: async () => ({ status: 'conflict', request_id: 'save', message: 'revision conflict', apply_state: 'unchanged', change_summary: [], snapshot: { ...config, revision: 'new' } } as ConfigurationUpdateResult) })); await flush();
  controller.edit(draft => { draft.memory.working!.context_message_limit = 12; }); await controller.submit(false);
  assert.equal(controller.getSnapshot().draft?.revision, config.revision);
  controller.connect(null); controller.connect(port({ read: async () => ({ ...config, revision: 'new' }) })); await flush();
  assert.equal(controller.getSnapshot().draft?.memory.working?.context_message_limit, 12); assert.equal(controller.getSnapshot().draft?.revision, config.revision);
  controller.discard(); assert.equal(controller.getSnapshot().draft?.revision, 'new'); controller.stop();
});
test('预览和保存防重，预览保留密钥草稿，保存成功后清空密钥', async () => {
  const controller = new ConfigurationController(); const result = deferred<ConfigurationUpdateResult>(); let calls = 0;
  controller.connect(port({ read: async () => configurationScenario(false), preview: async () => ({ status: 'preview', request_id: 'preview', message: 'preview', apply_state: 'unchanged', change_summary: [] }), save: () => { calls++; return result.promise; } })); await flush();
  controller.edit(draft => { draft.providers[0].api_key = 'new-secret'; }); await controller.submit(true);
  assert.equal(controller.getSnapshot().draft?.providers[0].api_key, 'new-secret');
  const pending = controller.submit(false); await controller.submit(false); controller.edit(draft => { draft.providers[0].key = 'wrong'; });
  assert.equal(calls, 1); assert.equal(controller.getSnapshot().draft?.providers[0].key, 'primary');
  result.resolve({ status: 'success', request_id: 'save', message: 'saved', apply_state: 'completed', change_summary: [], snapshot: configurationScenario(false) }); await pending;
  assert.equal(controller.getSnapshot().draft?.providers[0].api_key, ''); controller.stop();
});
test('较旧访问状态读取不能覆盖新令牌结果，失败明确呈现且可重试', async () => {
  const controller = new ConfigurationController(); const old = deferred<AccessTokenSnapshot>();
  controller.connect(port({ tokens: () => old.promise, operations: async () => { throw Error('bridge offline'); } })); await flush();
  await controller.mutateToken('create', 'laptop'); old.resolve({ ...tokens, message: 'stale' }); await flush();
  assert.equal(controller.getSnapshot().tokens?.message, 'test'); assert.equal(controller.getSnapshot().tokenResult?.issued_token, 'one-time');
  assert.equal(controller.getSnapshot().operationsError, 'bridge offline'); controller.hideToken(); assert.equal(controller.getSnapshot().tokenResult, null); controller.stop();
});
test('部署事务使用同一 receipt 轮询，离页后迟到结果不能继续轮询', async () => {
  const controller = new ConfigurationController(); const result = deferred<DeploymentOperationResult | null>(); let polls = 0; let operationId = '';
  controller.connect(port({ runOperation: async (operation, options) => { operationId = options.operationId; return { operation_id: operationId, operation, status: 'accepted', message: 'accepted', snapshot: operations }; }, operationResult: async id => { assert.equal(id, operationId); polls++; return result.promise; } })); await flush();
  await controller.runOperation('backup.create'); await controller.runOperation('backup.create'); assert.equal(polls, 1);
  controller.stop(); result.resolve({ operation_id: operationId, operation: 'backup.create', status: 'started', message: 'started', snapshot: operations }); await flush();
  await new Promise(resolve => setTimeout(resolve, 1050)); assert.equal(polls, 1);
});
test('恢复原事务并消费终态，未确认结果前不重复发起操作', async () => {
  const storage = new Map<string, string>([['glimmer-cradle.personal-server.active-operation', 'original']]);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key), removeItem: (key: string) => storage.delete(key) } });
  const controller = new ConfigurationController();
  try { controller.connect(port({ operationResult: async id => ({ operation_id: id, operation: 'backup.create', status: 'committed', message: 'done', snapshot: operations }) })); await flush(); assert.equal(controller.getSnapshot().operationResult?.operation_id, 'original'); assert.equal(controller.getSnapshot().operationPending, false); assert.equal(storage.size, 0); }
  finally { controller.stop(); if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});
test('旧运维读取和错误不能覆盖已提交的新事务快照', async () => {
  const old = deferred<typeof operations>(); let reads = 0;
  const controller = new ConfigurationController();
  controller.connect(port({ operations: () => ++reads === 1 ? Promise.resolve(operations) : old.promise, runOperation: async (operation, options) => ({ operation_id: options.operationId, operation, status: 'committed', message: 'done', snapshot: { ...operations, update: { ...operations.update, current_version: 'new' } } }) })); await flush();
  const refresh = controller.refreshSupplemental(); await controller.runOperation('update.check'); old.resolve(operations); await refresh;
  assert.equal(controller.getSnapshot().operations?.update.current_version, 'new'); controller.stop();
});
test('查询终态先于 POST accepted 返回时不回退为永久 pending', async () => {
  const posted = deferred<DeploymentOperationResult>(); let id = '';
  const controller = new ConfigurationController();
  controller.connect(port({ runOperation: async (_operation, options) => { id = options.operationId; return posted.promise; }, operationResult: async operationId => ({ operation_id: operationId, operation: 'backup.create', status: 'committed', message: 'done', snapshot: operations }) })); await flush();
  const running = controller.runOperation('backup.create'); await controller.refreshSupplemental(); await flush();
  assert.equal(controller.getSnapshot().operationPending, false);
  posted.resolve({ operation_id: id, operation: 'backup.create', status: 'accepted', message: 'accepted', snapshot: operations }); await running;
  assert.equal(controller.getSnapshot().operationPending, false); assert.equal(controller.getSnapshot().operationResult?.status, 'committed'); controller.stop();
});

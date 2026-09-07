import assert from 'node:assert/strict';
import test from 'node:test';
import { ExtensionsController, type ExtensionsPort } from './ExtensionsController';
import type { ExtensionInstallPreview, ExtensionInstallResult, ExtensionRuntimeProjectionResult } from '../../../shared/control-center-models';

const catalog: ExtensionRuntimeProjectionResult = { request_id: 'read', status: 'success', projections: [], installations: [] };
const preview: ExtensionInstallPreview = { request_id: 'prepare', status: 'ready', transaction_id: 'transaction' };
const request = { request_id: 'prepare', source: { kind: 'repository' as const, repository: 'community/echo', tag: 'v1' } };
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function setup(overrides: Partial<ExtensionsPort> = {}) {
  const cancelled: string[] = [];
  const port: ExtensionsPort = {
    read: async () => catalog, prepare: async () => preview,
    commit: async () => ({ request_id: 'commit', status: 'success' }),
    cancel: async (id) => { cancelled.push(id); return { request_id: 'cancel', status: 'cancelled' }; },
    lifecycle: async (id, operation) => ({ request_id: 'life', extension_id: id, operation, status: 'success' }),
    uninstall: async (id, version) => ({ request_id: 'uninstall', extension_id: id, version, status: 'success' }),
    upload: async () => { throw new Error('upload failed'); }, ...overrides,
  };
  const controller = new ExtensionsController(); controller.connect(port);
  return { controller, port, cancelled };
}
test('late prepare releases its transaction on original port after route teardown', async () => {
  const pending = deferred<ExtensionInstallPreview>();
  const { controller, cancelled } = setup({ prepare: () => pending.promise });
  void controller.prepare(request); controller.stop(); pending.resolve(preview); await settle();
  assert.deepEqual(cancelled, ['transaction']); assert.equal(controller.getSnapshot().preview, null);
});
test('ready preview is cancelled on leave and stale catalog cannot replace a new connection', async () => {
  const old = deferred<ExtensionRuntimeProjectionResult>();
  const { controller, port, cancelled } = setup({ read: () => old.promise });
  await controller.prepare(request); controller.connect({ ...port, read: async () => catalog });
  old.resolve({ ...catalog, status: 'error', message: 'old error' }); await settle();
  assert.deepEqual(cancelled, ['transaction']); assert.equal(controller.getSnapshot().error, ''); assert.equal(controller.getSnapshot().initialized, true);
  controller.stop();
});
test('commit is submitted once and teardown does not cancel an in-flight commit', async () => {
  const pending = deferred<ExtensionInstallResult>(); let commits = 0;
  const { controller, cancelled } = setup({ commit: () => { commits++; return pending.promise; } });
  await controller.prepare(request); void controller.commit(); void controller.commit(); controller.stop();
  pending.resolve({ request_id: 'commit', status: 'success' }); await settle();
  assert.equal(commits, 1); assert.deepEqual(cancelled, []); assert.equal(controller.getSnapshot().preview, null);
});
test('uncertain cancellation retains preview for retry and prevents a replacement prepare', async () => {
  let calls = 0;
  const { controller, port } = setup({ cancel: async () => { throw new Error('retry cancellation'); }, prepare: async () => { calls++; return preview; } });
  await controller.prepare(request); await controller.cancel(); await controller.prepare(request);
  assert.equal(calls, 1); assert.equal(controller.getSnapshot().preview, preview); assert.match(controller.getSnapshot().error, /retry/);
  port.cancel = async () => ({ request_id: 'cancel', status: 'cancelled' }); await controller.cancel();
  assert.equal(controller.getSnapshot().preview, null); controller.stop();
});
test('projection bursts coalesce while preserving a final fresh read', async () => {
  const first = deferred<ExtensionRuntimeProjectionResult>(); let reads = 0;
  const { controller } = setup({ read: () => ++reads === 1 ? first.promise : Promise.resolve(catalog) });
  controller.handleFrame({ kind: 'extension_runtime_projection_changed', timestamp: 1 }); controller.handleFrame({ kind: 'extension_runtime_projection_changed', timestamp: 2 });
  assert.equal(reads, 1); first.resolve(catalog); await settle(); assert.equal(reads, 2); controller.stop();
});
test('read failures remain explicit and disconnect invalidates a late upload', async () => {
  const uploaded = deferred<Awaited<ReturnType<ExtensionsPort['upload']>>>();
  const { controller } = setup({ read: async () => ({ ...catalog, status: 'error', message: 'catalog failure' }), upload: () => uploaded.promise });
  await settle(); assert.equal(controller.getSnapshot().initialized, false); assert.equal(controller.getSnapshot().readError, 'catalog failure');
  void controller.upload({} as File); controller.connect(null);
  uploaded.resolve({ upload_id: 'old', file_name: 'old.gcex', size: 1, expires_at: 'later' }); await settle();
  assert.equal(controller.getSnapshot().upload, null); assert.equal(controller.getSnapshot().busy, false); controller.stop();
});

test('terminal commit and cancel errors release consumed previews for a new prepare', async () => {
  for (const action of ['commit', 'cancel'] as const) {
    const { controller } = setup({ [action]: async () => ({ request_id: action, status: 'error', message: 'transaction failed' }) });
    await controller.prepare(request); await controller[action]();
    assert.equal(controller.getSnapshot().preview, null);
    assert.equal(controller.getSnapshot().error, 'transaction failed');
    await controller.prepare(request); assert.equal(controller.getSnapshot().preview, preview); controller.stop();
  }
});

test('late successful reads preserve operation failures and operations preserve catalog errors', async () => {
  const read = deferred<ExtensionRuntimeProjectionResult>();
  const { controller, port } = setup({ read: () => read.promise, prepare: async () => { throw new Error('prepare failed'); } });
  await controller.prepare(request); read.resolve(catalog); await settle();
  assert.equal(controller.getSnapshot().error, 'prepare failed');
  port.read = async () => ({ ...catalog, status: 'error', message: 'read failed' });
  await controller.reload(); await controller.prepare(request);
  assert.equal(controller.getSnapshot().readError, 'read failed');
  assert.equal(controller.getSnapshot().error, 'prepare failed'); controller.stop();
});

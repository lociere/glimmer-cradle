import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { DeploymentOperationsService } from './deployment-operations-service';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('DeploymentOperationsService', () => {
  it('没有外部 bridge 时所有宿主写操作 fail closed', async () => {
    const fixture = createFixture();
    const service = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      deploymentEnvFile: fixture.envFile,
    });
    const snapshot = await service.getSnapshot();
    assert.equal(snapshot.backup.supported, false);
    assert.equal(snapshot.service.restart_supported, false);
    assert.equal(snapshot.update.apply_supported, false);
    assert.match(snapshot.update.disabled_reason || '', /install-release/);
    assert.equal((await service.execute({
      operation: 'service.restart',
      operation_id: 'deployment_op_restart',
      confirm: true,
    })).status, 'error');
    for (const operation of ['update.check', 'update.apply']) {
      const result = await service.execute({
        operation,
        operation_id: `deployment_op_${operation.replace('.', '_')}`,
        confirm: true,
      });
      assert.equal(result.status, 'unsupported');
      assert.equal(result.operation_id, `deployment_op_${operation.replace('.', '_')}`);
    }
  });

  it('已配置 bridge 但不可达时绝不回退到 Product Host 自执行', async () => {
    const fixture = createFixture();
    const service = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      deploymentEnvFile: fixture.envFile,
      bridgeSocketPath: path.join(fixture.root, 'missing.sock'),
      bridgeToken: 'test-token',
    });
    const result = await service.execute({ operation: 'update.apply', confirm: true });
    assert.equal(result.status, 'error');
    assert.match(result.message, /没有回退/);
  });

  it('只读 fallback 能读取分域备份摘要但不声明写能力', async () => {
    const fixture = createFixture();
    const backup = path.join(fixture.stateRoot, 'data', 'backups', 'manual', '20260729T010203Z');
    mkdirSync(backup, { recursive: true });
    writeFileSync(path.join(backup, 'deployment.env'), 'status=manual\n');
    const service = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      deploymentEnvFile: fixture.envFile,
    });
    const snapshot = await service.getSnapshot();
    assert.deepEqual(snapshot.backup.entries, [{
      backup_id: '20260729T010203Z',
      created_at: '20260729T010203Z',
      status: 'manual',
    }]);
    assert.equal(snapshot.backup.supported, false);
  });

  it('Product→Bridge 保留同一 operation_id，查询同一终态且拒绝响应漂移', async () => {
    const fixture = createFixture();
    const calls: Array<{ method: string; route: string; body?: unknown }> = [];
    const snapshot = {
      backup: { supported: true, entries: [] },
      service: { restart_supported: true, stop_supported: true },
      update: {
        check_supported: false,
        apply_supported: false,
        current_version: '0.1.8',
        source: 'fixture',
      },
    };
    const service = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      deploymentEnvFile: fixture.envFile,
      bridgeTransport: async <T>(method: 'GET' | 'POST', route: string, body?: unknown) => {
        if (route === '/snapshot') return snapshot as T;
        calls.push({ method, route, body });
        const request = body as { operation?: string; operation_id?: string } | undefined;
        return {
          status: method === 'POST' ? 'accepted' : 'committed',
          message: 'fixture',
          operation_id: request?.operation_id || route.split('/').at(-1),
          operation: request?.operation || 'service.restart',
          snapshot,
        } as T;
      },
    });
    const operationId = 'deployment_op_product_bridge';
    const accepted = await service.execute({
      operation: 'service.restart',
      operation_id: operationId,
      confirm: true,
    });
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.operation_id, operationId);
    const committed = await service.getOperation(operationId);
    assert.equal(committed?.status, 'committed');
    assert.deepEqual(calls.map(({ method, route }) => [method, route]), [
      ['POST', '/operations'],
      ['GET', '/operations/deployment_op_product_bridge'],
    ]);
    assert.equal(
      (calls[0].body as { operation_id: string }).operation_id,
      operationId,
    );

    const drifted = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      bridgeTransport: async <T>(_method: 'GET' | 'POST', route: string) => (
        route === '/snapshot'
          ? snapshot
          : {
            status: 'accepted',
            message: 'fixture',
            operation_id: 'deployment_op_other',
            snapshot,
          }
      ) as T,
    });
    assert.equal((await drifted.execute({
      operation: 'service.restart',
      operation_id: operationId,
      confirm: true,
    })).status, 'error');
    assert.equal((await drifted.getOperation(operationId))?.status, 'error');
    assert.equal((await drifted.getOperation(operationId))?.operation_id, operationId);

    const preAck = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      bridgeTransport: async <T>(_method: 'GET' | 'POST', route: string) => (
        route === '/snapshot'
          ? snapshot
          : {
            status: 'ready',
            message: 'internal pre-ack',
            operation_id: operationId,
            snapshot,
          }
      ) as T,
    });
    assert.equal(await preAck.getOperation(operationId), null);

    const legacyUpdate = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      bridgeTransport: async <T>(
        method: 'GET' | 'POST',
        route: string,
        body?: unknown,
      ) => {
        if (route === '/snapshot') {
          return {
            ...snapshot,
            update: {
              ...snapshot.update,
              check_supported: true,
              apply_supported: true,
            },
          } as T;
        }
        const request = body as { operation: string; operation_id: string };
        return {
          status: 'accepted',
          message: 'legacy fake update',
          operation_id: request.operation_id,
          operation: request.operation,
          snapshot,
        } as T;
      },
    });
    assert.equal((await legacyUpdate.getSnapshot()).update.apply_supported, false);
    assert.equal((await legacyUpdate.execute({
      operation: 'update.apply',
      operation_id: 'deployment_op_legacy_update',
      confirm: true,
    })).status, 'error');
  });
});

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'gc-operations-'));
  roots.push(root);
  const applicationRoot = path.join(root, 'app');
  const stateRoot = path.join(root, 'state');
  const envFile = path.join(root, 'deployment.env');
  mkdirSync(applicationRoot, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(path.join(applicationRoot, 'package.json'), JSON.stringify({ version: '0.1.8' }));
  writeFileSync(envFile, `GLIMMER_CRADLE_STATE_ROOT=${stateRoot}\n`);
  return { root, applicationRoot, stateRoot, envFile };
}

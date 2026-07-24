import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createOperationController } from '../../deploy/personal-server/container/ops-bridge-core.mjs';

const snapshot = {
  backup: { supported: true, backup_root: '/state/backups', entries: [] },
  service: { restart_supported: true, stop_supported: true },
  update: { check_supported: true, apply_supported: true, current_version: '0.1.7', source: 'test' },
};

describe('Personal Server operations bridge controller', () => {
  it('先返回 accepted，再由调用方启动会中断服务的备份', async () => {
    const commands = [];
    const controller = createOperationController({
      snapshot: async () => snapshot,
      launch: async (command) => { commands.push(command); },
      createOperationId: () => 'deployment_op_test',
    });

    const prepared = await controller.prepare({ operation: 'backup.create' });
    assert.equal(prepared.status, 'accepted');
    assert.deepEqual(commands, []);

    prepared.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(commands, [['backup']]);
  });

  it('事务执行期间拒绝并发请求，完成后释放 lease', async () => {
    let finish;
    const running = new Promise((resolve) => { finish = resolve; });
    const controller = createOperationController({
      snapshot: async () => snapshot,
      launch: () => running,
      createOperationId: () => 'deployment_op_test',
    });

    const first = await controller.prepare({ operation: 'service.restart' });
    first.start();
    const conflict = await controller.prepare({ operation: 'backup.create' });
    assert.equal(conflict.status, 'conflict');

    finish();
    await new Promise((resolve) => setImmediate(resolve));
    const next = await controller.prepare({ operation: 'backup.create' });
    assert.equal(next.status, 'accepted');
  });

  it('恢复要求 canonical backup id 和显式确认', async () => {
    const controller = createOperationController({
      snapshot: async () => snapshot,
      launch: async () => undefined,
      createOperationId: () => 'deployment_op_test',
    });

    const traversal = await controller.prepare({
      operation: 'backup.restore',
      backup_id: '../outside',
      confirm: true,
    });
    assert.equal(traversal.status, 'error');

    const preflight = await controller.prepare({
      operation: 'backup.restore',
      backup_id: '20260724T010203Z',
    });
    assert.equal(preflight.status, 'preflight');
    assert.equal(preflight.requires_confirmation, true);
  });
});

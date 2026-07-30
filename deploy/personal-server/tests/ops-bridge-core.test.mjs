import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createOperationController } from '../container/ops-bridge-core.mjs';
import { buildExternalOwnerArgs } from '../container/ops-bridge-handoff.mjs';

const snapshot = {
  backup: { supported: true, backup_root: '/srv/gc/state/data/backups', entries: [] },
  service: { restart_supported: true, stop_supported: true },
  update: { check_supported: true, apply_supported: true, current_version: '0.1.8', source: 'test' },
};

describe('Personal Server Ops Bridge external handoff', () => {
  it('旧 bridge 只在外部 owner ready 后返回 accepted，并在响应后 ack', async () => {
    const calls = [];
    const controller = createOperationController({
      snapshot: async () => snapshot,
      handoff: async (command, operationId, operation) => {
        calls.push(['handoff', command, operationId, operation]);
        return { status: 'ready', ackPath: '/run/glimmer-cradle/handoff/test.ack' };
      },
      acknowledge: async (ackPath) => calls.push(['ack', ackPath]),
      createOperationId: () => 'deployment_op_test',
    });
    const prepared = await controller.prepare({ operation: 'update.apply', confirm: true });
    assert.equal(prepared.status, 'accepted');
    assert.deepEqual(calls[0], ['handoff', ['update'], 'deployment_op_test', 'update.apply']);
    await prepared.acknowledge();
    assert.deepEqual(calls[1], ['ack', '/run/glimmer-cradle/handoff/test.ack']);
  });

  it('lock conflict 与 handoff failure 都 fail closed', async () => {
    const conflict = createOperationController({
      snapshot: async () => snapshot,
      handoff: async () => ({ status: 'conflict' }),
      acknowledge: async () => undefined,
    });
    assert.equal((await conflict.prepare({ operation: 'backup.create' })).status, 'conflict');
    const failed = createOperationController({
      snapshot: async () => snapshot,
      handoff: async () => { throw new Error('boom'); },
      acknowledge: async () => undefined,
    });
    assert.equal((await failed.prepare({ operation: 'backup.create' })).status, 'error');
  });

  it('restart/restore/update 都要求确认', async () => {
    const controller = createOperationController({
      snapshot: async () => snapshot,
      handoff: async () => ({ status: 'ready', ackPath: '/ack' }),
      acknowledge: async () => undefined,
      createOperationId: () => 'deployment_op_test',
    });
    assert.equal((await controller.prepare({ operation: 'service.restart' })).status, 'preflight');
    assert.equal((await controller.prepare({
      operation: 'backup.restore',
      backup_id: '20260729T010203Z',
    })).status, 'preflight');
    assert.equal((await controller.prepare({ operation: 'update.apply' })).status, 'preflight');
  });

  it('custom root 映射保持宿主 bind source 与容器 destination 同构', () => {
    const config = {
      dockerBin: '/usr/bin/docker',
      image: 'example.invalid/personal-server@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      installRoot: '/srv/glimmer/install',
      stateRoot: '/srv/glimmer/state',
      runRoot: '/srv/glimmer/run',
      deploymentEnvFile: '/srv/glimmer/config/deployment.env',
      hostDockerBin: '/usr/local/bin/docker',
      hostComposePlugin: '/usr/local/lib/docker/cli-plugins/docker-compose',
      hostDockerSocket: '/srv/docker/docker.sock',
    };
    const built = buildExternalOwnerArgs(config, {
      operationId: 'deployment_op_contract',
      operation: 'service.restart',
      command: ['restart'],
    });
    for (const root of ['/srv/glimmer/install', '/srv/glimmer/state', '/srv/glimmer/run']) {
      assert.ok(built.args.includes(`type=bind,src=${root},dst=${root}`));
    }
    assert.ok(built.args.includes('GLIMMER_CRADLE_INSTALL_ROOT=/srv/glimmer/install'));
    assert.ok(built.args.includes('GLIMMER_CRADLE_RUN_ROOT=/srv/glimmer/run'));
    assert.equal(built.resultPath, '/srv/glimmer/run/handoff/deployment_op_contract.result.json');
    assert.match(built.args.join('\n'), /current\/lib\/host-transaction\.sh|OWNER_COMMAND/);
  });
});

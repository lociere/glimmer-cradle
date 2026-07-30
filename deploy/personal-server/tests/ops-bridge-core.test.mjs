import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createOperationController } from '../container/ops-bridge-core.mjs';
import {
  acknowledgeExternalOwner,
  buildExternalOwnerArgs,
  handoffToExternalOwner,
  readHandoffResult,
} from '../container/ops-bridge-handoff.mjs';

const snapshot = {
  backup: { supported: true, backup_root: '/srv/gc/state/data/backups', entries: [] },
  service: { restart_supported: true, stop_supported: true },
  update: {
    check_supported: false,
    apply_supported: false,
    current_version: '0.1.8',
    source: 'test',
  },
};

describe('Personal Server Ops Bridge external handoff', () => {
  it('只有 ready→ack→started 完成后才返回 accepted', async () => {
    const calls = [];
    const controller = createOperationController({
      snapshot: async () => snapshot,
      handoff: async (command, operationId, operation) => {
        calls.push(['handoff', command, operationId, operation]);
        return {
          status: 'ready',
          operation_id: operationId,
          ackPath: '/run/glimmer-cradle/handoff/test.ack',
        };
      },
      acknowledge: async (handoff) => {
        calls.push(['ack', handoff.ackPath]);
        return { status: 'started', operation_id: handoff.operation_id };
      },
      createOperationId: () => 'deployment_op_test',
    });
    const prepared = await controller.prepare({ operation: 'service.restart', confirm: true });
    assert.equal(prepared.status, 'accepted');
    assert.deepEqual(calls, [
      ['handoff', ['restart'], 'deployment_op_test', 'service.restart'],
      ['ack', '/run/glimmer-cradle/handoff/test.ack'],
    ]);
  });

  it('丢 ack、错误 started 与 handoff failure 都不会返回 accepted', async () => {
    for (const acknowledge of [
      async () => { throw new Error('lost ack'); },
      async () => ({ status: 'ready' }),
    ]) {
      const controller = createOperationController({
        snapshot: async () => snapshot,
        handoff: async () => ({
          status: 'ready',
          operation_id: 'deployment_op_test',
          ackPath: '/ack',
        }),
        acknowledge,
        createOperationId: () => 'deployment_op_test',
      });
      assert.equal((await controller.prepare({
        operation: 'service.restart',
        confirm: true,
      })).status, 'error');
    }
  });

  it('update.apply 在没有固定候选绑定时明确失败闭合', async () => {
    let handedOff = false;
    const controller = createOperationController({
      snapshot: async () => snapshot,
      handoff: async () => { handedOff = true; },
      acknowledge: async () => ({ status: 'started' }),
      createOperationId: () => 'deployment_op_update',
    });
    const missing = await controller.prepare({ operation: 'update.apply', confirm: true });
    const drifted = await controller.prepare({
      operation: 'update.apply',
      confirm: true,
      candidate: { version: '0.1.9', digest: `sha256:${'a'.repeat(64)}` },
    });
    assert.equal(missing.status, 'unsupported');
    assert.equal(drifted.status, 'unsupported');
    assert.equal(missing.snapshot.update.apply_supported, false);
    assert.equal(handedOff, false);
  });

  it('重复 operation ID 返回同一终态而不启动第二 owner', async () => {
    const controller = createOperationController({
      snapshot: async () => snapshot,
      handoff: async () => ({
        status: 'committed',
        operation_id: 'deployment_op_repeat',
        exit_code: 0,
      }),
      acknowledge: async () => { throw new Error('must not ack terminal operation'); },
    });
    const result = await controller.prepare({
      operation: 'backup.create',
      operation_id: 'deployment_op_repeat',
    });
    assert.equal(result.status, 'committed');
    assert.equal(result.exit_code, 0);
  });

  it('重复查询已经 started 的 operation 保持幂等 accepted 且不重复 ack', async () => {
    let acknowledgements = 0;
    const controller = createOperationController({
      snapshot: async () => snapshot,
      handoff: async () => ({
        status: 'started',
        operation_id: 'deployment_op_started',
      }),
      acknowledge: async () => { acknowledgements += 1; },
    });
    const result = await controller.prepare({
      operation: 'service.restart',
      operation_id: 'deployment_op_started',
      confirm: true,
    });
    assert.equal(result.status, 'accepted');
    assert.equal(acknowledgements, 0);
  });

  it('custom host root 投影到 bridge 规范 run root，owner 仍锁定宿主 run root', () => {
    const config = {
      dockerBin: '/usr/bin/docker',
      image: `example.invalid/personal-server@sha256:${'a'.repeat(64)}`,
      installRoot: '/srv/glimmer/install',
      stateRoot: '/srv/glimmer/state',
      hostRunRoot: '/srv/glimmer/run',
      bridgeRunRoot: '/run/glimmer-cradle',
      deploymentEnvFile: '/srv/glimmer/config/deployment.env',
      hostDockerBin: '/usr/local/bin/docker',
      hostComposePlugin: '/usr/local/lib/docker/cli-plugins/docker-compose',
      hostDockerSocket: '/srv/docker/docker.sock',
    };
    const built = buildExternalOwnerArgs(config, {
      operationId: 'deployment_op_contract',
      operation: 'service.restart',
      command: ['restart'],
      ackNonce: 'fixture',
    });
    assert.equal(
      built.resultPath,
      '/run/glimmer-cradle/handoff/deployment_op_contract.result.json',
    );
    assert.ok(built.args.includes('GLIMMER_CRADLE_RUN_ROOT=/srv/glimmer/run'));
    assert.ok(built.args.includes('type=bind,src=/srv/glimmer/run,dst=/srv/glimmer/run'));
    assert.ok(built.args.includes(
      'GLIMMER_CRADLE_HANDOFF_RESULT=/srv/glimmer/run/handoff/deployment_op_contract.result.json',
    ));
  });

  it('真实 handoff Adapter 以 durable request/ack/result 完成 started 并可查询', async () => {
    const root = (await mkdtemp(path.join(os.tmpdir(), 'glimmer-handoff-'))).replaceAll('\\', '/');
    const operationId = 'deployment_op_fixture';
    const config = fixtureConfig(root, async (_command, args) => {
      const resultPath = envArg(args, 'GLIMMER_CRADLE_HANDOFF_RESULT');
      const ackPath = envArg(args, 'GLIMMER_CRADLE_HANDOFF_ACK');
      const ackNonce = envArg(args, 'GLIMMER_CRADLE_HANDOFF_ACK_NONCE');
      await writeResult(resultPath, operationId, 'ready', 0);
      void waitForFile(ackPath).then(async () => {
        assert.equal((await readFile(ackPath, 'utf8')).trim(), `${operationId}:${ackNonce}`);
        await writeResult(resultPath, operationId, 'started', 0);
      });
    });
    try {
      const handoff = await handoffToExternalOwner(config, {
        operationId,
        operation: 'service.restart',
        command: ['restart'],
      });
      assert.equal(handoff.status, 'ready');
      assert.equal((await acknowledgeExternalOwner(config, handoff)).status, 'started');
      assert.equal((await readHandoffResult(config, operationId)).status, 'started');
      const request = JSON.parse(await readFile(
        path.join(root, 'handoff', `${operationId}.request.json`),
        'utf8',
      ));
      assert.deepEqual(request.command, ['restart']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('已有 request 无 owner 结果时重复调用失败闭合，不启动第二 owner', async () => {
    const root = (await mkdtemp(path.join(os.tmpdir(), 'glimmer-handoff-timeout-'))).replaceAll('\\', '/');
    const operationId = 'deployment_op_timeout';
    let starts = 0;
    const config = fixtureConfig(root, async () => { starts += 1; });
    try {
      await mkdir(path.join(root, 'handoff'));
      await writeFile(path.join(root, 'handoff', `${operationId}.request.json`), JSON.stringify({
        schema_version: 1,
        operation_id: operationId,
        operation: 'service.restart',
        command: ['restart'],
        ack_nonce: 'lost',
      }));
      await assert.rejects(
        () => handoffToExternalOwner(config, {
          operationId,
          operation: 'service.restart',
          command: ['restart'],
        }),
        /owner_timeout/,
      );
      assert.equal(starts, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function fixtureConfig(root, runDocker) {
  return {
    dockerBin: 'fake-docker',
    image: `example.invalid/personal-server@sha256:${'a'.repeat(64)}`,
    installRoot: root,
    stateRoot: root,
    hostRunRoot: root,
    bridgeRunRoot: root,
    deploymentEnvFile: `${root}/deployment.env`,
    hostDockerBin: `${root}/docker`,
    hostComposePlugin: `${root}/docker-compose`,
    hostDockerSocket: `${root}/docker.sock`,
    runDocker,
    readyTimeoutMs: 1_000,
    startedTimeoutMs: 1_000,
  };
}

function envArg(args, key) {
  const prefix = `${key}=`;
  const value = args.find((arg) => typeof arg === 'string' && arg.startsWith(prefix));
  assert.ok(value, `missing ${key}`);
  return value.slice(prefix.length);
}

async function writeResult(target, operationId, status, exitCode) {
  await writeFile(target, `${JSON.stringify({
    schema_version: 1,
    operation_id: operationId,
    operation: 'service.restart',
    status,
    exit_code: exitCode,
    updated_at: new Date().toISOString(),
    recovery_action: 'none',
  })}\n`);
}

async function waitForFile(target) {
  for (let index = 0; index < 100; index += 1) {
    try {
      await readFile(target);
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('fixture ack timeout');
}

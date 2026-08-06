import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createOperationController } from '../container/ops-bridge-core.mjs';
import {
  acknowledgeExternalOwner,
  buildExternalOwnerArgs,
  cleanupHandoffResults,
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

  it('重复 operation ID 绑定不同请求时返回 conflict 而非启动第二 owner', async () => {
    const controller = createOperationController({
      snapshot: async () => snapshot,
      handoff: async () => {
        throw new Error('transaction_handoff_id_reused_with_different_request');
      },
      acknowledge: async () => {
        throw new Error('must not acknowledge conflict');
      },
    });
    const result = await controller.prepare({
      operation: 'backup.create',
      operation_id: 'deployment_op_reused',
    });
    assert.equal(result.status, 'conflict');
    assert.equal(result.operation_id, 'deployment_op_reused');
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
        assert.deepEqual(JSON.parse(await readFile(ackPath, 'utf8')), {
          schema_version: 1,
          operation_id: operationId,
          operation: 'service.restart',
          nonce: ackNonce,
        });
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

  it('已有 request 无 external owner 结果时由 recovery authority 持锁收口唯一终态', async () => {
    const root = (await mkdtemp(path.join(os.tmpdir(), 'glimmer-handoff-timeout-'))).replaceAll('\\', '/');
    const operationId = 'deployment_op_timeout';
    let starts = 0;
    const config = fixtureConfig(root, async () => { starts += 1; });
    config.recoverExternalOwner = async (_config, handoff) => {
      await writeResult(handoff.resultPath, operationId, 'owner_timeout', 70);
    };
    try {
      await mkdir(path.join(root, 'handoff'));
      await writeFile(path.join(root, 'handoff', `${operationId}.request.json`), JSON.stringify({
        schema_version: 1,
        operation_id: operationId,
        operation: 'service.restart',
        command: ['restart'],
        ack_nonce: 'lost',
      }));
      const result = await handoffToExternalOwner(config, {
        operationId,
        operation: 'service.restart',
        command: ['restart'],
      });
      assert.equal(result.status, 'owner_timeout');
      assert.equal((await readFile(path.join(root, 'handoff', `${operationId}.decision`), 'utf8')).trim(), 'owner_timeout');
      assert.equal((await readHandoffResult(config, operationId)).status, 'owner_timeout');
      assert.equal(starts, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ack compare-or-create 只接受相同 operation+nonce，重复调用不启动第二事务', async () => {
    const root = (await mkdtemp(path.join(os.tmpdir(), 'glimmer-handoff-ack-'))).replaceAll('\\', '/');
    const operationId = 'deployment_op_ack_idempotent';
    const config = fixtureConfig(root, async () => undefined);
    const handoff = {
      ...buildExternalOwnerArgs(config, {
        operationId,
        operation: 'service.restart',
        command: ['restart'],
        ackNonce: 'same-nonce',
      }),
      operation_id: operationId,
      operation: 'service.restart',
    };
    try {
      await mkdir(path.dirname(handoff.ackPath), { recursive: true });
      await writeResult(handoff.resultPath, operationId, 'started', 0);
      assert.equal((await acknowledgeExternalOwner(config, handoff)).status, 'started');
      assert.equal((await acknowledgeExternalOwner(config, handoff)).status, 'started');
      await assert.rejects(
        () => acknowledgeExternalOwner(config, {
          ...handoff,
          operation: 'backup.create',
        }),
        /ack_conflict/,
      );
      await assert.rejects(
        () => acknowledgeExternalOwner(config, {
          ...handoff,
          ackNonce: 'different-nonce',
        }),
        /ack_conflict/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ack timeout 仅记录 durable decision，迟到 started 必须由 external owner 写入', async () => {
    const root = (await mkdtemp(path.join(os.tmpdir(), 'glimmer-handoff-race-'))).replaceAll('\\', '/');
    const config = { ...fixtureConfig(root, async () => undefined), startedTimeoutMs: 30 };
    config.recoverExternalOwner = async (_config, handoff) => {
      await writeResult(handoff.resultPath, handoff.operation_id, 'owner_timeout', 70);
    };
    const operationId = 'deployment_op_late_started';
    const handoff = {
      ...buildExternalOwnerArgs(config, {
        operationId,
        operation: 'service.restart',
        command: ['restart'],
        ackNonce: 'race-nonce',
      }),
      operation_id: operationId,
      operation: 'service.restart',
    };
    try {
      await mkdir(path.dirname(handoff.resultPath), { recursive: true });
      await writeResult(handoff.resultPath, operationId, 'ready', 0);
      assert.equal((await acknowledgeExternalOwner(config, handoff)).status, 'owner_timeout');
      assert.equal((await readFile(handoff.decisionPath, 'utf8')).trim(), 'owner_timeout');
      assert.equal(JSON.parse(await readFile(handoff.resultPath, 'utf8')).status, 'owner_timeout');

      const winningId = 'deployment_op_started_won';
      const winning = {
        ...buildExternalOwnerArgs(config, {
          operationId: winningId,
          operation: 'service.restart',
          command: ['restart'],
          ackNonce: 'winning-nonce',
        }),
        operation_id: winningId,
        operation: 'service.restart',
      };
      await writeResult(winning.resultPath, winningId, 'started', 0);
      await writeFile(winning.decisionPath, 'started\n');
      const authoritative = await acknowledgeExternalOwner(config, winning);
      assert.equal(authoritative.status, 'started');
      assert.equal((await readFile(winning.decisionPath, 'utf8')).trim(), 'started');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stale incomplete handoff 由 recovery authority 终态化后按 retention 清理', async () => {
    const root = (await mkdtemp(path.join(os.tmpdir(), 'glimmer-handoff-cleanup-'))).replaceAll('\\', '/');
    const operationId = 'deployment_op_stale_cleanup';
    const config = {
      ...fixtureConfig(root, async () => undefined),
      staleTimeoutMs: 1,
      retentionMs: 60_000,
    };
    config.recoverExternalOwner = async (_config, handoff) => {
      await writeResult(handoff.resultPath, handoff.operation_id, 'owner_timeout', 70);
    };
    const handoffRoot = path.join(root, 'handoff');
    try {
      await mkdir(handoffRoot, { recursive: true });
      await writeFile(path.join(handoffRoot, `${operationId}.request.json`), JSON.stringify({
        schema_version: 1,
        operation_id: operationId,
        operation: 'service.restart',
        command: ['restart'],
        ack_nonce: 'stale',
        created_at: '2020-01-01T00:00:00.000Z',
      }));
      await cleanupHandoffResults(config);
      assert.equal((await readHandoffResult(config, operationId)).status, 'owner_timeout');
      await writeFile(path.join(handoffRoot, `${operationId}.ack`), 'fixture');
      assert.equal((await readFile(
        path.join(handoffRoot, `${operationId}.decision`),
        'utf8',
      )).trim(), 'owner_timeout');
      await cleanupHandoffResults({ ...config, retentionMs: 1 }, Date.now() + 10_000);
      for (const suffix of ['request.json', 'result.json', 'ack', 'decision']) {
        await assert.rejects(
          () => readFile(path.join(handoffRoot, `${operationId}.${suffix}`)),
          (error) => error?.code === 'ENOENT',
        );
      }
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

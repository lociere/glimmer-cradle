import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { DeploymentOperationsService } from './deployment-operations-service';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('DeploymentOperationsService', () => {
  it('未显式注入宿主运维桥时保持 disabled', async () => {
    const fixture = createOperationsFixture();
    const service = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      deploymentEnvFile: fixture.envFile,
    });

    const snapshot = await service.getSnapshot();
    assert.equal(snapshot.backup.supported, false);
    assert.equal(snapshot.service.restart_supported, false);
    assert.equal(snapshot.update.apply_supported, false);
    assert.match(snapshot.update.disabled_reason || '', /未配置部署级 glimmer-cradle 运维桥/);
  });

  it('显式桥接命令存在时投影真实备份能力', async () => {
    const fixture = createOperationsFixture({ withCli: true, backups: ['20260718T181000Z'] });
    const service = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      cliPath: fixture.cliPath,
      deploymentEnvFile: fixture.envFile,
    });

    const snapshot = await service.getSnapshot();
    assert.equal(snapshot.backup.supported, true);
    assert.equal(snapshot.service.restart_supported, true);
    assert.equal(snapshot.update.apply_supported, true);
    assert.deepEqual(snapshot.backup.entries, [{
      backup_id: '20260718T181000Z',
      created_at: '20260718T181000Z',
      status: 'ready',
    }]);
  });

  it('发布镜像缺少仓库根 package.json 时从产品包读取当前版本', async () => {
    const fixture = createOperationsFixture({ withCli: true, omitApplicationPackage: true, packageVersion: '0.1.6' });
    const service = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      packageRoot: fixture.packageRoot,
      cliPath: fixture.cliPath,
      deploymentEnvFile: fixture.envFile,
    });

    const snapshot = await service.getSnapshot();
    assert.equal(snapshot.update.current_version, '0.1.6');
    assert.equal(snapshot.update.apply_supported, true);
  });

  it('版本文件都缺失时运维快照不抛异常', async () => {
    const fixture = createOperationsFixture({ withCli: true, omitApplicationPackage: true });
    const service = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      cliPath: fixture.cliPath,
      deploymentEnvFile: fixture.envFile,
    });

    const snapshot = await service.getSnapshot();
    assert.equal(snapshot.update.current_version, 'unknown');
  });


  it('显式桥接命令缺失时返回明确 disabled reason', async () => {
    const fixture = createOperationsFixture();
    const missingCliPath = path.join(fixture.root, 'bin', 'glimmer-cradle');
    const service = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      cliPath: missingCliPath,
      deploymentEnvFile: fixture.envFile,
    });

    const snapshot = await service.getSnapshot();
    assert.equal(snapshot.backup.supported, false);
    assert.match(snapshot.update.disabled_reason || '', new RegExp(escapeRegExp(missingCliPath)));
  });

  it('restore 先要求 canonical backup id 与确认，再拒绝 traversal', async () => {
    const fixture = createOperationsFixture({ withCli: true, backups: ['20260718T181000Z'] });
    const service = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      cliPath: fixture.cliPath,
      deploymentEnvFile: fixture.envFile,
    });

    const preflight = await service.execute({
      operation: 'backup.restore',
      backup_id: '20260718T181000Z',
    });
    assert.equal(preflight.status, 'preflight');
    assert.equal(preflight.requires_confirmation, true);

    const traversal = await service.execute({
      operation: 'backup.restore',
      backup_id: '../outside',
      confirm: true,
    });
    assert.equal(traversal.status, 'error');
    assert.match(traversal.message, /指定备份不存在/);
  });

  it('接受 detached 运维请求后占用唯一 lease，并拒绝并发重复请求', async () => {
    const fixture = createOperationsFixture({ withCli: true });
    const service = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      cliPath: fixture.cliPath,
      deploymentEnvFile: fixture.envFile,
      spawnDetachedFn: async () => undefined,
    });

    const accepted = await service.execute({
      operation: 'service.restart',
      confirm: true,
    });
    assert.equal(accepted.status, 'accepted');
    assert.match(accepted.operation_id || '', /^deployment_op_/);

    const conflict = await service.execute({
      operation: 'service.stop',
      confirm: true,
    });
    assert.equal(conflict.status, 'conflict');
    assert.match(conflict.message, /已有部署级运维事务/);
  });

  it('运维桥已配置但不可达时不回退重复执行', async () => {
    const fixture = createOperationsFixture({ withCli: true });
    let fallbackExecutions = 0;
    const service = new DeploymentOperationsService({
      applicationRoot: fixture.applicationRoot,
      cliPath: fixture.cliPath,
      deploymentEnvFile: fixture.envFile,
      bridgeSocketPath: path.join(fixture.root, 'missing-ops-bridge.sock'),
      bridgeToken: 'test-token',
      spawnDetachedFn: async () => { fallbackExecutions += 1; },
    });

    const result = await service.execute({
      operation: 'service.restart',
      confirm: true,
    });
    assert.equal(result.status, 'error');
    assert.match(result.message, /避免重复执行/);
    assert.equal(fallbackExecutions, 0);
  });
});

function createOperationsFixture(options: {
  readonly withCli?: boolean;
  readonly backups?: string[];
  readonly omitApplicationPackage?: boolean;
  readonly packageVersion?: string;
} = {}): {
  readonly root: string;
  readonly applicationRoot: string;
  readonly packageRoot: string;
  readonly envFile: string;
  readonly cliPath: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'gc-operations-'));
  tempRoots.push(root);
  const applicationRoot = path.join(root, 'app');
  const packageRoot = path.join(applicationRoot, 'products', 'personal-server');
  const stateRoot = path.join(root, 'state');
  const envFile = path.join(root, 'deployment.env');
  const cliPath = path.join(root, 'bin', 'glimmer-cradle');
  mkdirSync(applicationRoot, { recursive: true });
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  if (!options.omitApplicationPackage) {
    writeFileSync(path.join(applicationRoot, 'package.json'), JSON.stringify({ version: '0.1.1' }), 'utf8');
  }
  if (options.packageVersion) {
    writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ version: options.packageVersion }), 'utf8');
  }
  writeFileSync(envFile, `GLIMMER_CRADLE_STATE_ROOT=${stateRoot}\n`, 'utf8');
  for (const backupId of options.backups ?? []) {
    const backupDir = path.join(stateRoot, 'backups', backupId);
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(path.join(backupDir, 'deployment.env'), 'status=ready\n', 'utf8');
  }
  if (options.withCli) {
    mkdirSync(path.dirname(cliPath), { recursive: true });
    writeFileSync(cliPath, process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n', 'utf8');
    if (process.platform !== 'win32') chmodSync(cliPath, 0o755);
  }
  return { root, applicationRoot, packageRoot, envFile, cliPath };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

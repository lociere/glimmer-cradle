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
    assert.match(snapshot.update.disabled_reason || '', /外部事务 owner/);
    assert.equal((await service.execute({ operation: 'service.restart', confirm: true })).status, 'disabled');
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

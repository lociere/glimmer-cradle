import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deploy = await readFile(path.join(root, 'deploy.sh'), 'utf8');
const installer = await readFile(path.join(root, 'install-release.sh'), 'utf8');
const lock = await readFile(path.join(root, 'lib', 'host-transaction.sh'), 'utf8');
const handoff = await readFile(path.join(root, 'container', 'ops-bridge-handoff.mjs'), 'utf8');
const contract = JSON.parse(await readFile(path.join(root, 'tests', 'transaction-contract.fixture.json'), 'utf8'));

test('query dispatch 发生在 version、Docker elevation 与事务初始化之前', () => {
  const query = deploy.indexOf('if [[ "$COMMAND" == status || "$COMMAND" == logs ]]');
  assert.ok(query > 0);
  assert.ok(query < deploy.indexOf('RELEASE_VERSION="$(resolve_release_version)"', query));
  assert.ok(query < deploy.indexOf('sudo docker info', query));
  assert.ok(query < deploy.indexOf('host_transaction_acquire "deploy.${COMMAND}"', query));
  const runQuery = deploy.slice(deploy.indexOf('run_query()'), deploy.indexOf('\nmain()'));
  assert.doesNotMatch(runQuery, /\bsudo\b|prepare_environment|prepare_state|chmod|chown/);
});

test('source/custom root 不伪装 Ops 支持，image mode 使用同路径 mount', () => {
  assert.match(deploy, /source_mode_has_no_stable_host_owner/);
  for (const rootName of ['INSTALL_ROOT', 'STATE_ROOT', 'RUN_ROOT']) {
    assert.match(deploy, new RegExp(`src=\\\"\\$${rootName}\\\",dst=\\\"\\$${rootName}\\\"`));
  }
});

test('可信锁拒绝 symlink/不安全 owner 并以 guard inode 防替换', () => {
  assert.match(lock, /trusted_path_symlink/);
  assert.match(lock, /trusted_path_owner_invalid/);
  assert.match(lock, /trusted_path_permissions_invalid/);
  assert.match(lock, /lock_inode_replaced/);
  assert.match(lock, /HOST_TRANSACTION_LOCK_GUARD_FILE/);
  assert.match(lock, /\/proc\/self\/fd/);
});

test('installer 原样传播稳定 deploy exit，只有自身补偿失败升级 78', () => {
  assert.match(installer, /DEPLOY_EXIT=\$\?/);
  assert.match(installer, /exit "\$\(host_transaction_normalize_exit "\$DEPLOY_EXIT"\)"/);
  assert.match(installer, /cleanup_failed[\s\S]*exit_code=78/);
});

test('phase contract 区分执行 commit 与终态 committed', () => {
  assert.ok(contract.execution_phases.includes('commit'));
  assert.ok(!contract.execution_phases.includes('committed'));
  assert.ok(contract.terminal_states.includes('committed'));
  assert.match(lock, /HOST_TRANSACTION_PHASE=committed/);
  assert.match(lock, /host_transaction_write_state committed committed/);
});

test('handoff Adapter 在启动外部 owner 前创建可信结果目录', () => {
  const prepareDirectory = handoff.indexOf('await mkdir(path.posix.dirname(launch.resultPath)');
  const startOwner = handoff.indexOf('await runDocker(config.dockerBin, launch.args)');
  assert.ok(prepareDirectory > 0);
  assert.ok(prepareDirectory < startOwner);
  assert.match(handoff, /mode: 0o700/);
});

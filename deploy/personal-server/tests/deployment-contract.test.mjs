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
const bridge = await readFile(path.join(root, 'container', 'ops-bridge.mjs'), 'utf8');
const envTemplate = await readFile(path.join(root, '.env.example'), 'utf8');
const compose = await readFile(path.join(root, 'compose.yaml'), 'utf8');
const dockerfile = await readFile(path.join(root, 'Dockerfile'), 'utf8');
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

test('source mode 不伪装 Ops 支持，宿主事务与服务 IPC 使用不同 owner 域', () => {
  assert.match(deploy, /source_mode_has_no_stable_host_owner/);
  for (const rootName of ['INSTALL_ROOT', 'STATE_ROOT']) {
    assert.match(deploy, new RegExp(`src=\\\"\\$${rootName}\\\",dst=\\\"\\$${rootName}\\\"`));
  }
  assert.match(
    deploy,
    /src="\$SERVICE_RUN_ROOT",dst="\$CONTAINER_RUN_ROOT"/,
  );
  assert.match(deploy, /GLIMMER_CRADLE_HOST_RUN_ROOT="\$HOST_RUN_ROOT"/);
  assert.match(deploy, /install -d -o 0 -g 0 -m 0700 "\$HOST_RUN_ROOT"/);
  assert.match(deploy, /install -d -o 10001 -g 10001 -m 0700 "\$SERVICE_RUN_ROOT"/);
  assert.match(deploy, /HOST_STATE_ROOT="\$\{STATE_ROOT\}\/host"/);
  assert.match(deploy, /SERVICE_STATE_ROOT="\$\{STATE_ROOT\}\/service"/);
  assert.match(deploy, /install -d -o 10001 -g 10001 -m 0700 "\$SERVICE_STATE_ROOT"/);
  assert.doesNotMatch(deploy, /chown -R 10001:10001/);
  assert.match(deploy, /assert_archive_root "\$backup_dir\/config\.tar\.gz" config/);
  assert.match(deploy, /BACKUP_ROOT="\$\{HOST_STATE_ROOT\}\/backups"/);
  assert.match(deploy, /DEPLOY_DIAGNOSTICS_ROOT="\$\{HOST_STATE_ROOT\}\/diagnostics\/deploy"/);
  assert.match(compose, /GLIMMER_CRADLE_SERVICE_STATE_ROOT:-\.\/state\/service/);
});

test('容器运行脚本不位于会被宿主 install root bind mount 遮蔽的路径', () => {
  assert.match(
    dockerfile,
    /deploy\/personal-server\/container \/usr\/local\/lib\/glimmer-cradle-personal-server/,
  );
  assert.match(
    dockerfile,
    /\/usr\/local\/lib\/glimmer-cradle-personal-server\/entrypoint\.mjs/,
  );
  assert.match(
    deploy,
    /\/usr\/local\/lib\/glimmer-cradle-personal-server\/ops-bridge\.mjs/,
  );
  assert.doesNotMatch(dockerfile, /\/opt\/glimmer-cradle\/container/);
  assert.doesNotMatch(deploy, /\/opt\/glimmer-cradle\/container\/ops-bridge\.mjs/);
});

test('默认 env 与 Compose 固定容器 socket，宿主 run root 只作为 bind source', () => {
  assert.match(envTemplate, /^GLIMMER_CRADLE_SITE_ADDRESS=:80$/m);
  assert.match(envTemplate, /^GLIMMER_CRADLE_HTTP_BIND=0\.0\.0\.0$/m);
  assert.match(envTemplate, /^GLIMMER_CRADLE_HTTP_PORT=80$/m);
  assert.doesNotMatch(deploy, /拒绝将无 TLS 的控制面板绑定到公网地址/);
  assert.match(deploy, /访问地址: http:\/\/<服务器公网 IP 或域名>/);
  assert.match(
    envTemplate,
    /^GLIMMER_CRADLE_OPERATIONS_BRIDGE_SOCKET=\/run\/glimmer-cradle\/ops-bridge\.sock$/m,
  );
  assert.match(
    compose,
    /GLIMMER_CRADLE_OPERATIONS_BRIDGE_SOCKET:-\/run\/glimmer-cradle\/ops-bridge\.sock/,
  );
  assert.match(
    compose,
    /\$\{GLIMMER_CRADLE_SERVICE_RUN_ROOT:-\.\/run\/service\}:\/run\/glimmer-cradle/,
  );
  assert.match(
    deploy,
    /set_env_value "\$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_OPERATIONS_BRIDGE_SOCKET "\$CONTAINER_OPS_BRIDGE_SOCKET"/,
  );
});

test('候选装配只写临时 projection，readiness 后才原子替换 canonical env', () => {
  const install = deploy.slice(deploy.indexOf('install_release()'), deploy.indexOf('\nupdate_release()'));
  const update = deploy.slice(deploy.indexOf('update_release()'), deploy.indexOf('\ncleanup_history()'));
  assert.ok(install.indexOf('create_previous_compose_env') < install.indexOf('create_candidate_compose_env'));
  assert.match(update, /create_previous_compose_env/);
  assert.match(update, /create_candidate_compose_env/);
  assert.ok(update.indexOf('wait_until_ready "$TRANSACTION_CANDIDATE_ENV"')
    < update.indexOf('persist_deployment_projection "$TRANSACTION_CANDIDATE_ENV"'));
  assert.match(deploy, /mv -f -- "\$temporary" "\$DEPLOYMENT_ENV_FILE"/);
  assert.doesNotMatch(installer, /set_env_value GLIMMER_CRADLE_CADDYFILE/);
  assert.match(installer, /GLIMMER_CRADLE_CANDIDATE_CADDYFILE="\$\{RELEASE_ROOT\}\/Caddyfile"/);
  assert.ok(deploy.indexOf('capture_candidate_diagnostics "$TRANSACTION_CANDIDATE_ENV"')
    < deploy.indexOf('compose_with_env "$TRANSACTION_CANDIDATE_ENV" down --remove-orphans'));
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
  const startOwner = handoff.indexOf('config.runDocker || runDocker');
  assert.ok(prepareDirectory > 0);
  assert.ok(prepareDirectory < startOwner);
  assert.match(handoff, /mode: 0o700/);
  for (const state of [
    'ready',
    'started',
    'committed',
    'failed',
    'recovery_required',
    'owner_timeout',
    'conflict',
  ]) {
    assert.match(handoff, new RegExp(state));
  }
  assert.match(handoff, /finish_owner_timeout[\s\S]*host_transaction_finish 70/);
  assert.match(handoff, /owner timeout cleanup did not close safely/);
  assert.match(handoff, /HANDOFF_RETENTION_MS/);
  assert.match(bridge, /request\.method === 'GET'[\s\S]*readHandoffResult/);
});

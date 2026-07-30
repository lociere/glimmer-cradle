import { createServer } from 'node:http';
import { chmod, chown, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createOperationController } from './ops-bridge-core.mjs';
import {
  acknowledgeExternalOwner,
  handoffToExternalOwner,
  readHandoffResult,
} from './ops-bridge-handoff.mjs';

const socketPath = process.env.GLIMMER_CRADLE_OPERATIONS_BRIDGE_SOCKET || '/run/glimmer-cradle/ops-bridge.sock';
const token = process.env.GLIMMER_CRADLE_OPERATIONS_BRIDGE_TOKEN || '';
const stateRoot = process.env.GLIMMER_CRADLE_STATE_ROOT || '/var/lib/glimmer-cradle';
const runRoot = process.env.GLIMMER_CRADLE_RUN_ROOT || '/run/glimmer-cradle';
const hostRunRoot = process.env.GLIMMER_CRADLE_HOST_RUN_ROOT || '';
const hostReleaseRoot = process.env.GLIMMER_CRADLE_HOST_RELEASE_ROOT || '/opt/glimmer-cradle/current';
const hostInstallRoot = process.env.GLIMMER_CRADLE_HOST_INSTALL_ROOT || '/opt/glimmer-cradle';
const transactionImage = process.env.GLIMMER_CRADLE_TRANSACTION_IMAGE || '';
const dockerBin = '/usr/bin/docker';
const hostDockerBin = process.env.GLIMMER_CRADLE_HOST_DOCKER_BIN || '';
const hostComposePlugin = process.env.GLIMMER_CRADLE_HOST_DOCKER_COMPOSE_PLUGIN || '';
const hostDockerSocket = process.env.GLIMMER_CRADLE_HOST_DOCKER_SOCKET || '/var/run/docker.sock';
const deploymentEnvFile = process.env.GLIMMER_CRADLE_DEPLOYMENT_ENV_FILE || '/etc/glimmer-cradle/deployment.env';
const releaseSource = process.env.GLIMMER_CRADLE_RELEASE_SOURCE || 'https://github.com/lociere/glimmer-cradle/releases/latest/download';

if (!token) {
  console.error('GLIMMER_CRADLE_OPERATIONS_BRIDGE_TOKEN is required');
  process.exit(1);
}
if (!hostRunRoot || !path.posix.isAbsolute(hostRunRoot)) {
  console.error('GLIMMER_CRADLE_HOST_RUN_ROOT is required and must be absolute');
  process.exit(1);
}

await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o770 });
await rm(socketPath, { force: true });

const handoffConfig = {
  dockerBin,
  image: transactionImage,
  installRoot: hostInstallRoot,
  stateRoot,
  hostRunRoot,
  bridgeRunRoot: runRoot,
  deploymentEnvFile,
  hostDockerBin,
  hostComposePlugin,
  hostDockerSocket,
};

const operations = createOperationController({
  snapshot,
  handoff: (command, operationId, operation) => handoffToExternalOwner(
    handoffConfig,
    { command, operationId, operation },
  ),
  acknowledge: (handoff) => acknowledgeExternalOwner(handoffConfig, handoff),
  onError: (operationId, error) => {
    console.error(`[ops-bridge] operation ${operationId} failed: ${error instanceof Error ? error.message : String(error)}`);
  },
});

const server = createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${token}`) {
    sendJson(response, 403, { error: 'forbidden' });
    return;
  }
  try {
    if (request.method === 'GET' && request.url === '/snapshot') {
      sendJson(response, 200, await snapshot());
      return;
    }
    const operationResult = request.method === 'GET'
      ? /^\/operations\/(deployment_op_[A-Za-z0-9][A-Za-z0-9._-]{0,111})$/.exec(request.url || '')
      : null;
    if (operationResult) {
      const result = await readHandoffResult(handoffConfig, operationResult[1]);
      sendJson(response, result ? 200 : 404, result || { error: 'operation_not_found' });
      return;
    }
    if (request.method === 'POST' && request.url === '/operations') {
      const body = await readBody(request, 8192);
      const result = await operations.prepare(JSON.parse(body || '{}'));
      sendJson(response, 200, result);
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(socketPath, () => {
  void secureSocket(socketPath);
  process.stdout.write(`[ops-bridge] listening on ${socketPath}\n`);
});

async function secureSocket(targetPath) {
  await chownIfRoot(targetPath, 10001, 10001);
  await chmod(targetPath, 0o660).catch(() => undefined);
}

async function chownIfRoot(targetPath, uid, gid) {
  if (process.getuid?.() !== 0) return;
  await chown(targetPath, uid, gid).catch(() => undefined);
}

async function snapshot(availableVersion) {
  const commandAvailable = Boolean(
    transactionImage
      && existsSync(dockerBin)
      && existsSync(path.join(hostReleaseRoot, 'lib', 'host-transaction.sh')),
  );
  return {
    backup: {
      supported: commandAvailable,
      disabled_reason: commandAvailable ? undefined : '外部宿主事务 owner 未完整配置。',
      backup_root: path.join(stateRoot, 'data', 'backups'),
      entries: await listBackups(),
    },
    service: {
      restart_supported: commandAvailable,
      stop_supported: commandAvailable,
      disabled_reason: commandAvailable ? undefined : '外部宿主事务 owner 未完整配置。',
    },
    update: {
      check_supported: false,
      apply_supported: false,
      current_version: await currentVersion(),
      source: releaseSource,
      disabled_reason: '尚未建立经验证候选、固定 OCI digest 与 install-release 的不可漂移绑定。',
      available_version: availableVersion,
    },
  };
}

async function listBackups() {
  const backupRoot = path.join(stateRoot, 'data', 'backups');
  if (!existsSync(backupRoot)) return [];
  const backups = [];
  for (const kind of ['manual', 'transaction', 'restore-safety']) {
    const kindRoot = path.join(backupRoot, kind);
    if (!existsSync(kindRoot)) continue;
    const entries = await readdir(kindRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      backups.push({
        backup_id: entry.name,
        created_at: entry.name,
        kind,
        status: await readBackupStatus(path.join(kindRoot, entry.name, 'deployment.env')),
      });
    }
  }
  return backups.sort((left, right) => right.backup_id.localeCompare(left.backup_id));
}

async function readBackupStatus(filePath) {
  try {
    return (await readFile(filePath, 'utf8')).match(/^status=(.+)$/m)?.[1]?.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function currentVersion() {
  try {
    return (await readFile(path.join(hostReleaseRoot, 'VERSION'), 'utf8')).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        reject(new Error('request_body_too_large'));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

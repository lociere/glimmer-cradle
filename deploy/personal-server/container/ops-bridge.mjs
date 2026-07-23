import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, chown, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const socketPath = process.env.GLIMMER_CRADLE_OPERATIONS_BRIDGE_SOCKET || '/var/lib/glimmer-cradle/run/ops-bridge.sock';
const token = process.env.GLIMMER_CRADLE_OPERATIONS_BRIDGE_TOKEN || '';
const cliPath = process.env.GLIMMER_CRADLE_CLI_PATH || '/usr/local/bin/glimmer-cradle';
const stateRoot = process.env.GLIMMER_CRADLE_STATE_ROOT || '/var/lib/glimmer-cradle';
const hostReleaseRoot = process.env.GLIMMER_CRADLE_HOST_RELEASE_ROOT || '/host/glimmer-cradle/current';
const releaseSource = process.env.GLIMMER_CRADLE_RELEASE_SOURCE || 'https://github.com/lociere/glimmer-cradle/releases/latest/download';
let activeOperation = null;

if (!token) {
  console.error('GLIMMER_CRADLE_OPERATIONS_BRIDGE_TOKEN is required');
  process.exit(1);
}

await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o770 });
await chownIfRoot(path.dirname(socketPath), 10001, 10001);
await rm(socketPath, { force: true });

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
    if (request.method === 'POST' && request.url === '/operations') {
      const body = await readBody(request, 8192);
      sendJson(response, 200, await execute(JSON.parse(body || '{}')));
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
  const commandAvailable = existsSync(cliPath);
  return {
    backup: {
      supported: commandAvailable,
      disabled_reason: commandAvailable ? undefined : `运维桥命令不存在：${cliPath}`,
      backup_root: path.join(stateRoot, 'backups'),
      entries: await listBackups(),
    },
    service: {
      restart_supported: commandAvailable,
      stop_supported: commandAvailable,
      disabled_reason: commandAvailable ? undefined : `运维桥命令不存在：${cliPath}`,
    },
    update: {
      check_supported: true,
      apply_supported: commandAvailable,
      current_version: await currentVersion(),
      source: releaseSource,
      disabled_reason: commandAvailable ? undefined : `运维桥命令不存在：${cliPath}`,
      available_version: availableVersion,
    },
  };
}

async function execute(body) {
  const operation = String(body.operation || '');
  if (!['backup.create', 'backup.restore', 'service.restart', 'service.stop', 'update.apply'].includes(operation)) {
    return { status: 'error', message: '未知的运维操作。', snapshot: await snapshot(), operation_id: opId() };
  }
  if (activeOperation) {
    return { status: 'conflict', message: '当前已有部署级运维事务在进行中，请等待前一项操作结束。', snapshot: await snapshot(), operation_id: activeOperation };
  }
  activeOperation = opId();
  try {
  if (operation === 'backup.create') {
    await runCli(['backup']);
    return { status: 'success', message: '备份已创建。', snapshot: await snapshot(), operation_id: activeOperation };
  }
  if (operation === 'backup.restore') {
    const backupId = String(body.backup_id || '');
    if (!/^[0-9]{8}T[0-9]{6}Z(?:-[0-9]{2})?$/.test(backupId)) {
      return { status: 'error', message: '指定备份不存在，无法恢复。', snapshot: await snapshot(), operation_id: activeOperation };
    }
    if (!body.confirm) {
      const operationId = activeOperation;
      activeOperation = null;
      return {
        status: 'preflight',
        message: `恢复 ${backupId} 将中断当前服务，并在失败时依赖部署事务回滚。`,
        requires_confirmation: true,
        snapshot: await snapshot(),
        operation_id: operationId,
      };
    }
    await runCli(['restore', backupId]);
    return { status: 'success', message: `已从备份恢复 ${backupId}。`, snapshot: await snapshot(), operation_id: activeOperation };
  }
  if (operation === 'service.restart') {
    detachCli(['restart']);
    return { status: 'accepted', message: '已接受重启请求，当前控制面连接将重新建立。', snapshot: await snapshot(), operation_id: activeOperation };
  }
  if (operation === 'service.stop') {
    detachCli(['stop']);
    return { status: 'accepted', message: '已接受停机请求，当前控制面连接将被关闭。', snapshot: await snapshot(), operation_id: activeOperation };
  }
  if (operation === 'update.apply') {
    if (!body.confirm) {
      const operationId = activeOperation;
      activeOperation = null;
      return { status: 'preflight', message: '更新将触发部署级事务、就绪门与失败回滚；确认后当前连接可能中断。', requires_confirmation: true, snapshot: await snapshot(), operation_id: operationId };
    }
    detachCli(['update']);
    return { status: 'accepted', message: '已接受更新请求，当前控制面连接将根据部署事务状态中断或恢复。', snapshot: await snapshot(), operation_id: activeOperation };
  }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error), snapshot: await snapshot(), operation_id: activeOperation };
  } finally {
    if (!['service.restart', 'service.stop', 'update.apply'].includes(operation) || body.confirm !== true) {
      activeOperation = null;
    }
  }
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`运维桥命令失败，退出码 ${code ?? 'null'}。`)));
  });
}

function detachCli(args) {
  const child = spawn(cliPath, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

async function listBackups() {
  const backupRoot = path.join(stateRoot, 'backups');
  if (!existsSync(backupRoot)) return [];
  const entries = await readdir(backupRoot, { withFileTypes: true });
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    backups.push({ backup_id: entry.name, created_at: entry.name, status: await readBackupStatus(path.join(backupRoot, entry.name, 'deployment.env')) });
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

function opId() {
  return `deployment_op_${randomUUID()}`;
}

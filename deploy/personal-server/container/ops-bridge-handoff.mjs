import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OPERATION_ID = /^deployment_op_[A-Za-z0-9][A-Za-z0-9._-]{0,111}$/;
const TERMINAL_STATES = new Set(['committed', 'failed', 'recovery_required', 'owner_timeout', 'conflict']);
const OWNER_READY_TIMEOUT_MS = 10_000;
const OWNER_STARTED_TIMEOUT_MS = 10_000;
const OWNER_STALE_TIMEOUT_MS = 10 * 60_000;
const HANDOFF_RETENTION_MS = 7 * 24 * 60 * 60_000;

const OWNER_COMMAND = String.raw`
set -Eeuo pipefail
source "$GLIMMER_CRADLE_INSTALL_ROOT/current/lib/host-transaction.sh"
heartbeat_pid=

write_handoff_result() {
  status="$1"
  exit_code="$2"
  recovery_action=none
  if [ "$#" -ge 3 ]; then
    recovery_action="$3"
  fi
  temporary="$GLIMMER_CRADLE_HANDOFF_RESULT.$$.new"
  printf '{"schema_version":1,"operation_id":"%s","operation":"%s","status":"%s","exit_code":%d,"updated_at":"%s","recovery_action":"%s"}\n' \
    "$GLIMMER_CRADLE_TRANSACTION_REQUEST_ID" \
    "$GLIMMER_CRADLE_HANDOFF_OPERATION" \
    "$status" \
    "$exit_code" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$(host_transaction_json_escape "$recovery_action")" >"$temporary"
  chmod 0600 "$temporary"
  mv -f -- "$temporary" "$GLIMMER_CRADLE_HANDOFF_RESULT"
}

finish() {
  code=$?
  trap - EXIT INT TERM
  if [ -n "$heartbeat_pid" ]; then
    kill "$heartbeat_pid" 2>/dev/null || true
    wait "$heartbeat_pid" 2>/dev/null || true
  fi
  normalized="$(host_transaction_normalize_exit "$code")"
  if ! host_transaction_finish "$normalized"; then
    normalized=78
  fi
  status=failed
  recovery_action=none
  if [ "$normalized" -eq 0 ]; then
    status=committed
  elif [ "$normalized" -eq 78 ]; then
    status=recovery_required
    recovery_action="inspect the host transaction journal and restore the last verified release"
  fi
  write_handoff_result "$status" "$normalized" "$recovery_action"
  exit "$normalized"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

set +e
host_transaction_acquire "$GLIMMER_CRADLE_HANDOFF_OPERATION"
code=$?
set -e
if [ "$code" -ne 0 ]; then
  trap - EXIT INT TERM
  status=failed
  [ "$code" -eq 75 ] && status=conflict
  write_handoff_result "$status" "$code"
  exit "$code"
fi

finish_owner_timeout() {
  trap - EXIT INT TERM
  if host_transaction_finish 70; then
    write_handoff_result owner_timeout 70 "retry query with the same operation_id; no deploy command was acknowledged"
    exit 70
  fi
  write_handoff_result recovery_required 78 "inspect the host transaction journal; owner timeout cleanup did not close safely"
  exit 78
}

write_handoff_result ready 0
deadline=$((SECONDS + 30))
while [ ! -f "$GLIMMER_CRADLE_HANDOFF_ACK" ]; do
  if [ -f "$GLIMMER_CRADLE_HANDOFF_DECISION" ]; then
    IFS= read -r decision <"$GLIMMER_CRADLE_HANDOFF_DECISION" || exit 70
    if [ "$decision" = "owner_timeout" ]; then
      finish_owner_timeout
    fi
  fi
  [ "$SECONDS" -lt "$deadline" ] || exit 70
  sleep 1
done
IFS= read -r acknowledgement <"$GLIMMER_CRADLE_HANDOFF_ACK" || exit 70
expected_ack="$(printf '{"schema_version":1,"operation_id":"%s","operation":"%s","nonce":"%s"}' \
  "$GLIMMER_CRADLE_TRANSACTION_REQUEST_ID" \
  "$GLIMMER_CRADLE_HANDOFF_OPERATION" \
  "$GLIMMER_CRADLE_HANDOFF_ACK_NONCE")"
[ "$acknowledgement" = "$expected_ack" ] || exit 70

set +e
(
  set -C
  printf 'started\n' >"$GLIMMER_CRADLE_HANDOFF_DECISION"
) 2>/dev/null
set -e
IFS= read -r decision <"$GLIMMER_CRADLE_HANDOFF_DECISION" || exit 70
if [ "$decision" = "owner_timeout" ]; then
  finish_owner_timeout
fi
[ "$decision" = "started" ] || exit 70
write_handoff_result started 0
(
  while true; do
    sleep 5
    write_handoff_result started 0
  done
) &
heartbeat_pid=$!

set +e
"$GLIMMER_CRADLE_INSTALL_ROOT/current/deploy.sh" "$@"
code=$?
set -e
exit "$code"
`;

export function buildExternalOwnerArgs(config, request) {
  if (!OPERATION_ID.test(request.operationId)) throw new Error('transaction_handoff_id_invalid');
  const {
    image,
    installRoot,
    stateRoot,
    hostRunRoot,
    bridgeRunRoot = '/run/glimmer-cradle',
    deploymentEnvFile,
    hostDockerBin,
    hostComposePlugin,
    hostDockerSocket,
  } = config;
  const operationId = request.operationId;
  const bridgeHandoffRoot = path.posix.join(bridgeRunRoot, 'handoff');
  const hostHandoffRoot = path.posix.join(hostRunRoot, 'handoff');
  const resultPath = path.posix.join(bridgeHandoffRoot, `${operationId}.result.json`);
  const requestPath = path.posix.join(bridgeHandoffRoot, `${operationId}.request.json`);
  const ackPath = path.posix.join(bridgeHandoffRoot, `${operationId}.ack`);
  const decisionPath = path.posix.join(bridgeHandoffRoot, `${operationId}.decision`);
  const hostResultPath = path.posix.join(hostHandoffRoot, `${operationId}.result.json`);
  const hostAckPath = path.posix.join(hostHandoffRoot, `${operationId}.ack`);
  const hostDecisionPath = path.posix.join(hostHandoffRoot, `${operationId}.decision`);
  const ackNonce = request.ackNonce || randomBytes(24).toString('hex');
  const name = `glimmer-cradle-transaction-${operationId.replace(/[^A-Za-z0-9_.-]/g, '-').slice(-48)}`;
  return {
    operation_id: operationId,
    operation: request.operation,
    resultPath,
    requestPath,
    ackPath,
    decisionPath,
    ackNonce,
    args: [
      'run', '--detach', '--rm',
      '--name', name,
      '--label', `io.glimmer-cradle.transaction=${operationId}`,
      '--user', 'root',
      '--read-only',
      '--network', 'none',
      '--cap-drop', 'ALL',
      '--cap-add', 'CHOWN',
      '--cap-add', 'DAC_OVERRIDE',
      '--cap-add', 'FOWNER',
      '--security-opt', 'no-new-privileges',
      '--pids-limit', '128',
      '--entrypoint', '/bin/bash',
      '--env', `GLIMMER_CRADLE_TRANSACTION_REQUEST_ID=${operationId}`,
      '--env', 'GLIMMER_CRADLE_TRANSACTION_CONFIRMED=1',
      '--env', `GLIMMER_CRADLE_HANDOFF_OPERATION=${request.operation}`,
      '--env', `GLIMMER_CRADLE_HANDOFF_RESULT=${hostResultPath}`,
      '--env', `GLIMMER_CRADLE_HANDOFF_ACK=${hostAckPath}`,
      '--env', `GLIMMER_CRADLE_HANDOFF_DECISION=${hostDecisionPath}`,
      '--env', `GLIMMER_CRADLE_HANDOFF_ACK_NONCE=${ackNonce}`,
      '--env', `GLIMMER_CRADLE_STATE_ROOT=${stateRoot}`,
      '--env', `GLIMMER_CRADLE_RUN_ROOT=${hostRunRoot}`,
      '--env', `GLIMMER_CRADLE_DEPLOYMENT_ENV_FILE=${deploymentEnvFile}`,
      '--env', `GLIMMER_CRADLE_DEPLOYMENT_CONFIG_ROOT=${path.posix.dirname(deploymentEnvFile)}`,
      '--env', `GLIMMER_CRADLE_INSTALL_ROOT=${installRoot}`,
      '--env', `GLIMMER_CRADLE_DOCKER_SOCKET_PATH=${hostDockerSocket}`,
      '--mount', `type=bind,src=${hostDockerSocket},dst=${hostDockerSocket},readonly`,
      '--mount', `type=bind,src=${hostDockerBin},dst=/usr/bin/docker,readonly`,
      '--mount', `type=bind,src=${hostComposePlugin},dst=/usr/libexec/docker/cli-plugins/docker-compose,readonly`,
      '--mount', `type=bind,src=${installRoot},dst=${installRoot}`,
      '--mount', `type=bind,src=${path.posix.dirname(deploymentEnvFile)},dst=${path.posix.dirname(deploymentEnvFile)}`,
      '--mount', `type=bind,src=${stateRoot},dst=${stateRoot}`,
      '--mount', `type=bind,src=${hostRunRoot},dst=${hostRunRoot}`,
      '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=128m,mode=1777',
      image,
      '-c', OWNER_COMMAND, 'glimmer-cradle-handoff',
      ...request.command,
    ],
  };
}

export async function handoffToExternalOwner(config, request) {
  await cleanupHandoffResults(config);
  const launch = buildExternalOwnerArgs(config, request);
  await mkdir(path.posix.dirname(launch.resultPath), { recursive: true, mode: 0o700 });
  const existingRequest = await readJson(launch.requestPath);
  if (existingRequest) {
    assertSameRequest(existingRequest, request);
    launch.ackNonce = existingRequest.ack_nonce;
    const existingResult = await readHandoffResult(config, request.operationId);
    if (existingResult) return { ...existingResult, ...launch };
    const resumed = await waitForResult(
      config,
      request.operationId,
      config.readyTimeoutMs || OWNER_READY_TIMEOUT_MS,
      (value) => value.status === 'ready'
        || value.status === 'started'
        || TERMINAL_STATES.has(value.status),
    ).catch(() => null);
    if (resumed) return { ...resumed, ...launch };
    return { ...await settleOwnerTimeout(config, launch), ...launch };
  }

  const durableRequest = {
    schema_version: 1,
    operation_id: request.operationId,
    operation: request.operation,
    command: request.command,
    ack_nonce: launch.ackNonce,
    created_at: new Date().toISOString(),
  };
  await writeFile(launch.requestPath, `${JSON.stringify(durableRequest)}\n`, { mode: 0o600, flag: 'wx' });
  await rm(launch.resultPath, { force: true });
  await rm(launch.ackPath, { force: true });
  await rm(launch.decisionPath, { force: true });
  await (config.runDocker || runDocker)(config.dockerBin, launch.args);
  const ready = await waitForResult(config, request.operationId, config.readyTimeoutMs || OWNER_READY_TIMEOUT_MS, (value) => (
    value.status === 'ready' || TERMINAL_STATES.has(value.status)
  )).catch(async () => settleOwnerTimeout(config, launch));
  return { ...ready, ...launch };
}

export async function acknowledgeExternalOwner(config, handoff) {
  const acknowledgement = `${JSON.stringify({
    schema_version: 1,
    operation_id: handoff.operation_id,
    operation: handoff.operation,
    nonce: handoff.ackNonce,
  })}\n`;
  await compareOrCreate(
    handoff.ackPath,
    acknowledgement,
    'transaction_handoff_ack_conflict',
  );
  return waitForResult(
    config,
    handoff.operation_id,
    config.startedTimeoutMs || OWNER_STARTED_TIMEOUT_MS,
    (value) => value.status === 'started' || TERMINAL_STATES.has(value.status),
  ).catch(async () => settleOwnerTimeout(config, handoff));
}

export async function readHandoffResult(config, operationId) {
  if (!OPERATION_ID.test(operationId)) throw new Error('transaction_handoff_id_invalid');
  const resultPath = path.posix.join(config.bridgeRunRoot || '/run/glimmer-cradle', 'handoff', `${operationId}.result.json`);
  const result = await readJson(resultPath);
  if (!result) return null;
  if (result.operation_id !== operationId) throw new Error('transaction_handoff_id_mismatch');
  const updated = Date.parse(result.updated_at);
  if (!TERMINAL_STATES.has(result.status) && Number.isFinite(updated)
    && Date.now() - updated > (config.staleTimeoutMs || OWNER_STALE_TIMEOUT_MS)) {
    const paths = operationPaths(config, operationId);
    return settleOwnerTimeout(config, { ...paths, operation_id: operationId }, result);
  }
  return result;
}

export async function cleanupHandoffResults(config, now = Date.now()) {
  const root = path.posix.join(config.bridgeRunRoot || '/run/glimmer-cradle', 'handoff');
  const entries = await readdir(root).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const ids = new Set(entries.flatMap((name) => {
    const match = /^(deployment_op_[A-Za-z0-9][A-Za-z0-9._-]{0,111})\.(?:result\.json|request\.json|ack|decision)$/.exec(name);
    return match ? [match[1]] : [];
  }));
  for (const operationId of ids) {
    const paths = operationPaths(config, operationId);
    let result = await readHandoffResult(config, operationId);
    if (!result) {
      const request = await readJson(paths.requestPath);
      const created = Date.parse(request?.created_at)
        || await fileTimestamp(paths.requestPath);
      if (Number.isFinite(created) && now - created > (config.staleTimeoutMs || OWNER_STALE_TIMEOUT_MS)) {
        result = await settleOwnerTimeout(config, { ...paths, operation_id: operationId });
      }
    }
    const updated = Date.parse(result?.updated_at);
    if (!TERMINAL_STATES.has(result?.status) || !Number.isFinite(updated)
      || now - updated <= (config.retentionMs || HANDOFF_RETENTION_MS)) continue;
    for (const suffix of ['result.json', 'request.json', 'ack', 'decision']) {
      await rm(path.posix.join(root, `${operationId}.${suffix}`), { force: true });
    }
  }
}

async function waitForResult(config, operationId, timeoutMs, predicate) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await readHandoffResult(config, operationId);
    if (result && predicate(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('transaction_handoff_timeout');
}

async function settleOwnerTimeout(config, handoff, authoritative = null) {
  const current = authoritative || await readJson(handoff.resultPath);
  if (current && (current.status === 'started' || TERMINAL_STATES.has(current.status))) {
    return current;
  }
  const decision = await claimDecision(handoff.decisionPath, 'owner_timeout\n');
  if (decision.trim() === 'started') {
    const started = await readJson(handoff.resultPath);
    return started?.status === 'started' || TERMINAL_STATES.has(started?.status)
      ? started
      : {
        schema_version: 1,
        operation_id: handoff.operation_id,
        operation: current?.operation || (await readJson(handoff.requestPath))?.operation,
        status: 'started',
        exit_code: 0,
        updated_at: new Date().toISOString(),
        recovery_action: 'none',
      };
  }
  if (decision.trim() !== 'owner_timeout') {
    throw new Error('transaction_handoff_decision_conflict');
  }
  const request = await readJson(handoff.requestPath);
  const timeoutResult = {
    schema_version: 1,
    operation_id: handoff.operation_id,
    operation: current?.operation || request?.operation,
    status: 'owner_timeout',
    exit_code: 70,
    updated_at: new Date().toISOString(),
    recovery_action: 'retry query with the same operation_id; no deploy command was acknowledged',
  };
  await writeJsonAtomic(handoff.resultPath, timeoutResult);
  return timeoutResult;
}

async function claimDecision(filePath, requested) {
  try {
    await writeFile(filePath, requested, { mode: 0o600, flag: 'wx' });
    return requested;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return readFile(filePath, 'utf8');
  }
}

async function compareOrCreate(filePath, expected, conflictCode) {
  try {
    await writeFile(filePath, expected, { mode: 0o600, flag: 'wx' });
    return expected;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const actual = await readFile(filePath, 'utf8');
    if (actual !== expected) throw new Error(conflictCode);
    return actual;
  }
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${randomBytes(8).toString('hex')}.new`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, filePath);
}

function operationPaths(config, operationId) {
  const root = path.posix.join(config.bridgeRunRoot || '/run/glimmer-cradle', 'handoff');
  return {
    resultPath: path.posix.join(root, `${operationId}.result.json`),
    requestPath: path.posix.join(root, `${operationId}.request.json`),
    ackPath: path.posix.join(root, `${operationId}.ack`),
    decisionPath: path.posix.join(root, `${operationId}.decision`),
  };
}

async function fileTimestamp(filePath) {
  return stat(filePath).then((entry) => entry.mtimeMs).catch(() => Number.NaN);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function assertSameRequest(existing, request) {
  if (existing.operation_id !== request.operationId
    || existing.operation !== request.operation
    || JSON.stringify(existing.command) !== JSON.stringify(request.command)) {
    throw new Error('transaction_handoff_id_reused_with_different_request');
  }
}

function runDocker(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4096);
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`external_owner_start_failed:${code ?? 'null'}:${redact(stderr)}`)));
  });
}

function redact(value) {
  return String(value)
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/token=[^\s&]+/gi, 'token=[REDACTED]')
    .trim();
}

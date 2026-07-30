import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OWNER_COMMAND = `
set -Eeuo pipefail
source "$GLIMMER_CRADLE_INSTALL_ROOT/current/lib/host-transaction.sh"
finish() {
  code=$?
  trap - EXIT INT TERM
  normalized="$(host_transaction_normalize_exit "$code")"
  host_transaction_finish "$normalized" || normalized=78
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
  printf '{"transaction_id":"%s","status":"%s","exit_code":%d}\n' \
    "$GLIMMER_CRADLE_TRANSACTION_REQUEST_ID" \
    "$([ "$code" -eq 75 ] && printf conflict || printf failed)" "$code" \
    >"$GLIMMER_CRADLE_HANDOFF_RESULT"
  exit "$code"
fi
printf '{"transaction_id":"%s","status":"ready","exit_code":0}\n' \
  "$GLIMMER_CRADLE_TRANSACTION_ID" >"$GLIMMER_CRADLE_HANDOFF_RESULT"
deadline=$((SECONDS + 30))
while [ ! -f "$GLIMMER_CRADLE_HANDOFF_ACK" ]; do
  [ "$SECONDS" -lt "$deadline" ] || exit 70
  sleep 1
done
exec "$GLIMMER_CRADLE_INSTALL_ROOT/current/deploy.sh" "$@"
`;

export function buildExternalOwnerArgs(config, request) {
  const {
    image,
    installRoot,
    stateRoot,
    runRoot,
    deploymentEnvFile,
    hostDockerBin,
    hostComposePlugin,
    hostDockerSocket,
  } = config;
  const operationId = request.operationId;
  const handoffRoot = path.posix.join(runRoot, 'handoff');
  const resultPath = path.posix.join(handoffRoot, `${operationId}.result.json`);
  const ackPath = path.posix.join(handoffRoot, `${operationId}.ack`);
  const name = `glimmer-cradle-transaction-${operationId.replace(/[^A-Za-z0-9_.-]/g, '-').slice(-48)}`;
  return {
    resultPath,
    ackPath,
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
      '--env', `GLIMMER_CRADLE_HANDOFF_RESULT=${resultPath}`,
      '--env', `GLIMMER_CRADLE_HANDOFF_ACK=${ackPath}`,
      '--env', `GLIMMER_CRADLE_STATE_ROOT=${stateRoot}`,
      '--env', `GLIMMER_CRADLE_RUN_ROOT=${runRoot}`,
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
      '--mount', `type=bind,src=${runRoot},dst=${runRoot}`,
      '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=128m,mode=1777',
      image,
      '-c', OWNER_COMMAND, 'glimmer-cradle-handoff',
      ...request.command,
    ],
  };
}

export async function handoffToExternalOwner(config, request) {
  const launch = buildExternalOwnerArgs(config, request);
  await mkdir(path.posix.dirname(launch.resultPath), { recursive: true, mode: 0o700 });
  await rm(launch.resultPath, { force: true });
  await rm(launch.ackPath, { force: true });
  await runDocker(config.dockerBin, launch.args);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const result = JSON.parse(await readFile(launch.resultPath, 'utf8'));
      if (result.transaction_id !== request.operationId) throw new Error('transaction_handoff_id_mismatch');
      return { ...result, ackPath: launch.ackPath };
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('transaction_handoff_timeout');
}

export async function acknowledgeExternalOwner(ackPath) {
  await writeFile(ackPath, 'acknowledged\n', { mode: 0o600, flag: 'wx' });
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

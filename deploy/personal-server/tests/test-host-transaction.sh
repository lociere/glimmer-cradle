#!/usr/bin/env bash
set -Eeuo pipefail

if (( EUID != 0 )); then
  exec sudo --preserve-env=PATH bash "$0" "$@"
fi

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB="${REPO_ROOT}/deploy/personal-server/lib/host-transaction.sh"
DEPLOY="${REPO_ROOT}/deploy/personal-server/deploy.sh"
FIXTURES="${REPO_ROOT}/deploy/personal-server/tests/fixtures"
ROOT="$(mktemp -d /tmp/glimmer-transaction-test.XXXXXX)"
trap 'rm -rf -- "$ROOT"' EXIT

wait_file() {
  for _ in $(seq 1 200); do
    [[ -e "$1" ]] && return
    sleep 0.01
  done
  return 70
}

STATE="${ROOT}/state"
RUN="${ROOT}/run"
READY="${ROOT}/holder.ready"
RELEASE="${ROOT}/holder.release"
env GLIMMER_CRADLE_HOST_STATE_ROOT="$STATE" GLIMMER_CRADLE_RUN_ROOT="$RUN" \
  READY="$READY" RELEASE="$RELEASE" bash -c '
    set -Eeuo pipefail
    source "$1"
    host_transaction_acquire test.holder
    : >"$READY"
    while [[ ! -e "$RELEASE" ]]; do sleep 0.01; done
    host_transaction_phase commit
    host_transaction_finish 0
  ' bash "$LIB" &
HOLDER=$!
wait_file "$READY"
set +e
env GLIMMER_CRADLE_HOST_STATE_ROOT="$STATE" GLIMMER_CRADLE_RUN_ROOT="$RUN" \
  bash -c 'source "$1"; host_transaction_acquire test.contender' bash "$LIB" \
  >"${ROOT}/contender.out" 2>"${ROOT}/contender.err"
CODE=$?
set -e
[[ "$CODE" == 75 ]]
grep -q host_transaction_locked "${ROOT}/contender.err"
: >"$RELEASE"
wait "$HOLDER"
grep -q '"phase":"committed"' "${STATE}/transactions/current.json"

SPOOF="${ROOT}/spoof"
mkdir -p "$SPOOF"
set +e
env GLIMMER_CRADLE_HOST_STATE_ROOT="${ROOT}/spoof-state" GLIMMER_CRADLE_RUN_ROOT="${ROOT}/spoof-run" \
  GLIMMER_CRADLE_TRANSACTION_ID=forged GLIMMER_CRADLE_TRANSACTION_OPERATION=test.forged \
  bash -c 'exec 9>"$2"; source "$1"; host_transaction_acquire test.forged' \
  bash "$LIB" "${SPOOF}/unrelated" 2>"${ROOT}/spoof.err"
CODE=$?
set -e
[[ "$CODE" == 78 ]]
grep -q lock_fd_not_inherited "${ROOT}/spoof.err"

SAFE="${ROOT}/safe"
mkdir -p "$SAFE"
ln -s "$SAFE" "${ROOT}/symlink-run"
set +e
env GLIMMER_CRADLE_HOST_STATE_ROOT="${ROOT}/symlink-state" GLIMMER_CRADLE_RUN_ROOT="${ROOT}/symlink-run" \
  bash -c 'source "$1"; host_transaction_acquire test.symlink' bash "$LIB" 2>"${ROOT}/symlink.err"
CODE=$?
set -e
[[ "$CODE" == 64 || "$CODE" == 78 ]]

mkdir -p "${ROOT}/user-run"
chown 65534:65534 "${ROOT}/user-run"
set +e
env GLIMMER_CRADLE_HOST_STATE_ROOT="${ROOT}/user-state" GLIMMER_CRADLE_RUN_ROOT="${ROOT}/user-run" \
  bash -c 'source "$1"; host_transaction_acquire test.user' bash "$LIB" 2>"${ROOT}/user.err"
CODE=$?
set -e
[[ "$CODE" == 78 ]]

REPLACE_STATE="${ROOT}/replace-state"
REPLACE_RUN="${ROOT}/replace-run"
set +e
env GLIMMER_CRADLE_HOST_STATE_ROOT="$REPLACE_STATE" GLIMMER_CRADLE_RUN_ROOT="$REPLACE_RUN" \
  bash -c '
    source "$1"
    host_transaction_acquire test.replace
    rm -f -- "$HOST_TRANSACTION_LOCK_FILE"
    install -o 0 -g 0 -m 0600 /dev/null "$HOST_TRANSACTION_LOCK_FILE"
    host_transaction_finish 0
  ' bash "$LIB" 2>"${ROOT}/replace.err"
CODE=$?
set -e
[[ "$CODE" == 78 ]]
grep -q lock_inode_replaced "${ROOT}/replace.err"

QUERY="${ROOT}/query"
mkdir -p "$QUERY"
: >"${QUERY}/docker.log"
: >"${QUERY}/sudo.log"
cat >"${QUERY}/deployment.env" <<EOF
GLIMMER_CRADLE_STATE_ROOT=${QUERY}/state
GLIMMER_CRADLE_HOST_STATE_ROOT=${QUERY}/state/host
GLIMMER_CRADLE_SERVICE_STATE_ROOT=${QUERY}/state/service
GLIMMER_CRADLE_DEPLOYMENT_MODE=image
EOF
BEFORE="$(sha256sum "${QUERY}/deployment.env")"
set +e
env PATH="${FIXTURES}:${PATH}" \
  GLIMMER_CRADLE_DEPLOYMENT_ENV_FILE="${QUERY}/deployment.env" \
  GLIMMER_CRADLE_TEST_DOCKER_LOG="${QUERY}/docker.log" \
  GLIMMER_CRADLE_TEST_SUDO_LOG="${QUERY}/sudo.log" \
  GLIMMER_CRADLE_TEST_DOCKER_UNAVAILABLE=1 \
  bash "$DEPLOY" status 2>"${QUERY}/query.err"
CODE=$?
set -e
[[ "$CODE" == 66 ]]
[[ "$(sha256sum "${QUERY}/deployment.env")" == "$BEFORE" ]]
[[ ! -e "${QUERY}/state" && ! -s "${QUERY}/sudo.log" ]]

RECOVERY="${ROOT}/recovery"
mkdir -p "$RECOVERY"

set +e
ACTION_FILE="${RECOVERY}/backup-restart.action" DEPLOY="$DEPLOY" bash -c '
  source "$DEPLOY"
  DEPLOYMENT_ENV_FILE=/fixture/deployment.env
  compose_with_env() {
    [[ "$*" == *"ps --status running --services"* ]] && { printf "personal-server\n"; return 0; }
    [[ "$*" == *"down --remove-orphans"* ]] && return 0
    [[ "$*" == *"up --detach --remove-orphans"* ]] && return 1
    return 0
  }
  current_container_image() { printf "fixture-image"; }
  create_backup() { printf "/fixture/manual-backup"; }
  mark_backup() { :; }
  host_transaction_mark_recovery_required() { printf "%s" "$1" >"$ACTION_FILE"; }
  backup_release
' 2>"${RECOVERY}/backup-restart.err"
CODE=$?
set -e
[[ "$CODE" == 78 ]]
grep -q 'manual backup completed' "${RECOVERY}/backup-restart.action"

mkdir -p "${RECOVERY}/manual/20260729T010203Z"
set +e
ACTION_FILE="${RECOVERY}/restore-snapshot.action" DEPLOY="$DEPLOY" RECOVERY="$RECOVERY" bash -c '
  source "$DEPLOY"
  MANUAL_BACKUP_ROOT="$RECOVERY/manual"
  TRANSACTION_BACKUP_ROOT="$RECOVERY/transaction"
  DEPLOYMENT_ENV_FILE=/fixture/deployment.env
  validate_backup() { :; }
  compose_with_env() {
    [[ "$*" == *"ps --status running --services"* ]] && { printf "personal-server\n"; return 0; }
    [[ "$*" == *"down --remove-orphans"* ]] && return 0
    [[ "$*" == *"up --detach --remove-orphans"* ]] && return 1
    return 0
  }
  current_container_image() { printf "fixture-image"; }
  create_backup() { return 1; }
  host_transaction_mark_recovery_required() { printf "%s" "$1" >"$ACTION_FILE"; }
  restore_release 20260729T010203Z
' 2>"${RECOVERY}/restore-snapshot.err"
CODE=$?
set -e
[[ "$CODE" == 78 ]]
grep -q 'safety snapshot failed' "${RECOVERY}/restore-snapshot.action"

set +e
ACTION_FILE="${RECOVERY}/restore-readiness.action" DEPLOY="$DEPLOY" RECOVERY="$RECOVERY" bash -c '
  source "$DEPLOY"
  MANUAL_BACKUP_ROOT="$RECOVERY/manual"
  TRANSACTION_BACKUP_ROOT="$RECOVERY/transaction"
  DEPLOYMENT_ENV_FILE=/fixture/deployment.env
  validate_backup() { :; }
  compose_with_env() {
    [[ "$*" == *"ps --status running --services"* ]] && { printf "personal-server\n"; return 0; }
    return 0
  }
  current_container_image() { printf "fixture-image"; }
  create_backup() { printf "/fixture/restore-safety"; }
  restore_backup() { :; }
  mark_backup() { :; }
  wait_until_ready() { return 1; }
  host_transaction_mark_recovery_required() { printf "%s" "$1" >"$ACTION_FILE"; }
  restore_release 20260729T010203Z
' 2>"${RECOVERY}/restore-readiness.err"
CODE=$?
set -e
[[ "$CODE" == 78 ]]
grep -q 'safety compensation did not recover' "${RECOVERY}/restore-readiness.action"

UNTRUSTED="${ROOT}/untrusted-service"
mkdir -p "${UNTRUSTED}/service/config" "${UNTRUSTED}/service/data/models" \
  "${UNTRUSTED}/service/data/packages" "${UNTRUSTED}/outside" "${UNTRUSTED}/host/backups/manual"
ln -s "${UNTRUSTED}/outside" "${UNTRUSTED}/service/data/state"
set +e
UNTRUSTED="$UNTRUSTED" DEPLOY="$DEPLOY" bash -c '
  source "$DEPLOY"
  SERVICE_STATE_ROOT="$UNTRUSTED/service"
  MANUAL_BACKUP_ROOT="$UNTRUSTED/host/backups/manual"
  PRIVILEGED=()
  create_backup manual
' >"${UNTRUSTED}/backup.out" 2>"${UNTRUSTED}/backup.err"
CODE=$?
set -e
[[ "$CODE" == 70 ]]
grep -q '备份已拒绝' "${UNTRUSTED}/backup.err"
[[ -z "$(find "${UNTRUSTED}/host/backups/manual" -mindepth 1 -maxdepth 1 -print -quit)" ]]

printf 'host transaction sandbox tests passed\n'

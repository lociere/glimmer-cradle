#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if (( EUID != 0 )); then
  command -v sudo >/dev/null 2>&1 || {
    echo "安装写事务需要 root；系统未提供 sudo。" >&2
    exit 66
  }
  exec sudo --preserve-env=GLIMMER_CRADLE_STATE_ROOT,GLIMMER_CRADLE_RUN_ROOT,GLIMMER_CRADLE_HOST_RUN_ROOT,GLIMMER_CRADLE_SERVICE_RUN_ROOT,GLIMMER_CRADLE_DEPLOYMENT_ENV_FILE \
    "$0" "$@"
fi

docker_is_ready() {
  docker info >/dev/null 2>&1 \
    && docker compose version >/dev/null 2>&1 \
    && docker buildx version >/dev/null 2>&1
}

privileged_docker_is_ready() {
  if (( EUID == 0 )); then
    docker_is_ready
    return
  fi
  command -v sudo >/dev/null 2>&1 \
    && sudo -v \
    && sudo docker info >/dev/null 2>&1 \
    && sudo docker compose version >/dev/null 2>&1 \
    && sudo docker buildx version >/dev/null 2>&1
}

if ! docker_is_ready && ! privileged_docker_is_ready; then
  if (( EUID == 0 )); then
    "${SCRIPT_DIR}/bootstrap-host.sh"
  else
    "${SCRIPT_DIR}/bootstrap-host.sh"
  fi
fi

exec "${SCRIPT_DIR}/deploy.sh" install

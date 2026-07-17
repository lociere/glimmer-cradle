#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

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
  elif ! command -v sudo >/dev/null 2>&1; then
    echo "需要 root 权限初始化 Docker Engine，但系统未提供 sudo。请以 root 身份重新运行此脚本。" >&2
    exit 1
  else
    echo "正在初始化 Docker Engine、Buildx 与 Compose。"
    sudo "${SCRIPT_DIR}/bootstrap-host.sh"
  fi
fi

exec "${SCRIPT_DIR}/deploy.sh" install

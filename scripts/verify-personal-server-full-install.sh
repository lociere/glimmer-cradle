#!/usr/bin/env bash
set -Eeuo pipefail

IMAGE="${1:?用法: verify-personal-server-full-install.sh <image@sha256:digest>}"
VERSION="${2:-$(node -p 'require("./package.json").version')}"
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VERIFY_ROOT="$(mktemp -d)"
RELEASE_ROOT="${VERIFY_ROOT}/release"
INSTALL_ROOT="${VERIFY_ROOT}/install"
STATE_ROOT="${VERIFY_ROOT}/state"
CONFIG_ROOT="${VERIFY_ROOT}/config"
CLI_PATH="${VERIFY_ROOT}/bin/glimmer-cradle"
HTTP_PORT=8080
ARCHIVE_IMAGE=""
BAD_IMAGE=""
BAD_ARCHIVE_IMAGE=""

as_root() {
  if (( EUID == 0 )); then
    "$@"
  else
    sudo "$@"
  fi
}

cleanup() {
  if [[ -x "$CLI_PATH" ]]; then
    as_root "$CLI_PATH" stop >/dev/null 2>&1 || true
  fi
  as_root rm -rf -- "$VERIFY_ROOT"
  if [[ -n "$ARCHIVE_IMAGE" ]]; then
    docker image rm "$ARCHIVE_IMAGE" >/dev/null 2>&1 || true
  fi
  if [[ -n "$BAD_ARCHIVE_IMAGE" ]]; then
    docker image rm "$BAD_ARCHIVE_IMAGE" >/dev/null 2>&1 || true
  fi
  if [[ -n "$BAD_IMAGE" ]]; then
    docker image rm "$BAD_IMAGE" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

docker image inspect "$IMAGE" >/dev/null
DIGEST="${IMAGE##*@sha256:}"
ARCHIVE_IMAGE="glimmer-cradle/personal-server:release-v${VERSION}-${DIGEST:0:12}"
docker tag "$IMAGE" "$ARCHIVE_IMAGE"
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$ARCHIVE_IMAGE")"
docker save --output "${VERIFY_ROOT}/personal-server-linux-amd64.tar" "$ARCHIVE_IMAGE"
docker image rm "$ARCHIVE_IMAGE" >/dev/null
SOURCE_DATE_EPOCH=1 "${REPO_ROOT}/deploy/personal-server/package-release.sh" \
  "$VERSION" "$RELEASE_ROOT" "$IMAGE" "${VERIFY_ROOT}/personal-server-linux-amd64.tar" "$ARCHIVE_IMAGE" "$IMAGE_ID"

install_full() {
  as_root env \
    GLIMMER_CRADLE_RELEASE_SOURCE="$RELEASE_ROOT" \
    GLIMMER_CRADLE_PACKAGE_VARIANT=full \
    GLIMMER_CRADLE_VERSION="$VERSION" \
    GLIMMER_CRADLE_INSTALL_ROOT="$INSTALL_ROOT" \
    GLIMMER_CRADLE_STATE_ROOT="$STATE_ROOT" \
    GLIMMER_CRADLE_DEPLOYMENT_CONFIG_ROOT="$CONFIG_ROOT" \
    GLIMMER_CRADLE_CLI_PATH="$CLI_PATH" \
    bash "${RELEASE_ROOT}/glimmer-cradle-installer.sh"
}

install_full
as_root sh -c "printf 'preserved\n' > '${STATE_ROOT}/data/m10-install-verification'"
install_full
[[ "$(as_root cat "${STATE_ROOT}/data/m10-install-verification")" == preserved ]]
[[ ! -e "${INSTALL_ROOT}/releases/${VERSION}/images" ]]

BACKUP_OUTPUT="$(as_root "$CLI_PATH" backup)"
BACKUP_PATH="${BACKUP_OUTPUT##*备份已创建: }"
BACKUP_NAME="$(basename -- "$BACKUP_PATH")"
as_root sh -c "printf 'corrupted\n' > '${STATE_ROOT}/data/m10-install-verification'"
as_root "$CLI_PATH" restore "$BACKUP_NAME"
[[ "$(as_root cat "${STATE_ROOT}/data/m10-install-verification")" == preserved ]]

BAD_VERSION=0.1.2
BAD_RELEASE_ROOT="${VERIFY_ROOT}/bad-release"
BAD_IMAGE="glimmer-cradle/personal-server:m10-unhealthy"
printf 'FROM %s\nENTRYPOINT ["/bin/false"]\n' "$IMAGE" | docker build --quiet --tag "$BAD_IMAGE" - >/dev/null
BAD_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$BAD_IMAGE")"
BAD_DIGEST="${BAD_IMAGE_ID#sha256:}"
BAD_DECLARED_IMAGE="ghcr.io/example/glimmer-cradle-personal-server:v${BAD_VERSION}@sha256:${BAD_DIGEST}"
BAD_ARCHIVE_IMAGE="glimmer-cradle/personal-server:release-v${BAD_VERSION}-${BAD_DIGEST:0:12}"
docker tag "$BAD_IMAGE" "$BAD_ARCHIVE_IMAGE"
docker save --output "${VERIFY_ROOT}/bad-image.tar" "$BAD_ARCHIVE_IMAGE"
SOURCE_DATE_EPOCH=1 "${REPO_ROOT}/deploy/personal-server/package-release.sh" \
  "$BAD_VERSION" "$BAD_RELEASE_ROOT" "$BAD_DECLARED_IMAGE" "${VERIFY_ROOT}/bad-image.tar" \
  "$BAD_ARCHIVE_IMAGE" "$BAD_IMAGE_ID"
docker image rm "$BAD_ARCHIVE_IMAGE" >/dev/null
if as_root env \
  GLIMMER_CRADLE_RELEASE_SOURCE="$BAD_RELEASE_ROOT" \
  GLIMMER_CRADLE_PACKAGE_VARIANT=full \
  GLIMMER_CRADLE_VERSION="$BAD_VERSION" \
  GLIMMER_CRADLE_INSTALL_ROOT="$INSTALL_ROOT" \
  GLIMMER_CRADLE_STATE_ROOT="$STATE_ROOT" \
  GLIMMER_CRADLE_DEPLOYMENT_CONFIG_ROOT="$CONFIG_ROOT" \
  GLIMMER_CRADLE_CLI_PATH="$CLI_PATH" \
  GLIMMER_CRADLE_READY_TIMEOUT_SECONDS=10 \
  bash "${BAD_RELEASE_ROOT}/glimmer-cradle-installer.sh"; then
  echo '不健康候选版本错误通过了就绪门。' >&2
  exit 1
fi
[[ "$(<"${INSTALL_ROOT}/current/VERSION")" == "$VERSION" ]]
[[ ! -e "${INSTALL_ROOT}/releases/${BAD_VERSION}" ]]
[[ "$(as_root cat "${STATE_ROOT}/data/m10-install-verification")" == preserved ]]
as_root "$CLI_PATH" status >/dev/null

as_root "$CLI_PATH" stop
if docker ps --format '{{.Names}}' | grep -Eq '^glimmer-cradle-(personal-server|caddy)$'; then
  echo 'stop 后仍有 Personal Server 容器运行。' >&2
  exit 1
fi
if command -v ss >/dev/null 2>&1 && ss -H -ltn "sport = :${HTTP_PORT}" | grep -q .; then
  echo "stop 后端口 ${HTTP_PORT} 仍被占用。" >&2
  exit 1
fi

echo 'Personal Server 完整包离线安装、重复安装、备份恢复、更新失败回滚、数据连续性与停止回收验证通过。'

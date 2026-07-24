#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REMOTE_HOST="${1:?用法: glimmer-cradle-remote-installer.sh <user@host>}"
VERSION="${GLIMMER_CRADLE_VERSION:-latest}"
RELEASE_SOURCE="${GLIMMER_CRADLE_RELEASE_SOURCE:-}"
DOWNLOAD_TOKEN="${GLIMMER_CRADLE_GITHUB_TOKEN:-${GH_TOKEN:-}}"
SSH_IDENTITY="${GLIMMER_CRADLE_SSH_IDENTITY:-}"
SSH_PORT="${GLIMMER_CRADLE_SSH_PORT:-}"
CHECKSUMS_NAME=SHA256SUMS
INSTALLER_NAME=glimmer-cradle-installer.sh
REMOTE_ROOT=""

[[ "$REMOTE_HOST" =~ ^[A-Za-z0-9._@:%+-]+$ && "$REMOTE_HOST" != -* ]] || {
  echo "远程主机只接受 SSH 的 user@host 或已配置 Host alias。" >&2
  exit 2
}
[[ "$VERSION" == latest || "$VERSION" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || {
  echo "GLIMMER_CRADLE_VERSION 必须是 latest 或语义版本。" >&2
  exit 2
}
if [[ -n "$SSH_PORT" ]]; then
  [[ "$SSH_PORT" =~ ^[0-9]+$ && "$SSH_PORT" -ge 1 && "$SSH_PORT" -le 65535 ]] || {
    echo "GLIMMER_CRADLE_SSH_PORT 必须是 1 到 65535。" >&2
    exit 2
  }
fi
if [[ -n "$SSH_IDENTITY" && ! -f "$SSH_IDENTITY" ]]; then
  echo "SSH identity 不存在: ${SSH_IDENTITY}" >&2
  exit 2
fi

for command in ssh scp sha256sum awk mktemp; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "控制机缺少 ${command}。" >&2
    exit 1
  }
done
if command -v curl >/dev/null 2>&1; then
  DOWNLOAD_CLIENT=curl
elif command -v wget >/dev/null 2>&1; then
  DOWNLOAD_CLIENT=wget
else
  echo "控制机必须提供 curl 或 wget。" >&2
  exit 1
fi

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=8)
SCP=(scp -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=8)
if [[ -n "$SSH_IDENTITY" ]]; then
  SSH+=(-i "$SSH_IDENTITY")
  SCP+=(-i "$SSH_IDENTITY")
fi
if [[ -n "$SSH_PORT" ]]; then
  SSH+=(-p "$SSH_PORT")
  SCP+=(-P "$SSH_PORT")
fi

TEMP_ROOT="$(mktemp -d)"
cleanup() {
  local exit_code=$?
  rm -rf -- "$TEMP_ROOT"
  if [[ -n "$REMOTE_ROOT" ]]; then
    if ! "${SSH[@]}" "$REMOTE_HOST" rm -rf -- "$REMOTE_ROOT" >/dev/null 2>&1; then
      echo "远程临时目录清理失败，请手工删除: ${REMOTE_HOST}:${REMOTE_ROOT}" >&2
      if (( exit_code == 0 )); then
        exit_code=1
      fi
    fi
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

if [[ -n "$RELEASE_SOURCE" ]]; then
  DOWNLOAD_BASE="${RELEASE_SOURCE%/}"
elif [[ "$VERSION" == latest ]]; then
  DOWNLOAD_BASE=https://github.com/lociere/glimmer-cradle/releases/latest/download
else
  DOWNLOAD_BASE="https://github.com/lociere/glimmer-cradle/releases/download/v${VERSION#v}"
fi

download() {
  local source="$1"
  local target="$2"
  local -a auth_args=()
  if [[ -n "$DOWNLOAD_TOKEN" && "$source" == https://github.com/* ]]; then
    if [[ "$DOWNLOAD_CLIENT" == curl ]]; then
      auth_args=(--header "Authorization: Bearer ${DOWNLOAD_TOKEN}")
    else
      auth_args=(--header="Authorization: Bearer ${DOWNLOAD_TOKEN}")
    fi
  fi
  if [[ "$DOWNLOAD_CLIENT" == curl ]]; then
    curl --fail --show-error --location --retry 3 --retry-all-errors \
      --retry-delay 2 --connect-timeout 10 --speed-limit 1024 --speed-time 30 \
      "${auth_args[@]}" --output "$target" "$source"
  else
    wget --quiet --show-progress --tries=3 --timeout=30 \
      "${auth_args[@]}" --output-document="$target" "$source"
  fi
}

acquire() {
  local name="$1"
  local target="$2"
  if [[ "$DOWNLOAD_BASE" =~ ^https:// ]]; then
    download "${DOWNLOAD_BASE}/${name}" "$target"
  elif [[ "$DOWNLOAD_BASE" =~ ^http:// ]]; then
    echo "远程发布源必须使用 HTTPS: ${DOWNLOAD_BASE}" >&2
    exit 1
  else
    local source_path="${DOWNLOAD_BASE#file://}/${name}"
    [[ -f "$source_path" ]] || {
      echo "本地发布资产不存在: ${source_path}" >&2
      exit 1
    }
    cp -- "$source_path" "$target"
  fi
}

echo "控制机正在取得并校验 Personal Server 完整发布包。"
acquire "$CHECKSUMS_NAME" "${TEMP_ROOT}/${CHECKSUMS_NAME}"
mapfile -t FULL_ASSETS < <(
  awk '$2 ~ /^glimmer-cradle-personal-server-v[0-9A-Za-z][0-9A-Za-z._+-]*-linux-amd64-full\.tar\.gz$/ { print $2 }' \
    "${TEMP_ROOT}/${CHECKSUMS_NAME}"
)
(( ${#FULL_ASSETS[@]} == 1 )) || {
  echo "发布清单必须且只能声明一个 linux-amd64 完整包。" >&2
  exit 1
}
FULL_ASSET="${FULL_ASSETS[0]}"
RELEASE_VERSION="${FULL_ASSET#glimmer-cradle-personal-server-v}"
RELEASE_VERSION="${RELEASE_VERSION%-linux-amd64-full.tar.gz}"
if [[ "$VERSION" != latest && "$RELEASE_VERSION" != "${VERSION#v}" ]]; then
  echo "请求版本与发布清单不一致: ${VERSION} != ${RELEASE_VERSION}" >&2
  exit 1
fi
acquire "$FULL_ASSET" "${TEMP_ROOT}/${FULL_ASSET}"
acquire "$INSTALLER_NAME" "${TEMP_ROOT}/${INSTALLER_NAME}"
(
  cd "$TEMP_ROOT"
  awk -v full="$FULL_ASSET" -v installer="$INSTALLER_NAME" \
    '$2 == full || $2 == installer' "$CHECKSUMS_NAME" > selected.sha256
  [[ "$(wc -l < selected.sha256)" == 2 ]]
  sha256sum --check selected.sha256
)

REMOTE_ROOT="$("${SSH[@]}" "$REMOTE_HOST" "mktemp -d /tmp/glimmer-cradle-${RELEASE_VERSION}.XXXXXX")"
[[ "$REMOTE_ROOT" =~ ^/tmp/glimmer-cradle-[0-9A-Za-z.+-]+\.[0-9A-Za-z]+$ ]] || {
  echo "远程临时目录格式无效。" >&2
  exit 1
}
"${SCP[@]}" \
  "${TEMP_ROOT}/${CHECKSUMS_NAME}" \
  "${TEMP_ROOT}/${FULL_ASSET}" \
  "${TEMP_ROOT}/${INSTALLER_NAME}" \
  "${REMOTE_HOST}:${REMOTE_ROOT}/"

echo "远程主机正在从已校验本地完整包执行事务安装。"
REMOTE_SCRIPT=$(cat <<'EOF'
set -Eeuo pipefail
remote_root="$1"
release_version="$2"
full_asset="glimmer-cradle-personal-server-v${release_version}-linux-amd64-full.tar.gz"
cd "$remote_root"
awk -v full="$full_asset" -v installer=glimmer-cradle-installer.sh \
  '$2 == full || $2 == installer' SHA256SUMS > selected.sha256
[[ "$(wc -l < selected.sha256)" == 2 ]]
sha256sum --check selected.sha256
if (( EUID == 0 )); then
  privileged=()
else
  privileged=(sudo -n)
fi
"${privileged[@]}" env \
  GLIMMER_CRADLE_RELEASE_SOURCE="$remote_root" \
  GLIMMER_CRADLE_PACKAGE_VARIANT=full \
  GLIMMER_CRADLE_VERSION="$release_version" \
  bash ./glimmer-cradle-installer.sh
EOF
)
printf '%s\n' "$REMOTE_SCRIPT" | "${SSH[@]}" "$REMOTE_HOST" bash -s -- "$REMOTE_ROOT" "$RELEASE_VERSION"
echo "Glimmer Cradle Personal Server ${RELEASE_VERSION} 远程安装完成。"

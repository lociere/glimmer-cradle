#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if (( EUID != 0 )); then
  echo "请通过 sudo 运行远程安装器。" >&2
  exit 1
fi

VERSION="${GLIMMER_CRADLE_VERSION:-latest}"
INSTALL_ROOT="${GLIMMER_CRADLE_INSTALL_ROOT:-/opt/glimmer-cradle}"
STATE_ROOT="${GLIMMER_CRADLE_STATE_ROOT:-/var/lib/glimmer-cradle}"
CONFIG_ROOT="${GLIMMER_CRADLE_DEPLOYMENT_CONFIG_ROOT:-/etc/glimmer-cradle}"
DEPLOYMENT_ENV_FILE="${CONFIG_ROOT}/deployment.env"
CLI_PATH="${GLIMMER_CRADLE_CLI_PATH:-/usr/local/bin/glimmer-cradle}"
RELEASE_TARGET="linux-amd64"
CHECKSUMS_NAME="SHA256SUMS"
DOWNLOAD_TOKEN="${GLIMMER_CRADLE_GITHUB_TOKEN:-${GH_TOKEN:-}}"
GHCR_TOKEN="${GLIMMER_CRADLE_GHCR_TOKEN:-$DOWNLOAD_TOKEN}"
GHCR_USERNAME="${GLIMMER_CRADLE_GITHUB_USER:-lociere}"

if [[ -n "${GLIMMER_CRADLE_DOWNLOAD_BASE:-}" ]]; then
  DOWNLOAD_BASE="${GLIMMER_CRADLE_DOWNLOAD_BASE%/}"
elif [[ "$VERSION" == "latest" ]]; then
  DOWNLOAD_BASE="https://github.com/lociere/glimmer-cradle/releases/latest/download"
else
  DOWNLOAD_BASE="https://github.com/lociere/glimmer-cradle/releases/download/v${VERSION#v}"
fi

for command in tar sha256sum install; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "基础系统缺少 ${command}；请使用受支持的 Ubuntu 24.04 或 Debian 13 最小镜像。" >&2
    exit 1
  }
done

case "$(uname -m)" in
  x86_64|amd64) ;;
  *)
    echo "当前正式发行只支持 linux/amd64；检测到架构: $(uname -m)。" >&2
    exit 1
    ;;
esac

if command -v curl >/dev/null 2>&1; then
  DOWNLOAD_CLIENT=curl
elif command -v wget >/dev/null 2>&1; then
  DOWNLOAD_CLIENT=wget
else
  echo "基础系统必须提供 curl 或 wget 之一，才能取得发布包。" >&2
  exit 1
fi

TEMP_ROOT="$(mktemp -d)"
cleanup() {
  rm -rf -- "$TEMP_ROOT"
}
trap cleanup EXIT INT TERM

download() {
  local source="$1"
  local target="$2"
  local -a auth_args=()
  if [[ -n "$DOWNLOAD_TOKEN" && "$source" == https://github.com/* ]]; then
    if [[ "$DOWNLOAD_CLIENT" == "curl" ]]; then
      auth_args=(--header "Authorization: Bearer ${DOWNLOAD_TOKEN}")
    else
      auth_args=(--header="Authorization: Bearer ${DOWNLOAD_TOKEN}")
    fi
  fi
  if [[ "$DOWNLOAD_CLIENT" == "curl" ]]; then
    curl --fail --show-error --location \
      --retry 5 --retry-delay 2 --connect-timeout 20 \
      "${auth_args[@]}" --output "$target" "$source"
  else
    wget --quiet --show-progress --tries=5 --timeout=20 \
      "${auth_args[@]}" --output-document="$target" "$source"
  fi
}

echo "正在下载 Glimmer Cradle Personal Server 发布包。"
download "${DOWNLOAD_BASE}/${CHECKSUMS_NAME}" "${TEMP_ROOT}/${CHECKSUMS_NAME}"
mapfile -t PACKAGE_ASSETS < <(
  awk '$2 ~ /^glimmer-cradle-personal-server-v[0-9A-Za-z][0-9A-Za-z._+-]*-linux-amd64\.tar\.gz$/ { print $2 }' \
    "${TEMP_ROOT}/${CHECKSUMS_NAME}"
)
if (( ${#PACKAGE_ASSETS[@]} != 1 )); then
  echo "发布清单必须且只能声明一个 ${RELEASE_TARGET} Personal Server 部署包。" >&2
  exit 1
fi
ASSET_NAME="${PACKAGE_ASSETS[0]}"
download "${DOWNLOAD_BASE}/${ASSET_NAME}" "${TEMP_ROOT}/${ASSET_NAME}"
(
  cd "$TEMP_ROOT"
  sha256sum --check --ignore-missing "$CHECKSUMS_NAME"
)
PACKAGE_SHA256="$(awk -v asset="$ASSET_NAME" '$2 == asset { print $1 }' "${TEMP_ROOT}/${CHECKSUMS_NAME}")"
[[ "$PACKAGE_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || {
  echo "发布包摘要格式无效。" >&2
  exit 1
}

while IFS= read -r entry; do
  case "$entry" in
    glimmer-cradle-personal-server|glimmer-cradle-personal-server/*) ;;
    *) echo "发布包包含非法顶层路径: ${entry}" >&2; exit 1 ;;
  esac
  [[ "$entry" != /* && "$entry" != *'/../'* && "$entry" != '../'* ]] || {
    echo "发布包包含越界路径: ${entry}" >&2
    exit 1
  }
done < <(tar -tzf "${TEMP_ROOT}/${ASSET_NAME}")

tar -xzf "${TEMP_ROOT}/${ASSET_NAME}" -C "$TEMP_ROOT"
PAYLOAD_ROOT="${TEMP_ROOT}/glimmer-cradle-personal-server"
RELEASE_VERSION="$(<"${PAYLOAD_ROOT}/VERSION")"
[[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || {
  echo "发布版本标识无效: ${RELEASE_VERSION}" >&2
  exit 1
}
EXPECTED_ASSET_NAME="glimmer-cradle-personal-server-v${RELEASE_VERSION}-${RELEASE_TARGET}.tar.gz"
[[ "$ASSET_NAME" == "$EXPECTED_ASSET_NAME" ]] || {
  echo "发布包文件名与内部版本不一致: ${ASSET_NAME} != ${EXPECTED_ASSET_NAME}" >&2
  exit 1
}
if [[ "$VERSION" != "latest" && "$RELEASE_VERSION" != "${VERSION#v}" ]]; then
  echo "请求版本与发布包内部版本不一致: ${VERSION} != ${RELEASE_VERSION}" >&2
  exit 1
fi
RELEASE_ROOT="${INSTALL_ROOT}/releases/${RELEASE_VERSION}"
PREVIOUS_RELEASE=""
EXISTING_DEPLOYMENT=0
CURRENT_IMAGE=""
DEPLOYMENT_ENV_BACKUP="${TEMP_ROOT}/deployment.env.previous"
if [[ -L "${INSTALL_ROOT}/current" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "${INSTALL_ROOT}/current")"
fi
if [[ -f "$DEPLOYMENT_ENV_FILE" ]]; then
  EXISTING_DEPLOYMENT=1
  cp "$DEPLOYMENT_ENV_FILE" "$DEPLOYMENT_ENV_BACKUP"
  CURRENT_IMAGE="$(grep '^GLIMMER_CRADLE_IMAGE=' "$DEPLOYMENT_ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
fi

install -d -m 0755 "$INSTALL_ROOT" "${INSTALL_ROOT}/releases" "$CONFIG_ROOT"
if [[ -d "$RELEASE_ROOT" ]]; then
  EXISTING_RELEASE_SHA=""
  if [[ -f "${RELEASE_ROOT}/.release-sha256" ]]; then
    EXISTING_RELEASE_SHA="$(<"${RELEASE_ROOT}/.release-sha256")"
  fi
  [[ "$EXISTING_RELEASE_SHA" == "$PACKAGE_SHA256" ]] || {
    echo "版本 ${RELEASE_VERSION} 已存在但摘要不同；拒绝覆盖不可变版本目录。" >&2
    exit 1
  }
else
  STAGED_RELEASE="${INSTALL_ROOT}/releases/.${RELEASE_VERSION}.$$.new"
  rm -rf -- "$STAGED_RELEASE"
  install -d -m 0755 "$STAGED_RELEASE"
  cp -a "${PAYLOAD_ROOT}/." "$STAGED_RELEASE/"
  printf '%s\n' "$PACKAGE_SHA256" > "${STAGED_RELEASE}/.release-sha256"
  chmod 0644 "${STAGED_RELEASE}/.release-sha256"
  mv -- "$STAGED_RELEASE" "$RELEASE_ROOT"
fi

if [[ ! -f "$DEPLOYMENT_ENV_FILE" ]]; then
  cp "${RELEASE_ROOT}/.env.example" "$DEPLOYMENT_ENV_FILE"
fi

set_env_value() {
  local key="$1"
  local value="$2"
  local temporary
  temporary="$(mktemp "${DEPLOYMENT_ENV_FILE}.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$DEPLOYMENT_ENV_FILE" > "$temporary"
  chmod 600 "$temporary"
  mv -f -- "$temporary" "$DEPLOYMENT_ENV_FILE"
}

set_env_value GLIMMER_CRADLE_DEPLOYMENT_MODE image
set_env_value GLIMMER_CRADLE_STATE_ROOT "$STATE_ROOT"
set_env_value GLIMMER_CRADLE_CADDYFILE "${RELEASE_ROOT}/Caddyfile"
if [[ -n "${GLIMMER_CRADLE_CADDY_IMAGE:-}" ]]; then
  set_env_value GLIMMER_CRADLE_CADDY_IMAGE "$GLIMMER_CRADLE_CADDY_IMAGE"
fi

CANDIDATE_IMAGE="${GLIMMER_CRADLE_CANDIDATE_IMAGE:-$(grep '^GLIMMER_CRADLE_IMAGE=' "${RELEASE_ROOT}/.env.example" | cut -d= -f2-)}"
[[ -n "$CANDIDATE_IMAGE" ]] || {
  echo "发布包未声明候选 OCI 镜像。" >&2
  exit 1
}

export GLIMMER_CRADLE_DEPLOYMENT_ENV_FILE="$DEPLOYMENT_ENV_FILE"
export GLIMMER_CRADLE_ENV_TEMPLATE_FILE="${RELEASE_ROOT}/.env.example"
export GLIMMER_CRADLE_STATE_ROOT="$STATE_ROOT"
export GLIMMER_CRADLE_CANDIDATE_IMAGE="$CANDIDATE_IMAGE"

if ! docker info >/dev/null 2>&1 \
  || ! docker compose version >/dev/null 2>&1 \
  || ! docker buildx version >/dev/null 2>&1; then
  "${RELEASE_ROOT}/bootstrap-host.sh" </dev/null
fi

if [[ "$CANDIDATE_IMAGE" == ghcr.io/* && -n "$GHCR_TOKEN" ]]; then
  export DOCKER_CONFIG="${TEMP_ROOT}/docker-config"
  install -d -m 0700 "$DOCKER_CONFIG"
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io \
    --username "$GHCR_USERNAME" --password-stdin >/dev/null
fi

DEPLOY_COMMAND=install
if (( EXISTING_DEPLOYMENT )) && [[ "$CURRENT_IMAGE" != "$CANDIDATE_IMAGE" ]]; then
  DEPLOY_COMMAND=update
fi

if "${RELEASE_ROOT}/deploy.sh" "$DEPLOY_COMMAND" </dev/null; then
  if [[ "$PREVIOUS_RELEASE" != "$RELEASE_ROOT" ]]; then
    NEXT_LINK="${INSTALL_ROOT}/.current.$$.next"
    ln -s "$RELEASE_ROOT" "$NEXT_LINK"
    mv -Tf -- "$NEXT_LINK" "${INSTALL_ROOT}/current"
  fi
  true
else
  if (( EXISTING_DEPLOYMENT )); then
    cp "$DEPLOYMENT_ENV_BACKUP" "$DEPLOYMENT_ENV_FILE"
    chmod 600 "$DEPLOYMENT_ENV_FILE"
  else
    rm -f -- "$DEPLOYMENT_ENV_FILE"
  fi
  exit 1
fi

install -d -m 0755 "$(dirname -- "$CLI_PATH")"
cat > "$CLI_PATH" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
export GLIMMER_CRADLE_DEPLOYMENT_ENV_FILE="${DEPLOYMENT_ENV_FILE}"
export GLIMMER_CRADLE_STATE_ROOT="${STATE_ROOT}"
if (( \$# == 0 )); then
  set -- status
fi
exec "${INSTALL_ROOT}/current/deploy.sh" "\$@"
EOF
chmod 0755 "$CLI_PATH"

echo "安装完成。后续可使用 sudo glimmer-cradle status|logs|restart|stop。"
echo "再次运行同一条远程安装命令即可获取并事务化更新最新版本。"

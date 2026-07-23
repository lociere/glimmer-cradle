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
PACKAGE_VARIANT="${GLIMMER_CRADLE_PACKAGE_VARIANT:-light}"
RELEASE_SOURCE="${GLIMMER_CRADLE_RELEASE_SOURCE:-}"
DOWNLOAD_TOKEN="${GLIMMER_CRADLE_GITHUB_TOKEN:-${GH_TOKEN:-}}"
GHCR_TOKEN="${GLIMMER_CRADLE_GHCR_TOKEN:-$DOWNLOAD_TOKEN}"
GHCR_USERNAME="${GLIMMER_CRADLE_GITHUB_USER:-lociere}"
DOCKER_BIN="${GLIMMER_CRADLE_DOCKER_BIN:-docker}"
RELEASE_ROOT=""
STAGED_RELEASE=""
RELEASE_CREATED=0
DEPLOYMENT_ENV_TOUCHED=0
INSTALL_COMMITTED=0
EXISTING_DEPLOYMENT=0
DEPLOYMENT_ENV_BACKUP=""
CURRENT_LINK_SWITCHED=0
CLI_TOUCHED=0
CLI_EXISTED=0
CLI_BACKUP=""
PREVIOUS_RELEASE=""
DEPLOY_RESULT_FILE=""

case "$PACKAGE_VARIANT" in
  light|full) ;;
  *) echo "GLIMMER_CRADLE_PACKAGE_VARIANT 只允许 light 或 full。" >&2; exit 1 ;;
esac

if [[ -n "$RELEASE_SOURCE" ]]; then
  DOWNLOAD_BASE="${RELEASE_SOURCE%/}"
elif [[ "$VERSION" == "latest" ]]; then
  DOWNLOAD_BASE="https://github.com/lociere/glimmer-cradle/releases/latest/download"
else
  DOWNLOAD_BASE="https://github.com/lociere/glimmer-cradle/releases/download/v${VERSION#v}"
fi

for command in tar sha256sum install; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "基础系统缺少 ${command}；请使用受支持的 Ubuntu 24.04 LTS 最小镜像。" >&2
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
DEPLOY_RESULT_FILE="${TEMP_ROOT}/deploy.committed"
cleanup() {
  local exit_code=$?
  local cleanup_failed=0
  set +e
  if [[ -n "$DEPLOY_RESULT_FILE" && -f "$DEPLOY_RESULT_FILE" ]] \
    && grep -qx committed "$DEPLOY_RESULT_FILE"; then
    INSTALL_COMMITTED=1
  fi
  if (( ! INSTALL_COMMITTED )); then
    if (( DEPLOYMENT_ENV_TOUCHED )); then
      if (( EXISTING_DEPLOYMENT )) && [[ -f "$DEPLOYMENT_ENV_BACKUP" ]]; then
        cp "$DEPLOYMENT_ENV_BACKUP" "$DEPLOYMENT_ENV_FILE"
        if (( $? == 0 )); then
          chmod 600 "$DEPLOYMENT_ENV_FILE" || cleanup_failed=1
        else
          cleanup_failed=1
        fi
      else
        rm -f -- "$DEPLOYMENT_ENV_FILE" || cleanup_failed=1
      fi
    fi
    if (( CURRENT_LINK_SWITCHED )); then
      if [[ -n "$PREVIOUS_RELEASE" ]]; then
        local rollback_link="${INSTALL_ROOT}/.current.$$.rollback"
        ln -s "$PREVIOUS_RELEASE" "$rollback_link" \
          && mv -Tf -- "$rollback_link" "${INSTALL_ROOT}/current" \
          || cleanup_failed=1
        rm -f -- "$rollback_link"
      else
        rm -f -- "${INSTALL_ROOT}/current" || cleanup_failed=1
      fi
    fi
    if (( CLI_TOUCHED )); then
      if (( CLI_EXISTED )); then
        cp "$CLI_BACKUP" "$CLI_PATH" && chmod 0755 "$CLI_PATH" || cleanup_failed=1
      else
        rm -f -- "$CLI_PATH" || cleanup_failed=1
      fi
    fi
    if (( RELEASE_CREATED )) \
      && [[ -n "$RELEASE_ROOT" && "$RELEASE_ROOT" == "${INSTALL_ROOT}/releases/"* ]]; then
      rm -rf -- "$RELEASE_ROOT" || cleanup_failed=1
    fi
    if [[ -n "$STAGED_RELEASE" && "$STAGED_RELEASE" == "${INSTALL_ROOT}/releases/."* ]]; then
      rm -rf -- "$STAGED_RELEASE" || cleanup_failed=1
    fi
  fi
  rm -rf -- "$TEMP_ROOT" || cleanup_failed=1
  if (( cleanup_failed )); then
    echo "安装器退出清理未能完整完成，请检查 ${INSTALL_ROOT} 与 ${CONFIG_ROOT}。" >&2
    if (( exit_code == 0 )); then
      exit_code=1
    fi
  fi
  return "$exit_code"
}

handle_signal() {
  local signal_name="$1"
  local exit_code="$2"
  trap - INT TERM
  echo "安装过程收到 ${signal_name}，正在回滚未提交状态。" >&2
  exit "$exit_code"
}

install_signal_handlers() {
  trap 'handle_signal INT 130' INT
  trap 'handle_signal TERM 143' TERM
}

trap cleanup EXIT
install_signal_handlers

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

echo "正在下载 Glimmer Cradle Personal Server 发布包。"
acquire "$CHECKSUMS_NAME" "${TEMP_ROOT}/${CHECKSUMS_NAME}"
mapfile -t PACKAGE_ASSETS < <(
  if [[ "$PACKAGE_VARIANT" == full ]]; then
    awk '$2 ~ /^glimmer-cradle-personal-server-v[0-9A-Za-z][0-9A-Za-z._+-]*-linux-amd64-full\.tar\.gz$/ { print $2 }' "${TEMP_ROOT}/${CHECKSUMS_NAME}"
  else
    awk '$2 ~ /^glimmer-cradle-personal-server-v[0-9A-Za-z][0-9A-Za-z._+-]*-linux-amd64\.tar\.gz$/ { print $2 }' "${TEMP_ROOT}/${CHECKSUMS_NAME}"
  fi
)
if (( ${#PACKAGE_ASSETS[@]} != 1 )); then
  echo "发布清单必须且只能声明一个 ${RELEASE_TARGET} Personal Server 部署包。" >&2
  exit 1
fi
ASSET_NAME="${PACKAGE_ASSETS[0]}"
acquire "$ASSET_NAME" "${TEMP_ROOT}/${ASSET_NAME}"
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
if tar -tvzf "${TEMP_ROOT}/${ASSET_NAME}" | awk 'substr($1,1,1) ~ /[lh]/ { found=1 } END { exit !found }'; then
  echo "发布包不得包含符号链接或硬链接。" >&2
  exit 1
fi

tar -xzf "${TEMP_ROOT}/${ASSET_NAME}" -C "$TEMP_ROOT"
PAYLOAD_ROOT="${TEMP_ROOT}/glimmer-cradle-personal-server"
while read -r manifest_sha manifest_path; do
  [[ "$manifest_sha" =~ ^[0-9a-f]{64}$ ]] || {
    echo "部署内容清单包含无效摘要。" >&2
    exit 1
  }
  case "$manifest_path" in
    ./*) ;;
    *) echo "部署内容清单包含非法路径: ${manifest_path}" >&2; exit 1 ;;
  esac
  [[ "$manifest_path" != *'/../'* && "$manifest_path" != './..' && "$manifest_path" != ./images/* ]] || {
    echo "部署内容清单包含越界或镜像归档路径: ${manifest_path}" >&2
    exit 1
  }
done < "${PAYLOAD_ROOT}/RELEASE-MANIFEST.sha256"
(cd "$PAYLOAD_ROOT" && sha256sum --check RELEASE-MANIFEST.sha256)
RELEASE_CONTENT_SHA256="$(sha256sum "${PAYLOAD_ROOT}/RELEASE-MANIFEST.sha256" | cut -d' ' -f1)"
RELEASE_VERSION="$(<"${PAYLOAD_ROOT}/VERSION")"
[[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || {
  echo "发布版本标识无效: ${RELEASE_VERSION}" >&2
  exit 1
}
if [[ "$PACKAGE_VARIANT" == full ]]; then
  EXPECTED_ASSET_NAME="glimmer-cradle-personal-server-v${RELEASE_VERSION}-${RELEASE_TARGET}-full.tar.gz"
else
  EXPECTED_ASSET_NAME="glimmer-cradle-personal-server-v${RELEASE_VERSION}-${RELEASE_TARGET}.tar.gz"
fi
[[ "$ASSET_NAME" == "$EXPECTED_ASSET_NAME" ]] || {
  echo "发布包文件名与内部版本不一致: ${ASSET_NAME} != ${EXPECTED_ASSET_NAME}" >&2
  exit 1
}
if [[ "$VERSION" != "latest" && "$RELEASE_VERSION" != "${VERSION#v}" ]]; then
  echo "请求版本与发布包内部版本不一致: ${VERSION} != ${RELEASE_VERSION}" >&2
  exit 1
fi
RELEASE_ROOT="${INSTALL_ROOT}/releases/${RELEASE_VERSION}"
CURRENT_IMAGE=""
CURRENT_CADDY_IMAGE=""
DEPLOYMENT_ENV_BACKUP="${TEMP_ROOT}/deployment.env.previous"
if [[ -L "${INSTALL_ROOT}/current" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "${INSTALL_ROOT}/current")"
fi
if [[ -f "$DEPLOYMENT_ENV_FILE" ]]; then
  EXISTING_DEPLOYMENT=1
  cp "$DEPLOYMENT_ENV_FILE" "$DEPLOYMENT_ENV_BACKUP"
  CURRENT_IMAGE="$(grep '^GLIMMER_CRADLE_IMAGE=' "$DEPLOYMENT_ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  CURRENT_CADDY_IMAGE="$(grep '^GLIMMER_CRADLE_CADDY_IMAGE=' "$DEPLOYMENT_ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
fi

install -d -m 0755 "$INSTALL_ROOT" "${INSTALL_ROOT}/releases" "$CONFIG_ROOT"
if [[ -d "$RELEASE_ROOT" ]]; then
  EXISTING_RELEASE_SHA=""
  if [[ -f "${RELEASE_ROOT}/.release-sha256" ]]; then
    EXISTING_RELEASE_SHA="$(<"${RELEASE_ROOT}/.release-sha256")"
  fi
  [[ "$EXISTING_RELEASE_SHA" == "$RELEASE_CONTENT_SHA256" ]] || {
    echo "版本 ${RELEASE_VERSION} 已存在但部署内容摘要不同；拒绝覆盖不可变版本目录。" >&2
    exit 1
  }
else
  STAGED_RELEASE="${INSTALL_ROOT}/releases/.${RELEASE_VERSION}.$$.new"
  rm -rf -- "$STAGED_RELEASE"
  install -d -m 0755 "$STAGED_RELEASE"
  cp -a "${PAYLOAD_ROOT}/." "$STAGED_RELEASE/"
  rm -rf -- "${STAGED_RELEASE}/images"
  printf '%s\n' "$RELEASE_CONTENT_SHA256" > "${STAGED_RELEASE}/.release-sha256"
  chmod 0644 "${STAGED_RELEASE}/.release-sha256"
  mv -- "$STAGED_RELEASE" "$RELEASE_ROOT"
  RELEASE_CREATED=1
fi

if [[ ! -f "$DEPLOYMENT_ENV_FILE" ]]; then
  cp "${RELEASE_ROOT}/.env.example" "$DEPLOYMENT_ENV_FILE"
  DEPLOYMENT_ENV_TOUCHED=1
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
DEPLOYMENT_ENV_TOUCHED=1
set_env_value GLIMMER_CRADLE_STATE_ROOT "$STATE_ROOT"
set_env_value GLIMMER_CRADLE_CADDYFILE "${RELEASE_ROOT}/Caddyfile"
if [[ -n "${GLIMMER_CRADLE_CADDY_IMAGE:-}" ]]; then
  set_env_value GLIMMER_CRADLE_CADDY_IMAGE "$GLIMMER_CRADLE_CADDY_IMAGE"
else
  RELEASE_CADDY_IMAGE="$(grep '^GLIMMER_CRADLE_CADDY_IMAGE=' "${RELEASE_ROOT}/.env.example" | tail -n 1 | cut -d= -f2- || true)"
  [[ "$RELEASE_CADDY_IMAGE" =~ ^[^[:space:]]+@sha256:[0-9a-f]{64}$ ]] || {
    echo "发布包未声明 digest 固定的 Caddy 入口镜像。" >&2
    exit 1
  }
  PREVIOUS_RELEASE_CADDY_IMAGE=""
  if [[ -n "$PREVIOUS_RELEASE" && -f "${PREVIOUS_RELEASE}/.env.example" ]]; then
    PREVIOUS_RELEASE_CADDY_IMAGE="$(grep '^GLIMMER_CRADLE_CADDY_IMAGE=' "${PREVIOUS_RELEASE}/.env.example" | tail -n 1 | cut -d= -f2- || true)"
  fi
  if (( ! EXISTING_DEPLOYMENT )) \
    || [[ -z "$PREVIOUS_RELEASE" ]] \
    || [[ "$CURRENT_CADDY_IMAGE" == "$PREVIOUS_RELEASE_CADDY_IMAGE" ]]; then
    set_env_value GLIMMER_CRADLE_CADDY_IMAGE "$RELEASE_CADDY_IMAGE"
  fi
fi

DECLARED_IMAGE="$(grep '^GLIMMER_CRADLE_IMAGE=' "${RELEASE_ROOT}/.env.example" | cut -d= -f2-)"
CANDIDATE_IMAGE="${GLIMMER_CRADLE_CANDIDATE_IMAGE:-$DECLARED_IMAGE}"
[[ "$CANDIDATE_IMAGE" =~ ^[^[:space:]]+@sha256:[0-9a-f]{64}$ ]] || {
  echo "发布包未声明候选 OCI 镜像。" >&2
  exit 1
}

if [[ "$PACKAGE_VARIANT" == full ]]; then
  ARCHIVE_DECLARED_IMAGE="$(<"${PAYLOAD_ROOT}/images/IMAGE")"
  LOCAL_ARCHIVE_IMAGE="$(<"${PAYLOAD_ROOT}/images/ARCHIVE_IMAGE")"
  ARCHIVE_IMAGE_ID="$(<"${PAYLOAD_ROOT}/images/IMAGE_ID")"
  DIGEST_HEX="${DECLARED_IMAGE##*@sha256:}"
  EXPECTED_LOCAL_IMAGE="glimmer-cradle/personal-server:release-v${RELEASE_VERSION}-${DIGEST_HEX:0:12}"
  [[ "$ARCHIVE_DECLARED_IMAGE" == "$DECLARED_IMAGE" && "$CANDIDATE_IMAGE" == "$DECLARED_IMAGE" ]] || {
    echo "完整包镜像身份与候选镜像不一致。" >&2
    exit 1
  }
  [[ "$LOCAL_ARCHIVE_IMAGE" == "$EXPECTED_LOCAL_IMAGE" ]] || {
    echo "完整包本地镜像引用与版本或 OCI digest 不一致。" >&2
    exit 1
  }
  [[ "$ARCHIVE_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo "完整包 image ID 格式无效。" >&2
    exit 1
  }
  [[ -s "${PAYLOAD_ROOT}/images/personal-server-linux-amd64.tar" ]] || {
    echo "完整包缺少容器镜像归档。" >&2
    exit 1
  }
  CANDIDATE_IMAGE_ARCHIVE="${PAYLOAD_ROOT}/images/personal-server-linux-amd64.tar"
fi

export GLIMMER_CRADLE_DEPLOYMENT_ENV_FILE="$DEPLOYMENT_ENV_FILE"
export GLIMMER_CRADLE_ENV_TEMPLATE_FILE="${RELEASE_ROOT}/.env.example"
export GLIMMER_CRADLE_STATE_ROOT="$STATE_ROOT"
if ! "$DOCKER_BIN" info >/dev/null 2>&1 \
  || ! "$DOCKER_BIN" compose version >/dev/null 2>&1 \
  || ! "$DOCKER_BIN" buildx version >/dev/null 2>&1; then
  "${RELEASE_ROOT}/bootstrap-host.sh" </dev/null
fi

if [[ "$PACKAGE_VARIANT" == full ]]; then
  "$DOCKER_BIN" load --input "$CANDIDATE_IMAGE_ARCHIVE" >/dev/null
  LOADED_IMAGE_ID="$("$DOCKER_BIN" image inspect --format '{{.Id}}' "$LOCAL_ARCHIVE_IMAGE" 2>/dev/null || true)"
  [[ "$LOADED_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo "完整包镜像归档加载后无法解析本地镜像身份。" >&2
    exit 1
  }
  CANDIDATE_IMAGE="$LOCAL_ARCHIVE_IMAGE"
  export GLIMMER_CRADLE_CANDIDATE_PRELOADED=1
fi

export GLIMMER_CRADLE_CANDIDATE_IMAGE="$CANDIDATE_IMAGE"

if [[ "$CANDIDATE_IMAGE" == ghcr.io/* && -n "$GHCR_TOKEN" ]]; then
  export DOCKER_CONFIG="${TEMP_ROOT}/docker-config"
  install -d -m 0700 "$DOCKER_CONFIG"
  printf '%s' "$GHCR_TOKEN" | "$DOCKER_BIN" login ghcr.io \
    --username "$GHCR_USERNAME" --password-stdin >/dev/null
fi

DEPLOY_COMMAND=install
if (( EXISTING_DEPLOYMENT )) && [[ "$CURRENT_IMAGE" != "$CANDIDATE_IMAGE" ]]; then
  DEPLOY_COMMAND=update
fi

if [[ "$PREVIOUS_RELEASE" != "$RELEASE_ROOT" ]]; then
  NEXT_LINK="${INSTALL_ROOT}/.current.$$.next"
  ln -s "$RELEASE_ROOT" "$NEXT_LINK"
  mv -Tf -- "$NEXT_LINK" "${INSTALL_ROOT}/current"
  CURRENT_LINK_SWITCHED=1
fi
install -d -m 0755 "$(dirname -- "$CLI_PATH")"
CLI_BACKUP="${TEMP_ROOT}/cli.previous"
if [[ -f "$CLI_PATH" ]]; then
  CLI_EXISTED=1
  cp "$CLI_PATH" "$CLI_BACKUP"
fi
CLI_TEMP="${TEMP_ROOT}/glimmer-cradle-cli"
cat > "$CLI_TEMP" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
export GLIMMER_CRADLE_DEPLOYMENT_ENV_FILE="${DEPLOYMENT_ENV_FILE}"
export GLIMMER_CRADLE_STATE_ROOT="${STATE_ROOT}"
if (( \$# == 0 )); then
  set -- status
fi
exec "${INSTALL_ROOT}/current/deploy.sh" "\$@"
EOF
chmod 0755 "$CLI_TEMP"
CLI_TOUCHED=1
install -m 0755 "$CLI_TEMP" "$CLI_PATH"

export GLIMMER_CRADLE_DEPLOY_RESULT_FILE="$DEPLOY_RESULT_FILE"
if "${RELEASE_ROOT}/deploy.sh" "$DEPLOY_COMMAND" </dev/null; then
  [[ -f "$DEPLOY_RESULT_FILE" ]] && grep -qx committed "$DEPLOY_RESULT_FILE" || {
    echo "部署脚本成功返回但未提交事务结果。" >&2
    exit 1
  }
  INSTALL_COMMITTED=1
else
  if (( EXISTING_DEPLOYMENT )); then
    cp "$DEPLOYMENT_ENV_BACKUP" "$DEPLOYMENT_ENV_FILE"
    chmod 600 "$DEPLOYMENT_ENV_FILE"
  else
    rm -f -- "$DEPLOYMENT_ENV_FILE"
  fi
  exit 1
fi

echo "安装完成。后续可使用 sudo glimmer-cradle status|logs|restart|stop。"
echo "再次运行同一条远程安装命令即可获取并事务化更新最新版本。"

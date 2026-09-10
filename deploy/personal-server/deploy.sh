#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/lib/host-transaction.sh"
ENV_TEMPLATE_FILE="${GLIMMER_CRADLE_ENV_TEMPLATE_FILE:-${SCRIPT_DIR}/.env.example}"
DEPLOYMENT_ENV_FILE="${GLIMMER_CRADLE_DEPLOYMENT_ENV_FILE:-${SCRIPT_DIR}/.env}"
STATE_ROOT="${GLIMMER_CRADLE_STATE_ROOT:-${SCRIPT_DIR}/state}"
RUN_ROOT="${GLIMMER_CRADLE_RUN_ROOT:-/run/glimmer-cradle}"
HOST_RUN_ROOT="${GLIMMER_CRADLE_HOST_RUN_ROOT:-${RUN_ROOT}/host-owner}"
SERVICE_RUN_ROOT="${GLIMMER_CRADLE_SERVICE_RUN_ROOT:-${RUN_ROOT}/service}"
CONTAINER_RUN_ROOT="/run/glimmer-cradle"
CONTAINER_OPS_BRIDGE_SOCKET="${CONTAINER_RUN_ROOT}/ops-bridge.sock"
INSTALL_ROOT="${GLIMMER_CRADLE_INSTALL_ROOT:-${SCRIPT_DIR}}"
CONFIG_ROOT="${GLIMMER_CRADLE_DEPLOYMENT_CONFIG_ROOT:-$(dirname -- "$DEPLOYMENT_ENV_FILE")}"
BACKUP_ROOT="${STATE_ROOT}/data/backups"
MANUAL_BACKUP_ROOT="${BACKUP_ROOT}/manual"
TRANSACTION_BACKUP_ROOT="${BACKUP_ROOT}/transaction"
RESTORE_SAFETY_BACKUP_ROOT="${BACKUP_ROOT}/restore-safety"
DEPLOY_DIAGNOSTICS_ROOT="${STATE_ROOT}/data/diagnostics/deploy"
IMAGE_REPOSITORY="glimmer-cradle/personal-server"
OPS_BRIDGE_CONTAINER="glimmer-cradle-ops-bridge"
DOCKER_SOCKET_PATH="${GLIMMER_CRADLE_DOCKER_SOCKET_PATH:-/var/run/docker.sock}"
BACKUP_RETENTION=5
IMAGE_RETENTION=3
READY_TIMEOUT_SECONDS="${GLIMMER_CRADLE_READY_TIMEOUT_SECONDS:-240}"
DEPLOY_RESULT_FILE="${GLIMMER_CRADLE_DEPLOY_RESULT_FILE:-}"
COMMAND="${1:-install}"
COMMAND_ARGUMENT="${2:-}"
DOCKER=(docker)
PRIVILEGED=()
TEMP_ENV_FILES=()
TRANSACTION_ACTIVE=0
TRANSACTION_MODE=""
TRANSACTION_BACKUP=""
TRANSACTION_CANDIDATE_ENV=""
TRANSACTION_PREVIOUS_ENV=""
TRANSACTION_PREVIOUS_IMAGE=""
TRANSACTION_CANDIDATE_IMAGE=""
TRANSACTION_REPLACING_IMAGE=""
TRANSACTION_IMAGE_PERSISTED=0
RELEASE_VERSION=""

resolve_release_version() {
  local packaged_version_file="${SCRIPT_DIR}/VERSION"
  local source_package_file="${REPO_ROOT}/package.json"
  local version version_source
  if [[ -f "$packaged_version_file" ]]; then
    version="$(<"$packaged_version_file")"
    version_source="$packaged_version_file"
  elif [[ -f "$source_package_file" ]]; then
    version="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$source_package_file" | head -n 1)"
    version_source="$source_package_file"
  else
    echo "无法解析部署版本：缺少 ${packaged_version_file} 和 ${source_package_file}。" >&2
    return 1
  fi
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || {
    echo "部署版本标识无效（${version_source}）: ${version:-<empty>}" >&2
    return 1
  }
  printf '%s' "$version"
}

cleanup() {
  local env_file
  for env_file in "${TEMP_ENV_FILES[@]}"; do
    if [[ -n "$env_file" ]]; then
      rm -f -- "$env_file"
    fi
  done
  return 0
}

on_exit() {
  local exit_code=$?
  local finish_code=0
  trap - EXIT INT TERM
  if (( TRANSACTION_ACTIVE )); then
    if [[ -n "$DEPLOY_RESULT_FILE" ]]; then
      rm -f -- "$DEPLOY_RESULT_FILE"
    fi
    if ! rollback_transaction; then
      host_transaction_mark_recovery_required \
        "restore the last verified transaction backup and restart the previous image"
      exit_code="$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
    fi
  fi
  cleanup
  exit_code="$(host_transaction_normalize_exit "$exit_code")"
  host_transaction_finish "$exit_code" || finish_code=$?
  (( finish_code == 0 )) || exit_code="$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
  exit "$exit_code"
}

prepare_environment() {
  mkdir -p "$(dirname -- "$DEPLOYMENT_ENV_FILE")"
  if [[ ! -f "$DEPLOYMENT_ENV_FILE" ]]; then
    cp "$ENV_TEMPLATE_FILE" "$DEPLOYMENT_ENV_FILE"
  fi
  if grep -q '^GLIMMER_CRADLE_SERVER_TOKEN=GENERATE_ON_INSTALL$' "$DEPLOYMENT_ENV_FILE"; then
    local token
    token="$(openssl rand -hex 32)"
    set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_SERVER_TOKEN "$token"
  fi
  if ! grep -q '^GLIMMER_CRADLE_OPERATIONS_BRIDGE_TOKEN=' "$DEPLOYMENT_ENV_FILE" \
    || grep -q '^GLIMMER_CRADLE_OPERATIONS_BRIDGE_TOKEN=GENERATE_ON_INSTALL$' "$DEPLOYMENT_ENV_FILE"; then
    local bridge_token
    bridge_token="$(openssl rand -hex 32)"
    set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_OPERATIONS_BRIDGE_TOKEN "$bridge_token"
  fi
  # deployment.env 始终保存容器视角的稳定 IPC 路径；宿主路径只用于 Compose bind source。
  set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_OPERATIONS_BRIDGE_SOCKET "$CONTAINER_OPS_BRIDGE_SOCKET"
  if ! grep -q '^GLIMMER_CRADLE_IMAGE=' "$DEPLOYMENT_ENV_FILE"; then
    set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_IMAGE "${IMAGE_REPOSITORY}:${RELEASE_VERSION}"
  fi
  if ! grep -q '^GLIMMER_CRADLE_DEPLOYMENT_MODE=' "$DEPLOYMENT_ENV_FILE"; then
    set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_DEPLOYMENT_MODE source
  fi
  set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_STATE_ROOT "$STATE_ROOT"
  set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_RUN_ROOT "$RUN_ROOT"
  set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_HOST_RUN_ROOT "$HOST_RUN_ROOT"
  set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_SERVICE_RUN_ROOT "$SERVICE_RUN_ROOT"
  set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_INSTALL_ROOT "$INSTALL_ROOT"
  set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_DEPLOYMENT_CONFIG_ROOT "$CONFIG_ROOT"
  chmod 600 "$DEPLOYMENT_ENV_FILE"
}

prepare_state() {
  mkdir -p "$STATE_ROOT/config" "$STATE_ROOT/data/state" "$STATE_ROOT/data/models" \
    "$STATE_ROOT/data/packages" "$MANUAL_BACKUP_ROOT" "$TRANSACTION_BACKUP_ROOT" \
    "$RESTORE_SAFETY_BACKUP_ROOT"
  "${PRIVILEGED[@]}" install -d -o 0 -g 0 -m 0700 "$HOST_RUN_ROOT"
  "${PRIVILEGED[@]}" install -d -o 10001 -g 10001 -m 0700 "$SERVICE_RUN_ROOT"
  "${PRIVILEGED[@]}" chown 10001:10001 "$STATE_ROOT/data"
  "${PRIVILEGED[@]}" chown -R 10001:10001 "$STATE_ROOT/config" "$STATE_ROOT/data/state" \
    "$STATE_ROOT/data/models" "$STATE_ROOT/data/packages"
  "${PRIVILEGED[@]}" chmod 700 "$STATE_ROOT" "$STATE_ROOT/config" "$STATE_ROOT/data" \
    "$STATE_ROOT/data/state" "$STATE_ROOT/data/models" "$STATE_ROOT/data/packages" \
    "$BACKUP_ROOT" "$MANUAL_BACKUP_ROOT" "$TRANSACTION_BACKUP_ROOT" "$RESTORE_SAFETY_BACKUP_ROOT"
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local temporary
  temporary="$(mktemp "${file}.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$file" > "$temporary"
  chmod 600 "$temporary"
  mv -f -- "$temporary" "$file"
}

read_env() {
  local key="$1"
  local fallback="$2"
  local value
  value="$(grep -E "^${key}=" "$DEPLOYMENT_ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  printf '%s' "${value:-$fallback}"
}

read_env_file() {
  local file="$1"
  local key="$2"
  local fallback="$3"
  local value
  value="$(grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true)"
  printf '%s' "${value:-$fallback}"
}

create_previous_compose_env() {
  local env_file
  env_file="$(mktemp "${STATE_ROOT}/.compose-env.XXXXXX")"
  cp "$DEPLOYMENT_ENV_FILE" "$env_file"
  TEMP_ENV_FILES+=("$env_file")
  COMPOSE_ENV_RESULT="$env_file"
}

create_candidate_compose_env() {
  local image="$1"
  local env_file current_image current_caddy_image deployment_mode candidate_caddy_image candidate_caddyfile
  create_previous_compose_env
  env_file="$COMPOSE_ENV_RESULT"
  current_image="$(read_env_file "$env_file" GLIMMER_CRADLE_IMAGE '')"
  current_caddy_image="$(read_env_file "$env_file" GLIMMER_CRADLE_CADDY_IMAGE '')"
  deployment_mode="$(read_env_file "$env_file" GLIMMER_CRADLE_DEPLOYMENT_MODE source)"
  candidate_caddy_image="${GLIMMER_CRADLE_CANDIDATE_CADDY_IMAGE:-$image}"
  candidate_caddyfile="${GLIMMER_CRADLE_CANDIDATE_CADDYFILE:-${SCRIPT_DIR}/Caddyfile}"
  set_env_value "$env_file" GLIMMER_CRADLE_DEPLOYMENT_MODE "${GLIMMER_CRADLE_CANDIDATE_DEPLOYMENT_MODE:-$deployment_mode}"
  set_env_value "$env_file" GLIMMER_CRADLE_IMAGE "$image"
  set_env_value "$env_file" GLIMMER_CRADLE_CADDYFILE "$candidate_caddyfile"
  if [[ "$deployment_mode" == "source" || -z "$current_caddy_image" || "$current_caddy_image" == "$current_image" ]]; then
    set_env_value "$env_file" GLIMMER_CRADLE_CADDY_IMAGE "$candidate_caddy_image"
  fi
  COMPOSE_ENV_RESULT="$env_file"
}

persist_deployment_projection() {
  local source_env="$1" temporary
  temporary="$(mktemp "${DEPLOYMENT_ENV_FILE}.XXXXXX")"
  cp "$source_env" "$temporary"
  chmod 0600 "$temporary"
  mv -f -- "$temporary" "$DEPLOYMENT_ENV_FILE"
}

write_deploy_result() {
  [[ -n "$DEPLOY_RESULT_FILE" ]] || return 0
  local result_parent result_temp
  result_parent="$(dirname -- "$DEPLOY_RESULT_FILE")"
  [[ -d "$result_parent" ]] || {
    echo "部署结果目录不存在: ${result_parent}" >&2
    return 1
  }
  result_temp="${DEPLOY_RESULT_FILE}.$$.new"
  printf 'committed\n' > "$result_temp"
  chmod 0600 "$result_temp"
  mv -f -- "$result_temp" "$DEPLOY_RESULT_FILE"
}

compose_with_env() {
  local env_file="$1"
  shift
  local -a compose_args=(
    compose
    --project-directory "$SCRIPT_DIR"
    --env-file "$env_file"
    --file "$SCRIPT_DIR/compose.yaml"
  )
  if [[ "$(read_env_file "$env_file" GLIMMER_CRADLE_DEPLOYMENT_MODE source)" == "source" ]]; then
    compose_args+=(--file "$SCRIPT_DIR/compose.source.yaml")
  fi
  "${DOCKER[@]}" "${compose_args[@]}" "$@"
}

prepare_candidate() {
  local env_file="$1"
  if [[ "$(read_env_file "$env_file" GLIMMER_CRADLE_DEPLOYMENT_MODE source)" == "source" ]]; then
    compose_with_env "$env_file" build --pull
  else
    local image
    image="$(read_env_file "$env_file" GLIMMER_CRADLE_IMAGE '')"
    if [[ "${GLIMMER_CRADLE_CANDIDATE_PRELOADED:-0}" == 1 ]] \
      || "${DOCKER[@]}" image inspect "$image" >/dev/null 2>&1; then
      "${DOCKER[@]}" image inspect "$image" >/dev/null
    else
      compose_with_env "$env_file" pull
    fi
  fi
}

next_candidate_image() {
  if [[ -n "${GLIMMER_CRADLE_CANDIDATE_IMAGE:-}" ]]; then
    printf '%s' "$GLIMMER_CRADLE_CANDIDATE_IMAGE"
  elif [[ "$(read_env GLIMMER_CRADLE_DEPLOYMENT_MODE source)" == "source" ]]; then
    candidate_image
  else
    read_env GLIMMER_CRADLE_IMAGE "${IMAGE_REPOSITORY}:${RELEASE_VERSION}"
  fi
}

candidate_image() {
  local revision timestamp dirty
  revision="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD 2>/dev/null || printf 'source')"
  dirty=""
  if git -C "$REPO_ROOT" status --porcelain --untracked-files=no 2>/dev/null | grep -q .; then
    dirty="-dirty"
  fi
  timestamp="$(date -u +%Y%m%d%H%M%S)"
  printf '%s:%s-%s%s-%s' "$IMAGE_REPOSITORY" "$RELEASE_VERSION" "$revision" "$dirty" "$timestamp"
}

port_in_use() {
  local protocol="$1"
  local port="$2"
  if [[ "$protocol" == "tcp" ]]; then
    [[ -n "$(ss -H -ltn "sport = :${port}")" ]]
  else
    [[ -n "$(ss -H -lun "sport = :${port}")" ]]
  fi
}

preflight_ports() {
  if compose_with_env "$DEPLOYMENT_ENV_FILE" ps --status running --services 2>/dev/null | grep -qx 'caddy'; then
    return
  fi

  local site_address http_bind http_port https_bind https_port
  site_address="$(read_env GLIMMER_CRADLE_SITE_ADDRESS ':80')"
  http_bind="$(read_env GLIMMER_CRADLE_HTTP_BIND '127.0.0.1')"
  http_port="$(read_env GLIMMER_CRADLE_HTTP_PORT '8080')"
  https_bind="$(read_env GLIMMER_CRADLE_HTTPS_BIND '127.0.0.1')"
  https_port="$(read_env GLIMMER_CRADLE_HTTPS_PORT '8443')"

  if [[ "$site_address" == ':80' && "$http_bind" != '127.0.0.1' && "$http_bind" != '::1' ]]; then
    echo "拒绝将无 TLS 的控制面板绑定到公网地址 ${http_bind}。请使用默认 SSH 隧道，或配置域名与 HTTPS。" >&2
    exit 1
  fi
  if port_in_use tcp "$http_port"; then
    echo "宿主机 TCP 端口 ${http_port} 已被占用；请调整 GLIMMER_CRADLE_HTTP_PORT。" >&2
    exit 1
  fi
  if port_in_use tcp "$https_port" || port_in_use udp "$https_port"; then
    echo "宿主机 TCP/UDP 端口 ${https_port} 已被占用；请调整 GLIMMER_CRADLE_HTTPS_PORT。" >&2
    exit 1
  fi
}

wait_until_ready() {
  local env_file="$1"
  local deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    if compose_with_env "$env_file" exec -T personal-server node -e \
      "fetch('http://127.0.0.1:3210/readyz',{headers:{authorization:'Bearer '+process.env.GLIMMER_CRADLE_SERVER_TOKEN}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
      echo "Glimmer Cradle Personal Server 已就绪。"
      return 0
    fi
    sleep 3
  done
  compose_with_env "$env_file" ps || true
  compose_with_env "$env_file" logs --tail=120 personal-server || true
  echo "等待服务就绪超时。" >&2
  return 1
}

start_ops_bridge() {
  local image token docker_gid docker_bin compose_plugin deployment_mode release_root
  image="$(read_env GLIMMER_CRADLE_IMAGE '')"
  token="$(read_env GLIMMER_CRADLE_OPERATIONS_BRIDGE_TOKEN '')"
  deployment_mode="$(read_env GLIMMER_CRADLE_DEPLOYMENT_MODE source)"
  if [[ "$deployment_mode" != image ]]; then
    stop_ops_bridge
    printf '{"event":"ops_bridge_disabled","error_code":"source_mode_has_no_stable_host_owner","exit_code":66}\n' >&2
    return 0
  fi
  release_root="$SCRIPT_DIR"
  [[ -d "$release_root" && -f "$release_root/lib/host-transaction.sh" \
    && ! -L "$release_root/lib/host-transaction.sh" ]] || {
    printf '{"event":"ops_bridge_disabled","error_code":"installed_owner_missing","exit_code":66}\n' >&2
    return 0
  }
  [[ -n "$image" && -n "$token" && -S "$DOCKER_SOCKET_PATH" ]] || return 0
  docker_bin="$(command -v docker)"
  compose_plugin="${GLIMMER_CRADLE_DOCKER_COMPOSE_PLUGIN:-/usr/libexec/docker/cli-plugins/docker-compose}"
  [[ -x "$compose_plugin" ]] || compose_plugin="/usr/lib/docker/cli-plugins/docker-compose"
  [[ -x "$compose_plugin" ]] || {
    echo "未找到 Docker Compose CLI 插件，运维桥不启动。" >&2
    return 0
  }
  docker_gid="$(stat -c '%g' "$DOCKER_SOCKET_PATH" 2>/dev/null || printf '0')"
  "${DOCKER[@]}" rm -f "$OPS_BRIDGE_CONTAINER" >/dev/null 2>&1 || true
  "${DOCKER[@]}" run --detach \
    --name "$OPS_BRIDGE_CONTAINER" \
    --restart unless-stopped \
    --init \
    --user root \
    --read-only \
    --network none \
    --cap-drop ALL \
    --cap-add CHOWN \
    --cap-add DAC_OVERRIDE \
    --cap-add FOWNER \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --group-add "$docker_gid" \
    --entrypoint /usr/local/bin/node \
    --env GLIMMER_CRADLE_STATE_ROOT="$STATE_ROOT" \
    --env GLIMMER_CRADLE_RUN_ROOT="$CONTAINER_RUN_ROOT" \
    --env GLIMMER_CRADLE_HOST_RUN_ROOT="$HOST_RUN_ROOT" \
    --env GLIMMER_CRADLE_DEPLOYMENT_ENV_FILE="$DEPLOYMENT_ENV_FILE" \
    --env GLIMMER_CRADLE_HOST_RELEASE_ROOT="$release_root" \
    --env GLIMMER_CRADLE_HOST_INSTALL_ROOT="$INSTALL_ROOT" \
    --env GLIMMER_CRADLE_TRANSACTION_IMAGE="$image" \
    --env GLIMMER_CRADLE_HOST_DOCKER_BIN="$docker_bin" \
    --env GLIMMER_CRADLE_HOST_DOCKER_COMPOSE_PLUGIN="$compose_plugin" \
    --env GLIMMER_CRADLE_HOST_DOCKER_SOCKET="$DOCKER_SOCKET_PATH" \
    --env GLIMMER_CRADLE_OPERATIONS_BRIDGE_SOCKET="$CONTAINER_OPS_BRIDGE_SOCKET" \
    --env GLIMMER_CRADLE_OPERATIONS_BRIDGE_TOKEN="$token" \
    --env GLIMMER_CRADLE_RELEASE_SOURCE="$(read_env GLIMMER_CRADLE_RELEASE_SOURCE https://github.com/lociere/glimmer-cradle/releases/latest/download)" \
    --mount type=bind,src="$DOCKER_SOCKET_PATH",dst=/var/run/docker.sock,readonly \
    --mount type=bind,src="$docker_bin",dst=/usr/bin/docker,readonly \
    --mount type=bind,src="$compose_plugin",dst=/usr/libexec/docker/cli-plugins/docker-compose,readonly \
    --mount type=bind,src="$INSTALL_ROOT",dst="$INSTALL_ROOT" \
    --mount type=bind,src="$CONFIG_ROOT",dst="$CONFIG_ROOT" \
    --mount type=bind,src="$STATE_ROOT",dst="$STATE_ROOT" \
    --mount type=bind,src="$SERVICE_RUN_ROOT",dst="$CONTAINER_RUN_ROOT" \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    "$image" /opt/glimmer-cradle/container/ops-bridge.mjs >/dev/null
  wait_until_ops_bridge_ready
}

wait_until_ops_bridge_ready() {
  local deadline=$((SECONDS + 30))
  while (( SECONDS < deadline )); do
    if "${DOCKER[@]}" exec "$OPS_BRIDGE_CONTAINER" node -e \
      "const h=require('node:http');const r=h.request({socketPath:process.env.GLIMMER_CRADLE_OPERATIONS_BRIDGE_SOCKET,path:'/snapshot',headers:{authorization:'Bearer '+process.env.GLIMMER_CRADLE_OPERATIONS_BRIDGE_TOKEN}},x=>process.exit(x.statusCode===200?0:1));r.on('error',()=>process.exit(1));r.end()" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  host_transaction_event ops_bridge_readiness_failed ops_bridge_not_ready "$HOST_TRANSACTION_EXIT_FAILED"
  return "$HOST_TRANSACTION_EXIT_FAILED"
}

stop_ops_bridge() {
  "${DOCKER[@]}" rm -f "$OPS_BRIDGE_CONTAINER" >/dev/null 2>&1 || true
  "${PRIVILEGED[@]}" rm -f -- "${RUN_ROOT}/ops-bridge.sock"
}

create_backup() {
  local kind="${1:-transaction}" root timestamp backup_dir counter=0
  case "$kind" in
    manual) root="$MANUAL_BACKUP_ROOT" ;;
    transaction) root="$TRANSACTION_BACKUP_ROOT" ;;
    restore-safety) root="$RESTORE_SAFETY_BACKUP_ROOT" ;;
    *) return "$HOST_TRANSACTION_EXIT_USAGE" ;;
  esac
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_dir="${root}/${timestamp}"
  while [[ -e "$backup_dir" ]]; do
    ((counter += 1))
    backup_dir="${root}/${timestamp}-$(printf '%02d' "$counter")"
  done
  mkdir -p "$backup_dir"
  "${PRIVILEGED[@]}" tar -C "$STATE_ROOT" -czf "$backup_dir/config.tar.gz" config
  "${PRIVILEGED[@]}" tar -C "$STATE_ROOT" -czf "$backup_dir/data.tar.gz" \
    data/state data/models data/packages
  "${PRIVILEGED[@]}" chown -R "$(id -u):$(id -g)" "$backup_dir"
  (
    cd "$backup_dir"
    sha256sum config.tar.gz data.tar.gz > SHA256SUMS
  )
  cat > "$backup_dir/deployment.env" <<EOF
created_at=${timestamp}
kind=${kind}
previous_image=${TRANSACTION_PREVIOUS_IMAGE}
candidate_image=${TRANSACTION_CANDIDATE_IMAGE}
status=pending
EOF
  printf '%s' "$backup_dir"
}

mark_backup() {
  local backup_dir="$1"
  local status="$2"
  [[ -n "$backup_dir" && -f "$backup_dir/deployment.env" ]] || return 0
  set_env_value "$backup_dir/deployment.env" status "$status"
}

assert_archive_root() {
  local archive="$1"
  local expected_root="$2"
  local entry
  while IFS= read -r entry; do
    case "$entry" in
      "$expected_root"|"$expected_root"/*) ;;
      *) echo "备份包含越界路径: ${entry}" >&2; return 1 ;;
    esac
    [[ "$entry" != *'/../'* && "$entry" != '../'* ]] || return 1
  done < <(tar -tzf "$archive")
  if tar -tvzf "$archive" | awk 'substr($1,1,1) ~ /[lh]/ { found=1 } END { exit !found }'; then
    echo "备份归档不得包含符号链接或硬链接: ${archive}" >&2
    return 1
  fi
}

restore_backup() {
  local backup_dir="$1"
  (
    cd "$backup_dir"
    sha256sum -c SHA256SUMS
  )
  assert_archive_root "$backup_dir/config.tar.gz" config
  assert_archive_root "$backup_dir/data.tar.gz" data
  "${PRIVILEGED[@]}" rm -rf -- "$STATE_ROOT/config" "$STATE_ROOT/data/state" \
    "$STATE_ROOT/data/models" "$STATE_ROOT/data/packages"
  "${PRIVILEGED[@]}" tar -C "$STATE_ROOT" -xzf "$backup_dir/config.tar.gz"
  "${PRIVILEGED[@]}" tar -C "$STATE_ROOT" -xzf "$backup_dir/data.tar.gz"
  prepare_state
}

validate_backup() {
  local backup_dir="$1"
  [[ -d "$backup_dir" && ! -L "$backup_dir" \
    && -f "$backup_dir/config.tar.gz" && ! -L "$backup_dir/config.tar.gz" \
    && -f "$backup_dir/data.tar.gz" && ! -L "$backup_dir/data.tar.gz" \
    && -f "$backup_dir/SHA256SUMS" && ! -L "$backup_dir/SHA256SUMS" ]] || {
    echo "备份不完整: ${backup_dir}" >&2
    return 1
  }
  (
    cd "$backup_dir"
    sha256sum --check SHA256SUMS
  )
  assert_archive_root "$backup_dir/config.tar.gz" config
  assert_archive_root "$backup_dir/data.tar.gz" data
}

backup_release() {
  local was_running=0 current backup_dir
  if compose_with_env "$DEPLOYMENT_ENV_FILE" ps --status running --services 2>/dev/null | grep -qx personal-server; then
    was_running=1
  fi
  current="$(current_container_image)"
  TRANSACTION_PREVIOUS_IMAGE="$current"
  TRANSACTION_CANDIDATE_IMAGE="$current"
  if (( was_running )); then
    compose_with_env "$DEPLOYMENT_ENV_FILE" down --remove-orphans
  fi
  if ! backup_dir="$(create_backup manual)"; then
    if (( was_running )); then
      if ! compose_with_env "$DEPLOYMENT_ENV_FILE" up --detach --remove-orphans \
        || ! wait_until_ready "$DEPLOYMENT_ENV_FILE"; then
        host_transaction_mark_recovery_required \
          "backup failed and the pre-operation service could not be restored; restart the recorded image"
        return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
      fi
    fi
    echo "备份创建失败，服务已恢复到操作前状态。" >&2
    return 1
  fi
  mark_backup "$backup_dir" manual
  if (( was_running )); then
    if ! compose_with_env "$DEPLOYMENT_ENV_FILE" up --detach --remove-orphans \
      || ! wait_until_ready "$DEPLOYMENT_ENV_FILE"; then
      host_transaction_mark_recovery_required \
        "manual backup completed but the pre-operation service did not become ready"
      return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
    fi
  fi
  echo "备份已创建: ${backup_dir}"
}

restore_release() {
  local backup_name="$1"
  local backup_dir safety_backup was_running=0 current
  [[ "$backup_name" =~ ^[0-9]{8}T[0-9]{6}Z(-[0-9]{2})?$ ]] || {
    echo "restore 只接受 backups 下的 UTC 时间戳目录名。" >&2
    return 1
  }
  backup_dir="${MANUAL_BACKUP_ROOT}/${backup_name}"
  [[ -d "$backup_dir" ]] || backup_dir="${TRANSACTION_BACKUP_ROOT}/${backup_name}"
  validate_backup "$backup_dir"
  if compose_with_env "$DEPLOYMENT_ENV_FILE" ps --status running --services 2>/dev/null | grep -qx personal-server; then
    was_running=1
  fi
  current="$(current_container_image)"
  TRANSACTION_PREVIOUS_IMAGE="$current"
  TRANSACTION_CANDIDATE_IMAGE="$current"
  if (( was_running )); then
    compose_with_env "$DEPLOYMENT_ENV_FILE" down --remove-orphans
  fi
  if ! safety_backup="$(create_backup restore-safety)"; then
    if (( was_running )); then
      if ! compose_with_env "$DEPLOYMENT_ENV_FILE" up --detach --remove-orphans \
        || ! wait_until_ready "$DEPLOYMENT_ENV_FILE"; then
        host_transaction_mark_recovery_required \
          "restore safety snapshot failed and the pre-operation service could not be restarted"
        return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
      fi
    fi
    echo "无法创建恢复前安全快照，未修改当前数据。" >&2
    return 1
  fi
  if ! restore_backup "$backup_dir"; then
    local compensation_failed=0
    restore_backup "$safety_backup" || compensation_failed=1
    if (( was_running )); then
      compose_with_env "$DEPLOYMENT_ENV_FILE" up --detach --remove-orphans || compensation_failed=1
      wait_until_ready "$DEPLOYMENT_ENV_FILE" || compensation_failed=1
    fi
    mark_backup "$safety_backup" restore-rollback
    if (( compensation_failed )); then
      host_transaction_mark_recovery_required \
        "target restore and safety compensation failed; restore the recorded restore-safety snapshot manually"
      return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
    fi
    echo "恢复写入失败，已恢复操作前状态。" >&2
    return 1
  fi
  if (( was_running )); then
    compose_with_env "$DEPLOYMENT_ENV_FILE" up --detach --remove-orphans
    if ! wait_until_ready "$DEPLOYMENT_ENV_FILE"; then
      local readiness_compensation_failed=0
      compose_with_env "$DEPLOYMENT_ENV_FILE" down --remove-orphans || readiness_compensation_failed=1
      restore_backup "$safety_backup" || readiness_compensation_failed=1
      compose_with_env "$DEPLOYMENT_ENV_FILE" up --detach --remove-orphans || readiness_compensation_failed=1
      wait_until_ready "$DEPLOYMENT_ENV_FILE" || readiness_compensation_failed=1
      mark_backup "$safety_backup" restore-rollback
      if (( readiness_compensation_failed )); then
        host_transaction_mark_recovery_required \
          "restored data failed readiness and safety compensation did not recover the pre-operation service"
        return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
      fi
      echo "恢复后的服务未就绪，已恢复操作前状态。" >&2
      return 1
    fi
  fi
  mark_backup "$safety_backup" restore-safety
  echo "已从备份恢复: ${backup_dir}"
}

rollback_transaction() {
  local rollback_failed=0
  TRANSACTION_ACTIVE=0
  echo "候选版本未通过就绪门，正在回滚。" >&2
  if [[ -n "$TRANSACTION_CANDIDATE_ENV" ]]; then
    capture_candidate_diagnostics "$TRANSACTION_CANDIDATE_ENV" \
      || echo "候选诊断保存失败，继续执行回滚。" >&2
    compose_with_env "$TRANSACTION_CANDIDATE_ENV" down --remove-orphans || rollback_failed=1
  fi
  if [[ -n "$TRANSACTION_BACKUP" ]]; then
    if restore_backup "$TRANSACTION_BACKUP"; then
      mark_backup "$TRANSACTION_BACKUP" rollback-restored
    else
      rollback_failed=1
    fi
  fi
  if [[ -n "$TRANSACTION_PREVIOUS_IMAGE" && -n "$TRANSACTION_PREVIOUS_ENV" ]]; then
    if compose_with_env "$TRANSACTION_PREVIOUS_ENV" up --detach --remove-orphans \
      && wait_until_ready "$TRANSACTION_PREVIOUS_ENV"; then
      persist_deployment_projection "$TRANSACTION_PREVIOUS_ENV"
      echo "已恢复上一版本 ${TRANSACTION_PREVIOUS_IMAGE}。" >&2
    else
      echo "上一版本也未能恢复就绪，请保留 ${TRANSACTION_BACKUP} 并检查日志。" >&2
      rollback_failed=1
    fi
  elif (( TRANSACTION_IMAGE_PERSISTED )) && [[ -n "$TRANSACTION_REPLACING_IMAGE" ]]; then
    [[ -z "$TRANSACTION_PREVIOUS_ENV" ]] || persist_deployment_projection "$TRANSACTION_PREVIOUS_ENV" \
      || rollback_failed=1
  fi
  (( rollback_failed == 0 ))
}

capture_candidate_diagnostics() {
  local env_file="$1" diagnostic_dir transaction_id
  transaction_id="${GLIMMER_CRADLE_TRANSACTION_ID:-unknown}"
  diagnostic_dir="${DEPLOY_DIAGNOSTICS_ROOT}/${transaction_id}"
  mkdir -p "$diagnostic_dir"
  chmod 0700 "$DEPLOY_DIAGNOSTICS_ROOT" "$diagnostic_dir"
  compose_with_env "$env_file" ps --all > "${diagnostic_dir}/compose-ps.txt" 2>&1 || true
  compose_with_env "$env_file" logs --no-color > "${diagnostic_dir}/compose.log" 2>&1 || true
  chmod 0600 "${diagnostic_dir}/compose-ps.txt" "${diagnostic_dir}/compose.log"
  echo "候选诊断已保留: ${diagnostic_dir}" >&2
}

current_container_image() {
  local container_id
  container_id="$(compose_with_env "$DEPLOYMENT_ENV_FILE" ps --all -q personal-server 2>/dev/null | head -n 1)"
  if [[ -n "$container_id" ]]; then
    "${DOCKER[@]}" inspect --format '{{.Config.Image}}' "$container_id"
  fi
}

install_release() {
  local existing candidate replacing_image
  existing="$(current_container_image)"
  if [[ -n "$existing" ]]; then
    echo "检测到现有安装，转入统一事务更新以重新核对完整部署 projection。"
    update_release
    return
  fi
  replacing_image="$(read_env GLIMMER_CRADLE_IMAGE '')"
  TRANSACTION_REPLACING_IMAGE="$replacing_image"
  candidate="$(next_candidate_image)"
  create_previous_compose_env
  TRANSACTION_PREVIOUS_ENV="$COMPOSE_ENV_RESULT"
  create_candidate_compose_env "$candidate"
  TRANSACTION_CANDIDATE_ENV="$COMPOSE_ENV_RESULT"
  TRANSACTION_CANDIDATE_IMAGE="$candidate"
  host_transaction_phase prepare
  prepare_candidate "$TRANSACTION_CANDIDATE_ENV"
  TRANSACTION_MODE=install
  TRANSACTION_ACTIVE=1
  host_transaction_phase replace
  compose_with_env "$TRANSACTION_CANDIDATE_ENV" up --detach --remove-orphans
  host_transaction_phase readiness
  wait_until_ready "$TRANSACTION_CANDIDATE_ENV"
  persist_deployment_projection "$TRANSACTION_CANDIDATE_ENV"
  TRANSACTION_IMAGE_PERSISTED=1
  cleanup_history "$candidate" ""
  host_transaction_phase bridge_readiness
  start_ops_bridge
  host_transaction_phase commit
  print_access
  write_deploy_result
  TRANSACTION_ACTIVE=0
}

update_release() {
  local previous candidate
  previous="$(current_container_image)"
  if [[ -z "$previous" ]]; then
    echo "未检测到现有容器，将按首次安装处理。"
    install_release
    return
  fi
  candidate="$(next_candidate_image)"
  create_previous_compose_env
  TRANSACTION_PREVIOUS_ENV="$COMPOSE_ENV_RESULT"
  create_candidate_compose_env "$candidate"
  TRANSACTION_CANDIDATE_ENV="$COMPOSE_ENV_RESULT"
  TRANSACTION_PREVIOUS_IMAGE="$previous"
  TRANSACTION_CANDIDATE_IMAGE="$candidate"

  # Build while the current release is still serving traffic. State is untouched until this succeeds.
  host_transaction_phase prepare
  prepare_candidate "$TRANSACTION_CANDIDATE_ENV"
  TRANSACTION_MODE=update
  TRANSACTION_ACTIVE=1
  host_transaction_phase replace
  compose_with_env "$TRANSACTION_PREVIOUS_ENV" down --remove-orphans
  TRANSACTION_BACKUP="$(create_backup transaction)"
  host_transaction_phase restart
  compose_with_env "$TRANSACTION_CANDIDATE_ENV" up --detach --remove-orphans
  host_transaction_phase readiness
  wait_until_ready "$TRANSACTION_CANDIDATE_ENV"
  persist_deployment_projection "$TRANSACTION_CANDIDATE_ENV"
  TRANSACTION_IMAGE_PERSISTED=1
  mark_backup "$TRANSACTION_BACKUP" succeeded
  cleanup_history "$candidate" "$previous"
  host_transaction_phase bridge_readiness
  start_ops_bridge
  host_transaction_phase commit
  print_access
  write_deploy_result
  TRANSACTION_ACTIVE=0
}

cleanup_history() {
  local current_image="$1"
  local previous_image="$2"
  local -a backups images
  local index candidate
  mapfile -t backups < <(find "$TRANSACTION_BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
  for (( index=BACKUP_RETENTION; index<${#backups[@]}; index++ )); do
    [[ "${backups[$index]}" =~ ^[0-9]{8}T[0-9]{6}Z(-[0-9]{2})?$ ]] || continue
    rm -rf -- "$TRANSACTION_BACKUP_ROOT/${backups[$index]}"
  done

  mapfile -t images < <("${DOCKER[@]}" image ls "$IMAGE_REPOSITORY" --format '{{.Repository}}:{{.Tag}}' | awk '!seen[$0]++')
  local kept=0
  for candidate in "${images[@]}"; do
    if [[ "$candidate" == "$current_image" || "$candidate" == "$previous_image" || $kept -lt $IMAGE_RETENTION ]]; then
      ((kept += 1))
      continue
    fi
    "${DOCKER[@]}" image rm "$candidate" >/dev/null 2>&1 || true
  done
}

print_access() {
  local address http_bind http_port
  address="$(read_env GLIMMER_CRADLE_SITE_ADDRESS ':80')"
  http_bind="$(read_env GLIMMER_CRADLE_HTTP_BIND '127.0.0.1')"
  http_port="$(read_env GLIMMER_CRADLE_HTTP_PORT '8080')"
  if [[ "$address" == ':80' ]]; then
    echo "控制面板仅监听 ${http_bind}:${http_port}。"
    echo "从本机建立隧道: ssh -N -L ${http_port}:127.0.0.1:${http_port} <用户>@<服务器>"
    echo "随后访问: http://127.0.0.1:${http_port}/"
  else
    echo "访问地址: https://${address}/"
  fi
  echo "访问 token 保存在 ${DEPLOYMENT_ENV_FILE}。"
}

validate_query_environment() {
  local canonical
  [[ "$DEPLOYMENT_ENV_FILE" == /* ]] || {
    host_transaction_event deployment_query_failed deployment_env_path_not_absolute "$HOST_TRANSACTION_EXIT_USAGE"
    return "$HOST_TRANSACTION_EXIT_USAGE"
  }
  canonical="$(realpath -m -- "$DEPLOYMENT_ENV_FILE" 2>/dev/null || true)"
  [[ "$canonical" == "$DEPLOYMENT_ENV_FILE" && -f "$DEPLOYMENT_ENV_FILE" \
    && ! -L "$DEPLOYMENT_ENV_FILE" && -r "$DEPLOYMENT_ENV_FILE" ]] || {
    host_transaction_event deployment_query_failed deployment_env_unavailable "$HOST_TRANSACTION_EXIT_MISSING"
    return "$HOST_TRANSACTION_EXIT_MISSING"
  }
  STATE_ROOT="$(grep '^GLIMMER_CRADLE_STATE_ROOT=' "$DEPLOYMENT_ENV_FILE" | tail -n1 | cut -d= -f2-)"
  [[ "$STATE_ROOT" == /* && "$(realpath -m -- "$STATE_ROOT" 2>/dev/null || true)" == "$STATE_ROOT" ]] || {
    host_transaction_event deployment_query_failed state_root_invalid "$HOST_TRANSACTION_EXIT_USAGE"
    return "$HOST_TRANSACTION_EXIT_USAGE"
  }
}

print_transaction_state() {
  local transaction_file="${STATE_ROOT}/transactions/current.json"
  if [[ -f "$transaction_file" && ! -L "$transaction_file" && -r "$transaction_file" ]]; then
    printf 'host_transaction='
    cat -- "$transaction_file"
  else
    printf 'host_transaction={"status":"none"}\n'
  fi
}

run_query() {
  validate_query_environment || return $?
  docker info >/dev/null 2>&1 || {
    host_transaction_event deployment_query_failed docker_unavailable_without_elevation "$HOST_TRANSACTION_EXIT_MISSING"
    return "$HOST_TRANSACTION_EXIT_MISSING"
  }
  case "$COMMAND" in
    status)
      compose_with_env "$DEPLOYMENT_ENV_FILE" ps
      print_transaction_state
      ;;
    logs)
      compose_with_env "$DEPLOYMENT_ENV_FILE" logs --follow --tail=200
      ;;
  esac
}

main() {
  case "$COMMAND" in
    install|update|restart|stop|status|logs|backup) ;;
    restore)
      [[ -n "$COMMAND_ARGUMENT" ]] || {
        host_transaction_event deployment_validation_failed restore_backup_id_missing "$HOST_TRANSACTION_EXIT_USAGE"
        exit "$HOST_TRANSACTION_EXIT_USAGE"
      }
      ;;
    *)
      echo "用法: ./deploy.sh [install|update|restart|stop|status|logs|backup|restore <UTC timestamp>]" >&2
      exit "$HOST_TRANSACTION_EXIT_USAGE"
      ;;
  esac

  if [[ "$COMMAND" == status || "$COMMAND" == logs ]]; then
    run_query
    return $?
  fi

  RELEASE_VERSION="$(resolve_release_version)"
  [[ "$READY_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] && (( READY_TIMEOUT_SECONDS >= 10 && READY_TIMEOUT_SECONDS <= 900 )) || {
    echo "GLIMMER_CRADLE_READY_TIMEOUT_SECONDS 必须是 10 到 900 秒的整数。" >&2
    exit "$HOST_TRANSACTION_EXIT_USAGE"
  }

  if ! docker info >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
      DOCKER=(sudo docker)
    else
      echo "Docker Engine 不可用。先运行 sudo ./bootstrap-host.sh，或按 Docker 官方文档安装。" >&2
      exit "$HOST_TRANSACTION_EXIT_MISSING"
    fi
  fi

  if (( EUID != 0 )); then
    if ! command -v sudo >/dev/null 2>&1; then
      echo "部署状态由容器 UID 10001 持有，当前用户需要 sudo 才能执行一致性备份和恢复。" >&2
      exit "$HOST_TRANSACTION_EXIT_MISSING"
    fi
    PRIVILEGED=(sudo)
  fi

  trap on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  export GLIMMER_CRADLE_RUN_ROOT="$RUN_ROOT"
  export GLIMMER_CRADLE_HOST_RUN_ROOT="$HOST_RUN_ROOT"
  host_transaction_acquire "deploy.${COMMAND}"
  prepare_environment
  prepare_state

  case "$COMMAND" in
    install)
      preflight_ports
      install_release
      ;;
    update)
      preflight_ports
      update_release
      ;;
    restart)
      host_transaction_phase restart
      compose_with_env "$DEPLOYMENT_ENV_FILE" restart
      host_transaction_phase readiness
      wait_until_ready "$DEPLOYMENT_ENV_FILE"
      host_transaction_phase bridge_readiness
      start_ops_bridge
      host_transaction_phase commit
      ;;
    stop)
      host_transaction_phase replace
      compose_with_env "$DEPLOYMENT_ENV_FILE" down
      stop_ops_bridge
      host_transaction_phase commit
      ;;
    backup)
      host_transaction_phase prepare
      backup_release
      host_transaction_phase commit
      ;;
    restore)
      host_transaction_require_confirmation "${GLIMMER_CRADLE_TRANSACTION_CONFIRMED:-0}"
      host_transaction_phase prepare
      restore_release "$COMMAND_ARGUMENT"
      host_transaction_phase commit
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi

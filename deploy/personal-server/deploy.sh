#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
ENV_TEMPLATE_FILE="${GLIMMER_CRADLE_ENV_TEMPLATE_FILE:-${SCRIPT_DIR}/.env.example}"
DEPLOYMENT_ENV_FILE="${GLIMMER_CRADLE_DEPLOYMENT_ENV_FILE:-${SCRIPT_DIR}/.env}"
STATE_ROOT="${GLIMMER_CRADLE_STATE_ROOT:-${SCRIPT_DIR}/state}"
BACKUP_ROOT="${STATE_ROOT}/backups"
IMAGE_REPOSITORY="glimmer-cradle/personal-server"
OPS_BRIDGE_CONTAINER="glimmer-cradle-ops-bridge"
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

[[ "$READY_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] && (( READY_TIMEOUT_SECONDS >= 10 && READY_TIMEOUT_SECONDS <= 900 )) || {
  echo "GLIMMER_CRADLE_READY_TIMEOUT_SECONDS 必须是 10 到 900 秒的整数。" >&2
  exit 1
}

if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    DOCKER=(sudo docker)
  else
    echo "Docker Engine 不可用。先运行 sudo ./bootstrap-host.sh，或按 Docker 官方文档安装。" >&2
    exit 1
  fi
fi

if (( EUID != 0 )); then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "部署状态由容器 UID 10001 持有，当前用户需要 sudo 才能执行一致性备份和恢复。" >&2
    exit 1
  fi
  PRIVILEGED=(sudo)
fi

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
  trap - EXIT INT TERM
  if (( TRANSACTION_ACTIVE )); then
    if [[ -n "$DEPLOY_RESULT_FILE" ]]; then
      rm -f -- "$DEPLOY_RESULT_FILE"
    fi
    rollback_transaction || true
  fi
  cleanup
  exit "$exit_code"
}

trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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
  if ! grep -q '^GLIMMER_CRADLE_OPERATIONS_BRIDGE_SOCKET=' "$DEPLOYMENT_ENV_FILE"; then
    set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_OPERATIONS_BRIDGE_SOCKET /var/lib/glimmer-cradle/run/ops-bridge.sock
  fi
  if ! grep -q '^GLIMMER_CRADLE_IMAGE=' "$DEPLOYMENT_ENV_FILE"; then
    set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_IMAGE "${IMAGE_REPOSITORY}:0.1.5"
  fi
  if ! grep -q '^GLIMMER_CRADLE_DEPLOYMENT_MODE=' "$DEPLOYMENT_ENV_FILE"; then
    set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_DEPLOYMENT_MODE source
  fi
  set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_STATE_ROOT "$STATE_ROOT"
  chmod 600 "$DEPLOYMENT_ENV_FILE"
}

prepare_state() {
  mkdir -p "$STATE_ROOT/config" "$STATE_ROOT/data" "$STATE_ROOT/run" "$BACKUP_ROOT"
  "${PRIVILEGED[@]}" chown -R 10001:10001 "$STATE_ROOT/config" "$STATE_ROOT/data" "$STATE_ROOT/run"
  "${PRIVILEGED[@]}" chmod 700 "$STATE_ROOT" "$STATE_ROOT/config" "$STATE_ROOT/data" "$STATE_ROOT/run" "$BACKUP_ROOT"
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

create_compose_env() {
  local image="$1"
  local env_file current_image current_caddy_image deployment_mode
  env_file="$(mktemp "${STATE_ROOT}/.compose-env.XXXXXX")"
  cp "$DEPLOYMENT_ENV_FILE" "$env_file"
  current_image="$(read_env_file "$env_file" GLIMMER_CRADLE_IMAGE '')"
  current_caddy_image="$(read_env_file "$env_file" GLIMMER_CRADLE_CADDY_IMAGE '')"
  deployment_mode="$(read_env_file "$env_file" GLIMMER_CRADLE_DEPLOYMENT_MODE source)"
  set_env_value "$env_file" GLIMMER_CRADLE_IMAGE "$image"
  if [[ "$deployment_mode" == "source" || "$current_caddy_image" == "$current_image" ]]; then
    set_env_value "$env_file" GLIMMER_CRADLE_CADDY_IMAGE "$image"
  fi
  TEMP_ENV_FILES+=("$env_file")
  COMPOSE_ENV_RESULT="$env_file"
}

persist_selected_image() {
  local image="$1"
  local replacing_image="$2"
  local current_caddy_image deployment_mode
  current_caddy_image="$(read_env GLIMMER_CRADLE_CADDY_IMAGE '')"
  deployment_mode="$(read_env GLIMMER_CRADLE_DEPLOYMENT_MODE source)"
  set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_IMAGE "$image"
  if [[ "$deployment_mode" == "source" \
    || -z "$current_caddy_image" \
    || "$current_caddy_image" == "$replacing_image" ]]; then
    set_env_value "$DEPLOYMENT_ENV_FILE" GLIMMER_CRADLE_CADDY_IMAGE "$image"
  fi
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
    if [[ "${GLIMMER_CRADLE_CANDIDATE_PRELOADED:-0}" == 1 ]]; then
      local image
      image="$(read_env_file "$env_file" GLIMMER_CRADLE_IMAGE '')"
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
    read_env GLIMMER_CRADLE_IMAGE "${IMAGE_REPOSITORY}:0.1.5"
  fi
}

candidate_image() {
  local version revision timestamp dirty
  version="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${REPO_ROOT}/package.json" | head -n 1)"
  revision="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD 2>/dev/null || printf 'source')"
  dirty=""
  if git -C "$REPO_ROOT" status --porcelain --untracked-files=no 2>/dev/null | grep -q .; then
    dirty="-dirty"
  fi
  timestamp="$(date -u +%Y%m%d%H%M%S)"
  printf '%s:%s-%s%s-%s' "$IMAGE_REPOSITORY" "${version:-0.1.5}" "$revision" "$dirty" "$timestamp"
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
  local image token socket_path docker_gid docker_bin compose_plugin
  image="$(read_env GLIMMER_CRADLE_IMAGE '')"
  token="$(read_env GLIMMER_CRADLE_OPERATIONS_BRIDGE_TOKEN '')"
  socket_path="$(read_env GLIMMER_CRADLE_OPERATIONS_BRIDGE_SOCKET /var/lib/glimmer-cradle/run/ops-bridge.sock)"
  [[ -n "$image" && -n "$token" && -S /var/run/docker.sock ]] || return 0
  docker_bin="$(command -v docker)"
  compose_plugin="${GLIMMER_CRADLE_DOCKER_COMPOSE_PLUGIN:-/usr/libexec/docker/cli-plugins/docker-compose}"
  [[ -x "$compose_plugin" ]] || compose_plugin="/usr/lib/docker/cli-plugins/docker-compose"
  [[ -x "$compose_plugin" ]] || {
    echo "未找到 Docker Compose CLI 插件，运维桥不启动。" >&2
    return 0
  }
  docker_gid="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || printf '0')"
  "${DOCKER[@]}" rm -f "$OPS_BRIDGE_CONTAINER" >/dev/null 2>&1 || true
  "${DOCKER[@]}" run --detach \
    --name "$OPS_BRIDGE_CONTAINER" \
    --restart unless-stopped \
    --user root \
    --read-only \
    --network none \
    --group-add "$docker_gid" \
    --entrypoint /usr/local/bin/node \
    --env GLIMMER_CRADLE_CLI_PATH=/host/glimmer-cradle/current/deploy.sh \
    --env GLIMMER_CRADLE_STATE_ROOT=/var/lib/glimmer-cradle \
    --env GLIMMER_CRADLE_DEPLOYMENT_ENV_FILE=/etc/glimmer-cradle/deployment.env \
    --env GLIMMER_CRADLE_HOST_RELEASE_ROOT=/host/glimmer-cradle/current \
    --env GLIMMER_CRADLE_OPERATIONS_BRIDGE_SOCKET="$socket_path" \
    --env GLIMMER_CRADLE_OPERATIONS_BRIDGE_TOKEN="$token" \
    --env GLIMMER_CRADLE_RELEASE_SOURCE="$(read_env GLIMMER_CRADLE_RELEASE_SOURCE https://github.com/lociere/glimmer-cradle/releases/latest/download)" \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --mount type=bind,src="$docker_bin",dst=/usr/bin/docker,readonly \
    --mount type=bind,src="$compose_plugin",dst=/usr/libexec/docker/cli-plugins/docker-compose,readonly \
    --mount type=bind,src=/opt/glimmer-cradle/current,dst=/host/glimmer-cradle/current,readonly \
    --mount type=bind,src=/etc/glimmer-cradle,dst=/etc/glimmer-cradle \
    --mount type=bind,src="$STATE_ROOT",dst=/var/lib/glimmer-cradle \
    --tmpfs /tmp:mode=1777 \
    "$image" /opt/glimmer-cradle/container/ops-bridge.mjs >/dev/null
}

stop_ops_bridge() {
  "${DOCKER[@]}" rm -f "$OPS_BRIDGE_CONTAINER" >/dev/null 2>&1 || true
}

create_backup() {
  local timestamp backup_dir counter=0
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_dir="${BACKUP_ROOT}/${timestamp}"
  while [[ -e "$backup_dir" ]]; do
    ((counter += 1))
    backup_dir="${BACKUP_ROOT}/${timestamp}-$(printf '%02d' "$counter")"
  done
  mkdir -p "$backup_dir"
  "${PRIVILEGED[@]}" tar -C "$STATE_ROOT" -czf "$backup_dir/config.tar.gz" config
  "${PRIVILEGED[@]}" tar -C "$STATE_ROOT" -czf "$backup_dir/data.tar.gz" data
  "${PRIVILEGED[@]}" chown -R "$(id -u):$(id -g)" "$backup_dir"
  (
    cd "$backup_dir"
    sha256sum config.tar.gz data.tar.gz > SHA256SUMS
  )
  cat > "$backup_dir/deployment.env" <<EOF
created_at=${timestamp}
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
  "${PRIVILEGED[@]}" rm -rf -- "$STATE_ROOT/config" "$STATE_ROOT/data"
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
  if ! backup_dir="$(create_backup)"; then
    if (( was_running )); then
      compose_with_env "$DEPLOYMENT_ENV_FILE" up --detach --remove-orphans
      wait_until_ready "$DEPLOYMENT_ENV_FILE"
    fi
    echo "备份创建失败，服务已恢复到操作前状态。" >&2
    return 1
  fi
  mark_backup "$backup_dir" manual
  if (( was_running )); then
    compose_with_env "$DEPLOYMENT_ENV_FILE" up --detach --remove-orphans
    wait_until_ready "$DEPLOYMENT_ENV_FILE"
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
  backup_dir="${BACKUP_ROOT}/${backup_name}"
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
  if ! safety_backup="$(create_backup)"; then
    if (( was_running )); then
      compose_with_env "$DEPLOYMENT_ENV_FILE" up --detach --remove-orphans
      wait_until_ready "$DEPLOYMENT_ENV_FILE"
    fi
    echo "无法创建恢复前安全快照，未修改当前数据。" >&2
    return 1
  fi
  if ! restore_backup "$backup_dir"; then
    restore_backup "$safety_backup"
    if (( was_running )); then
      compose_with_env "$DEPLOYMENT_ENV_FILE" up --detach --remove-orphans
      wait_until_ready "$DEPLOYMENT_ENV_FILE"
    fi
    mark_backup "$safety_backup" restore-rollback
    echo "恢复写入失败，已恢复操作前状态。" >&2
    return 1
  fi
  if (( was_running )); then
    compose_with_env "$DEPLOYMENT_ENV_FILE" up --detach --remove-orphans
    if ! wait_until_ready "$DEPLOYMENT_ENV_FILE"; then
      compose_with_env "$DEPLOYMENT_ENV_FILE" down --remove-orphans || true
      restore_backup "$safety_backup"
      compose_with_env "$DEPLOYMENT_ENV_FILE" up --detach --remove-orphans
      wait_until_ready "$DEPLOYMENT_ENV_FILE"
      mark_backup "$safety_backup" restore-rollback
      echo "恢复后的服务未就绪，已恢复操作前状态。" >&2
      return 1
    fi
  fi
  mark_backup "$safety_backup" restore-safety
  echo "已从备份恢复: ${backup_dir}"
}

rollback_transaction() {
  TRANSACTION_ACTIVE=0
  echo "候选版本未通过就绪门，正在回滚。" >&2
  if [[ -n "$TRANSACTION_CANDIDATE_ENV" ]]; then
    compose_with_env "$TRANSACTION_CANDIDATE_ENV" down --remove-orphans || true
  fi
  if [[ -n "$TRANSACTION_BACKUP" ]]; then
    restore_backup "$TRANSACTION_BACKUP"
    mark_backup "$TRANSACTION_BACKUP" rollback-restored
  fi
  if [[ -n "$TRANSACTION_PREVIOUS_IMAGE" && -n "$TRANSACTION_PREVIOUS_ENV" ]]; then
    compose_with_env "$TRANSACTION_PREVIOUS_ENV" up --detach --remove-orphans
    if wait_until_ready "$TRANSACTION_PREVIOUS_ENV"; then
      persist_selected_image "$TRANSACTION_PREVIOUS_IMAGE" "$TRANSACTION_CANDIDATE_IMAGE"
      echo "已恢复上一版本 ${TRANSACTION_PREVIOUS_IMAGE}。" >&2
    else
      echo "上一版本也未能恢复就绪，请保留 ${TRANSACTION_BACKUP} 并检查日志。" >&2
      return 1
    fi
  fi
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
    echo "检测到现有安装，正在确保当前版本已启动并就绪。"
    compose_with_env "$DEPLOYMENT_ENV_FILE" up --detach --remove-orphans
    wait_until_ready "$DEPLOYMENT_ENV_FILE"
    start_ops_bridge
    print_access
    write_deploy_result
    return 0
  fi
  replacing_image="$(read_env GLIMMER_CRADLE_IMAGE '')"
  candidate="$(next_candidate_image)"
  create_compose_env "$candidate"
  TRANSACTION_CANDIDATE_ENV="$COMPOSE_ENV_RESULT"
  TRANSACTION_CANDIDATE_IMAGE="$candidate"
  prepare_candidate "$TRANSACTION_CANDIDATE_ENV"
  TRANSACTION_MODE=install
  TRANSACTION_ACTIVE=1
  compose_with_env "$TRANSACTION_CANDIDATE_ENV" up --detach --remove-orphans
  wait_until_ready "$TRANSACTION_CANDIDATE_ENV"
  persist_selected_image "$candidate" "$replacing_image"
  cleanup_history "$candidate" ""
  start_ops_bridge
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
  create_compose_env "$previous"
  TRANSACTION_PREVIOUS_ENV="$COMPOSE_ENV_RESULT"
  create_compose_env "$candidate"
  TRANSACTION_CANDIDATE_ENV="$COMPOSE_ENV_RESULT"
  TRANSACTION_PREVIOUS_IMAGE="$previous"
  TRANSACTION_CANDIDATE_IMAGE="$candidate"

  # Build while the current release is still serving traffic. State is untouched until this succeeds.
  prepare_candidate "$TRANSACTION_CANDIDATE_ENV"
  TRANSACTION_MODE=update
  TRANSACTION_ACTIVE=1
  compose_with_env "$TRANSACTION_PREVIOUS_ENV" down --remove-orphans
  TRANSACTION_BACKUP="$(create_backup)"
  compose_with_env "$TRANSACTION_CANDIDATE_ENV" up --detach --remove-orphans
  wait_until_ready "$TRANSACTION_CANDIDATE_ENV"
  persist_selected_image "$candidate" "$previous"
  mark_backup "$TRANSACTION_BACKUP" succeeded
  cleanup_history "$candidate" "$previous"
  start_ops_bridge
  print_access
  write_deploy_result
  TRANSACTION_ACTIVE=0
}

cleanup_history() {
  local current_image="$1"
  local previous_image="$2"
  local -a backups images
  local index candidate
  mapfile -t backups < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
  for (( index=BACKUP_RETENTION; index<${#backups[@]}; index++ )); do
    [[ "${backups[$index]}" =~ ^[0-9]{8}T[0-9]{6}Z(-[0-9]{2})?$ ]] || continue
    rm -rf -- "$BACKUP_ROOT/${backups[$index]}"
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
    compose_with_env "$DEPLOYMENT_ENV_FILE" restart
    wait_until_ready "$DEPLOYMENT_ENV_FILE"
    start_ops_bridge
    ;;
  stop)
    compose_with_env "$DEPLOYMENT_ENV_FILE" down
    stop_ops_bridge
    ;;
  status)
    compose_with_env "$DEPLOYMENT_ENV_FILE" ps
    ;;
  logs)
    compose_with_env "$DEPLOYMENT_ENV_FILE" logs --follow --tail=200
    ;;
  backup)
    backup_release
    ;;
  restore)
    restore_release "$COMMAND_ARGUMENT"
    ;;
  *)
    echo "用法: ./deploy.sh [install|update|restart|stop|status|logs|backup|restore <UTC timestamp>]" >&2
    exit 2
    ;;
esac

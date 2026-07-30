#!/usr/bin/env bash

# Personal Server 宿主写事务的唯一 owner。PID 只用于诊断；锁所有权由内核 flock 与
# 可信目录中的稳定 inode 共同决定，不能据 PID 或陈旧 JSON 抢锁。

HOST_TRANSACTION_EXIT_USAGE=64
HOST_TRANSACTION_EXIT_MISSING=66
HOST_TRANSACTION_EXIT_FAILED=70
HOST_TRANSACTION_EXIT_LOCKED=75
HOST_TRANSACTION_EXIT_CONFIRM_DENIED=77
HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED=78
HOST_TRANSACTION_LOCK_FD=9
HOST_TRANSACTION_IS_OWNER=0
HOST_TRANSACTION_RECOVERY_REQUIRED=0
HOST_TRANSACTION_RECOVERY_ACTION=""
HOST_TRANSACTION_OPERATION=""
HOST_TRANSACTION_PHASE=""
HOST_TRANSACTION_LOCK_IDENTITY=""

host_transaction_json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

host_transaction_event() {
  local event="$1" error_code="$2" exit_code="$3"
  printf '{"event":"%s","error_code":"%s","exit_code":%d}\n' \
    "$(host_transaction_json_escape "$event")" \
    "$(host_transaction_json_escape "$error_code")" \
    "$exit_code" >&2
}

host_transaction_now() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

host_transaction_boot_id() {
  if [[ -r /proc/sys/kernel/random/boot_id ]]; then
    tr -d '\r\n' < /proc/sys/kernel/random/boot_id
  else
    printf unavailable
  fi
}

host_transaction_id() {
  local suffix
  suffix="$(printf '%s-%s-%s-%s' "$$" "${RANDOM:-0}" "$(host_transaction_now)" "$(host_transaction_boot_id)" \
    | sha256sum | cut -c1-16)"
  printf 'host_txn_%s_%s' "$(date -u +%Y%m%dT%H%M%SZ)" "$suffix"
}

host_transaction_normalize_exit() {
  case "${1:-70}" in
    0|64|66|70|75|77|78|130|143) printf '%s' "${1:-70}" ;;
    *) printf '%s' "$HOST_TRANSACTION_EXIT_FAILED" ;;
  esac
}

host_transaction_validate_absolute_canonical_path() {
  local target="$1" canonical
  [[ "$target" == /* ]] || {
    host_transaction_event transaction_validation_failed path_not_absolute "$HOST_TRANSACTION_EXIT_USAGE"
    return "$HOST_TRANSACTION_EXIT_USAGE"
  }
  canonical="$(realpath -m -- "$target" 2>/dev/null || true)"
  [[ "$canonical" == "$target" ]] || {
    host_transaction_event transaction_validation_failed path_not_canonical "$HOST_TRANSACTION_EXIT_USAGE"
    return "$HOST_TRANSACTION_EXIT_USAGE"
  }
}

host_transaction_validate_trusted_ancestor() {
  local target="$1" fields uid mode octal
  [[ -e "$target" || -L "$target" ]] || return 0
  [[ ! -L "$target" ]] || {
    host_transaction_event transaction_validation_failed trusted_path_symlink "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
    return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
  }
  fields="$(stat -Lc '%u %a' "$target" 2>/dev/null || true)"
  read -r uid mode <<<"$fields"
  [[ "$uid" == 0 && "$mode" =~ ^[0-7]{3,4}$ ]] || {
    host_transaction_event transaction_validation_failed trusted_path_owner_invalid "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
    return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
  }
  octal=$((8#$mode))
  if (( octal & 0022 )); then
    if (( octal & 01000 )) && [[ "$target" == /tmp || "$target" == /var/tmp ]]; then
      return 0
    fi
    host_transaction_event transaction_validation_failed trusted_path_permissions_invalid "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
    return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
  fi
}

host_transaction_validate_trusted_tree() {
  local cursor="$1"
  host_transaction_validate_absolute_canonical_path "$cursor" || return $?
  while :; do
    host_transaction_validate_trusted_ancestor "$cursor" || return $?
    [[ "$cursor" == / ]] && break
    cursor="$(dirname -- "$cursor")"
  done
}

host_transaction_validate_control_file() {
  local target="$1" expected_mode="$2" fields uid mode
  [[ ! -e "$target" && ! -L "$target" ]] && return 0
  [[ ! -L "$target" ]] || {
    host_transaction_event transaction_validation_failed control_file_symlink "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
    return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
  }
  fields="$(stat -Lc '%u|%a' "$target" 2>/dev/null || true)"
  IFS='|' read -r uid mode <<<"$fields"
  [[ -f "$target" && "$uid" == 0 && "$mode" == "$expected_mode" ]] || {
    host_transaction_event transaction_validation_failed control_file_metadata_invalid "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
    return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
  }
}

host_transaction_configure_paths() {
  HOST_TRANSACTION_STATE_ROOT="${GLIMMER_CRADLE_STATE_ROOT:-}"
  HOST_TRANSACTION_RUN_ROOT="${GLIMMER_CRADLE_RUN_ROOT:-/run/glimmer-cradle}"
  [[ -n "$HOST_TRANSACTION_STATE_ROOT" ]] || {
    host_transaction_event transaction_validation_failed state_root_missing "$HOST_TRANSACTION_EXIT_MISSING"
    return "$HOST_TRANSACTION_EXIT_MISSING"
  }
  HOST_TRANSACTION_JOURNAL_ROOT="${HOST_TRANSACTION_STATE_ROOT}/transactions"
  HOST_TRANSACTION_LOCK_FILE="${HOST_TRANSACTION_RUN_ROOT}/host.lock"
  HOST_TRANSACTION_LOCK_GUARD_FILE="${HOST_TRANSACTION_RUN_ROOT}/.host.lock.guard"
  HOST_TRANSACTION_CURRENT_FILE="${HOST_TRANSACTION_JOURNAL_ROOT}/current.json"
  HOST_TRANSACTION_EVENTS_FILE="${HOST_TRANSACTION_JOURNAL_ROOT}/events.jsonl"
}

host_transaction_prepare_namespace() {
  local lock_identity guard_identity links
  (( EUID == 0 )) || {
    host_transaction_event transaction_validation_failed root_owner_required "$HOST_TRANSACTION_EXIT_MISSING"
    return "$HOST_TRANSACTION_EXIT_MISSING"
  }
  command -v realpath >/dev/null 2>&1 || {
    host_transaction_event transaction_validation_failed realpath_missing "$HOST_TRANSACTION_EXIT_MISSING"
    return "$HOST_TRANSACTION_EXIT_MISSING"
  }
  host_transaction_validate_absolute_canonical_path "$HOST_TRANSACTION_STATE_ROOT" || return $?
  host_transaction_validate_trusted_tree "$(dirname -- "$HOST_TRANSACTION_STATE_ROOT")" || return $?
  host_transaction_validate_trusted_tree "$(dirname -- "$HOST_TRANSACTION_RUN_ROOT")" || return $?
  [[ ! -L "$HOST_TRANSACTION_RUN_ROOT" ]] || {
    host_transaction_event transaction_validation_failed trusted_path_symlink "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
    return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
  }
  if [[ -e "$HOST_TRANSACTION_RUN_ROOT" ]]; then
    host_transaction_validate_trusted_tree "$HOST_TRANSACTION_RUN_ROOT" || return $?
  else
    install -d -o 0 -g 0 -m 0755 "$HOST_TRANSACTION_RUN_ROOT"
  fi
  host_transaction_validate_trusted_tree "$HOST_TRANSACTION_RUN_ROOT" || return $?
  if [[ -e "$HOST_TRANSACTION_STATE_ROOT" ]]; then
    host_transaction_validate_trusted_tree "$HOST_TRANSACTION_STATE_ROOT" || return $?
  else
    install -d -o 0 -g 0 -m 0700 "$HOST_TRANSACTION_STATE_ROOT"
  fi
  if [[ -e "$HOST_TRANSACTION_JOURNAL_ROOT" ]]; then
    host_transaction_validate_trusted_tree "$HOST_TRANSACTION_JOURNAL_ROOT" || return $?
  else
    install -d -o 0 -g 0 -m 0700 "$HOST_TRANSACTION_JOURNAL_ROOT"
  fi
  host_transaction_validate_control_file "$HOST_TRANSACTION_CURRENT_FILE" 600 || return $?
  host_transaction_validate_control_file "$HOST_TRANSACTION_EVENTS_FILE" 600 || return $?

  if [[ ! -e "$HOST_TRANSACTION_LOCK_FILE" && ! -L "$HOST_TRANSACTION_LOCK_FILE" \
    && ! -e "$HOST_TRANSACTION_LOCK_GUARD_FILE" && ! -L "$HOST_TRANSACTION_LOCK_GUARD_FILE" ]]; then
    install -o 0 -g 0 -m 0600 /dev/null "$HOST_TRANSACTION_LOCK_FILE"
    ln -- "$HOST_TRANSACTION_LOCK_FILE" "$HOST_TRANSACTION_LOCK_GUARD_FILE"
  elif [[ ! -e "$HOST_TRANSACTION_LOCK_FILE" || ! -e "$HOST_TRANSACTION_LOCK_GUARD_FILE" ]]; then
    host_transaction_event transaction_validation_failed lock_guard_incomplete "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
    return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
  fi
  host_transaction_validate_control_file "$HOST_TRANSACTION_LOCK_FILE" 600 || return $?
  host_transaction_validate_control_file "$HOST_TRANSACTION_LOCK_GUARD_FILE" 600 || return $?
  lock_identity="$(stat -Lc '%d:%i' "$HOST_TRANSACTION_LOCK_FILE")"
  guard_identity="$(stat -Lc '%d:%i' "$HOST_TRANSACTION_LOCK_GUARD_FILE")"
  links="$(stat -Lc '%h' "$HOST_TRANSACTION_LOCK_FILE")"
  [[ "$lock_identity" == "$guard_identity" && "$links" == 2 ]] || {
    host_transaction_event transaction_validation_failed lock_inode_replaced "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
    return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
  }
}

host_transaction_fd_matches_lock() {
  local fd_identity lock_identity guard_identity
  fd_identity="$(stat -Lc '%d:%i' "/proc/self/fd/${HOST_TRANSACTION_LOCK_FD}" 2>/dev/null || true)"
  lock_identity="$(stat -Lc '%d:%i' "$HOST_TRANSACTION_LOCK_FILE" 2>/dev/null || true)"
  guard_identity="$(stat -Lc '%d:%i' "$HOST_TRANSACTION_LOCK_GUARD_FILE" 2>/dev/null || true)"
  [[ -n "$fd_identity" && "$fd_identity" == "$lock_identity" && "$fd_identity" == "$guard_identity" \
    && "$fd_identity" == "$HOST_TRANSACTION_LOCK_IDENTITY" ]]
}

host_transaction_assert_lock_identity() {
  host_transaction_fd_matches_lock || {
    host_transaction_event transaction_lock_identity_failed lock_inode_replaced "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
    return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
  }
}

host_transaction_write_state() {
  local status="$1" phase="$2" recovery_action="${3:-none}" temp
  host_transaction_assert_lock_identity || return $?
  temp="$(mktemp "${HOST_TRANSACTION_CURRENT_FILE}.XXXXXX")"
  printf '{"schema_version":1,"transaction_id":"%s","operation":"%s","status":"%s","phase":"%s","owner_kind":"host-process","owner_pid":%s,"owner_boot_id":"%s","started_at":"%s","updated_at":"%s","recovery_action":"%s"}\n' \
    "$(host_transaction_json_escape "$GLIMMER_CRADLE_TRANSACTION_ID")" \
    "$(host_transaction_json_escape "$HOST_TRANSACTION_OPERATION")" \
    "$(host_transaction_json_escape "$status")" \
    "$(host_transaction_json_escape "$phase")" \
    "$GLIMMER_CRADLE_TRANSACTION_OWNER_PID" \
    "$(host_transaction_json_escape "$GLIMMER_CRADLE_TRANSACTION_OWNER_BOOT_ID")" \
    "$(host_transaction_json_escape "$GLIMMER_CRADLE_TRANSACTION_STARTED_AT")" \
    "$(host_transaction_now)" \
    "$(host_transaction_json_escape "$recovery_action")" >"$temp"
  chmod 0600 "$temp"
  chown 0:0 "$temp"
  mv -f -- "$temp" "$HOST_TRANSACTION_CURRENT_FILE"
}

host_transaction_log() {
  local event="$1" outcome="$2" phase="${3:-$HOST_TRANSACTION_PHASE}" error_code="${4:-}"
  host_transaction_assert_lock_identity || return $?
  [[ -e "$HOST_TRANSACTION_EVENTS_FILE" ]] \
    || install -o 0 -g 0 -m 0600 /dev/null "$HOST_TRANSACTION_EVENTS_FILE"
  printf '{"timestamp":"%s","module":"personal-server.host-transaction","event_type":"%s","transaction_id":"%s","operation":"%s","phase":"%s","event_outcome":"%s","error_code":"%s"}\n' \
    "$(host_transaction_now)" \
    "$(host_transaction_json_escape "$event")" \
    "$(host_transaction_json_escape "$GLIMMER_CRADLE_TRANSACTION_ID")" \
    "$(host_transaction_json_escape "$HOST_TRANSACTION_OPERATION")" \
    "$(host_transaction_json_escape "$phase")" \
    "$(host_transaction_json_escape "$outcome")" \
    "$(host_transaction_json_escape "$error_code")" >>"$HOST_TRANSACTION_EVENTS_FILE"
}

host_transaction_conflict() {
  local owner_id owner_operation owner_phase
  owner_id="$(sed -n 's/.*"transaction_id":"\([^"]*\)".*/\1/p' "$HOST_TRANSACTION_CURRENT_FILE" 2>/dev/null | head -n1)"
  owner_operation="$(sed -n 's/.*"operation":"\([^"]*\)".*/\1/p' "$HOST_TRANSACTION_CURRENT_FILE" 2>/dev/null | head -n1)"
  owner_phase="$(sed -n 's/.*"phase":"\([^"]*\)".*/\1/p' "$HOST_TRANSACTION_CURRENT_FILE" 2>/dev/null | head -n1)"
  printf '{"event":"transaction_lock_conflict","error_code":"host_transaction_locked","exit_code":75,"owner_transaction_id":"%s","owner_operation":"%s","owner_phase":"%s"}\n' \
    "$(host_transaction_json_escape "${owner_id:-unknown}")" \
    "$(host_transaction_json_escape "${owner_operation:-unknown}")" \
    "$(host_transaction_json_escape "${owner_phase:-unknown}")" >&2
}

host_transaction_require_confirmation() {
  [[ "${1:-0}" == 1 ]] && return 0
  host_transaction_event transaction_confirmation_denied confirmation_required "$HOST_TRANSACTION_EXIT_CONFIRM_DENIED"
  return "$HOST_TRANSACTION_EXIT_CONFIRM_DENIED"
}

host_transaction_acquire() {
  local operation="$1" requested_id="${GLIMMER_CRADLE_TRANSACTION_REQUEST_ID:-}" prior_status=""
  host_transaction_configure_paths || return $?
  command -v flock >/dev/null 2>&1 || {
    host_transaction_event transaction_validation_failed flock_missing "$HOST_TRANSACTION_EXIT_MISSING"
    return "$HOST_TRANSACTION_EXIT_MISSING"
  }
  host_transaction_prepare_namespace || return $?

  if [[ -n "${GLIMMER_CRADLE_TRANSACTION_ID:-}" ]]; then
    HOST_TRANSACTION_LOCK_IDENTITY="$(stat -Lc '%d:%i' "$HOST_TRANSACTION_LOCK_FILE")"
    if ! { true >&"$HOST_TRANSACTION_LOCK_FD"; } 2>/dev/null || ! host_transaction_fd_matches_lock; then
      host_transaction_event transaction_reentry_rejected lock_fd_not_inherited "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
      return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
    fi
    HOST_TRANSACTION_OPERATION="${GLIMMER_CRADLE_TRANSACTION_OPERATION:-$operation}"
    HOST_TRANSACTION_PHASE="${GLIMMER_CRADLE_TRANSACTION_PHASE:-acquired}"
    return 0
  fi

  [[ -z "$requested_id" || "$requested_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || {
    host_transaction_event transaction_validation_failed transaction_id_invalid "$HOST_TRANSACTION_EXIT_USAGE"
    return "$HOST_TRANSACTION_EXIT_USAGE"
  }
  [[ "$operation" =~ ^[a-z][a-z0-9._-]{0,63}$ ]] || {
    host_transaction_event transaction_validation_failed operation_invalid "$HOST_TRANSACTION_EXIT_USAGE"
    return "$HOST_TRANSACTION_EXIT_USAGE"
  }

  exec 9<>"$HOST_TRANSACTION_LOCK_FILE"
  HOST_TRANSACTION_LOCK_IDENTITY="$(stat -Lc '%d:%i' "$HOST_TRANSACTION_LOCK_FILE")"
  if ! flock --nonblock "$HOST_TRANSACTION_LOCK_FD"; then
    host_transaction_conflict
    exec 9>&-
    return "$HOST_TRANSACTION_EXIT_LOCKED"
  fi
  host_transaction_assert_lock_identity || {
    flock --unlock "$HOST_TRANSACTION_LOCK_FD" >/dev/null 2>&1 || true
    exec 9>&-
    return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
  }
  [[ -f "$HOST_TRANSACTION_CURRENT_FILE" ]] \
    && prior_status="$(sed -n 's/.*"status":"\([^"]*\)".*/\1/p' "$HOST_TRANSACTION_CURRENT_FILE" | head -n1)"

  export GLIMMER_CRADLE_TRANSACTION_ID="${requested_id:-$(host_transaction_id)}"
  export GLIMMER_CRADLE_TRANSACTION_OPERATION="$operation"
  export GLIMMER_CRADLE_TRANSACTION_OWNER_PID="$BASHPID"
  export GLIMMER_CRADLE_TRANSACTION_OWNER_BOOT_ID="$(host_transaction_boot_id)"
  export GLIMMER_CRADLE_TRANSACTION_STARTED_AT="$(host_transaction_now)"
  export GLIMMER_CRADLE_TRANSACTION_PHASE=acquired
  HOST_TRANSACTION_OPERATION="$operation"
  HOST_TRANSACTION_PHASE=acquired
  HOST_TRANSACTION_IS_OWNER=1
  host_transaction_write_state active acquired
  host_transaction_log transaction_started success acquired
  [[ "$prior_status" != active ]] \
    || host_transaction_log transaction_stale_metadata_replaced success acquired stale_metadata_only
}

host_transaction_phase() {
  local phase="$1"
  [[ -n "${GLIMMER_CRADLE_TRANSACTION_ID:-}" ]] || return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
  HOST_TRANSACTION_PHASE="$phase"
  export GLIMMER_CRADLE_TRANSACTION_PHASE="$phase"
  host_transaction_write_state active "$phase"
  host_transaction_log transaction_phase success "$phase"
  if [[ "${GLIMMER_CRADLE_TRANSACTION_FAIL_PHASE:-}" == "$phase" ]]; then
    host_transaction_log transaction_fault_injected failed "$phase" fault_injected
    return "$HOST_TRANSACTION_EXIT_FAILED"
  fi
}

host_transaction_mark_recovery_required() {
  local recovery_action="${1:-inspect transaction state and restore the last verified release}"
  HOST_TRANSACTION_RECOVERY_REQUIRED=1
  HOST_TRANSACTION_RECOVERY_ACTION="$recovery_action"
  HOST_TRANSACTION_PHASE=recovery_required
  export GLIMMER_CRADLE_TRANSACTION_PHASE=recovery_required
  host_transaction_write_state recovery_required recovery_required "$recovery_action"
  host_transaction_log transaction_recovery_required failed recovery_required recovery_required
}

host_transaction_finish() {
  local exit_code="${1:-0}"
  (( HOST_TRANSACTION_IS_OWNER )) || return 0
  if ! host_transaction_assert_lock_identity; then
    exec 9>&-
    HOST_TRANSACTION_IS_OWNER=0
    return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
  fi
  grep -q '"status":"recovery_required"' "$HOST_TRANSACTION_CURRENT_FILE" 2>/dev/null \
    && HOST_TRANSACTION_RECOVERY_REQUIRED=1
  if (( HOST_TRANSACTION_RECOVERY_REQUIRED )); then
    grep -q '"status":"recovery_required"' "$HOST_TRANSACTION_CURRENT_FILE" 2>/dev/null \
      || host_transaction_write_state recovery_required recovery_required "$HOST_TRANSACTION_RECOVERY_ACTION"
    host_transaction_log transaction_finished failed recovery_required recovery_required
  elif (( exit_code == 0 )); then
    HOST_TRANSACTION_PHASE=committed
    host_transaction_write_state committed committed
    host_transaction_log transaction_finished success committed
  else
    host_transaction_write_state failed "${HOST_TRANSACTION_PHASE:-unknown}" "diagnose the recorded phase before retrying"
    host_transaction_log transaction_finished failed "${HOST_TRANSACTION_PHASE:-unknown}" "exit_${exit_code}"
  fi
  flock --unlock "$HOST_TRANSACTION_LOCK_FD" >/dev/null 2>&1 || true
  exec 9>&-
  HOST_TRANSACTION_IS_OWNER=0
  (( HOST_TRANSACTION_RECOVERY_REQUIRED )) && return "$HOST_TRANSACTION_EXIT_RECOVERY_REQUIRED"
  return 0
}

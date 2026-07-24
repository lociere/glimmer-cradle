#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
SOURCE_ROOT="${TEST_ROOT}/release"
FAKE_BIN="${TEST_ROOT}/bin"
REMOTE_LOG="${TEST_ROOT}/remote.log"
VERSION=9.8.7
FULL_ASSET="glimmer-cradle-personal-server-v${VERSION}-linux-amd64-full.tar.gz"

cleanup() {
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$SOURCE_ROOT" "$FAKE_BIN"
printf 'full package\n' > "${SOURCE_ROOT}/${FULL_ASSET}"
printf '#!/usr/bin/env bash\nexit 0\n' > "${SOURCE_ROOT}/glimmer-cradle-installer.sh"
(
  cd "$SOURCE_ROOT"
  sha256sum "$FULL_ASSET" glimmer-cradle-installer.sh > SHA256SUMS
)

cat > "${FAKE_BIN}/ssh" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
while [[ "$1" == -* ]]; do
  case "$1" in
    -o|-i|-p) shift 2 ;;
    *) shift ;;
  esac
done
shift
if [[ "$*" == "rm -rf -- "* ]]; then
  remote_root="${*:4}"
  printf 'cleanup %s\n' "$remote_root" >> "$REMOTE_TEST_LOG"
  rm -rf -- "$remote_root"
  exit 0
fi
if [[ "$*" == "mktemp -d "* ]]; then
  mktemp -d /tmp/glimmer-cradle-9.8.7.XXXXXX
  exit 0
fi
if [[ "$1" == bash && "$2" == -s && "$3" == -- ]]; then
  remote_root="$4"
  release_version="$5"
  cat >/dev/null
  cd "$remote_root"
  full_asset="glimmer-cradle-personal-server-v${release_version}-linux-amd64-full.tar.gz"
  awk -v full="$full_asset" -v installer=glimmer-cradle-installer.sh \
    '$2 == full || $2 == installer' SHA256SUMS > selected.sha256
  [[ "$(wc -l < selected.sha256)" == 2 ]]
  sha256sum --check selected.sha256
  [[ "${REMOTE_TEST_FAIL_INSTALL:-0}" != 1 ]] || exit 75
  printf 'install %s\n' "$remote_root" >> "$REMOTE_TEST_LOG"
  exit 0
fi
echo "未预期的 fake ssh 调用: $*" >&2
exit 99
EOF

cat > "${FAKE_BIN}/scp" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
destination="${@: -1}"
remote_root="${destination#*:}"
mkdir -p "$remote_root"
for argument in "$@"; do
  if [[ -f "$argument" ]]; then
    cp -- "$argument" "$remote_root/"
  fi
done
if [[ "${REMOTE_TEST_TAMPER_PUSH:-0}" == 1 ]]; then
  printf 'tampered\n' >> "$remote_root"/*-full.tar.gz
fi
EOF

chmod +x "${FAKE_BIN}/ssh" "${FAKE_BIN}/scp"

run_remote_installer() {
  env \
    PATH="${FAKE_BIN}:${PATH}" \
    REMOTE_TEST_LOG="$REMOTE_LOG" \
    GLIMMER_CRADLE_RELEASE_SOURCE="$SOURCE_ROOT" \
    GLIMMER_CRADLE_VERSION="$VERSION" \
    "$@" \
    bash "${REPO_ROOT}/deploy/personal-server/install-remote.sh" root@test-host
}

run_remote_installer >/dev/null
grep -q '^install /tmp/glimmer-cradle-9\.8\.7\.' "$REMOTE_LOG"
grep -q '^cleanup /tmp/glimmer-cradle-9\.8\.7\.' "$REMOTE_LOG"
success_root="$(awk '/^install / { print $2 }' "$REMOTE_LOG" | tail -n 1)"
[[ ! -e "$success_root" ]]

: > "$REMOTE_LOG"
if run_remote_installer REMOTE_TEST_FAIL_INSTALL=1 >/dev/null 2>&1; then
  echo '远端安装故障错误完成了安装。' >&2
  exit 1
fi
grep -q '^cleanup /tmp/glimmer-cradle-9\.8\.7\.' "$REMOTE_LOG"
failure_root="$(awk '/^cleanup / { print $2 }' "$REMOTE_LOG" | tail -n 1)"
[[ ! -e "$failure_root" ]]

: > "$REMOTE_LOG"
if run_remote_installer REMOTE_TEST_TAMPER_PUSH=1 >/dev/null 2>&1; then
  echo '远端摘要校验错误接受了传输后篡改的完整包。' >&2
  exit 1
fi
! grep -q '^install ' "$REMOTE_LOG"
grep -q '^cleanup /tmp/glimmer-cradle-9\.8\.7\.' "$REMOTE_LOG"
tampered_root="$(awk '/^cleanup / { print $2 }' "$REMOTE_LOG" | tail -n 1)"
[[ ! -e "$tampered_root" ]]

echo 'Personal Server SSH push 双重摘要与临时目录清理测试通过。'

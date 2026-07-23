#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
VERSION=9.8.7
IMAGE="ghcr.io/example/glimmer-cradle-personal-server:v${VERSION}@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
ARCHIVE_IMAGE="glimmer-cradle/personal-server:release-v${VERSION}-aaaaaaaaaaaa"
IMAGE_ID=""
OUTPUT_ROOT="${TEST_ROOT}/release"
INSTALL_ROOT="${TEST_ROOT}/install"
STATE_ROOT="${TEST_ROOT}/state"
CONFIG_ROOT="${TEST_ROOT}/config"
CLI_PATH="${TEST_ROOT}/bin/glimmer-cradle"

cleanup() {
  if (( EUID == 0 )); then
    rm -rf -- "$TEST_ROOT"
  else
    sudo rm -rf -- "$TEST_ROOT"
  fi
}

as_root() {
  if (( EUID == 0 )); then
    "$@"
  else
    sudo "$@"
  fi
}

handle_test_signal() {
  trap - INT TERM
  exit "$1"
}

trap cleanup EXIT
trap 'handle_test_signal 130' INT
trap 'handle_test_signal 143' TERM

create_test_oci_archive() {
  local archive="$1"
  local archive_image="$2"
  local oci_root config_digest manifest_digest config_size manifest_size
  oci_root="${TEST_ROOT}/oci-image"
  rm -rf -- "$oci_root"
  mkdir -p "${oci_root}/blobs/sha256"
  printf '{"imageLayoutVersion":"1.0.0"}\n' > "${oci_root}/oci-layout"
  printf '{"created":"1970-01-01T00:00:00Z","architecture":"amd64","os":"linux","config":{},"rootfs":{"type":"layers","diff_ids":[]},"history":[]}\n' \
    > "${oci_root}/config.json"
  config_digest="$(sha256sum "${oci_root}/config.json" | cut -d' ' -f1)"
  config_size="$(wc -c < "${oci_root}/config.json" | tr -d ' ')"
  mv "${oci_root}/config.json" "${oci_root}/blobs/sha256/${config_digest}"
  cat > "${oci_root}/manifest.json" <<EOF
{"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{"mediaType":"application/vnd.oci.image.config.v1+json","digest":"sha256:${config_digest}","size":${config_size}},"layers":[]}
EOF
  manifest_digest="$(sha256sum "${oci_root}/manifest.json" | cut -d' ' -f1)"
  manifest_size="$(wc -c < "${oci_root}/manifest.json" | tr -d ' ')"
  mv "${oci_root}/manifest.json" "${oci_root}/blobs/sha256/${manifest_digest}"
  cat > "${oci_root}/index.json" <<EOF
{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"sha256:${manifest_digest}","size":${manifest_size},"annotations":{"io.containerd.image.name":"docker.io/${archive_image}","org.opencontainers.image.ref.name":"release-v${VERSION}-aaaaaaaaaaaa"}}]}
EOF
  tar -C "$oci_root" -cf "$archive" .
  printf 'sha256:%s' "$config_digest"
}

IMAGE_ID="$(create_test_oci_archive "${TEST_ROOT}/image.tar" "$ARCHIVE_IMAGE")"
SOURCE_DATE_EPOCH=1 "${REPO_ROOT}/deploy/personal-server/package-release.sh" \
  "$VERSION" "$OUTPUT_ROOT" "$IMAGE" "${TEST_ROOT}/image.tar" "$ARCHIVE_IMAGE" "$IMAGE_ID"

LIGHT="glimmer-cradle-personal-server-v${VERSION}-linux-amd64.tar.gz"
FULL="glimmer-cradle-personal-server-v${VERSION}-linux-amd64-full.tar.gz"
(
  cd "$OUTPUT_ROOT"
  sha256sum --check SHA256SUMS
  [[ "$(awk '{ print $2 }' SHA256SUMS | LC_ALL=C sort | tr '\n' ' ')" == \
    "glimmer-cradle-installer.sh glimmer-cradle-personal-server-v${VERSION}-linux-amd64-full.tar.gz glimmer-cradle-personal-server-v${VERSION}-linux-amd64.tar.gz " ]]
)

mkdir "${TEST_ROOT}/light" "${TEST_ROOT}/full"
tar -xzf "${OUTPUT_ROOT}/${LIGHT}" -C "${TEST_ROOT}/light"
tar -xzf "${OUTPUT_ROOT}/${FULL}" -C "${TEST_ROOT}/full"
cmp \
  "${TEST_ROOT}/light/glimmer-cradle-personal-server/RELEASE-MANIFEST.sha256" \
  "${TEST_ROOT}/full/glimmer-cradle-personal-server/RELEASE-MANIFEST.sha256"
[[ ! -e "${TEST_ROOT}/light/glimmer-cradle-personal-server/images" ]]
[[ -s "${TEST_ROOT}/full/glimmer-cradle-personal-server/images/personal-server-linux-amd64.tar" ]]
! tar -tzf "${OUTPUT_ROOT}/${FULL}" | grep -Eqi \
  '(^|/)(secrets\.yaml|data|logs?|cache|backups?|models?)(/|$)|\.(live2d|moc3)$'

run_installer() {
  local source="$1"
  shift
  local -a command=(env
    GLIMMER_CRADLE_RELEASE_SOURCE="$source"
    GLIMMER_CRADLE_PACKAGE_VARIANT=full
    GLIMMER_CRADLE_VERSION="$VERSION"
    GLIMMER_CRADLE_INSTALL_ROOT="$INSTALL_ROOT"
    GLIMMER_CRADLE_STATE_ROOT="$STATE_ROOT"
    GLIMMER_CRADLE_DEPLOYMENT_CONFIG_ROOT="$CONFIG_ROOT"
    GLIMMER_CRADLE_CLI_PATH="$CLI_PATH"
    "$@"
    bash "${OUTPUT_ROOT}/glimmer-cradle-installer.sh")
  if (( EUID == 0 )); then
    "${command[@]}"
  else
    sudo "${command[@]}"
  fi
}

run_light_installer() {
  local light_install_root="${TEST_ROOT}/light-install"
  local light_state_root="${TEST_ROOT}/light-state"
  local light_config_root="${TEST_ROOT}/light-config"
  local light_cli_path="${TEST_ROOT}/light-bin/glimmer-cradle"
  local fake_bin="${REPO_ROOT}/scripts/fixtures/personal-server-install-interrupt"

  as_root mkdir -p "$light_config_root" "$(dirname -- "$light_cli_path")"
  as_root chown -R "$(id -u):$(id -g)" "$light_config_root" "$(dirname -- "$light_cli_path")"
  cat > "${light_config_root}/deployment.env" <<EOF
GLIMMER_CRADLE_IMAGE=${IMAGE}
GLIMMER_CRADLE_CADDY_IMAGE=${IMAGE}
GLIMMER_CRADLE_SERVER_TOKEN=light-install-token
EOF

  local -a command=(env
    PATH="${fake_bin}:${PATH}"
    GLIMMER_CRADLE_DOCKER_BIN="${fake_bin}/docker"
    GLIMMER_CRADLE_TEST_DOCKER_MODE=light-success
    GLIMMER_CRADLE_TEST_CURRENT_IMAGE="$IMAGE"
    GLIMMER_CRADLE_RELEASE_SOURCE="$OUTPUT_ROOT"
    GLIMMER_CRADLE_PACKAGE_VARIANT=light
    GLIMMER_CRADLE_VERSION="$VERSION"
    GLIMMER_CRADLE_INSTALL_ROOT="$light_install_root"
    GLIMMER_CRADLE_STATE_ROOT="$light_state_root"
    GLIMMER_CRADLE_DEPLOYMENT_CONFIG_ROOT="$light_config_root"
    GLIMMER_CRADLE_CLI_PATH="$light_cli_path"
    bash "${OUTPUT_ROOT}/glimmer-cradle-installer.sh")
  if (( EUID == 0 )); then
    "${command[@]}" >/dev/null
  else
    sudo "${command[@]}" >/dev/null
  fi

  [[ "$(readlink -f "${light_install_root}/current")" == "${light_install_root}/releases/${VERSION}" ]]
  [[ -x "$light_cli_path" ]]
  as_root grep -q '^GLIMMER_CRADLE_SERVER_TOKEN=light-install-token$' "${light_config_root}/deployment.env"
  as_root grep -q "^GLIMMER_CRADLE_CADDYFILE=${light_install_root}/releases/${VERSION}/Caddyfile$" \
    "${light_config_root}/deployment.env"
}

start_interrupt_installer() {
  local marker="$1"
  local fake_bin="${REPO_ROOT}/scripts/fixtures/personal-server-install-interrupt"
  local -a command=(env
    PATH="${fake_bin}:${PATH}"
    GLIMMER_CRADLE_DOCKER_BIN="${fake_bin}/docker"
    GLIMMER_CRADLE_TEST_DOCKER_MARKER="$marker"
    GLIMMER_CRADLE_RELEASE_SOURCE="$OUTPUT_ROOT"
    GLIMMER_CRADLE_PACKAGE_VARIANT=full
    GLIMMER_CRADLE_VERSION="$VERSION"
    GLIMMER_CRADLE_INSTALL_ROOT="$INSTALL_ROOT"
    GLIMMER_CRADLE_STATE_ROOT="$STATE_ROOT"
    GLIMMER_CRADLE_DEPLOYMENT_CONFIG_ROOT="$CONFIG_ROOT"
    GLIMMER_CRADLE_CLI_PATH="$CLI_PATH"
    bash "${OUTPUT_ROOT}/glimmer-cradle-installer.sh")
  if (( EUID == 0 )); then
    setsid "${command[@]}" > "${TEST_ROOT}/interrupt.log" 2>&1 &
  else
    setsid sudo "${command[@]}" > "${TEST_ROOT}/interrupt.log" 2>&1 &
  fi
  INTERRUPT_INSTALLER_PID=$!
}

if run_installer 'http://release.invalid/example' >/dev/null 2>&1; then
  echo '安装器错误接受了明文 HTTP 发布源。' >&2
  exit 1
fi
[[ ! -e "${INSTALL_ROOT}/releases/${VERSION}" ]]

mkdir "${TEST_ROOT}/invalid-oci" "${TEST_ROOT}/invalid-oci-stage"
cp -a "${TEST_ROOT}/full/glimmer-cradle-personal-server" "${TEST_ROOT}/invalid-oci-stage/"
printf 'not an oci archive\n' > "${TEST_ROOT}/invalid-oci-stage/glimmer-cradle-personal-server/images/personal-server-linux-amd64.tar"
tar -C "${TEST_ROOT}/invalid-oci-stage" -czf "${TEST_ROOT}/invalid-oci/${FULL}" glimmer-cradle-personal-server
cp "${OUTPUT_ROOT}/glimmer-cradle-installer.sh" "${TEST_ROOT}/invalid-oci/"
(
  cd "${TEST_ROOT}/invalid-oci"
  sha256sum "$FULL" glimmer-cradle-installer.sh > SHA256SUMS
)
if run_installer "${TEST_ROOT}/invalid-oci" >/dev/null 2>&1; then
  echo '包含无效镜像归档的测试包错误完成了安装。' >&2
  exit 1
fi
[[ ! -e "${INSTALL_ROOT}/releases/${VERSION}" ]]
[[ ! -e "${CONFIG_ROOT}/deployment.env" ]]

cp -a "$OUTPUT_ROOT" "${TEST_ROOT}/tampered"
printf 'tampered\n' >> "${TEST_ROOT}/tampered/${FULL}"
if run_installer "${TEST_ROOT}/tampered" >/dev/null 2>&1; then
  echo '安装器错误接受了摘要不匹配的完整包。' >&2
  exit 1
fi
[[ ! -e "${INSTALL_ROOT}/releases/${VERSION}" ]]

mkdir "${TEST_ROOT}/linked" "${TEST_ROOT}/linked-stage"
cp -a "${TEST_ROOT}/full/glimmer-cradle-personal-server" "${TEST_ROOT}/linked-stage/"
ln -s /tmp "${TEST_ROOT}/linked-stage/glimmer-cradle-personal-server/unsafe-link"
tar -C "${TEST_ROOT}/linked-stage" -czf "${TEST_ROOT}/linked/${FULL}" glimmer-cradle-personal-server
cp "${OUTPUT_ROOT}/glimmer-cradle-installer.sh" "${TEST_ROOT}/linked/"
(
  cd "${TEST_ROOT}/linked"
  sha256sum "$FULL" glimmer-cradle-installer.sh > SHA256SUMS
)
if run_installer "${TEST_ROOT}/linked" >/dev/null 2>&1; then
  echo '安装器错误接受了包含链接的归档。' >&2
  exit 1
fi
[[ ! -e "${INSTALL_ROOT}/releases/${VERSION}" ]]

ENTRY_FAILURE_DEPLOY_MARKER="${TEST_ROOT}/entry-failure.deploy-called"
PREVIOUS_RELEASE="${INSTALL_ROOT}/releases/9.8.6"
as_root mkdir -p "$(dirname -- "$CLI_PATH")"
as_root chown -R "$(id -u):$(id -g)" "$INSTALL_ROOT" "$CONFIG_ROOT" "$(dirname -- "$CLI_PATH")"
mkdir -p "$PREVIOUS_RELEASE" "$CONFIG_ROOT" "$(dirname -- "$CLI_PATH")"
printf '9.8.6\n' > "${PREVIOUS_RELEASE}/VERSION"
ln -s "$PREVIOUS_RELEASE" "${INSTALL_ROOT}/current"
cat > "${CONFIG_ROOT}/deployment.env" <<EOF
GLIMMER_CRADLE_IMAGE=ghcr.io/example/personal-server:v9.8.6@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
GLIMMER_CRADLE_CADDY_IMAGE=ghcr.io/example/personal-server:v9.8.6@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
EOF
printf '#!/usr/bin/env bash\necho previous-cli\n' > "$CLI_PATH"
chmod 0755 "$CLI_PATH"
cp "${CONFIG_ROOT}/deployment.env" "${TEST_ROOT}/deployment.env.baseline"
cp "$CLI_PATH" "${TEST_ROOT}/cli.baseline"
if run_installer "$OUTPUT_ROOT" \
  PATH="${REPO_ROOT}/scripts/fixtures/personal-server-install-interrupt:${PATH}" \
  GLIMMER_CRADLE_DOCKER_BIN="${REPO_ROOT}/scripts/fixtures/personal-server-install-interrupt/docker" \
  GLIMMER_CRADLE_TEST_DOCKER_MODE=success \
  GLIMMER_CRADLE_TEST_IMAGE_ID="$IMAGE_ID" \
  GLIMMER_CRADLE_TEST_UNEXPECTED_DOCKER_MARKER="$ENTRY_FAILURE_DEPLOY_MARKER" \
  GLIMMER_CRADLE_TEST_FAIL_INSTALL_TARGET="$CLI_PATH" \
  >/dev/null 2>&1; then
  echo 'CLI 入口故障错误完成了安装。' >&2
  exit 1
fi
[[ ! -e "$ENTRY_FAILURE_DEPLOY_MARKER" ]]
[[ "$(readlink -f "${INSTALL_ROOT}/current")" == "$PREVIOUS_RELEASE" ]]
as_root cmp "${TEST_ROOT}/deployment.env.baseline" "${CONFIG_ROOT}/deployment.env"
as_root cmp "${TEST_ROOT}/cli.baseline" "$CLI_PATH"
[[ ! -e "${INSTALL_ROOT}/releases/${VERSION}" ]]

mkdir "${TEST_ROOT}/deploy-failure" "${TEST_ROOT}/deploy-failure-stage"
cp -a "${TEST_ROOT}/full/glimmer-cradle-personal-server" "${TEST_ROOT}/deploy-failure-stage/"
cat > "${TEST_ROOT}/deploy-failure-stage/glimmer-cradle-personal-server/deploy.sh" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
echo "注入 deploy 故障" >&2
exit 75
EOF
chmod 0755 "${TEST_ROOT}/deploy-failure-stage/glimmer-cradle-personal-server/deploy.sh"
(
  cd "${TEST_ROOT}/deploy-failure-stage/glimmer-cradle-personal-server"
  mapfile -t release_files < <(find . -type f ! -name RELEASE-MANIFEST.sha256 -print | LC_ALL=C sort)
  sha256sum "${release_files[@]}" > RELEASE-MANIFEST.sha256
)
tar -C "${TEST_ROOT}/deploy-failure-stage" -czf "${TEST_ROOT}/deploy-failure/${FULL}" glimmer-cradle-personal-server
cp "${OUTPUT_ROOT}/glimmer-cradle-installer.sh" "${TEST_ROOT}/deploy-failure/"
(
  cd "${TEST_ROOT}/deploy-failure"
  sha256sum "$FULL" glimmer-cradle-installer.sh > SHA256SUMS
)
if run_installer "${TEST_ROOT}/deploy-failure" \
  GLIMMER_CRADLE_DOCKER_BIN="${REPO_ROOT}/scripts/fixtures/personal-server-install-interrupt/docker" \
  GLIMMER_CRADLE_TEST_DOCKER_MODE=success \
  GLIMMER_CRADLE_TEST_IMAGE_ID="$IMAGE_ID" \
  >/dev/null 2>&1; then
  echo '部署故障错误完成了安装。' >&2
  exit 1
fi
[[ "$(readlink -f "${INSTALL_ROOT}/current")" == "$PREVIOUS_RELEASE" ]]
as_root cmp "${TEST_ROOT}/deployment.env.baseline" "${CONFIG_ROOT}/deployment.env"
as_root cmp "${TEST_ROOT}/cli.baseline" "$CLI_PATH"
[[ ! -e "${INSTALL_ROOT}/releases/${VERSION}" ]]

INTERRUPT_MARKER="${TEST_ROOT}/docker-load.started"
start_interrupt_installer "$INTERRUPT_MARKER"
for _ in $(seq 1 200); do
  [[ -e "$INTERRUPT_MARKER" ]] && break
  sleep 0.05
done
if [[ ! -e "$INTERRUPT_MARKER" ]]; then
  echo '安装器中断测试未进入镜像加载阶段。' >&2
  sed -n '1,120p' "${TEST_ROOT}/interrupt.log" >&2
  exit 1
fi
if (( EUID == 0 )); then
  kill -TERM -- "-${INTERRUPT_INSTALLER_PID}"
else
  sudo kill -TERM -- "-${INTERRUPT_INSTALLER_PID}"
fi
interrupt_status=0
wait "$INTERRUPT_INSTALLER_PID" || interrupt_status=$?
[[ "$interrupt_status" == 143 ]] || {
  echo "安装器收到 TERM 后退出码错误: ${interrupt_status}" >&2
  sed -n '1,120p' "${TEST_ROOT}/interrupt.log" >&2
  exit 1
}
[[ "$(readlink -f "${INSTALL_ROOT}/current")" == "$PREVIOUS_RELEASE" ]]
as_root cmp "${TEST_ROOT}/deployment.env.baseline" "${CONFIG_ROOT}/deployment.env"
as_root cmp "${TEST_ROOT}/cli.baseline" "$CLI_PATH"
[[ ! -e "${INSTALL_ROOT}/releases/${VERSION}" ]]

run_light_installer

echo 'Personal Server 发布包与安装器安全测试通过。'

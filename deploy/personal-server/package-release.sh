#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
VERSION="${1:?用法: package-release.sh <version> [output-dir] <image@sha256:digest>}"
OUTPUT_DIR="${2:-${REPO_ROOT}/dist/personal-server}"
IMAGE="${3:?用法: package-release.sh <version> [output-dir] <image@sha256:digest>}"
RELEASE_VERSION="${VERSION#v}"
RELEASE_TARGET="linux-amd64"
STAGING_ROOT="$(mktemp -d)"
PAYLOAD_ROOT="${STAGING_ROOT}/glimmer-cradle-personal-server"
ASSET_NAME="glimmer-cradle-personal-server-v${RELEASE_VERSION}-${RELEASE_TARGET}.tar.gz"
INSTALLER_NAME="glimmer-cradle-installer.sh"
CHECKSUMS_NAME="SHA256SUMS"
RELEASE_NOTES_NAME="release-notes.md"

[[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || {
  echo "发布版本必须是语义版本: ${VERSION}" >&2
  exit 1
}
[[ "$IMAGE" =~ ^[^[:space:]]+@sha256:[0-9a-f]{64}$ ]] || {
  echo "Personal Server 正式发布必须使用 digest 固定 OCI 镜像: ${IMAGE}" >&2
  exit 1
}

cleanup() {
  rm -rf -- "$STAGING_ROOT"
}
trap cleanup EXIT INT TERM

mkdir -p "$PAYLOAD_ROOT" "$OUTPUT_DIR"
rm -f -- \
  "$OUTPUT_DIR"/glimmer-cradle-personal-server*.tar.gz \
  "$OUTPUT_DIR"/glimmer-cradle-personal-server*.sha256 \
  "$OUTPUT_DIR"/install.sh \
  "$OUTPUT_DIR"/install.sh.sha256 \
  "$OUTPUT_DIR/$INSTALLER_NAME" \
  "$OUTPUT_DIR/$CHECKSUMS_NAME" \
  "$OUTPUT_DIR/$RELEASE_NOTES_NAME"

install -m 0755 "$SCRIPT_DIR/bootstrap-host.sh" "$PAYLOAD_ROOT/bootstrap-host.sh"
install -m 0755 "$SCRIPT_DIR/deploy.sh" "$PAYLOAD_ROOT/deploy.sh"
install -m 0644 "$SCRIPT_DIR/compose.yaml" "$PAYLOAD_ROOT/compose.yaml"
install -m 0644 "$SCRIPT_DIR/Caddyfile" "$PAYLOAD_ROOT/Caddyfile"
install -m 0644 "$SCRIPT_DIR/.env.example" "$PAYLOAD_ROOT/.env.example"
printf '%s\n' "$RELEASE_VERSION" > "$PAYLOAD_ROOT/VERSION"

sed -i \
  -e "s|^GLIMMER_CRADLE_IMAGE=.*$|GLIMMER_CRADLE_IMAGE=${IMAGE}|" \
  -e 's|^GLIMMER_CRADLE_DEPLOYMENT_MODE=.*$|GLIMMER_CRADLE_DEPLOYMENT_MODE=image|' \
  "$PAYLOAD_ROOT/.env.example"

tar --sort=name \
  --mtime="@${SOURCE_DATE_EPOCH:-0}" \
  --owner=0 --group=0 --numeric-owner \
  -C "$STAGING_ROOT" -czf "$OUTPUT_DIR/$ASSET_NAME" glimmer-cradle-personal-server

install -m 0755 "$SCRIPT_DIR/install-release.sh" "$OUTPUT_DIR/$INSTALLER_NAME"
(
  cd "$OUTPUT_DIR"
  sha256sum "$ASSET_NAME" "$INSTALLER_NAME" > "$CHECKSUMS_NAME"
)

cat > "$OUTPUT_DIR/$RELEASE_NOTES_NAME" <<EOF
Glimmer Cradle ${RELEASE_VERSION} 是 Personal Server 的版本化发行。

## 支持环境

- Ubuntu 24.04 LTS / Debian 13
- Linux amd64
- 无需预装 Git、Node.js、pnpm、Python 或 uv

## 安装

\`\`\`bash
curl -fsSL https://github.com/lociere/glimmer-cradle/releases/latest/download/${INSTALLER_NAME} | sudo bash
\`\`\`

默认只监听服务器 \`127.0.0.1:8080\`。配置、私有发布鉴权、阿里云 OSS/ACR 镜像与更新恢复方式见仓库中的 Personal Server 部署指南。

## 发布物

- \`${ASSET_NAME}\`：Compose、Caddy 与事务化部署脚本组成的轻量部署包；应用本体由下方不可变 OCI 镜像承载。
- \`${INSTALLER_NAME}\`：安装、更新和失败回滚的统一入口。
- \`${CHECKSUMS_NAME}\`：本次发布资产的 SHA-256 校验清单。
- OCI：\`${IMAGE}\`

OCI 镜像由同一 tag 构建，并附带 BuildKit SBOM 与 provenance。GitHub 自动生成的源码归档仅用于源码审阅，不是 Personal Server 安装包。

[完整提交记录](https://github.com/lociere/glimmer-cradle/commits/v${RELEASE_VERSION})
EOF

echo "Personal Server 发布包已生成: ${OUTPUT_DIR}/${ASSET_NAME}"

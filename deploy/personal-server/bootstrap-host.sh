#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 sudo ./bootstrap-host.sh 运行。" >&2
  exit 1
fi

. /etc/os-release
case "${ID}:${VERSION_ID}" in
  ubuntu:24.04) ;;
  *)
    echo "当前自动初始化仅正式支持 Ubuntu 24.04 LTS；检测到 ${PRETTY_NAME}." >&2
    echo "其他系统请按 Docker 官方安装文档配置后运行 ./deploy.sh install。" >&2
    exit 1
    ;;
esac

apt-get update
apt-get install --yes ca-certificates curl iproute2 openssl

# Only reached when no complete Docker installation is usable. Remove packages
# that conflict with Docker's official Engine bundle before adding its repository.
for package in docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc; do
  apt-get remove --yes "$package" >/dev/null 2>&1 || true
done

install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

ARCH="$(dpkg --print-architecture)"
CODENAME="${VERSION_CODENAME}"
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/${ID}
Suites: ${CODENAME}
Components: stable
Architectures: ${ARCH}
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt-get update
apt-get install --yes docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  usermod -aG docker "${SUDO_USER}"
  echo "已将 ${SUDO_USER} 加入 docker 组；重新登录后可不使用 sudo。"
fi

docker info >/dev/null
docker compose version
docker buildx version
echo "Docker Engine 初始化完成。"

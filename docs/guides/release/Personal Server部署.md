# Personal Server 部署

> 适用场景：在个人 Linux 服务器上安装、更新和运维 Glimmer Cradle Personal Server。
> 事实依据：`deploy/personal-server/`、[Product Compositions](../../reference/product-compositions.md) 与 [Packaging Layout](../../reference/packaging-layout.md)。

## 支持边界

- 正式发行当前支持 `linux/amd64`、Ubuntu 24.04 LTS 与 Debian 13。
- 服务器不要求预装 Git、Node.js、pnpm、Python、uv 或编译工具；应用语言环境全部固定在预构建 OCI 镜像中。
- 安装脚本复用已有 Docker；缺失 Engine、Buildx 或 Compose 时，通过 Docker 官方 `apt` 仓库补齐。
- 不可消除的前提只有 root/sudo、可用网络、受支持的系统，以及 `curl` 或 `wget` 之一。下载客户端是取得安装器本身所必需的系统能力。
- 标准镜像不包含 Avatar、ASR、FunASR 模型或本地 Embedding 模型。TTS、ASR 与 Embedding 默认关闭，文字对话是最小可运行形态。

## 社区安装

正式用户不需要克隆仓库。GitHub Release 同时发布稳定命名的安装器、统一 `SHA256SUMS`、包含版本与目标平台的部署包，以及预构建 GHCR 镜像：

```bash
curl -fsSL https://github.com/lociere/glimmer-cradle/releases/latest/download/glimmer-cradle-installer.sh | sudo bash
```

没有 `curl` 时可使用：

```bash
wget -qO- https://github.com/lociere/glimmer-cradle/releases/latest/download/glimmer-cradle-installer.sh | sudo bash
```

匿名一键安装要求 GitHub Release 和对应 GHCR package 可公开读取。私有开发发布使用具备仓库读取权限和 `read:packages` 的 GitHub PAT（classic）：

```bash
read -rsp 'GitHub token: ' GLIMMER_CRADLE_GITHUB_TOKEN && echo
export GLIMMER_CRADLE_GITHUB_TOKEN
curl -fsSL \
  -H "Authorization: Bearer ${GLIMMER_CRADLE_GITHUB_TOKEN}" \
  https://github.com/lociere/glimmer-cradle/releases/latest/download/glimmer-cradle-installer.sh | \
  sudo --preserve-env=GLIMMER_CRADLE_GITHUB_TOKEN bash
unset GLIMMER_CRADLE_GITHUB_TOKEN
```

安装器仅把该 token 用于 GitHub Release 下载和临时 GHCR 登录，不写入 Glimmer Cradle 配置；也可以把同一发布物同步到允许目标服务器读取的 OSS/ACR。发布包记录的是版本 tag 与镜像 digest 的组合，安装不会把可移动的 `latest` 当作应用事实源。

手动下载三个自有资产时，可一次校验发布包和安装器：

```bash
sha256sum --check SHA256SUMS
```

GitHub 自动附加的 `Source code (zip)` 与 `Source code (tar.gz)` 是 tag 对应的源码快照，不是 Personal Server 部署包。

安装器会校验部署包摘要和归档路径，安装只读版本到 `/opt/glimmer-cradle/releases/<version>/`，把当前版本原子切换到 `/opt/glimmer-cradle/current`，并创建：

| 路径 | 归属 |
|---|---|
| `/etc/glimmer-cradle/deployment.env` | 宿主部署配置与访问 token |
| `/var/lib/glimmer-cradle/config/` | 应用配置和 secret |
| `/var/lib/glimmer-cradle/data/` | 记忆、经历、扩展包与可观测数据 |
| `/usr/local/bin/glimmer-cradle` | 稳定运维命令 |

重复执行同一命令是幂等的；已停止的同版本会重新启动，发现新镜像时会先备份状态、验收候选版本，并在失败时恢复上一镜像和状态。

## 阿里云网络

默认安装链路只使用 GitHub Release 与公开 GHCR。宿主就绪检查只验证本机 Docker Engine、Compose 和 Buildx，不拉取 `hello-world` 等无关探测镜像；Caddy 已包含在同一个正式 OCI 中，因此目标服务器不依赖 Docker Hub。安装器不修改系统 DNS，也不自动注入未知镜像站。

阿里云区域访问 GitHub 或 GHCR 不稳定时，应把同一组已校验发布物同步到自己的 OSS，把同一个 OCI 镜像同步到自己的 ACR，然后显式覆盖来源：

```bash
curl -fsSL https://<bucket>.<region>.aliyuncs.com/glimmer-cradle/glimmer-cradle-installer.sh | \
  sudo env \
    GLIMMER_CRADLE_DOWNLOAD_BASE=https://<bucket>.<region>.aliyuncs.com/glimmer-cradle/0.1.1 \
    GLIMMER_CRADLE_CANDIDATE_IMAGE=registry.<region>.aliyuncs.com/<namespace>/glimmer-cradle-personal-server:v0.1.1@sha256:<digest> \
    bash
```

两个覆盖项彼此独立：

- `GLIMMER_CRADLE_DOWNLOAD_BASE` 指向包含版本化发布包与 `SHA256SUMS` 的可信目录；
- `GLIMMER_CRADLE_CANDIDATE_IMAGE` 指向相同版本、相同内容的 ACR 镜像；安装器会让应用与 Caddy 入口共同使用该候选镜像。

只有需要自行维护独立 Caddy 镜像时才设置 `GLIMMER_CRADLE_CADDY_IMAGE`。安装和更新会保留该显式覆盖，不会用新版默认值替换用户选择。

OSS/ACR 是传输镜像，不是第二事实源。镜像和发布包仍由同一 tag 发布流水线生成，摘要不得在同步后重写。阿里云安全组默认无需开放 `8080`；推荐保留回环监听并通过 SSH 隧道访问。

## 访问与配置

默认入口只监听服务器 `127.0.0.1:8080`：

```bash
ssh -N -L 8080:127.0.0.1:8080 <user>@<server>
```

随后访问 `http://127.0.0.1:8080/`。访问 token 位于 `/etc/glimmer-cradle/deployment.env`，只用于换取 HttpOnly 会话 Cookie，不进入 URL。

首次启动会把只读默认模板补充到 `/var/lib/glimmer-cradle/config/`，不会覆盖已有文件。真实 provider key 只写入：

```text
/var/lib/glimmer-cradle/config/secrets/secrets.yaml
```

至少配置一个 LLM provider，然后执行 `sudo glimmer-cradle restart`。启用 TTS 或 Embedding 时分别修改 `system/audio.yaml`、`system/embedding.yaml` 并提供对应 secret；保持 `disabled` 不会阻止基础服务就绪。

## 域名与 HTTPS

编辑 `/etc/glimmer-cradle/deployment.env`：

```dotenv
GLIMMER_CRADLE_SITE_ADDRESS=cradle.example.com
GLIMMER_CRADLE_HTTP_BIND=0.0.0.0
GLIMMER_CRADLE_HTTP_PORT=80
GLIMMER_CRADLE_HTTPS_BIND=0.0.0.0
GLIMMER_CRADLE_HTTPS_PORT=443
```

将域名解析到服务器并在安全组开放 TCP `80/443` 与 UDP `443`，然后执行 `sudo glimmer-cradle restart`。Caddy 自动申请和续期证书；部署脚本拒绝把明文 `:80` 站点直接绑定公网地址。

## 运维与更新

```bash
sudo glimmer-cradle status
sudo glimmer-cradle logs
sudo glimmer-cradle restart
sudo glimmer-cradle stop
```

更新使用和首次安装相同的一行命令。`stop` 发送容器级 SIGTERM；容器内 Supervisor 回收 Kernel、Product Host 和所有受管子进程。版本目录只读，用户配置和状态独立保存，不会因容器重建或版本切换丢失。

## 开发者源码安装

只有开发和发布验收需要仓库：

```bash
cd deploy/personal-server
./install.sh
```

该入口会在本机从源码构建候选镜像。它与社区安装共享同一套 Compose、状态边界、就绪门和停机语义，但不作为最终用户分发方式。

## 验证

源码发布门禁：

```bash
pnpm check:encoding
pnpm test
pnpm typecheck
pnpm build
pnpm smoke:personal-server
```

部署侧还必须验证远程下载、摘要校验、浏览器登录、`/readyz`、文字对话、重复安装、更新回滚、重启状态连续性，以及 `stop` 后端口和受管进程完全释放。显式启用并配置 TTS 后，使用 `GLIMMER_CRADLE_SMOKE_REQUIRE_TTS=1 pnpm smoke:personal-server` 追加语音和首段延迟验收。

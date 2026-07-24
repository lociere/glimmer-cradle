# Personal Server 部署

> 适用场景：在个人 Linux 服务器上安装、更新和运维 Glimmer Cradle Personal Server。
> 事实依据：`deploy/personal-server/`、[Product Compositions](../../reference/product-compositions.md) 与 [Packaging Layout](../../reference/packaging-layout.md)。

## 支持边界

- 正式发行当前支持 `linux/amd64`、Ubuntu 24.04 LTS。Debian 尚未完成实机验收，不在当前支持矩阵内。
- 服务器不要求预装 Git、Node.js、pnpm、Python、uv 或编译工具；应用语言环境全部固定在预构建 OCI 镜像中。
- 安装脚本复用已有 Docker；缺失 Engine、Buildx 或 Compose 时，通过 Docker 官方 `apt` 仓库补齐。
- 服务器拉取安装要求 root/sudo、可用外网、受支持的系统，以及 `curl` 或 `wget` 之一。控制机推送安装只要求服务器可经 SSH 到达并具备 root 或无交互 sudo；GitHub/GHCR 网络和下载工具由控制机承担。
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

安装器仅把该 token 用于 GitHub Release 下载和临时 GHCR 登录，不写入 Glimmer Cradle 配置；也可以把同一发布物同步到允许目标服务器读取的项目方 HTTPS 端点。发布包记录的是版本 tag 与镜像 digest 的组合，安装不会把可移动的 `latest` 当作应用事实源。

当前发布资产的职责如下：

| 资产 | 是否携带应用镜像 | 用途 |
|---|---:|---|
| `glimmer-cradle-personal-server-v<version>-linux-amd64.tar.gz` | 否 | 轻量部署包；提供 Compose、Caddy 配置、部署脚本、默认配置投影和目标 OCI digest，随后从 GHCR 拉取镜像 |
| `glimmer-cradle-personal-server-v<version>-linux-amd64-full.tar.gz` | 是 | 完整安装包；携带同一次发布导出的镜像归档，供可信 HTTPS 与本地离线安装 |
| `glimmer-cradle-installer.sh` | 否 | 稳定安装入口；完成下载、校验、宿主准备和事务化部署 |
| `glimmer-cradle-remote-installer.sh` | 否 | 受限网络入口；由控制机校验完整包，经 SSH 推送并调用同一事务安装器 |
| `SHA256SUMS` | 否 | 校验项目自有 Release 资产是否完整且未被替换 |

完整安装包不是新的产品版本，也不替代标准在线安装。它与轻量包和两个安装入口一起进入同一 `SHA256SUMS`；镜像只在发布流水线构建一次，完整包使用该 digest 对应的导出归档。

手动下载清单中的全部五个自有资产时，可一次校验所有发布资产：

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

## 受限网络与区域分发

默认安装链路只使用 GitHub Release 与公开 GHCR。宿主就绪检查只验证本机 Docker Engine、Compose 和 Buildx，不拉取 `hello-world` 等无关探测镜像；Caddy 已包含在同一个正式 OCI 中，因此目标服务器不依赖 Docker Hub。安装器不修改系统 DNS，也不自动注入未知镜像站。

当阿里云等目标服务器访问 GitHub Release 或 GHCR 不稳定，但用户的电脑、跳板机或 CI 控制机可以稳定访问 GitHub 时，使用正式推送入口。以下命令在控制机执行，目标服务器不再访问 GitHub、GHCR 或 Docker Hub：

```bash
curl -fsSL \
  https://github.com/lociere/glimmer-cradle/releases/latest/download/glimmer-cradle-remote-installer.sh | \
  GLIMMER_CRADLE_SSH_IDENTITY="$HOME/.ssh/id_rsa" \
  bash -s -- root@server.example.com
```

控制机入口会下载原始 `SHA256SUMS`、完整包和服务器安装器，在控制机与服务器各校验一次；随后由服务器安装器完成宿主准备、候选健康检查、原子切换和失败回滚。SSH key 只由本机 `ssh` 使用，不上传也不进入项目配置。非 root 账号必须具备 `sudo -n`；自定义端口使用 `GLIMMER_CRADLE_SSH_PORT`，固定版本使用 `GLIMMER_CRADLE_VERSION`。

本地离线安装仍使用服务器安装器。目录至少包含完整包、安装器与发布时生成的原始 `SHA256SUMS`：

```bash
sudo env \
  GLIMMER_CRADLE_RELEASE_SOURCE=/mnt/glimmer-cradle-release \
  GLIMMER_CRADLE_PACKAGE_VARIANT=full \
  GLIMMER_CRADLE_VERSION=<version> \
  bash /mnt/glimmer-cradle-release/glimmer-cradle-installer.sh
```

- `GLIMMER_CRADLE_RELEASE_SOURCE` 指向包含版本化发布包与 `SHA256SUMS` 的可信 HTTPS 或本地目录；远程明文 HTTP 会被拒绝。
- `GLIMMER_CRADLE_PACKAGE_VARIANT` 只允许 `light` 或 `full`，默认 `light`。
- `GLIMMER_CRADLE_CANDIDATE_IMAGE` 仅用于显式 OCI Registry 副本，且仍必须是 digest 固定引用。

只有需要自行维护独立 Caddy 镜像时才设置 `GLIMMER_CRADLE_CADDY_IMAGE`。安装和更新会保留该显式覆盖，不会用新版默认值替换用户选择。

控制机推送已覆盖当前受限网络的一键安装，不要求项目维护 OSS、CDN 或区域 Registry。当匿名服务器拉取规模、控制机中转带宽或长期稳定性成为真实瓶颈时，才建设项目方控制的 HTTPS 对象端点或 Registry。

区域端点只能是传输副本，不是第二事实源。镜像和发布包仍由同一 tag 发布流水线生成，签名、摘要、OCI digest、SBOM 与 provenance 不得由端点独立重写。对象存储和 Registry 的厂商选择不进入安装协议；自动选源、端点目录和签名校验尚未落地前，只允许显式配置项目方控制的端点。

当真实用户规模和网络条件需要区域交付时，一个可信 HTTPS 对象端点即可复用现有安装协议：安装器下载完整包、校验 `SHA256SUMS`、导入包内镜像，再进入同一部署事务。是否建设区域 OCI Registry 由更新频率、镜像层复用收益和公开拉取条件决定，不是基础安装前提。对象存储中的版本目录必须不可变；稳定入口只负责解析版本，实际安装继续固定到明确版本和镜像身份。

对象存储、CDN 或自托管静态站点只是同一契约的不同实现，厂商与地域不进入安装器。云安全组默认无需开放 `8080`，推荐保留回环监听并通过 SSH 隧道访问。

## 访问与配置

默认入口只监听服务器 `127.0.0.1:8080`：

```bash
ssh -N -L 8080:127.0.0.1:8080 <user>@<server>
```

随后访问 `http://127.0.0.1:8080/`。访问 token 位于 `/etc/glimmer-cradle/deployment.env`，只用于换取 HttpOnly 会话 Cookie，不进入 URL。

当前 `v0.1.x` 网页已提供正式控制面：`对话`、`状态`、`扩展`、`日志`、`设置` 五个一级页面可在零 Provider 状态下登录使用。设置中心当前已接入 Provider/默认路由、Audio、Embedding、Memory/Experience、Skill、安全访问令牌、存储/备份、更新/服务状态等 section owner；Provider secret 仍保持 write-only，浏览器不会回显密钥，也不会直接编辑原始 YAML。若某个运维动作依赖宿主桥但当前源码直跑环境未接入，页面会显示真实 disabled reason，而不是假按钮。

首次启动会把只读默认模板补充到 `/var/lib/glimmer-cradle/config/`，不会覆盖已有文件。真实 provider key 只写入：

```text
/var/lib/glimmer-cradle/config/secrets/secrets.yaml
```

至少配置一个 LLM provider，然后执行 `sudo glimmer-cradle restart`。启用 TTS 或 Embedding 时分别修改 `system/audio.yaml`、`system/embedding.yaml` 并提供对应 secret；保持 `disabled` 不会阻止基础服务就绪。

当前版本的 Extension 页面已接入统一安装事务：仓库 Release、Registry、Release Manifest 和浏览器本地 `.gcex` 都会进入同一 `prepare -> preview -> commit` 主线，并展示兼容性、权限、摘要/信任元数据与失败原因。浏览器本地包不会提交服务器绝对路径；页面只会把 `.gcex` 字节流上传到 Product Host owned 临时目录并换取 opaque `upload_id`，后续 prepare/commit/cancel 必须属于当前登录会话，断线会取消已预览未提交事务。安装前仍必须确认包的 `products`、`platforms` 和所需 `features` 包含当前 Personal Server 组合；只声明 `desktop` 或 `windows-x64` 的包会被正确拒绝。NapCat 的现有 Windows OneKey 包属于这种情况，不能通过改清单伪装成服务器兼容；Personal Server 版本将在 M11 按 [ADR-0012](../../architecture/decisions/ADR-0012-场景Adapter与平台受管资源分层.md) 拆分为跨平台 QQ 场景 Adapter 与外部 OneBot 资源配置后发布。

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
sudo glimmer-cradle backup
sudo glimmer-cradle restore <UTC时间戳目录名>
```

更新使用和首次安装相同的一行命令。`backup` 在运行中的服务停机后为 `config/` 与 `data/` 创建带 `SHA256SUMS` 的一致性备份，再恢复服务；输出的 UTC 时间戳目录名可交给 `restore`。恢复只接受部署备份域内的时间戳目录，写入前校验摘要和归档根，并先创建操作前安全快照；恢复后未通过 `/readyz` 时自动恢复安全快照。`stop` 发送容器级 SIGTERM；容器内 Supervisor 回收 Kernel、Product Host 和所有受管子进程。版本目录只读，用户配置和状态独立保存，不会因容器重建或版本切换丢失。

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
pnpm test:release
```

本地已有 digest 固定的正式镜像时，可运行 `pnpm verify:personal-server-full-install -- <image@sha256:digest> <version>`，验证完整包离线加载、`/readyz`、重复安装、数据连续性和 `stop` 资源释放。部署侧还必须验证远程下载、摘要校验、浏览器登录、文字对话、更新回滚和重启状态连续性。显式启用并配置 TTS 后，使用 `GLIMMER_CRADLE_SMOKE_REQUIRE_TTS=1 pnpm smoke:personal-server` 追加语音和首段延迟验收。

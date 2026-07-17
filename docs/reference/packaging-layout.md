# Packaging Layout Reference

> 范围：源码目录、开发投影、安装包资源、组件、只读资产、用户数据、外部运行时和打包验证的映射。
> 事实依据：Desktop `electron-builder` 配置、`scripts/build-*`、Avatar/Unity 同步脚本、路径 resolver、`data/` 布局。
> 维护触发：安装树、构建输出、组件路径、资源投影、更新策略、平台目标或打包脚本变化。

## 概念映射

| 概念 | 开发期位置 | 打包/安装期语义 |
|---|---|---|
| Electron Desktop | `products/desktop/` | Desktop 产品组合与应用主包，可能进入 `resources/app.asar` |
| Personal Server | `products/personal-server/` | OCI 内 `/opt/glimmer-cradle/app/products/personal-server/`，提供 HTTP/WebSocket ingress |
| Kernel | `core/kernel/` | 应用运行时组件，由 Desktop/启动脚本托管 |
| Cognition | `core/cognition/` | Python runtime/包投影，按 uv 环境或发行方案携带 |
| Audio Engine | `engines/audio/` | 官方 engine 组件，模型不随源码硬编码 |
| UnityAvatarHost | `core/avatar/unity-host/` | `resources/components/avatar/unity-host/` 或本机 Host 构建投影 |
| Native DLL | `native/` 构建产物 | 组件或 Unity plugin 投影 |
| Default assets | `assets/` | 只读默认资产，按 catalog 选择打包 |
| User data | `data/` 或系统 user-data 域 | 安装外持久化，不被升级覆盖 |
| Third-party package | `data/packages/*` | 本机托管上游包或可选组件，不进 Git |
| Build tree | `build/{components,packages,staging,reports,logs}/` | 可完全删除重建，不进入最终安装数据域 |
| Distribution tree | `dist/{desktop,personal-server,packages}/` | 最终可发布产物，不作为开发期加载入口 |

安装投影不要求和源码树同构。业务代码只能通过 resolver 取得语义路径，例如 user data、model cache、process log、UnityAvatarHost executable、public asset URL。

## 打包边界

- 安装目录默认只读，不写状态、缓存、日志、下载模型或用户导入资产。
- 真实 `configs/secrets/secrets.yaml`、个人模型、私有 Avatar 资产、provider key、开发缓存、测试输出不得进入发行包；只包含空值的 `secrets.example.yaml` 作为首次配置模板随默认配置投影交付。
- Unity/Cubism 导入目录、Avatar Package Registry、native DLL、Host executable 是构建投影；是否入包由 catalog 和打包脚本决定。
- 外部 runtime 必须记录版本、来源、许可证、完整性和缺失诊断。
- required 组件缺失时构建失败或运行 degraded，不能生成“看似成功但启动即假 ready”的包。

## Avatar 投影

当前开发期 Avatar 可由 `pnpm avatar:build` 生成到本机投影：`build/components/avatar/unity-host/windows-x64/UnityAvatarHostLauncher.exe` 是 Kernel 受管入口，负责在 HWND 创建阶段隔离 worker；同目录 `UnityAvatarHost.exe` 是 Unity Player。打包暂存进入 `build/staging/desktop/<platform>/resources/components/avatar/unity-host/`，最终 Desktop 分发物进入 `dist/desktop/`。Unity 正式身体的源资产来自 `assets/avatar/avatar-packages/*/avatar-package.json`，同步脚本生成 Unity project 投影和 `avatar-package-registry.json`；私人模型内容不进入 Git。

当前开发链路中，Desktop main 通过 `products/desktop/src/main/avatar-paths.ts` 解析 Unity project、Avatar Package Registry、SDK catalog、受管 Host 包和构建日志；脚本侧通过 `scripts/lib/avatar-paths.mjs` 生成同一套开发期物理位置。Kernel 运行时资源投影再通过 `core/kernel/src/foundation/resource-resolver.ts` 把 Avatar Package Registry、Host executable、workdir 和 `avatar.sdk.*` SDK 状态并入 `avatar.host.reconciler.resources`。新增 Avatar 相关入口时，必须先扩展 resolver，不再直接散落仓库相对路径。

打包验收必须覆盖：UnityAvatarHost 可启动、`host_hello`、`host_ready`、首帧 present、透明命中、拖动、DPI、多显示器、退出回收和 process log。

## Audio Engine 投影

Audio engine 以 `engines/audio` 为源码事实源。TTS/ASR 默认关闭且不影响基础运行 readiness；CosyVoice 是显式启用 TTS 后的当前云端 provider，凭据不入包。FunASR 本地模型位于用户数据模型域，标准 Personal Server 发行物不包含 ASR 依赖或模型。Kernel 只投影 `audio.host -> audio.tts/audio.asr -> providers`，不扫描 sidecar 包或复制 Engine provider 逻辑。

## Personal Server OCI 投影

`deploy/personal-server/Dockerfile` 使用 Node/Python 多阶段构建。pnpm 通过 `injectWorkspacePackages` 与 `pnpm deploy` 生成只含生产依赖的 Kernel 和 Personal Server 投影；Cognition 与 Audio 使用 uv 锁文件在 Linux builder 中创建非 editable 环境。构建阶段和最终镜像都使用 `/opt/glimmer-cradle/app`，因此虚拟环境没有跨绝对路径搬移。Caddy 可执行文件从上游固定版本的 GitHub Release 取得，构建时同时校验发行归档 SHA-512 与许可证 SHA-256，再进入最终 OCI。

tag 发布流水线先执行仓库门禁，再生成带 BuildKit provenance/SBOM 的 `linux/amd64` OCI 镜像和确定性部署包。GitHub Release 的自有资产固定为三个：`glimmer-cradle-personal-server-v<version>-linux-amd64.tar.gz`、稳定入口 `glimmer-cradle-installer.sh` 与统一校验清单 `SHA256SUMS`；GitHub 自动生成的源码归档不属于产品安装包。工作流依赖固定到完整 commit SHA，Release 正文由同一打包脚本生成，版本、支持平台、资产职责与 OCI digest 不依赖人工填写。发布门禁会在 OCI 上直接执行 Caddy 版本检查，并验证部署包中的应用与 Caddy 默认镜像指向同一个 digest。

社区安装器先下载 `SHA256SUMS`，从清单解析唯一目标平台部署包，再校验摘要、归档路径和包内版本。它不克隆源码：只读版本进入 `/opt/glimmer-cradle/releases/<version>`，`/opt/glimmer-cradle/current` 原子选择当前版本，配置、状态和运维命令分别固定在 `/etc/glimmer-cradle`、`/var/lib/glimmer-cradle` 与 `/usr/local/bin/glimmer-cradle`。私有开发发布可通过仅驻留当前安装进程的 GitHub token 下载 Release 并临时登录 GHCR；token 不写入项目配置。OSS/ACR 只允许作为同一发布物的显式传输镜像，不成为第二构建来源。

最终容器边界：

| 路径 | 语义 |
|---|---|
| `/opt/glimmer-cradle/app` | 只读应用与 Python 环境 |
| `/opt/glimmer-cradle/default-config` | 只读首次配置模板 |
| `/var/lib/glimmer-cradle/config` | 用户配置挂载 |
| `/var/lib/glimmer-cradle/data` | 用户数据挂载 |
| `/run/glimmer-cradle` | tmpfs 短期协调状态 |

标准镜像包含 Cognition、云端 TTS 所需代码和经完整性验证的 Caddy，不包含 ASR 依赖、FunASR 模型、Embedding 本地模型、私人 Avatar、真实 secret 或本机数据。应用和 Caddy 服务复用同一个 digest 固定的 OCI 传输单元，但仍是两个容器、两个主进程和两套权限边界；应用容器不直接发布 `3210` 到宿主机。目标服务器默认只访问 GitHub Release 与 GHCR，不为宿主就绪检查或入口服务额外拉取 Docker Hub 镜像。

## 验证清单

| 验证 | 要求 |
|---|---|
| 构建输入 | required asset、native、avatar shell、engine、配置 schema 均可定位 |
| 包内容 | 不含 secret、私有模型、开发缓存、测试产物 |
| 启动 | 打包版能启动 Kernel、Desktop、required SDK，并解释 degraded |
| 路径 | 开发路径和安装路径都经 resolver，不出现源码相对硬编码 |
| 日志 | 主日志与 process log 写入用户数据域 |
| 停机 | 退出应用能回收 sidecar、stdio、WebSocket 和子进程树 |

操作步骤见 [客户端打包](../guides/release/客户端打包.md)，数据域见 [Data Layout Reference](./data-layout.md)。

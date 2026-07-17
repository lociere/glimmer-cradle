# Glimmer Cradle（微光摇篮）

Glimmer Cradle 是一个面向长期陪伴角色的本地优先 AI 平台。项目以持续一致的角色认知为核心，将对话、注意力、记忆、经历、语音、Avatar、Skill Plane 与 Extension 生态组织在明确的协议、权限和生命周期边界内。

Selrena（月见）是当前默认角色。角色身份、人设、声音与 Avatar 资源属于 Character Package；Protocol、Kernel、Cognition、产品宿主和 Extension SDK 均保持角色无关。

> **项目状态**：当前版本为 `0.1.0`，属于首个公开开发版本。架构主线、Personal Server 发行链路和 Extension 契约已经建立；面向兼容性的稳定 API 与完整终端用户发行仍在持续完善。

## 核心能力

- **连续角色认知**：Cognition 统一处理上下文、注意力、情绪、推理、记忆、经历和行动决策。
- **长期对话连续性**：会话工作记忆、场景摘要、经历流和长期记忆分别承担即时理解、上下文压缩、事实证据和长期认识。
- **多产品组合**：Desktop 与 Personal Server 共享核心能力和数据契约，通过 Product Manifest 选择各自可用的设备、音频、Avatar 与控制表面。
- **受控能力生态**：Skill Plane 统一管理 Core、Extension、MCP Server 和 User Provider，并通过目录、策略、调用网关和审计约束能力使用。
- **可扩展交互表面**：Extension 可贡献平台适配器、人物 Skill、管理能力、资源和界面声明，同时保持与 Kernel、Cognition 和用户数据的边界。
- **可观测与可恢复**：结构化日志、trace、模型调用记录、DLQ、状态备份和事务化更新共同支撑诊断与恢复。

## 产品

| 产品 | 目标环境 | 能力范围 | 当前入口 |
|---|---|---|---|
| **Glimmer Cradle Desktop** | Windows 桌面 | 本机对话、Control Center、Presence、设备 Skill、Audio 与 Avatar | `products/desktop/` |
| **Glimmer Cradle Personal Server** | Ubuntu 24.04 / Debian 13，`linux/amd64` | 常驻服务、浏览器控制面板、远程对话、云端 TTS lane、Skill Plane 与 Extension Host | `products/personal-server/` |

两个产品共享 Protocol、Kernel、Cognition、Audio Engine、Extension Host 和数据契约，但不是同一宿主程序。Desktop 负责本机窗口、设备和 Avatar；Personal Server 不声明其部署环境不具备的桌面能力。

## 快速开始

### Personal Server

正式 Release 发布后，可在受支持的 Linux 服务器上一键安装：

```bash
curl -fsSL https://github.com/lociere/glimmer-cradle/releases/latest/download/glimmer-cradle-installer.sh | sudo bash
```

服务器不需要预装 Git、Node.js、pnpm、Python、uv 或编译工具。安装器会取得版本化部署包和预构建 OCI 镜像，在需要时通过 Docker 官方仓库安装 Engine、Buildx 与 Compose，然后等待严格就绪门通过。

默认服务只监听服务器 `127.0.0.1:8080`。通过 SSH 隧道访问：

```bash
ssh -N -L 8080:127.0.0.1:8080 <user>@<server>
```

随后打开 `http://127.0.0.1:8080/`。配置位于 `/etc/glimmer-cradle/`，用户配置、记忆、经历、扩展包和可观测数据位于 `/var/lib/glimmer-cradle/`。域名、HTTPS、阿里云 OSS/ACR 镜像和更新恢复说明见 [Personal Server 部署指南](docs/guides/release/Personal%20Server部署.md)。

### Desktop

Desktop 当前以源码开发和实机验收为主，尚未提供面向普通用户的稳定安装包。开发启动方式见下方章节；本地 Avatar Package、Live2D 模型及相关第三方 SDK 不随源码仓库分发。

## 架构

```text
Product Host / Control Surface
              │
              ▼
           Protocol
              │
              ▼
Kernel ── Skill Plane ── Extension / MCP / User Provider
  │
  ├── Audio / Avatar / Platform Ports
  │
  ▼
Cognition ── Context / Attention / Memory / Experience / Reasoning
```

主要边界：

- **Protocol**：跨语言、跨进程 Schema 和事件契约的唯一事实源。
- **Kernel**：负责产品组合、Ingress、路由、权限、生命周期、能力调用和受控投影，不承担人格或记忆语义。
- **Cognition**：负责角色认知和行动决策，不直接访问平台 IO 或 Extension 内部对象。
- **Audio Engine**：独立承载 TTS 与 ASR 能力状态；未配置语音时不影响文字对话基础形态。
- **Avatar**：属于角色呈现层；Renderer 只消费受控投影，不推断系统事实。
- **Extension**：通过公开 SDK、Manifest、权限和 Host Port 接入，不依赖 Kernel 内部实现。

长期设计原则和当前实现分别见 [架构蓝图](docs/architecture/blueprint/README.md) 与 [当前架构](docs/architecture/current/README.md)。

## 开发环境

仓库锁定以下工具版本：

| 工具 | 版本 | 事实源 |
|---|---|---|
| Node.js | `24.18.0` | `.nvmrc` |
| pnpm | `11.13.0` | `package.json#packageManager` |
| Python | `3.12.13` | `.python-version` |
| uv | `0.11.28` | 项目与发布工作流 |

初始化工作区：

```powershell
corepack enable
pnpm install --frozen-lockfile
uv sync --project core/cognition --extra dev
uv sync --project engines/audio --extra tts --extra asr --extra dev
```

复制 `configs/secrets/secrets.example.yaml` 为 `configs/secrets/secrets.yaml`，并仅填写实际需要的 Provider 凭据。真实密钥不得进入 Git、日志、文档或发布物。

开发启动：

```powershell
# Desktop
pnpm dev

# Personal Server
pnpm dev:personal-server
```

`scripts/launch-product.mjs` 是开发期 Product Supervisor，负责共同持有 Product Host 与 Kernel，并在退出时回收受管子进程。正式 Personal Server 使用 OCI、Docker Compose 和版本化部署包，不依赖源码目录或开发服务器。

## 验证

提交前最低验证：

```powershell
pnpm sync:contracts
pnpm check:encoding
pnpm test
pnpm typecheck
pnpm build
```

涉及 UI、Avatar、Audio、Extension、生命周期、协议或数据迁移时，还必须运行对应专项验证。完整要求见 [开发手册](docs/guides/开发手册.md)。

## Extension 生态

Extension 使用 [Extension SDK](packages/extension-sdk/) 和 [基础模板](templates/extension-basic/) 开发。标准 `.gcex` 包携带 Extension Manifest、全量 SHA-256 摘要与 SPDX 2.3 SBOM，可从审核 Registry、发布者仓库 Release、Release Manifest 或本地包进入同一套 prepare、preview、commit 安装事务。

安装后的不可变版本进入 `data/packages/extensions/<extension-id>/<version>/`，由 `configs/extensions/active.yaml` 精确选择。多个版本可以并存，版本切换必须显式完成，主程序不从扩展源码仓库直接加载。

第一方扩展源码、第三方 Adapter 与审核 Registry 分属独立仓库。Registry 只提供发现、审核和信任索引，不托管源码、制品或 SBOM；未收录的社区扩展仍可通过发布者仓库或本地 `.gcex` 安装。精确边界见 [Extension SDK Reference](docs/reference/extension-sdk.md)。

## 配置、数据与隐私

- `configs/system/`：系统与能力配置。
- `configs/characters/<character-id>/`：Character Package 配置。
- `configs/secrets/`：密钥模板和本机 secret。
- `data/state/`：不可再生的角色与应用状态。
- `data/models/`：用户配置的本地模型。
- `data/packages/`：已安装的第三方包。
- `data/observability/`：日志、trace、审计和模型调用记录。

本地数据域可通过 `GLIMMER_CRADLE_DATA_ROOT` 重定位。精确目录契约、保留策略和恢复边界见 [Data Layout Reference](docs/reference/data-layout.md)。

## 仓库结构

```text
assets/       可公开资产声明与只读默认资源
configs/      系统配置、Character Package 与密钥模板
core/         Kernel、Cognition 与 Avatar Host
data/         本地数据域契约
deploy/       产品部署和发布编排
docs/         架构、参考、指南、路线图、ADR 与历史证据
engines/      第一方能力引擎
native/       平台原生组件
packages/     可独立发布的 SDK
products/     Desktop 与 Personal Server 产品宿主
protocol/     Schema、代码生成器与跨语言契约
scripts/      构建、同步、启动和验证工具
templates/    Extension 等开发模板
```

## 文档

从 [文档中心](docs/README.md) 进入完整事实源：

- [架构蓝图](docs/architecture/blueprint/README.md)：长期不变量和设计原则。
- [当前架构](docs/architecture/current/README.md)：现有系统结构和边界。
- [实现地图](docs/architecture/implementation/README.md)：代码入口、组装和运行链路。
- [Reference](docs/reference/README.md)：协议、配置、数据、SDK 与打包的精确事实。
- [开发与运维指南](docs/guides/README.md)：开发、测试、发布和排障步骤。
- [路线图](docs/roadmap/README.md)：当前承诺、候选事项和验收门。

## 许可证

本项目采用 [GNU General Public License v3.0](LICENSE)。第三方模型、Avatar、Live2D SDK、字体、音频和其他媒体资源遵循各自许可证，不因本仓库许可证自动获得再分发授权。

# ADR-0012 场景 Adapter 与平台受管资源分层

- 状态：accepted
- 日期：2026-07-18

## Context

NapCat 的业务身份是 QQ 场景 Adapter：它把 OneBot 事件转换为 Glimmer Cradle 的场景、感知、注意力、回复路由和可选 Skill。现有实现同时承担 Windows OneKey 包准备、`NapCatWinBootMain.exe` 启动和 QQ 进程监督，使通用 QQ 场景接入被错误限制为 `desktop + windows-x64`，无法自然进入 Personal Server。

如果只扩大 Extension Manifest 的 `products` 或 `platforms`，Linux Host 会接受一个仍依赖 Windows 可执行文件的包，形成假兼容。反过来，如果让 Extension 直接持有 Docker Socket 或部署编排权限，又会绕过 Kernel 权限、宿主生命周期和发布边界。

## Decision

1. 场景 Adapter Core 只拥有协议语义、平台身份、场景映射、注意力、感知、回复和该来源可见的 Skill；只要目标协议端点可达，它原则上不绑定 Desktop 或 Personal Server。
2. 第三方程序准备与进程/工作负载监督属于平台受管资源策略，不属于 Adapter Core。一个 Extension 可以为同一资源声明多个产品/平台 profile，但 profile 的选择、授权、生命周期和 readiness 由 Host 管理。
3. NapCat 首个 Personal Server 形态采用 `external_onebot`：NapCat 由用户或部署层独立运行，Adapter 只连接受控 OneBot 端点。Windows Desktop 保留 `managed_windows_onekey`，但它只是 Windows 资源 profile，不定义扩展整体身份。
4. 后续服务器伴随容器必须由 Personal Server 部署层或专用 Workload Port 监督。Extension 不得挂载 Docker Socket、调用容器编排私有 API 或自行取得宿主 root 权限。
5. OneBot 等第三方协议入口不进入 Kernel 内部 Endpoint Registry。服务器同机部署优先使用 Compose 私有网络；跨主机连接必须显式配置鉴权、TLS、来源限制、限流和可观测性。
6. 同一 Extension ID 和版本可以发布平台变体，例如 `windows-x64.gcex` 与 `linux-x64.gcex`。各变体共享公开贡献语义，但只能携带并声明自身平台需要的 payload 与资源 profile；Package Manager 必须在安装前拒绝产品、平台或 feature 不兼容。
7. Extension 私有 Skill 仍是完整 Skill。NapCat 的 `source_provider` Skill 只在 NapCat 产生的 ConversationContext 中可规划和执行；显式声明为全局且通过权限策略的 Skill 才能进入其他场景。
8. WebUI、二维码、账号切换、连接诊断和进程操作属于用户管理能力，不得复用成人物 Skill。QQ ingress、QQ reply、NapCat 管理和上游资源 readiness 必须是可独立降级的 Capability Graph 节点。

## Consequences

- QQ 场景语义可以在 Desktop 与 Personal Server 复用，平台差异收敛到受管资源和网络 profile。
- Personal Server 可以先连接外部 NapCat，之后再增加受控伴随服务，而无需重写感知、会话、记忆或 Skill 链路。
- Extension Manifest、SDK、Package Manager 和 Control Surface 需要表达产品/平台兼容性、资源 profile、配置 Secret 和网络 readiness。
- Windows 受管启动代码必须从 Adapter Core 中抽离；只修改 Manifest 不构成 Linux 支持。
- 用户需要明确选择上游部署模式，并理解外部服务的账号、数据和升级不由 `.gcex` 包托管。

## Alternatives considered

- **把现有包直接声明为 Linux 兼容**：拒绝。实现仍依赖 Windows 可执行文件，会产生假 ready 和无法恢复的启动失败。
- **在应用容器中运行 Docker CLI 并挂载 Docker Socket**：拒绝。权限面等价于宿主 root，破坏 Extension 隔离和最小权限。
- **为 Personal Server 复制第二套 QQ Adapter**：拒绝。场景、注意力、记忆和回复语义会形成双事实源。
- **只支持远端 NapCat，不保留受管模式**：作为首个 Linux 切片可行，但不是长期唯一形态；Desktop 仍需要受控本地体验，服务器未来也可由部署层提供伴随服务。

## Links

- [ADR-0004 Extension 开放生态运行边界](./ADR-0004-Extension开放生态运行边界.md)
- [ADR-0009 本地监督树与动态端点治理](./ADR-0009-本地监督树与动态端点治理.md)
- [ADR-0010 产品组合与扩展仓库边界](./ADR-0010-产品组合与扩展仓库边界.md)
- [M11：Personal Server 控制面、区域分发与跨产品 Extension 闭环](../../roadmap/milestones/M11-Personal%20Server控制面、区域分发与跨产品Extension闭环.md)

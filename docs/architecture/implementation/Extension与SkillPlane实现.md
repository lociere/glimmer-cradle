# Extension 与 Skill Plane 实现

> 范围：Extension SDK、Extension Host、Skill Registry、Policy、Invocation Gateway、Core/Extension/MCP/User Provider 和 Adapter 如何在代码中接线；不写 SDK 字段全表。
> 源码依据：`packages/extension-sdk/src/`、`templates/extension-basic/`、独立 `glimmer-cradle-extensions` 仓库、`data/packages/extensions/<extension-id>/<version>/`、`core/kernel/src/application/skill-plane/`、`core/kernel/src/host/extension-manager.ts`、`configs/system/skills.yaml`、`configs/extensions/`。
> 维护触发：SDK API、manifest、permissions/requires、activation、provider 生命周期、MCP、Policy、Gateway、catalog、confirmation 或 audit 变化。

## 目录

- [SDK 与 Host 入口](#sdk-与-host-入口)
- [Skill Plane 代码结构](#skill-plane-代码结构)
- [Extension Adapter 链路](#extension-adapter-链路)
- [MCP Provider 链路](#mcp-provider-链路)
- [调试入口](#调试入口)
- [验证](#验证)

## SDK 与 Host 入口

| 入口 | 职责 |
|---|---|
| `packages/extension-sdk/src/index.ts` | SDK 包入口 |
| `lifecycle/define-extension.ts` | 扩展定义入口 |
| `lifecycle/base-extension.ts` | 扩展基类和生命周期约束 |
| `manifest/` | manifest 类型和解析 |
| `permissions/` | 权限声明 |
| `host/` | Host port 类型 |
| `utilities/websocket/` | 扩展侧 WebSocket bridge |
| `protocol/src/schemas/models/ExtensionRuntimeProjection.schema.json` | Extension Host 运行投影的跨进程契约 |
| `core/kernel/src/host/extension-manager.ts` | Kernel ExtensionManager |
| `core/kernel/src/host/process/extension-process-host.ts` | Kernel 侧独立 Host 监督、权限和 Port RPC |
| `core/kernel/src/host/process/extension-host-worker.ts` | 扩展入口唯一加载点与 SDK Context bridge |
| `packages/extension-sdk/src/host/process-protocol.ts` | Host/Worker 双向进程消息 |
| `core/kernel/src/host/extension-runtime-readiness.ts` | 把 Host `ExtensionRuntimeProjection` 归一成 lifecycle `RuntimeReadinessSnapshot.reconciler` |
| `core/kernel/src/host/extension-dependency-installer.ts` | Extension 外部依赖准备、下载缓存和解压安装 |
| `core/kernel/src/host/managed-resource-supervisor.ts` | Extension 受管资源 readiness gate 检查，并产出 Capability Graph 节点 |
| `application/services/extension-host-app.service.ts` | Extension Host application service |
| `application/services/extension-runtime-registry.ts` | Host-owned Contribution Point Registry 到 Capability Graph projection 的转换器 |

Extension 只能通过 SDK/Port 协作，不能 import Kernel 内部路径。每个激活扩展运行在独立 Node Host 进程；Kernel 不 `require()` 扩展入口，只读取 manifest 和原始自有配置。Worker 内完成 config schema 校验和 `onActivate()`，所有 storage、event、command、agent、attention、perception、evidence 与运行投影调用都通过进程 RPC 回到 Kernel 权限边界。Host 负责加载、激活、停止、释放、超时和进程树错误隔离；这是故障隔离，不是承诺抵御恶意本机代码的 OS 沙箱。

记忆相关 SDK Port 当前落点：

| Port | SDK 类型 | Kernel 接线 |
|---|---|---|
| `evidenceProposal` | `EvidenceProposalPort` | `ExtensionHostAppService.submitEvidenceProposal()` → `PerceptionAppService.processIngress()` |
| `perception` | `PerceptionPort` | `PerceptionAppService.processIngress()` |

两种 Port 都只接受 `ConversationAddress`，不接受 Extension 自造的 canonical scene/conversation/actor id。`ConversationDirectory.resolve()` 对 provider account、space、thread、endpoint 做不可逆规范化，并依据 visibility/space kind 生成 `conversation_private`、`space_local` 或 `public` scope。

`evidenceProposal.submit()` 由 `EVIDENCE_PROPOSAL_WRITE` 授权。Host 校验 address、`content`、`sourceEventId` 和 `schemaRef`，组装为 `ambient + observe_only + memory_candidate` 的 `PerceptionEvent`，并固定 `cognitive_effect=evidence_proposal`。它不是 Memory 写 API，Extension SDK 也不暴露 Memory CRUD。

`ExtensionManager` 的生命周期语义：

- `init()` 先读取精确激活选择并扫描 `data/packages/extensions/<id>/<version>/` catalog；激活项必须命中指定版本，未激活扩展选择最新已安装版本用于管理投影。每个被选中的合法 manifest 注册为 `ExtensionRuntimeProjection(lifecycle=discovered)`；
- `loadExtension()` 校验 manifest、版本和入口，准备配置/依赖并创建尚未启动的独立 Host；只把 `audience=character` 的 `contributes.glimmer.skill` 中 character audience 的 tool/resource/prompt 注册为 `contract_only` 人物目录项；
- `loadExtension()` 会读取 `contributionPoints` 与按 point id 分组的 `contributes`，注册内建和扩展自带 definition；未知 point 只进入 unsupported 投影；
- `loadExtension()` 会准备 `contributes.glimmer.managedResource` / `contributes.glimmer.protocolBridge` 中带 package 的受管资源：先检查声明安装目录，缺失时由宿主级 installer 按 manifest 来源下载和解压；第三方包落在数据根，不进入源码树；
- `startExtension()` fork Worker 并等待 ready，再在 Worker 内加载扩展、校验配置和激活；`ctx.ports.agents.registerSubAgent(...)` 等同步注册必须全部由 Kernel 确认后激活才算成功；
- 激活失败会释放激活过程中注册的订阅/handler，并撤销声明式目录项，然后发布 `ExtensionErrorEvent`；
- `stopExtension()` 无论扩展是否成功运行，都会释放 activation subscriptions 和声明式目录项；重启时重新注册声明式目录，避免复用旧 handler 或旧 catalog。

Control Center 通过桌面桥向 Kernel 发送扩展生命周期请求；Kernel 只暴露 `loadExtension`、`startExtension`、`stopExtension` 的受控入口，不允许 Electron renderer 直接触碰扩展进程或 Host 内部对象。运行投影契约是 `ExtensionRuntimeProjection`：Host 通过 `ExtensionRuntimeRegistry` 聚合 manifest 身份字段、lifecycle、contribution point definitions、带 `audience` 的 Capability Graph、带 `audience` 的 action intents 和 diagnostics 后推送给 Desktop，Renderer 只消费该投影。

`ExtensionManager` 只从 `data/packages/extensions/<id>/<version>/` 发现已安装 manifest，并由 `configs/extensions/active.yaml` 的 `{ id, version }` 精确选择启动版本；不存在目录覆盖式升级或单一 package 兼容入口。Package Manager 另行发布 `ExtensionInstallationProjection`，表达已安装版本集合和当前激活版本；Extension Host 发布 `ExtensionRuntimeProjection`，只表达当前选择版本的运行事实。安装新版本不会隐式替换旧版本，控制表面通过带目标 `version` 的 lifecycle request 显式切换。在 `init()` 时注册 discovered 投影，在 `loadExtension()` 时升级 manifest/运行投影，在 `startExtension()`、`stopExtension()` 和激活失败时更新 lifecycle；`ControlSurfaceGateway` 支持 `extension_runtime_projection_request` 并广播 `extension_runtime_projection_changed`。产品表面直接消费两类权威投影，不扫描扩展源码仓库，也不读取扩展 storage 或运行日志来还原事实。extension lifecycle module 会经 `host/extension-runtime-readiness.ts` 把这些运行投影折叠成 `RuntimeReadinessSnapshot[]` 返回给 Lifecycle Orchestrator；后续扩展启停和失败继续覆写 `RuntimeReadinessCatalogStore` 中对应模块的 snapshots。

Personal Server 的浏览器本地 `.gcex` 不把服务器路径暴露成公共协议。`src/server/bootstrap/personal-server-app.ts` 只接受认证后的 `.gcex` 字节流上传到 Product Host owned 临时目录，返回绑定当前 principal/session、30 分钟时效和单次消费的 opaque `upload_id`。`src/server/websocket/surface-proxy.ts` 会记录每个 `extension_install_prepare` 的授权上下文：`uploaded_package` 先在当前会话内解析为受控 file source，再转发给 Kernel；任何 ready preview 返回的 `transaction_id` 都会绑定到当前 principal/session，因此 commit/cancel 对仓库、Registry、Manifest 和本地上传四类来源都执行同一授权规则。Host 断线时先向 Kernel cancel 本连接所有已预览未提交事务，再释放本地上传索引；若 Product Host 已失去上游连接，则由 Kernel `ExtensionPackageManager` 的启动/定时 sweep 清理 stale transaction 目录，不依赖浏览器或 Product Host 的偶然恢复。

Desktop main 只保留精确激活版本与扩展配置 YAML 的受控编辑入口，不承担扩展身份发现或运行事实拼装。依赖健康、能力可用性、动作 enablement 和诊断均来自 Host runtime projection 的 Capability Graph。`ManagedResourceSupervisor` 会在扩展加载和启动时检查第三方 package 是否存在，并执行 `readinessGates` 生成 graph node 状态；NapCat 通过 `runtime` Port 上报 process、OneBot、WebUI 和 capability graph 节点。Control Center 扩展页按 projection 通用渲染 Contribution Points、Capability Graph Nodes、Graph Edges、Action Intents 和 Diagnostics，不硬编码 NapCat 面板。`contributes.glimmer.setting` 会经 Capability Graph 派生为通用配置表单字段；renderer 只通过 `saveExtensionConfig()` 保存 YAML 草稿，不直接读写扩展配置文件。

## Skill Plane 代码结构

```text
core/kernel/src/application/skill-plane/
├── skill-registry.ts
├── skill-policy-engine.ts
├── skill-invocation-gateway.ts
├── types.ts
└── providers/
    ├── core/
    ├── extension/
    ├── mcp-server/
    └── user/
```

| 组件 | 职责 |
|---|---|
| Registry | 汇总 provider catalog，只提供 character audience 的 skill/tool/resource/prompt 可发现能力快照 |
| Policy Engine | 判断权限、风险、确认需求和拒绝原因 |
| Invocation Gateway | 唯一执行入口，统一 audience/scope/requirements/Policy、timeout、trace、audit 与错误归一化 |
| Core Provider | Kernel 内置基础能力 |
| Extension Provider | Extension manifest/handler 暴露的能力 |
| MCP Provider | stdio/http/ws MCP server 的工具、资源和 prompt |
| User Provider | 用户配置或脚本能力 |

Catalog 不等于授权，Policy 通过不等于执行，执行必须经过 Gateway。

Gateway 当前实现位于 `skill-invocation-gateway.ts`。它对 tool/resource/prompt 统一执行：

1. 解析 `traceId`、当前 ALS trace 或新 trace；
2. 校验 skill 与目标 tool/resource/prompt 都是 `character` audience，并按当前 `ConversationContext` 重新校验 global/source provider/scene/conversation scope；
3. 校验 Product Composition、平台和 feature requirements，再按 skill policy 或目标级 policy 调用 `SkillPolicyEngine`；
4. 若 policy 要求确认，先调用确认通道；无确认通道或用户拒绝时写 `policy_denied`；
5. 成功时调用 handler，并记录结果类型与耗时；
6. 策略拒绝或 handler 抛错时记录拒绝/失败摘要并保留原错误语义；
7. 写入 `skill.invocation.count` 与 `skill.invocation.duration_ms` metrics，默认 audit sink 写结构化运行日志。

成功审计受 `policy.audit` 控制；拒绝和失败不受该开关关闭。

Core Skill Provider 的 Desktop/Notification/Clipboard manifest 通过 `CorePlatformBridge` 注入真实 handler；`desktop.open_url`、`notification.show`、`clipboard.read` 和 `clipboard.write` 标记为 ready。Desktop bridge 由 `ControlSurfaceGateway` 通过 WebSocket 向 Electron main 发送 `core_skill_action_request` 或 `core_skill_confirmation_request`，Electron main 执行 `shell.openExternal`、Notification、clipboard 或确认对话，并用 response frame 返回结果。剪贴板读写和中风险桌面动作需要确认；Desktop 未连接、handler 抛错或用户拒绝都会经 Gateway 形成失败/拒绝审计。

`SkillPlanningAppService` 位于 Kernel application 层，负责把 `SkillCatalogSnapshot` 中 `audience=character`、`runtime_status=ready` 且 scope 匹配当前 `ConversationContext` 的工具转成 `AgentPlanRequest.available_tools`，经 `AIProxy.requestAgentPlan()` 请求 Cognition 规划，并在返回后再次过滤目录外建议。`executeSuggestion()` 将同一 ConversationContext 传给 `SkillInvocationGateway`，不直接执行 provider handler。这样 planner 看不到跨来源能力，伪造建议也会在执行层再次被拒绝。

`SkillActionController` 是普通聊天热路径中的 Skill 使用编排入口，随 `ApplicationRuntime` 创建并注册为 `ACTION_COMMAND` handler。它保留原 `reply` 投递行为；收到 `ActionCommand.action_type=skill_request` 时，会按同一 trace 执行：

```text
skill_request ActionCommand
  -> SkillPlanningAppService.plan(ready catalog -> agent_plan)
  -> SkillPlanningAppService.executeSuggestion()
  -> SkillInvocationGateway(policy / confirmation / handler / audit)
  -> normalized AgentToolResult[]
  -> AIProxy.requestAgentSynthesis(agent_synthesis)
  -> ChannelReplyEvent
```

无 ready skill、无合适建议、策略拒绝、缺确认通道、用户拒绝和 handler 失败都会转成 `success/error/skipped` 之一的工具结果回传 Cognition 合成。`contract_only` 目录项和非 character audience tool/resource/prompt 不会进入人物 Skill catalog；`agent_plan` 目前只投影 ready character tools，即使越界建议也会被 `SkillPlanningAppService` 二次过滤；执行阶段仍由 Gateway 再次校验 audience、Policy 和 handler。

Control Center 的能力目录通过 Desktop bridge 的 `skill_catalog_request` 读取同一个 `SkillCatalogAppService.getCatalogSnapshot()`，Electron main 只转发受控快照，不在 Desktop 进程中 import Kernel service 或重新构造注册表。`SkillCatalogSnapshot` 现在除了人物可用 skill 条目，还会带 `providerRuntimes`：Kernel 统一投影 core / extension / MCP / user provider 的运行态、契约-only、连接失败和恢复动作，Desktop 能力页只消费这份投影，不探测本地 MCP 端点。Extension 运行态不再停留在 `ExtensionRuntimeProjection` 支线里；`ExtensionHostAppService` 会把 Host 侧 manifest/lifecycle/capability graph/diagnostics 同步映射成 `provider.kind=extension` 的 provider runtime，因此即使一个扩展暂时没有人物可用 skill，Control Center 也能在同一能力目录里看到它是 `contract_only`、`connecting`、`ready`、`degraded` 还是 `unavailable`。Skill Plane 不消失，但收敛为 Host-Owned Capability Plane 上的人物可用调用层：`glimmer.skill` 是内建 contribution point，只有 character audience 的 skill/tool/resource/prompt 进入人物 Skill catalog；管理动作从 `ExtensionRuntimeProjection.actions` 的 user audience action intent 触发，不能混入 `SkillPlanningAppService.available_tools`。

## Extension Adapter 链路

```text
平台 payload
  -> data/packages/extensions/<extension-id>/<version>/* 已安装协议适配模块
  -> SDK/Host port
  -> Kernel PerceptionAppService 或 ChannelStateStore
  -> Cognition 统一感知
  -> Kernel 输出
  -> Adapter 受控平台动作
```

Adapter 清洗平台字段、映射 scene/source/identity、处理平台限流和输出通道。平台私有 payload 不进入 Cognition；Adapter 不写 Cognition DB，不持有 Kernel 内部 service。

Adapter 需要区分三类 ID：

| ID | 用途 | 示例 |
|---|---|---|
| `ConversationAddress` | 外部 account/space/thread/endpoint 地址，由 Kernel 规范化 | QQ 群、私聊或线程的外部键 |
| sender identity | 发言者语义身份，进入 `PerceptionEvent.content.actor_id/actor_name` | `napcat:user:<hash>`、nickname |
| attention channel | Kernel LifeClock 的注意力窗口键 | `napcat:group:<groupId>:user:<senderId>` |

这使平台规则留在 Adapter 内：NapCat 群聊默认是“唤醒者窗口”，同一人在窗口内继续说话不再需要唤醒词；如配置为群级窗口，则群内所有人在窗口内都视为连续对话。Cognition 只接收 `direct/ambient` 等通用感知语义，不理解 QQ 群聊细节。

NapCat 注入 Cognition 的 `actor_id` 使用 sender id 的不可逆哈希构造，避免把 QQ 号等平台原始 ID 写入认知经历或关系库；`actor_name` 使用已解析昵称，用于关系观察和近期经历可读性。

`attention channel` 是 Kernel Attention Lease 的当前兼容输入，不是 Cognition 状态。Extension 只能申请或释放外部焦点窗口；是否可回复由 `response_policy` 表达，是否愿意回复由 Cognition Volition 决定，是否执行工具由 Skill Plane Policy/Gateway 决定。

第三方 Extension 不能直接发布 Avatar/Live2D 控制帧。远端平台消息默认不驱动本地身体；Cognition 对这些消息的行动结果由 Adapter 投递回对应平台。只有 `desktop-ui:*`、`avatar:*` 等本地 surface scene 会进入本地 VisualCommand/Avatar 外显链路。

远端平台的连续性统一由地址表达。Adapter 决定一个私聊、群聊或线程如何映射到 `ConversationAddress`，Kernel 决定 canonical topology 和 scope。直接互动按 `direct + reply_allowed` 进入，未聚焦背景按 `ambient + observe_only` 进入，摘要候选走 `evidenceProposal`。进入 Cognition 后先成为带 ConversationContext 与 SourceDescriptor 的 Moment，再派生 Conversation/Episode，并由 Consolidation 判断是否进入 Memory。

NapCat adapter 的非焦点背景消息直接提交 `ExtensionPerceptionProposal`；Host 解析地址后才构建 `PerceptionEvent`。这条路径不申请 Attention Lease、不登记 `ReplyRouter` 路由，因此不会把背景群聊升级成焦点或建立远端回复目标。进入 Cognition 后写 `perception` 和带 `reason=observe_only` 的策略性 `silence`；Context Assembly 只在同一 `space_local` 域内召回 perception，不把策略性 silence 当成“她选择沉默”。

NapCat adapter 的运行健康拆为四段：NapCat package/process 节点是 `host` audience，OneBot bridge、QQ ingress 和 QQ reply 是 `adapter` audience，WebUI management 和二维码/快速登录/打开 WebUI 等命令是 `user` audience，semantic capability 节点只表达对应链路 ready。Adapter 通过 `ctx.ports.runtime.reportCapabilityGraph()` 上报这些节点和 diagnostics，Host 合并为 `ExtensionRuntimeProjection`；不再把私有 `runtime.status` 或 NapCat 专用字段作为 Control Center 事实源，也不把管理命令或 adapter bridge 暴露为人物 skill。OneBot 默认由 Adapter 自动选择回环端口，端点存在只说明协议接入口已分配，不说明 NapCat 已登录；`http://127.0.0.1:6099/webui` 只说明管理面板可打开，不应作为整个扩展的唯一 readiness。若未来要让人物查询 QQ 登录状态，应新增 `audience=character` 的独立 `glimmer.skill`，不能复用管理命令或协议桥节点。

NapCat Windows 默认启动策略是官方 Shell Windows OneKey 包中的 direct launcher：当 `package_dir` 指向 OneKey 根目录时，扩展直接启动根目录 `NapCatWinBootMain.exe`，并把首选账号作为可选第一个参数传入；该入口使用包内 `QQ.exe` 与 `versions/<version>/resources/app/napcat/napcat.mjs`，不再向根 `NapCatWinBootMain.exe` 传旧式 `QQ.exe + NapCatWinBootHook.dll` 参数，也不在包根生成 `loadNapCat.js`。如果配置了 `external_dependency.qq_path`，或包目录本身就是旧 `resources/app/napcat` app-dir，扩展才使用 app-dir 内的 `NapCatWinBootMain.exe`、`NapCatWinBootHook.dll`、`qqnt.json` 与 `loadNapCat.js` 走外部 QQ 注入路径。工作目录落在 `data/state/extensions/lociere.napcat-adapter/napcat/`，第三方程序包落在 `data/packages/managed-resources/lociere.napcat-adapter/napcat/`。扩展不默认通过 `launcher.bat` 打开用户不可管理的终端窗口；如必须使用官方 bat 或自定义命令，需在 `external_dependency.launch_mode` 显式切换为 `official_shell` 或 `custom`。bootstrap 进程退出码 0 只表示启动命令发出，不表示 NapCat 已注入、WebUI 已监听或 OneBot 已连接；projection 必须保持 `starting/detached`，直到 WebUI 或 OneBot readiness 成功，超时后进入 degraded/failed 并给出恢复动作。direct 启动只阻止将被启动或注入的目标 `QQ.exe` 冲突：OneKey 默认只检查包内 `QQ.exe`，外部 QQ 注入则按 `external_dependency.qq_path`、NapCat 包内置 `QQ.exe`、系统 QQ 注册表路径的顺序选择目标并检查该目标，避免把无法注入的既有 QQ 会话伪装为扩展受管资源，同时不影响用户日常使用的其他 QQ 实例。

## MCP Provider 链路

```text
configs/system/skills.yaml
  -> mcp-server provider config
  -> MCP initialize
  -> enumerate tools/resources/prompts
  -> SkillRegistry catalog
  -> Gateway call
  -> normalized result / error
```

MCP server 是外部能力来源，默认不可信。`McpServerSkillProvider` 会把连接状态同步为 `SkillCatalogSnapshot.providerRuntimes` 中的 `mcp_server` provider runtime：`connecting` 只表示正在握手，`ready` 表示能力目录已枚举并注册进 Skill Registry，`unavailable` 表示连接失败或能力刷新失败。当前它还会通过 `mcp-server-runtime-readiness.ts` 把这些 provider runtime 折叠成 `RuntimeReadinessSnapshot[]`：`mcp.host` 表达整个 MCP capability plane，`mcp.<server-id>` 表达逐 server desired/actual/readiness，且在连接状态变化时持续刷新 `RuntimeReadinessCatalogStore`。断连、initialize 失败、枚举失败、调用超时、工具返回非法结果都要有 trace、provider id、server id 和错误 code。

## 调试入口

| 症状 | 先查 |
|---|---|
| 扩展未加载 | manifest、activation、requires、ExtensionManager log |
| skill 不出现在 catalog | provider lifecycle、registry snapshot、权限声明 |
| 调用被拒绝 | Policy decision、permissions、confirmation 状态 |
| handler 执行但结果异常 | InvocationGateway、normalized result、provider log |
| MCP 断连 | connection、initialize、catalog refresh、process cleanup |
| 停用后还能调用 | disposable、catalog 撤销、旧 handler 引用 |

## 验证

```powershell
pnpm --filter @glimmer-cradle/extension-sdk typecheck
pnpm --filter @glimmer-cradle/kernel typecheck
pnpm typecheck
```

Extension/Skill Plane 改动还要覆盖：注册、拒权、确认缺失、调用成功、调用失败、断连、停用、升级、dispose、旧 handler 不可复用。

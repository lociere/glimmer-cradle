# Extension 与 Skill Plane 实现

感知媒体的真实入站为 Extension Host IPC `asset.begin/write/abort` 与 `perception.inject`。Kernel 每次检查 `PERCEPTION_WRITE`，暂存 token 绑定扩展且只可消费一次；Host 等待 Cognition 感知操作结果，持久资产由 Kernel 单写者提交。旧 URI-only `items` 仍是阶段 9/14 删除门约束的读取兼容。准确字段见 [SDK Reference](../../reference/extension-sdk.md) 与 [ADR-0020](../decisions/ADR-0020-Content资产单写者与恢复边界.md)。

> 范围：Extension SDK、Extension Host、Capabilities 三类定义、接入映射、Policy、Invocation Gateway、Core/Extension/MCP/User Provider 如何接线；不写 SDK 字段全表。
> 源码依据：`packages/extension-sdk/src/`、`templates/extension-basic/`、独立 `glimmer-cradle-extensions` 仓库、`data/packages/extensions/<extension-id>/<version>/`、`core/kernel/src/application/skill-plane/`、`core/kernel/src/adapters/{extension-host,skill-plane}/`、`core/kernel/src/ports/{extension-host,skill-plane,application-capabilities}.port.ts`、`configs/system/skills.yaml`、`configs/extensions/`。
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
| `packages/extension-sdk/src/contracts/` | Extension Host public projection 与产品/Kernel edge types |
| `contracts/proto/glimmer/extension/v1/extension_host_process.proto` | Extension Host 进程监督 Service IDL |
| `contracts/json-schema/extension/v1/extension-host-process.schema.json` | Extension Host process stage 与 IPC 文档契约 |
| `core/kernel/src/adapters/extension-host/extension-manager.ts` | Kernel ExtensionManager |
| `core/kernel/src/adapters/extension-host/extension-process-host.ts` | Kernel 侧 Host process 监督、权限和 Port RPC |
| `hosts/extension-host/src/main.ts` | 扩展入口唯一加载点与 SDK Context bridge |
| `packages/extension-sdk/src/host/process-protocol.ts` | Kernel supervision / Host process 的 Node IPC transport mapping，stage 对齐 Contract Spine generated enum |
| `hosts/extension-host/src/process-protocol.ts` | 只 re-export SDK-owned process protocol，不维护第二份 channel/method/stage 定义 |
| `core/kernel/src/adapters/extension-host/extension-runtime-readiness.ts` | 把 Host `ExtensionRuntimeProjection` 归一成 lifecycle `RuntimeReadinessSnapshot.reconciler` |
| `core/kernel/src/adapters/extension-host/extension-dependency-installer.ts` | Extension 外部依赖准备、下载缓存和解压安装 |
| `core/kernel/src/adapters/extension-host/managed-resource-supervisor.ts` | Extension 受管资源 readiness gate 检查，并产出 Capability Graph 节点 |
| `core/kernel/src/adapters/extension-host/extension-host-application-adapter.ts` | Extension Host 到 Application capability Ports 的适配器 |
| `core/kernel/src/adapters/extension-host/extension-runtime-registry.ts` | Host-owned Contribution Point Registry 到 Capability Graph projection 的转换器 |

Extension 只能通过 SDK/Port 协作，不能 import Kernel 内部路径。当前每个激活扩展运行在受 Kernel 直接监督的 `hosts/extension-host` 独立 Node 子进程；Kernel 不 `require()` 扩展入口，只读取 manifest 和原始自有配置。Host process 内完成 config schema 校验和 `onActivate()`，所有 storage、event、command、agent、attention、perception、evidence 与运行投影调用都通过进程 RPC 回到 Kernel 权限边界。`contracts/proto/glimmer/extension/v1/extension_host_process.proto` 拥有 lifecycle service/stage；SDK process protocol 唯一维护当前 Node IPC transport mapping，并用 drift test 对齐 generated stage。Kernel 负责 manifest、权限、激活、停止、释放、超时、重启/失败投影和进程树错误隔离；Host process 负责第三方 module loader、handler registry、订阅/timer/disposable lifecycle 和扩展上下文。

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
- `startExtension()` fork `hosts/extension-host` 并等待 process ready，再把 Kernel 已按产品、平台和 feature 解析的通用 `activationProfile` 标识传入 `ExtensionContext`，由 Host 内加载扩展、校验配置和激活；普通配置只有在 `CONFIG_READ_SELF` 获批时注入，`configs/secrets/extensions/<id>.yaml` 的当前扩展字符串 Secret 只有在 `SECRET_READ_SELF` 获批后才能经 `ctx.ports.secrets.get(key)` 按需读取。Kernel/Host 不解释第三方 profile 名称、Secret key 或配置字段，`ctx.ports.agents.registerSubAgent(...)` 等同步注册必须全部由 Kernel 确认后激活才算成功；
- 激活失败会释放激活过程中注册的订阅/handler，并撤销声明式目录项，然后发布 `ExtensionErrorEvent`；
- `stopExtension()` 无论扩展是否成功运行，都会释放 activation subscriptions 和声明式目录项；重启时重新注册声明式目录，避免复用旧 handler 或旧 catalog。

Control Center 通过桌面桥向 Kernel 发送扩展生命周期请求；Kernel 只暴露 `loadExtension`、`startExtension`、`stopExtension` 的受控入口，不允许 Electron renderer 直接触碰扩展进程或 Host 内部对象。运行投影契约是 `ExtensionRuntimeProjection`：Host 通过 `ExtensionRuntimeRegistry` 聚合 manifest 身份字段、lifecycle、contribution point definitions、带 `audience` 的 Capability Graph、带 `audience` 的 action intents 和 diagnostics 后推送给 Desktop，Renderer 只消费该投影。

`ExtensionManager` 只从 `data/packages/extensions/<id>/<version>/` 发现已安装 manifest，并由 `configs/extensions/active.yaml` 的 `{ id, version, profile }` 精确选择启动版本与 activation profile；不存在目录覆盖式升级或单一 package 兼容入口。Kernel 先以所选 profile 的增量权限和 `requirements.profiles` 裁剪 manifest，再准备资源、注册 contribution 和启动隔离 Host，避免跨产品扩展把某个平台 profile 的权限扩散给其他产品。Package Manager 另行发布 `ExtensionInstallationProjection`，表达已安装版本集合、当前激活版本与 profile；Extension Host 发布 `ExtensionRuntimeProjection`，只表达当前选择版本的运行事实。安装新版本不会隐式替换旧版本，控制表面通过带目标 `version` 的 lifecycle request 显式切换。在 `init()` 时注册 discovered 投影，在 `loadExtension()` 时升级 manifest/运行投影，在 `startExtension()`、`stopExtension()` 和激活失败时更新 lifecycle；`ControlSurfaceGateway` 支持 `extension_runtime_projection_request` 并广播 `extension_runtime_projection_changed`。产品表面直接消费两类权威投影，不扫描扩展源码仓库，也不读取扩展 storage 或运行日志来还原事实。extension runtime module 会经 `adapters/extension-host/extension-runtime-readiness.ts` 把这些运行投影折叠成 `RuntimeReadinessSnapshot[]`；后续扩展启停和失败经 `RuntimeProjectionInputPort` 覆写 Application-owned projection mapper 中对应模块的 snapshots。

Personal Server 的浏览器本地 `.gcex` 不把服务器路径暴露成公共协议。`src/server/bootstrap/personal-server-app.ts` 只接受认证后的 `.gcex` 字节流上传到 Product Host owned 临时目录，返回绑定当前 principal/session、30 分钟时效和单次消费的 opaque `upload_id`。`src/server/websocket/surface-proxy.ts` 会记录每个 `extension_install_prepare` 的授权上下文：`uploaded_package` 先在当前会话内解析为受控 file source，再转发给 Kernel；任何 ready preview 返回的 `transaction_id` 都会绑定到当前 principal/session，因此 commit/cancel 对仓库、Registry、Manifest 和本地上传四类来源都执行同一授权规则。权限确认通过后，Kernel 把 commit 视为终结尝试：重新校验失败、目标冲突、解包失败、落位失败或元数据失败都会清理事务缓存与 staging，并在已经移动目录时回滚目标版本。Host 断线时先向 Kernel cancel 本连接所有已预览未提交事务，再释放本地上传索引；若 Product Host 已失去上游连接，则由 Kernel `ExtensionPackageManager` 的启动/定时 sweep 清理 stale transaction 目录，不依赖浏览器或 Product Host 的偶然恢复。

Desktop main 只保留精确激活版本与扩展配置 YAML 的受控编辑入口，不承担扩展身份发现或运行事实拼装。依赖健康、能力可用性、动作 enablement 和诊断均来自 Host runtime projection 的 Capability Graph。`ManagedResourceSupervisor` 会在扩展加载和启动时检查第三方 package 是否存在，并执行 `readinessGates` 生成 graph node 状态；NapCat 通过 `runtime` Port 上报 process、OneBot、WebUI 和 capability graph 节点。Control Center 扩展页按 projection 通用渲染 Contribution Points、Capability Graph Nodes、Graph Edges、Action Intents 和 Diagnostics，不硬编码 NapCat 面板。`contributes.glimmer.setting` 会经 Capability Graph 派生为通用配置表单字段；renderer 只通过 `saveExtensionConfig()` 保存 YAML 草稿，不直接读写扩展配置文件。

## Skill Plane 代码结构

```text
core/kernel/src/application/skill-plane/
├── skill-policy-engine.ts
├── skill-invocation-gateway.ts
└── providers/
    ├── core/
    └── user/

core/kernel/src/ports/skill-plane.port.ts
core/kernel/src/adapters/skill-plane/
├── capability-catalog-adapter.ts
├── extension/
└── mcp-server/
```

| 组件 | 职责 |
|---|---|
| Core ToolRegistry / SkillCatalog / ResourceRegistry | 分别拥有动作、方法知识、可读资源的不可变定义、owner/revision/readiness 与撤销；没有万能集合或 Skill→Tool 父子关系 |
| CapabilityCatalogAdapter | 映射现行 SDK 分组与 handler/reader，投影旧界面目录，不成为三类定义的第二事实源 |
| Policy Engine | 当前判断契约就绪、风险与确认需求；完整 permission/broker 不在此切片中 |
| Invocation Gateway | 唯一执行入口，统一 audience/scope/requirements/Policy、timeout、trace、audit 与错误归一化 |
| Core Provider | Kernel 内置基础能力 |
| Extension Provider | Extension manifest/handler 暴露的能力 |
| MCP Provider | stdio/http/ws MCP server 的工具、资源和 prompt |
| User Provider | 用户安装的 SKILL.md 指令技能 |

Catalog 不等于授权，Policy 通过不等于执行，执行必须经过 Gateway。

scope 规则的唯一领域 owner 已迁入 `core/capabilities/src/exposure/exposure-policy.ts`，公开入口为
`@glimmer-cradle/capabilities`。Kernel 接入映射的 global 缺省、规划过滤和 Gateway 的调用前
scope 校验都直接消费它；旧 `application/skill-plane/scope.ts` 已删除，内部 Port 只引用 Core
类型，不复制规则。Core 只接收 source provider/scene/conversation 身份，未引入 Conversation
concrete、SDK 或 wire。缺上下文/空限定范围/未知 kind 失败关闭，不把未知 kind 猜为 conversation。
扩展 `$self` 解析仍由接入层 `availability.ts` 的 `SkillPlanePolicy` 完成，不属于 Core 授权。
三类定义实际位于 Core `tools/`、`skills/`、`resources/`：Tool 只保存 executor 引用；Resource
只保存 reader 引用；Skill 保存 inline 方法正文或参数化 reader 引用，动态 prompt description
不冒充正文。各集合分别校验 JSON 数据、保护 owner/revision 并深冻结快照；这不是新的跨进程
Schema 源。现行 SDK/wire 的 `SkillDescriptor` 仍是旧分组投影，`totalSkills` 不等于 Core 方法数量。
`CapabilityCatalogAdapter` 在注册前验证整组，失败保留旧快照；分组/目标内部引用用无歧义元组，
既有公开 ID、journal capability ID 与摘要算法不重算。原地修改、handler 替换或独立 Core 撤销
会使绑定失效。规划直接读取 ToolRegistry 的有效 ready 定义；连接降级不继续暴露/调用旧 handler。
应用只依赖 `CapabilityCatalogPort`，具体 adapter 只由 composition 注入；旧 SkillRegistry owner
已经删除。接入映射随阶段 12 移到 App，旧 SDK 分组在阶段 9/11/12 原生消费者归零后删除。
User Provider 已以 inline 方法接入独立 SkillCatalog，删除 `instructions.read` 假 Tool；现行两次
Plan 分别消费方法目录与正文。原生 Step Exposure 已接默认聊天的 typed client/模型 Loop，
方法正文与 Resource 内容已由通用加载操作接入原生 Loop；完整权限/持久预算 broker 仍未完成。

`core/capabilities/src/exposure/{step-surface,exposure-controller}.ts` 分别投影 Tool、Skill 摘要、Resource，
没有正文或 handler。显式授权事实必须匹配主体、可选平台用户、定义 ID/revision、实际目标位置和协议；
再与定义 audience、ready、多 scope 交集及数量/UTF-8 字节预算共同过滤，缺少事实不曝光。
Core 增加 user scope，公开 SDK/Document 尚未迁移该 scope，不把外部 Actor 推断为平台 User。
现行 App 没有权威平台用户解析，拒绝带 user_id 的 Step，不能把 Worker 自报字段变为授权事实。

当前 `NativeCapabilityAppService` 位于 Kernel Application，由生产 composition 注入真实 catalog、
Policy 与持久 Gateway，实际位置由 App 固定。授权事实暂从现行 App Policy/来源事实映射，
permission revision 暂绑定定义 revision，不等于完整 Host 粒度权限 broker。服务保存至多 128 个
短寿命 Step，预算只限制当次已保存 Step，不是持久 Run 配额或 Platform authority。调用复验当次
与当前曝光、scope、精确定义引用和幂等身份，撤销/换代/替换后不拿旧名称重绑；重复调用进入
原 journal，不重复副作用。Gateway 确认后仍复验注册、策略与定义。
`ReadSkill` / `ReadResource` 需要 `capability-read.v1` 支持，分别匹配独立当次/当前曝光与 reader
参数 Schema，不将加载控制函数注册成业务 Tool。加载 ACTION 先刷盘，共用 Step 调用预算；
Gateway 委托同一持久执行 owner，读结果携实际方法正文或有界资源内容/内容 hash，失败与
unknown 沿原恢复纪律。文本/规范 JSON 是当前资源边界，binary/realtime/订阅尚未实现。
MCP 接入 adapter 将 prompt text 转为方法材料、resource text 转为保留 URI/media 的中性数据，
不把 supplier DTO 或 description 冒充正文；reader signal/SDK deadline 到达实际请求，不只取消
等待者。非文本 prompt/binary resource 明确不支持；实际派发后异常仍保留未知结果，不自动重试。
已提交的确认拒绝投影为已知 failed 结果，不伪造成功；派发后未知仍通过 typed recovery error
要求可信对账，不能当 failed 重跑。协议和 Worker 接纳链见
[Contract Spine 实现](Protocol契约层实现.md)及[Cognition 实现](Cognition认知核实现.md#唯一认知循环)。
普通聊天已切原生模型/Tool 续接，短程 ActionPlan 及非原生 Loop 入口已删除；
明确 Plan/Synthesis 请求仍有兼容编排消费者，按 consumer-zero 收束，不恢复为聊天旁路。
App owner、旧 SDK 分组在阶段 9/11/12 consumer-zero 后迁移/删除。

User 来源整体 degraded 保留坏文件诊断；成功逐文件加载的静态方法由接入事实
`ready_inline_method_groups` 明确记录并冻结，仍可通过定义/scope/revision 复验。该标记不
放宽动态 MCP 来源、Tool 或 reader readiness；来源停止、缺少加载事实或方法撤销仍失败关闭。
新包已接根 test/typecheck/build 与 Kernel workspace 依赖；Kernel 的 with-deps 命令按真实依赖
闭包构建。Personal Server Docker 安装前显式复制其 Core manifest，构建先于 Kernel；临时
`pnpm deploy` 已验证新包从部署树自身解析，不回查源码仓库，真实 OCI/完整安装验收仍待执行。

持久 Execution 已由 `core/capabilities` 唯一拥有，生产 `kernel-application.ts` 通过 resolver
打开 `state/capabilities/execution.sqlite` 并向 Tool Gateway 注入真实 journal/controller。Core
ExecutorPort 由 Gateway 映射当前注册、策略、确认和 handler，不导入 Kernel/SDK/generated。
prepared → authorized → dispatched 的每次转换在 SQLite IMMEDIATE 事务中使用 revision、
request digest、owner/attempt CAS；第二连接打开不接管活跃派发。不同参数/目标/定义/身份的同一
invocation 或 scope/key 冲突失败关闭。输入只持久保存摘要，传给确认与接收方的是不可变 JSON 快照。

确认后、派发前同步检查原注册、handler、定义摘要、scope 与策略；卸载/替换/变更则不调用 handler。
授权与确认拒绝、撤销为未派发 failed/attempt=0。handler 返回时保存原结果；handler throw、
断线或结果提交失败均不得猜测“未应用”，即使声明 `sideEffects=[]` 也需要恢复。异常能落盘时
记 unknown；进程崩溃或事务失败留下 dispatched/side_effects=unknown，重开同样要求恢复，
不标失败也不自动派发。取消后接收方能实际确认成功时仍提交成功，不擦除已知事实。

结果与 outbox 同事务提交；日志/audit 不拥有执行事实，诊断故障不改写结果。schema 2 将
Conversation ID/原 Action fact ID 纳入不可变请求摘要；旧 schema 1 不隐式升级，无原引用的历史
结果不能猜测路由。Gateway 提交后立即尝试经独立 Conversation Service 投递，App 在 Worker ready
后启动每批最多 10 个、批次结束 1 秒后再调度的重投链；单次实际 RPC deadline 为 5 秒。
只发布 journal 已提交且内容完全一致的事件，不重跑 handler。实际接纳与刷盘完成才 ACK；断线、
取消、错误 receipt 或未 ready 保留 outbox，跨 Worker 新 generation 重投仍用原 identity。
pending 路由结果如实投影非 blocking degraded；无交互引用的 outbox 保留且不阻塞可路由结果。
Store 的 receipt API 绑定 event ID、invocation ID/revision 与真实 accepted 接纳；重复 receipt 幂等。
Conversation 接纳/合成规则见[Conversation 实现](Conversation实现.md#history-与恢复)。Controller instance owner 不是
Platform authority，未实施外部 fencing/证据对账或自动接管；人工恢复必须待可信接收方证据，
不得删库或换 invocation ID 重跑。备份约束见[数据布局](../../reference/data-layout.md)。

停机关闭 ingress 后停止结果计时器、Tool 接纳并取消/等待实际 handler 与结果 RPC，Worker 仍 ready
时完成最后一个有界投递批次；再停止 Worker、卸载 provider、关闭 journal。启动失败的 Application
也排空计时器/调用再释放资源；没有把 cancellation 等同进程已停止。装配失败逆序关闭已打开的库。Core tests 使用
真实 SQLite 重开、双连接、事务故障；Gateway tests 验证真实撤销与稳定 ID 重放。仅 fixture
可不注入 controller；生产组装始终注入，旧无 journal 分支在三 Registry/入口切换后 consumer-zero
删除。resource 内容 revision/Knowledge ingest、完整 Step Exposure、native broker 与完整行动恢复
仍待完成。目标与证据见[执行记录](../../roadmap/architecture-v2-refactor.md)。

Gateway 当前实现位于 `skill-invocation-gateway.ts`。它对 tool/resource/prompt 统一执行：

1. 解析 `traceId`、当前 ALS trace 或新 trace；
2. 校验 skill 与目标 tool/resource/prompt 都是 `character` audience，并按当前 `ConversationContext` 重新校验 global/source provider/scene/conversation scope；
3. 校验 Product Composition、平台和 feature requirements，再按 skill policy 或目标级 policy 调用 `SkillPolicyEngine`；
4. 若 policy 要求确认，先调用确认通道；无确认通道或用户拒绝时写 `policy_denied`；
5. 成功时调用 handler，并记录结果类型与耗时；
6. 策略拒绝记录拒绝；持久 Tool 的 handler 抛错记录 unknown/恢复，legacy resource/prompt 仍保留错误语义；
7. 写入 `skill.invocation.count` 与 `skill.invocation.duration_ms` metrics，默认 audit sink 写结构化运行日志。

成功审计受 `policy.audit` 控制；拒绝和失败不受该开关关闭。

Core Skill Provider 通过 `CorePlatformBridge` 注入真实 handler，覆盖桌面 URL/本地文件打开、通知、剪贴板、屏幕截图、前台窗口信息和用户确认。Desktop bridge 由 `ControlSurfaceGateway` 通过 typed `SurfaceGatewayService` stream 向 Electron main 发送 `core_skill_action_request` 或 `core_skill_confirmation_request`，并用 typed Command response 返回结果；实际可调用性仍受 Product Composition、平台、连接和策略约束。截图返回 PNG 文件路径与尺寸，不代表模型已经理解图像；前台窗口读取目前仅支持 Windows。文件打开使用系统默认程序，确认详情显示完整目标路径并提示可能启动程序。

确认请求只路由到具有 `surface:write` 的连接，回执绑定接收请求的 session 和响应类型；只读就绪观察连接不处理动作。Electron 使用原生确认框，Personal Server 使用应用级确认对话框，均显示可选 `title`/`detail`。浏览器默认聚焦拒绝，关闭、超时或断线撤销请求；用户拒绝、缺少控制表面和执行失败均保留 Gateway 审计。

User Provider 由 IO adapter `UserSkillSource` 从包数据目录加载 SKILL.md，元数据遵循 canonical `user-skill-metadata.schema.json`，安装格式见[配置参考](../../reference/configuration.md#用户指令技能)。有效技能在接入边缘映射为 inline Core 方法，贡献零 Tool；旧 SDK/UI 分组暂以 prompt 条目承载，不代表新的公开方法契约。第一轮 Plan 只看方法目录并返回定义引用，应用复验当前 revision、来源 readiness、scope 和绑定后，最多加载两份、合计 64 KiB UTF-8 正文，通过独立材料字段再次规划；两次规划保持原用户目标，不经 Gateway 或 Execution journal。返回后再次复验正文撤销，并过滤不在当次及当前 Tool 目录中的建议。指令及 `allowed-tools` 不授予权限，不作为执行结果或 Memory 事实，引用文件和脚本不会自动执行。动态 reader 和需确认的旧方法不进入直接正文入口，仍保留其受控 Gateway。禁用时不读取目录，坏文件单独降级，停止时撤销方法与旧引用。

MCP 连接失败或断开时撤销旧能力目录，以 1 秒起、最多 30 秒的退避重连；成功连接后重置退避。停止 Provider 会取消重试，迟到的旧连接回调不能重建目录。

扩展首次安装成功后自动尝试激活。激活失败保留安装包并呈现降级原因，用户修正配置、凭据或依赖后需在扩展详情重新激活；重启服务不会自动恢复失败的首次激活。已有扩展的升级与重复安装不自动改变既有激活选择。

`SkillPlanningAppService` 位于 Kernel application 层，通过消费方 Catalog Port 读取独立 Core ToolRegistry 中 character audience、ready 且 scope 匹配当前 ConversationContext 的工具，转成 `AgentPlanRequest.available_tools`，经 `AIProxy.requestAgentPlan()` 请求 Cognition 规划；方法目录/正文使用独立字段。返回后再次按当次及当前 Tool 目录过滤建议。`executeSuggestion()` 将同一 ConversationContext 传给 `SkillInvocationGateway`，不直接执行 provider handler。这样 planner 看不到跨来源能力，伪造建议也会在执行层再次被拒绝。

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

反向 action 的 operation id 会派生每个工具步骤的稳定 invocation id，并一路传到 Core Platform
Bridge 与 Desktop 实际副作用 owner。Controller 只复用已 committed 的步骤结果；合成等待期的
deadline/cancel 会取消 gRPC 且原样上抛，不发布 fallback。若不可逆 provider 在取消点无法证明
是否提交，Desktop response 固定携带 `error_code=recovery_required`、稳定 `operation_id` 与
`recovery_actions=[confirm_side_effect_state]`；`ControlSurfaceGateway` 将其映射为应用层
`RecoveryRequiredError`，Controller 记录后让同 operation 的重试直接拒绝，不再自动调用 handler。
后续 Kernel Service Adapter 再映射到 canonical Protobuf code/action，Application 不 import generated DTO。

Control Center 的能力目录通过 Desktop bridge 的 `skill_catalog_request` 读取同一个 `SkillCatalogAppService.getCatalogSnapshot()`，Electron main 只转发受控快照，不在 Desktop 进程中 import Kernel service 或重新构造注册表。`SkillCatalogSnapshot` 现在除了人物可用 skill 条目，还会带 `providerRuntimes`：Kernel 统一投影 core / extension / MCP / user provider 的运行态、契约-only、连接失败和恢复动作，Desktop 能力页只消费这份投影，不探测本地 MCP 端点。Extension 运行态不再停留在 `ExtensionRuntimeProjection` 支线里；`ExtensionHostAppService` 会把 Host 侧 manifest/lifecycle/capability graph/diagnostics 同步映射成 `provider.kind=extension` 的 provider runtime，因此即使一个扩展暂时没有人物可用 skill，Control Center 也能在同一能力目录里看到它是 `contract_only`、`connecting`、`ready`、`degraded` 还是 `unavailable`。Skill Plane 不消失，但收敛为 Host-Owned Capability Plane 上的人物可用调用层：`glimmer.skill` 是内建 contribution point，只有 character audience 的 skill/tool/resource/prompt 进入人物 Skill catalog；管理动作从 `ExtensionRuntimeProjection.actions` 的 user audience action intent 触发，不能混入 `SkillPlanningAppService.available_tools`。

## 目标 Host Resource 授权与读取

`apps/host/src/broker/permission-broker.ts` 拥有本实例可撤销授权；Platform security 仅定义
不可变 Principal/PermissionRequest/PermissionGrant。授权绑定 Host 登记的主体、generation、
permission、资源定义 revision、目标位置和过期时间；授权 revision 独立于定义 revision。
缺省拒绝，副本/模型参数/manifest 不成为 grant。墙钟回拨不复活过期 grant；新增授权的审计
失败则不登记，撤销先失效再报告审计错误。授权不持久化，Host 重启必须重新显式授权。

`composition/extension-contributions.ts` 的 `HostResourceContributions` 接收真实 reader 和独立
ResourceRegistry；正文不进入目录。WorkerSupervisor 通过既有 FD3 HMAC 注册本代主体，关闭
ingress 或切代即撤销，再关闭 client/Worker。CapabilityService 只开放本代 ready 主体的
ExposeStep/ReadResource；InvokeTool/ReadSkill 尚未接入而返回 NOT_READY。客户端入口统一为
`createCognitionClient()`，不保留仅表示 Jobs 的旧命名壳。

每个 Step 捕获原授权，晚授予不能扩张旧 Step；scope、readiness、协议 feature、目录字节/
调用预算及当前定义由 Core Exposure 再过滤。Host 尚未接 user resolver，拒绝自报 userId。
读取前复验当前 grant/注册/定义；参数经实际 Resource schema 验证并冻结。请求使用稳定
`run_id:call_id`，持久 Execution target 是 `resource:<definition_id>`，正文 reference 保持原
定义 ID/revision。成功内容具有 Core 生成的内容 hash/revision 和 32 KiB 限制。

读取结果与 outbox 按既有 Core journal 同事务保存，CognitionClient 将事件映射到独立
ConversationService.AcceptExecutionResult；验证 event/invocation/revision/Moment/position 的
真实 receipt 后才 ACK，再复验权限后返回材料。接纳响应丢失只重投同一事实，不重复 reader；
派发异常保持 unknown/recovery_required，不自动重读。等待中撤权、定义替换、generation
失效或取消时，已知执行仍可留 journal，但迟到正文不返回当前模型。stop 取消并 drain 后
停止 controller/outbox、撤销所有主体、解除监听；审计错误不能中断后续安全清理。journal
由调用方注入并拥有，须在 stop 完成后关闭，不与 Kernel 同时打开同一执行库。

生产 Python Worker、实际 typed RPC/local HTTP SSE 和 SQLite Conversation Log 已覆盖授权
读取→原 Action 引用→刷盘 result receipt→模型续接→Reply 因果链，以及读取中撤权时不续接。
该链不是完整 SDK IO 沙箱、持久用户权限 UI、跨重启 outbox 驱动或持久 Run/budget；Tool/Skill
迁移、完整 Resource freshness/Knowledge 生命周期及默认产品 Host 启动仍未完成。旧 Kernel owner
待相应 consumer-zero/产品切换门后删除，不以新增 Host 模块冒充完整替代。

## Knowledge 显式资源采集边界

同一 HostResourceContributions 的 `registerKnowledgeAccess` 只接纳 Host IO 政策：主体、source_id、
定义引用、固定 schema-valid 参数、明确 global 或精确 provider/scene/conversation scope 和最大采集年龄。
它不拥有 Cognition 的 Knowledge 正文、来源修订或索引，不是第二份 Knowledge source store。
缺省没有接纳项；参数、模型加载、manifest 和单独 resource.read grant 都不能触发采集。
global 只允许 Host 显式接纳且无 context 时仍可见的资源；wire scope 缺省表示该 global
接纳，不伪造 Conversation。部分/空 context 拒绝，private 来源不能删 scope 升为 global。
实际采集需同时拥有 resource.read/knowledge.ingest，当前定义 character/ready/scope 可见。

WorkerSupervisor 开放唯一生成的 CollectKnowledgeResource/ValidateKnowledgeResource；Host
从本代受监督身份推导 principal。采集没有模型 Step 或原 Action，因此不伪造 Execution/
Conversation result，也不作为模型工具暴露。真实 reader 的实际文本/JSON 经 Core 生成 hash，
仍受 32 KiB 限制。Host 只缓存采集证明和 hash、不缓存正文；证明绑定原来源、定义、reader、
双 grant、主体/世代和精确 scope。期限取两个 grant 和 Host 最大采集年龄的最小值；墙钟回拨
不复活旧证明。返回前再验证；较早并发读取迟到不能覆盖较新采集。重采集撤销旧证明。

grant/主体/来源/资源撤销和定义替换取消在途采集、删除证明；reader 忽略取消时迟到正文仍不
返回。stop drain 后解除监听/清空证明，store 仍由调用方拥有。外部资源内容变更通过
`invalidateResourceContent(resourceId, ownerId)` 独立失效，不强迫改写目录定义 revision；
错误 owner 无权失效，正确通知取消等待并撤销旧证明，后续重新采集产生新证明/hash。
定义替换仍按注册 revision 失效；TTL 是有限采集年龄，不冒充供应商主动更新订阅。
同一 graph 的 `onResourceChanged` 在取消读取/使旧证明失效后发布冻结的内容更新、定义更新、移除
或停止通知；通知只携定义引用、不携正文。重复登记同一定义/reader 保留绑定身份且不发通知。
订阅上限 128，可解除；一个观察者失败仍通知其他观察者，再向调用方报告聚合错误，失效不回滚。
RPC 复验比对完整证明 identity/revision/time、内容 hash 和作用域，不接受仅凭 id 或时间戳
自报授权。未知、过期、被撤销证明为 current=false；不自动恢复或提升权限。
实际 media_type 也绑定证明，不能在复验后自报另一 parser 输入类型。单来源最多两次在途采集，
总 active 上限 128；超限拒绝，不递增 attempt 或再读取，避免非合作 reader 导致无界资源积累。

Python `adapters/resource_client.py` 的 ResourceClient 实际实现 Core ResourcePort.read/is_current，
由 KernelGrpcClient 补本代 metadata、唯一 generated DTO mapper 调上述 RPC；Body/hash、主体、
来源、时间与返回 presence 均验证。ResourceScope/ResourceAccess 属于 Core consumer Port，
不 import generated/供应商 SDK。普通 Step 的 decoder 仍返回 access=None，不能作为知识
采集证明。真实 Host/已注册生产 Worker 的测试 generation、实际 Python Adapter/transport
与 gRPC 已验证读取和复验；测试额外 channel 只附加本代，不重新伪造 FD3 注册。

Worker composition 已向 KnowledgeIndex 注入 ResourceClient 与本代主体。显式来源登记、
文本/JSON 持久采集、修订与派生索引失效、scope/live 过滤和原生 Step/Reply 复验门见唯一
[Knowledge 实现](Cognition认知核实现.md#knowledge-来源与持久化)。真实 Host/生产 Worker/SQLite/SSE
已验证知识正文进入模型，保存权限撤销后不再续接或产生 Reply。Host 不写 Knowledge 库。
HostKnowledgeController 已通过 CognitionService 来源管理 RPC 接入真实持久 owner；唯一
HostConfig 审批驱动新世代重验与重新采集，来源修订/摘要/enabled 不符或到期拒绝，详细字段与
生命周期仍归上述 Knowledge 实现。controller 订阅本 graph 的内容更新，用单个 pump、每来源
一个最新 ticket 合并通知；在途采集被较新通知取消，迟到 receipt 不替换新状态。刷新前查询真实
来源，复验原接纳与双 grant，仍沿实际 CollectKnowledgeSource/SQL CAS 接纳链路，不重新批准、
补发 grant 或延长审批到期。定义替换、移除、停止或原权限失效直接撤销，不自动改写声明/审批。
失败撤销后投影稳定错误；清理审计失败单独标记 knowledge_refresh_cleanup_failed，不自动重试。
停止解除订阅，撤销并 drain 所有在途请求与 pump，再关闭 client。新的明确 App collect 可按仍匹配
且未到期的审批重建授权，不是内容通知的隐式恢复。Host 通知不是持久消息或供应商订阅；未发通知
的外部更新只能靠既有 TTL/live 复验拒绝旧材料。失效后的旧 Context 不因新采集成功而复活。
供应商主动订阅、权限 UI、持久采集调度和完整安装态迁移仍待落位；
不能自动保存 Tool/Step 结果、把数据提升成 Memory 或宣称完整 Knowledge 生命周期已交付。

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
  -> CapabilityCatalogAdapter -> Core ToolRegistry / ResourceRegistry / SkillCatalog
  -> Gateway call
  -> normalized result / error
```

MCP server 是外部能力来源，默认不可信。`adapters/skill-plane/mcp-server/McpServerSkillProvider` 会把连接状态同步为 `SkillCatalogSnapshot.providerRuntimes` 中的 `mcp_server` provider runtime：`connecting` 只表示正在握手，`ready` 表示能力目录已枚举并映射进独立三类 Core owner，`unavailable` 表示连接失败或能力刷新失败。它还会通过同目录的 `mcp-server-runtime-readiness.ts` 把这些 provider runtime 折叠成 `RuntimeReadinessSnapshot[]`：`mcp.host` 表达整个 MCP capability plane，`mcp.<server-id>` 表达逐 server desired/actual/readiness，且在连接状态变化时经 `RuntimeProjectionInputPort` 持续刷新唯一 Application projection store。断连、initialize 失败、枚举失败、调用超时、工具返回非法结果都要有 trace、provider id、server id 和错误 code。

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

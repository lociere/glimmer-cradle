# Protocol Reference

> 范围：跨语言、跨进程和公开 SDK 契约的权威规则，包括 Schema、生成物、事件、错误、Avatar frame 和变更流程。
> 事实依据：`protocol/src/schemas/`、`protocol/src/generated/`、`protocol/src/runtime/`、`protocol/codegen/`、`contracts/{proto,json-schema,compatibility,generated}/` 与当前 runtime 消费端。
> 维护触发：Schema、事件、IPC/WS frame、错误码、config schema、codegen、兼容策略或任一跨边界消费者变化。

## 目录

- [权威来源](#权威来源)
- [M12 Slice 1 Contracts Baseline](#m12-slice-1-contracts-baseline)
- [Accepted 目标与当前差距](#accepted-目标与当前差距)
- [消息与事件规则](#消息与事件规则)
- [关键契约族](#关键契约族)
- [变更顺序](#变更顺序)
- [验证](#验证)

## 权威来源

迁移期权威路由按 owner 分流：

- 对应 M12 迁移切片前，现有 runtime 已消费的跨语言/跨进程结构仍由 `protocol/src/schemas/` 拥有，使用 `pnpm sync:contracts`。
- 新 Contract Spine 跨进程可调用能力由 `contracts/proto/` 拥有；新文档型契约由 `contracts/json-schema/` 拥有，使用 `pnpm contracts:generate` / `pnpm contracts:verify`。
- Kernel↔Cognition runtime 已在 Slice 2 迁移；Surface Gateway 的 IDL 与 presentation projection 已在 Slice 7 迁移到 Contract Spine。Slice 8 候选已把 Kernel↔UnityAvatarHost runtime consumer 切到动态回环 `AvatarHostService.Connect` 双向 gRPC。这些契约只能由 `contracts/proto/glimmer/{common,kernel,cognition,avatar,surface}/v1/` 定义，不得恢复旧 Protocol 镜像。

现有 runtime Protocol 的生成投影和消费端包括：

| 目录 | 角色 |
|---|---|
| `protocol/src/schemas/models/` | 领域共享模型，如 perception、action、memory、avatar frame |
| `protocol/src/schemas/config/` | 配置结构的可校验契约 |
| `protocol/src/schemas/enums/` | 跨语言枚举，如 error、moment、metric |
| `protocol/src/generated/` | TypeScript 生成物，只读 |
| `engines/audio/src/glimmer_cradle/audio/generated/` | Audio legacy Python 生成物，只读；生成工具环境由 Audio owner 持有，Cognition legacy projection 已删除 |
| `contracts/generated/csharp/GlimmerCradle/avatar/v1/` | Avatar v1 C# projection，只读；Unity Host Adapter 消费 |
| `protocol/src/runtime/` | 运行时校验、normalizer 和回复/Avatar frame helper |

禁止手写镜像、修改生成物、让 UI view model 反向定义协议，或在某个消费者里维护“临时兼容字段”而不更新其实际 owner。

## M12 Contracts Baseline 与 Slice 2 Service

M12 Slice 1 已建立长期 `contracts/` baseline，Slice 2 已切换 Kernel↔Cognition runtime，Slice 5 已建立 Avatar control IDL/projection 与当前 transport edge mapping。当前查表规则如下：

| 路径 | 当前状态 | 规则 |
|---|---|---|
| `contracts/proto/` | canonical Protobuf Service | 包含 baseline `ContractProbeService`、`CognitionService` / `KernelControlService` v1、Slice 7 `SurfaceGatewayService` v1，以及 Slice 8 runtime consumer 已接入的 `AvatarHostService` v1。 |
| `contracts/json-schema/` | canonical JSON Schema Document baseline | 文档型契约目标位置；包含 Skill tool parameters 与 Slice 7 presentation frame projection envelope。 |
| `contracts/generated/` | Buf 生成的 TS/Python/C# DTO | 只读，只属于 Adapter/Transport 边缘；Kernel/Cognition Adapter 已消费对应生成物。 |
| `contracts/compatibility/` | 仓库内 Protobuf image 与 JSON Schema baseline | `buf breaking` 与项目 JSON Schema compatibility 不依赖 BSR。 |
| `contracts/inventory.md` | Slice 1 inventory | 冻结旧 `protocol/`、生成链、consumer、owner、迁移切片与删除条件。 |

迁移期必须按切片区分 owner：Kernel↔Cognition、Surface Gateway 与 Avatar control IDL/projection 由 `contracts/` 拥有；Slice 8 候选已把 Avatar runtime consumer 切到 `AvatarHostService.Connect`，其余尚未迁移运行结构仍由 `protocol/` 拥有。Slice 7 的 Desktop 与 Personal Server 只通过 `SurfaceGatewayService` 访问 Kernel；Personal Server 对浏览器保留受认证 WebSocket ingress，由 Product Host 代理到内部 gRPC Gateway。Cognition legacy Python projection 已在 Slice 4 删除，`protocol/codegen/gen-py.py` 仅保留 Audio consumer；Contract Spine DTO/stub 只能在对应 contract Adapter/transport 边缘消费。配置、Character Package、Extension manifest/package 和动态 Skill/tool 参数继续由 JSON Schema 拥有；Protobuf 只能引用 Document id、version 和 digest，不复制同一 Document 结构。

## Accepted 目标与当前差距

[ADR-0013：契约脊柱与跨进程服务架构](../architecture/decisions/ADR-0013-契约脊柱与跨进程服务架构.md) 已接受长期目标，[M12](../roadmap/milestones/M12-契约脊柱与跨进程服务架构重建.md) 已落地 Slice 1 与 Slice 2；其他 runtime 边界仍待后续切片：

| 当前事实 | Accepted 目标 |
|---|---|
| Kernel↔Cognition、Desktop/Personal Server↔Surface Gateway 与 Avatar runtime 已使用 Contract Spine；Audio 等其他运行结构仍在 `protocol/` | Slice 8 完成 Audio consumer 迁移；所有边界迁移后删除旧 `protocol/` |
| 尚未迁移的 JSON Schema 仍覆盖共享模型、配置与部分 SDK 投影 | Protobuf Service 拥有跨进程可调用能力；JSON Schema 只拥有文档契约 |
| Kernel ↔ Cognition、产品到 Kernel Surface 与 Avatar Host 已使用 gRPC；部分 Engine 仍使用 stdio | 核心器官默认 gRPC；Web/Desktop 只访问 Kernel Surface Gateway，浏览器入口保留产品自有认证 WebSocket |
| 多类消息通过 envelope、`kind/type` 和 payload 约定区分 | Command、Query、Event、Stream、Document 五类语义显式分离 |
| 大对象主要依赖资源引用、路径投影或现有帧约定 | control/data plane 分离，使用 typed reference、stream、Blob lease 或经验证的数据通道 |
| 兼容主要依赖 Schema 同步、类型/测试与旧字段搜索 | 增加 Buf breaking、JSON Schema compatibility、TS/Python/C# round-trip 和 Adapter contract test |

后续切片仍必须以各边界当前事实执行，不得创建手写 Protobuf/JSON Schema 镜像。Kernel↔Cognition 旧 ZMQ/envelope 主线已经过删除门，不得作为 fallback 恢复；全部切片迁移完成后再删除其余 `protocol/`。

## 消息与事件规则

- 消息必须有稳定 `kind`/`type` 或枚举，不依赖 class name。
- 跨边界 payload 只携带可 JSON 序列化数据，不携带函数、句柄、进程对象、DOM、Unity/Cubism 对象或 provider SDK 实例。
- 错误使用稳定 code、可读 message、必要上下文和 trace；不得泄露密钥、token 或完整用户隐私 payload。
- 高频帧保持紧凑；大对象使用资源引用、路径投影或分页读取。
- 所有入口延续 trace；若入口没有上游 trace，则由入口 owner 创建。

## 关键契约族

| 契约族 | 典型用途 | 变更关注点 |
|---|---|---|
| `CognitionService` / `KernelControlService` | Kernel 与 Cognition 的版本化请求、查询与回调 | deadline、cancellation、typed error、trace/causation/correlation、generation、幂等 |
| `ExtensionHostProcessService` | Extension Host lifecycle 的版本化 service/stage 契约；当前 Slice 6 Node IPC 仍由 SDK-owned compatibility shim 承载 channel/method wire | stage 必须对齐 generated enum；`packages/extension-sdk/src/host/process-protocol.ts` 是唯一 shim owner，`hosts/extension-host/src/process-protocol.ts` 只 re-export；后续 Host transport 完整迁移后删除 shim |
| `PerceptionEvent` / `ActionCommand` | 感知输入和行动语义 | 不暴露平台原始 payload；语义由 Cognition 解释 |
| `CognitiveActivitySnapshot` / emotion model | 认知资源调度、情绪和表现投影 | 调度与 Affect 分离，不让 renderer 反推人格状态 |
| `AvatarHostService` / `AvatarDownstreamFrame` / `AvatarUpstreamFrame` | Kernel↔UnityAvatarHost 二进制 gRPC control contract；`Connect` 是唯一 runtime consumer | `host_hello`、`host_ready`、`character_presentation_projection`、emotion、motion、presentation 区分；scalar presence 对齐必填语义；双方 Adapter 直接映射 generated DTO，并拒绝 unknown kind/enum、缺失/多重/错配 payload；`host_ready` 必须晚于 Avatar Package / composition surface / first frame / interaction ready |
| `ExtensionRuntimeProjection` | Extension Host 给 Desktop/Control Center 的运行投影 | Host 是唯一生产者；以 Contribution Point Registry、Capability Graph、Action Intent 和 Diagnostics 表达运行事实；Capability Graph node 与 action intent 必须带 `audience`；Renderer 不从 DB、日志、manifest 固定字段或端点还原扩展事实 |
| `ExtensionInstallationProjection` / Extension install lifecycle | Extension Package Manager 给控制表面的安装态与安装事务 | 安装态只表达已安装版本集合和当前激活版本；prepare/preview/commit 先校验来源、摘要、SBOM、平台与权限，再原子安装；指定版本激活不与运行投影混为同一事实 |
| `SkillCatalogSnapshot` | Kernel 给 Desktop/Control Center 的 Skill Plane 目录与 provider runtime 投影 | 只暴露 character audience skill/tool/resource/prompt；`providerRuntimes` 补充 core / extension / MCP / user provider 的连接、契约-only、降级与恢复动作 |
| config schemas | YAML/JSON 配置校验 | 默认值来源、normalizer、密钥边界 |
| enums/error codes | 跨语言错误和状态分类 | 稳定命名、禁止局部字符串分叉 |

`SubmitPerception` 返回的是受管 operation，不是“已处理”回执。Kernel 通过
`GetPerceptionOperation` 观察 `accepted -> running -> succeeded/cancelled/failed`，只在真实终态
清理 in-flight；`CancelPerception` 同时移除尚未竞争的队列/工作区输入，或取消正在执行的
Cycle/推理 task。队满、工作区拒绝或被更高优先级输入淘汰都必须写入 `failed`，不能留下永久
pending。重复提交先按稳定 `operation_id` 判定；同一 operation 绑定不同 trace，或同一 trace
改用不同 operation，均返回 `INVALID_REQUEST`，不能把冲突请求误判为幂等命中。

`PublishAction` 是 Cognition 到 Kernel 的反向终态调用。Kernel 持有 deadline 并把客户端取消或
deadline 传播为 `AbortSignal`，贯穿工具调用与 `Synthesize` gRPC；取消不是合成失败，不能发布
fallback reply。Skill Plane 从 action operation 派生稳定 invocation id，并以步骤账本记录工具与
reply 的 committed 状态：提交后的重试只恢复未完成步骤，不能重复副作用；终态不明的不可逆
provider 返回“需要人工恢复”，拒绝自动重放。响应只允许 `completed` 或 `duplicate`；transport
只有在 handler 正常完成或步骤账本确认副作用已提交后才记录幂等完成，并发同键调用合并为一次
执行。typed failure 通过 gRPC status 与 `ServiceErrorDetail` 的完整受控 `CallMetadata` 返回，对外
message 不携带内部异常。不可安全重放固定使用 `RECOVERY_REQUIRED`，并由
`recovery_actions=[CONFIRM_SIDE_EFFECT_STATE]` 与 `operation_id` 给出可程序化恢复投影；Desktop
response、Control Surface、Skill Action、Kernel Service 与 Python client 都按这些稳定字段映射，
不得解析 message 判定恢复语义。

Cognition 注册使用 Kernel 通过匿名 bootstrap pipe 单次交付的 nonce/capability secret。HMAC
proof 绑定 generation、nonce、Cognition 动态回环 endpoint、Service PID 与受监督子进程 PID；
注册成功或任一注册校验失败都立即清零并作废 secret/nonce。PID 字段只参与已认证 proof 和监督树
关系校验，不再被当作独立身份凭据。分配下一世代前会先原地清零旧 secret Buffer 并拒绝旧注册
waiter；启动失败、未取得 PID、无 child 的提前 stop、child error/exit 与正常 stop 都统一撤销
本代 endpoint/capability。

`PerceptionEvent` 的寻址和响应策略分层表达：

| 字段 | 语义 |
|---|---|
| `address_mode=direct` | 明确呼唤或当前焦点对话，进入工作区时按最高显著度竞争 |
| `address_mode=ambient` | 背景或环境感知，按熟悉度和场景节律竞争 |
| `response_policy=reply_allowed` | Cognition 可以在 Deliberate/Volition 后生成并外发回复 |
| `response_policy=observe_only` | 只作为经历、情绪、关系观察和记忆候选输入，不生成外显回复 |

每个 `PerceptionEvent` 必须携带 `conversation: ConversationContext`。Desktop 或 Extension 先向 Kernel 提交 `ConversationAddress`；地址包含 provider、provider account、space kind、external space/thread、actor endpoint、continuity hint 与 visibility。只有 Kernel `ConversationDirectory` 可以生成 canonical `scene_id`、`conversation_id`、`continuity_id`、`thread_id`、`interaction_id`、`recall_scope` 和 `disclosure_scope`，并对外部键做不可逆摘要。Extension 不得自行构造 canonical context。

scope 当前稳定值为 `conversation_private`、`actor_private`、`space_local`、`global_safe`、`public` 和 `character_internal`。所有 ContextSource 必须先按 scope 与对应 conversation/actor/scene owner 过滤，再做相关性排序；批处理不得扩大最严格作用域。

`address_mode` 不等同于回复许可。外部 Adapter 可以把非焦点背景事件作为 `ambient + observe_only` 注入统一认知主线，使其可追溯、可沉淀、可在后续上下文中召回，但不会打断当前场景或向远端平台发起回复。

`PerceptionEvent.content.actor_id` / `actor_name` 是可选语义发言者字段。`actor_id` 必须是 Adapter 归一化后的稳定 ID，不得使用 QQ 号、平台 user id 等原始私有标识；`actor_name` 只用于关系观察、近期经历可读性和上下文说明。

Kernel 入站、注意力批处理和 Cognition Service 全程保留同一份感知语义，不得在 Transport 定义字段更少的替代模型。批处理必须保留 `trace_id`、`origin` 与 `retention_ceiling`；混合不同留存上限时采用最严格值，避免批处理扩大认知留存权限。

`ActionCommand.action_type` 当前包含 `reply`、`recall`、`react`、`skill_request` 和 `noop`。其中 `skill_request` 是 Cognition 在普通对话主线中请求使用 Skill Plane 的稳定行动契约：`payload.skill_request.original_goal` 保存原始目标或整理后的目标，`capability_kind` 与 `confidence` 来自 Cognition 内部结构化 ActionPlan，`reason` 保存语义理由，`planning_hint` 是可选规划提示，并携带本轮 `conversation` 上下文。它不是执行授权；Kernel 必须经 character audience 的 ready catalog、`SkillPolicyEngine` 和 `SkillInvocationGateway` 编排，工具结果连同原 ConversationContext 通过 `agent_synthesis` 回到 Cognition。

`ExtensionRuntimeProjection` 中 `CapabilityGraphNode.audience` 与 `ActionIntentSnapshot.audience` 的枚举为 `character`、`user`、`host`、`renderer`、`extension`、`adapter`。只有 `character` 能进入人物可用 Skill catalog；Control Center 的管理动作消费 `user` action intent；Host lifecycle/readiness 使用 `host`；协议桥和平台收发链路使用 `adapter`；Renderer 投影和扩展内部事实不得伪装成人物 skill。

扩展安装态与运行态是两份投影：`ExtensionInstallationProjection` 由 Package Manager 产生，包含不可变的 `installed_versions` 与 `active_version`；`ExtensionRuntimeProjection` 由 Extension Host 产生，只描述当前被选择版本的 manifest、生命周期、能力图和诊断。安装新版本不会隐式替换正在运行的旧版本；控制表面必须显式提交带目标 `version` 的 `extension_lifecycle_request`，Kernel 停止旧版本、原子更新 `configs/extensions/active.yaml`，再加载并启动目标版本。停用不会删除安装包，卸载也不能删除当前激活或仍在运行的版本。

`MomentKind` 包含 `perception`、`emotion`、`reply`、`action`、`action_result` 和 `silence`。其中 `action` 记录当前角色决定使用外部能力的经历，不等于工具结果或长期记忆事实。易失的 thought Intent 与 Presentation thought frame 不属于 Experience Moment。

`cognition_shutdown` 是 Kernel 发往 Cognition 的协议级生命周期控制消息。Cognition 返回确认后由自身依次停止认知循环、刷新 Experience、封口开放 Episode、关闭 Memory/telemetry 并退出；该路径不执行记忆巩固模型。Kernel 只监督有界退出期限并在超时后回收进程树；强制终止后的已提交数据和待巩固 Episode 由下次正常维护恢复。

`LifeHeartbeatPayload` 当前为空对象。Kernel 只用 `life_heartbeat` 探测 Cognition 活性；是否允许主动行为、使用多少上下文预算和模型档位，由 Cognition 的 `CognitiveActivitySnapshot.policy` 决定，不从 Kernel 传入 `attention_mode`。Activity transition 不是 Experience，`MomentKind` 不包含 `arousal`。

## 变更顺序

1. 用 `rg` 找 Schema/IDL、生成物、生产者、映射层、消费者、测试和文档引用，并确认迁移切片与 owner。
2. 现有 runtime 契约修改 `protocol/src/schemas/`；新 Service/Document 修改 `contracts/{proto,json-schema}/`。明确必填性、默认值、枚举、错误和兼容语义。
3. 分别运行 `pnpm sync:contracts`，或 `pnpm contracts:generate` 与 `pnpm contracts:verify`；不得交叉刷新另一条基线。
4. 按生产者、映射层、消费者、UI/日志投影顺序实现。
5. 删除旧字段、旧消息、手写镜像和无期限 fallback。
6. 更新受影响的 Current、Implementation、Reference、Guide。
7. 运行 `pnpm typecheck`、相关测试和至少一条端到端链路验证。

破坏性语义变化应优先选择显式迁移和删除旧路径。只有短期迁移窗口允许双轨；必须写清 owner、删除条件和验证方式。

## 验证

- 现有 runtime 变更在 `pnpm sync:contracts` 后保证 TypeScript、Python 与 Unity C# 生成物一致；新 Contract Spine 变更通过 `pnpm contracts:verify` 的兼容、工具链与三语言门。
- TypeScript 与 Python 消费端都能通过类型/单元测试。
- IPC/WS/stdio 链路能处理成功、缺字段、未知枚举、错误 code 和降级。
- 旧字段搜索无运行时残留。

架构背景见 [构件、分层与依赖](../architecture/current/04-构件、分层与依赖.md)，代码实现见 [Protocol 契约层实现](../architecture/implementation/Protocol契约层实现.md)，操作指南见 [Schema 与跨进程契约变更](../guides/development/Schema与跨进程契约变更.md)。

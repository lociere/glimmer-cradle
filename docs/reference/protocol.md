# Protocol Reference

> 范围：跨语言、跨进程和公开 SDK 契约的权威规则，包括 Schema、生成物、事件、错误、Avatar frame 和变更流程。
> 事实依据：`protocol/src/schemas/`、`protocol/src/generated/`、`protocol/src/runtime/`、`protocol/codegen/`、Kernel/Cognition/Desktop/Avatar/Extension 消费端。
> 维护触发：Schema、事件、IPC/WS frame、错误码、config schema、codegen、兼容策略或任一跨边界消费者变化。

## 权威来源

两个及以上语言或进程共同理解的结构，必须定义在 `protocol/src/schemas/`。生成投影由 `pnpm sync:contracts` 产出，常见消费端包括：

| 目录 | 角色 |
|---|---|
| `protocol/src/schemas/models/` | 领域共享模型，如 perception、action、memory、avatar frame |
| `protocol/src/schemas/ipc/` | Kernel 与 Cognition 等 IPC envelope/payload |
| `protocol/src/schemas/config/` | 配置结构的可校验契约 |
| `protocol/src/schemas/enums/` | 跨语言枚举，如 error、moment、metric |
| `protocol/src/generated/` | TypeScript 生成物，只读 |
| `core/cognition/src/glimmer_cradle/cognition/protocol/generated/` | Python 生成物，只读 |
| `core/avatar/unity-host/Assets/Scripts/Avatar/Contracts/PresentationFrames.g.cs` | Unity C# Presentation Frame 生成物，只读 |
| `protocol/src/runtime/` | 运行时校验、normalizer 和回复/Avatar frame helper |

禁止手写镜像、修改生成物、让 UI view model 反向定义协议，或在某个消费者里维护“临时兼容字段”而不更新 Schema。

## 消息与事件规则

- 消息必须有稳定 `kind`/`type` 或枚举，不依赖 class name。
- 跨边界 payload 只携带可 JSON 序列化数据，不携带函数、句柄、进程对象、DOM、Unity/Cubism 对象或 provider SDK 实例。
- 错误使用稳定 code、可读 message、必要上下文和 trace；不得泄露密钥、token 或完整用户隐私 payload。
- 高频帧保持紧凑；大对象使用资源引用、路径投影或分页读取。
- 所有入口延续 trace；若入口没有上游 trace，则由入口 owner 创建。

## 关键契约族

| 契约族 | 典型用途 | 变更关注点 |
|---|---|---|
| `KernelMessageEnvelope` / IPC payload | Kernel 与 Cognition 的消息包络 | 必填性、错误 code、trace、版本迁移 |
| `PerceptionEvent` / `ActionCommand` | 感知输入和行动语义 | 不暴露平台原始 payload；语义由 Cognition 解释 |
| `CognitiveActivitySnapshot` / emotion model | 认知资源调度、情绪和表现投影 | 调度与 Affect 分离，不让 renderer 反推人格状态 |
| `PresentationDownstreamFrame` / `PresentationUpstreamFrame` | Desktop/Avatar 消息 | `host_hello`、`host_ready`、`character_presentation_projection`、reply、emotion、audio、presentation 区分；`host_ready` 必须晚于 Avatar Package / composition surface / first frame / interaction ready |
| `ExtensionRuntimeProjection` | Extension Host 给 Desktop/Control Center 的运行投影 | Host 是唯一生产者；以 Contribution Point Registry、Capability Graph、Action Intent 和 Diagnostics 表达运行事实；Capability Graph node 与 action intent 必须带 `audience`；Renderer 不从 DB、日志、manifest 固定字段或端点还原扩展事实 |
| `ExtensionInstallationProjection` / Extension install lifecycle | Extension Package Manager 给控制表面的安装态与安装事务 | 安装态只表达已安装版本集合和当前激活版本；prepare/preview/commit 先校验来源、摘要、SBOM、平台与权限，再原子安装；指定版本激活不与运行投影混为同一事实 |
| `SkillCatalogSnapshot` | Kernel 给 Desktop/Control Center 的 Skill Plane 目录与 provider runtime 投影 | 只暴露 character audience skill/tool/resource/prompt；`providerRuntimes` 补充 core / extension / MCP / user provider 的连接、契约-only、降级与恢复动作 |
| config schemas | YAML/JSON 配置校验 | 默认值来源、normalizer、密钥边界 |
| enums/error codes | 跨语言错误和状态分类 | 稳定命名、禁止局部字符串分叉 |

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

Kernel 入站、注意力批处理和 Cognition IPC 全程使用同一份 `PerceptionEvent`，不得再定义字段更少的 IPC 感知结构。批处理必须保留 `trace_id`、`origin` 与 `retention_ceiling`；混合不同留存上限时采用最严格值，避免批处理扩大认知留存权限。

`ActionCommand.action_type` 当前包含 `reply`、`recall`、`react`、`skill_request` 和 `noop`。其中 `skill_request` 是 Cognition 在普通对话主线中请求使用 Skill Plane 的稳定行动契约：`payload.skill_request.original_goal` 保存原始目标或整理后的目标，`capability_kind` 与 `confidence` 来自 Cognition 内部结构化 ActionPlan，`reason` 保存语义理由，`planning_hint` 是可选规划提示，并携带本轮 `conversation` 上下文。它不是执行授权；Kernel 必须经 character audience 的 ready catalog、`SkillPolicyEngine` 和 `SkillInvocationGateway` 编排，工具结果连同原 ConversationContext 通过 `agent_synthesis` 回到 Cognition。

`ExtensionRuntimeProjection` 中 `CapabilityGraphNode.audience` 与 `ActionIntentSnapshot.audience` 的枚举为 `character`、`user`、`host`、`renderer`、`extension`、`adapter`。只有 `character` 能进入人物可用 Skill catalog；Control Center 的管理动作消费 `user` action intent；Host lifecycle/readiness 使用 `host`；协议桥和平台收发链路使用 `adapter`；Renderer 投影和扩展内部事实不得伪装成人物 skill。

扩展安装态与运行态是两份投影：`ExtensionInstallationProjection` 由 Package Manager 产生，包含不可变的 `installed_versions` 与 `active_version`；`ExtensionRuntimeProjection` 由 Extension Host 产生，只描述当前被选择版本的 manifest、生命周期、能力图和诊断。安装新版本不会隐式替换正在运行的旧版本；控制表面必须显式提交带目标 `version` 的 `extension_lifecycle_request`，Kernel 停止旧版本、原子更新 `configs/extensions/active.yaml`，再加载并启动目标版本。停用不会删除安装包，卸载也不能删除当前激活或仍在运行的版本。

`MomentKind` 包含 `perception`、`emotion`、`reply`、`action`、`action_result` 和 `silence`。其中 `action` 记录当前角色决定使用外部能力的经历，不等于工具结果或长期记忆事实。易失的 thought Intent 与 Presentation thought frame 不属于 Experience Moment。

`cognition_shutdown` 是 Kernel 发往 Cognition 的协议级生命周期控制消息。Cognition 返回确认后由自身依次停止认知循环、刷新 Experience、封口开放 Episode、关闭 Memory/telemetry 并退出；该路径不执行记忆巩固模型。Kernel 只监督有界退出期限并在超时后回收进程树；强制终止后的已提交数据和待巩固 Episode 由下次正常维护恢复。

`LifeHeartbeatPayload` 当前为空对象。Kernel 只用 `life_heartbeat` 探测 Cognition 活性；是否允许主动行为、使用多少上下文预算和模型档位，由 Cognition 的 `CognitiveActivitySnapshot.policy` 决定，不从 Kernel 传入 `attention_mode`。Activity transition 不是 Experience，`MomentKind` 不包含 `arousal`。

## 变更顺序

1. 用 `rg` 找 Schema、生成物、生产者、映射层、消费者、测试和文档引用。
2. 修改 `protocol/src/schemas/` 中的权威 Schema，明确必填性、默认值、枚举、错误和兼容语义。
3. 运行 `pnpm sync:contracts`。
4. 按生产者、映射层、消费者、UI/日志投影顺序实现。
5. 删除旧字段、旧消息、手写镜像和无期限 fallback。
6. 更新受影响的 Current、Implementation、Reference、Guide。
7. 运行 `pnpm typecheck`、相关测试和至少一条端到端链路验证。

破坏性语义变化应优先选择显式迁移和删除旧路径。只有短期迁移窗口允许双轨；必须写清 owner、删除条件和验证方式。

## 验证

- `pnpm sync:contracts` 后 TypeScript、Python 与 Unity C# 生成物均与 Schema 一致。
- TypeScript 与 Python 消费端都能通过类型/单元测试。
- IPC/WS/stdio 链路能处理成功、缺字段、未知枚举、错误 code 和降级。
- 旧字段搜索无运行时残留。

架构背景见 [构件、分层与依赖](../architecture/current/04-构件、分层与依赖.md)，代码实现见 [Protocol 契约层实现](../architecture/implementation/Protocol契约层实现.md)，操作指南见 [Schema 与跨进程契约变更](../guides/development/Schema与跨进程契约变更.md)。

# Cognition 当前视图

> 范围：Python 认知核的当前职责、边界、认知循环、记忆连续性、上下文、推理和行动语义；不展开逐函数实现。
> 事实依据：`core/cognition/src/glimmer_cradle/cognition/`、`contracts/proto/glimmer/cognition/v1/`、`configs/characters/selrena/`、历史 Cognition 架构材料与当前代码。
> 维护触发：认知循环、人格/情绪/觉醒、记忆、经历、上下文装配、推理 provider、Kernel Service 或持久化 owner 变化。

Cognition 是当前角色的心智主权边界。用户输入、平台事件、语音转写、工具结果和桌面上下文只有被规范化为当前角色感知后，才能进入 Cognition；Cognition 输出的是行动、回复、情绪、思考和状态事件，而不是直接控制窗口、平台或进程。

新媒体经 `PerceptionContent.parts` 进入；Cognition 只读 `data/state/content/assets/` 或当拍租约并复核摘要，不解释外部路径。Experience v5 Moment 保存引用与语义文本；v4 文本继续读取。旧 URI-only `items` 当拍处理并标记不可保证恢复；图片可临时构造视觉 provider 输入，视频与未转写音频如实降级。取舍见 [ADR-0020](../../decisions/ADR-0020-Content资产单写者与恢复边界.md)。

生命周期结束同样遵守心智主权边界：Kernel 通过 `CognitionService.Shutdown` 请求停机，Cognition 在回复确认后自行停止入站 Service、刷新 Experience、封口开放 Episode、关闭 Memory/telemetry 并退出；停机不运行记忆巩固模型，Kernel 只保留有界 deadline、进程树监督与强制回收兜底。

## 当前职责

| 职责 | 当前事实源 | 不承担 |
|---|---|---|
| 身份与人格 | `domain/{identity,persona}/`、`configs/characters/<character-id>/{persona,profile,dialogue}.yaml` | 平台账号、窗口状态、Extension 生命周期 |
| 情绪、活动态与觉醒 | `state/`、`domain/identity/` | UI 动画本地推断 |
| 经历之流 | `domain/experience/`、`application/experience/`、`adapters/persistence/experience/` | 普通日志或聊天界面状态替代经历 |
| 记忆与知识 | `memory/`、`knowledge/`、各自 SQLite persistence adapter | Kernel 记忆副本、Extension 私写记忆或未授权知识变更 |
| 上下文装配 | `context/`、`persona/PersonaCompiler` | 简单 prompt 拼接或知识库人格注入 |
| 推理与多模态 | `inference/`、`adapters/inference/` | provider key 管理或桌面 IO |
| 规划与行动语义 | `planning/`、`loop/loop_controller.py`、迁移期 Cycle helpers、`application/agent_*`、Kernel outbound adapter | Skill catalog、平台 payload、窗口控制、权限执行 |

## 当前结构

```text
core/cognition/src/glimmer_cradle/cognition/
├── domain/                            # 心智模型、不变量和内部模块 API
├── application/                       # Cycle、维护、查询和本地事务编排
├── ports/                             # Kernel/provider/persistence/clock/observability 外部能力
├── adapters/                          # gRPC、provider、persistence、config/path 与观测 concrete
├── planning/                          # Cognition 目标、行动计划、承诺与规划持久化边界
└── host/{process,composition}.py      # 唯一进程入口、组装与受监督生命周期
```

`host/composition.py` 是 Cognition 唯一组装点，`host/process.py` 只监督进程生命周期。Kernel–Cognition 跨边界 DTO 来自 `contracts/generated/python/glimmer/{common,cognition,kernel}/v1/`，只允许 `adapters/kernel/` import；心智内部使用自己的应用模型，不得 import gRPC/Protobuf 或手写 TypeScript 镜像。

感知入站由 `PerceptionOperationRegistry` 监督：transport 接受后保持
`accepted/running/succeeded/cancelled/failed`，实际 Cycle tick 与推理 task 绑定到同一 trace。
取消会移除队列/工作区候选或取消正在运行的推理，不会只取消 RPC 外壳。operation 终态表达
Cognition 是否履行该感知的处理义务：`ambient` 在 Appraise 写入经历后即成功，不等待未来是否广播；
`direct` 则保持到本拍处理完成，队列淘汰、竞争拒绝或异常导致直接感知丢失时进入失败。工作区的
注意力选择不再被误报成基础设施失败并推动 Kernel 熔断。operation id 是幂等主键，trace 绑定冲突会被拒绝。Cognition 反向发布 action
时等待 Kernel 的终态响应，不在固定 5 秒后脱离 Kernel 副作用继续运行；Kernel 的取消还会
贯穿结果合成，不会被误写成合成失败 fallback。

## 唯一认知主线

当前认知主线是 `loop/loop_controller.py` 的 `LoopController`。`LoopStep` 持有单拍状态，迁移期 `ReplyContextBuilder` 装配回复上下文，`ActionEmitter` 负责行动命令映射，`CycleContinuity` 在仲裁后写入会话与经历。Loop checkpoint 以 expected revision 持久化 cycle count 与运行终态，重启时把未完成的 running 状态恢复为 interrupted。原生迭代入口直接消费模型 `ToolCall`，只允许调用 `CapabilityPort.expose()` 返回的能力，并把带稳定幂等键的执行结果传入下一模型 Step；step、调用次数和输出长度均受 `StopPolicy` 限制。它把感知处理为行动的基本语义顺序是：

```text
Perception
  -> Appraise
  -> Recall / ContextAssembler
  -> Workspace Competition
  -> Deliberate / Reasoning
  -> Intend / Volition
  -> Act
  -> Experience / Episode / Consolidation
  -> Kernel outbound event
```

这条主线保证同一感知不会被旧用例、UI 层或平台 Adapter 重复编排。`application/agent_plan_use_case.py`、`agent_synthesis_use_case.py` 等用例可以服务工具规划与结果综合，但不能重新成为独立聊天回复主线。

`ports/` 已提供 v2.1 消费方契约：`ClockPort`、`ContentPort`、`ConversationPort`、`CapabilityPort`、`JobPort` 与 `ResourcePort`。这些类型只表达读取、事实提交、能力执行和长期工作请求语义；Worker 已装配 typed Capability/模型及其他具体 adapter，完整 broker 与剩余 consumer 迁移仍未完成。

当前生产聊天由唯一 Loop 直接消费原生模型流：每 Step 曝光 Tool、方法摘要和 Resource，绑定实际
定义后调用 typed Capability Service；ACTION 先刷盘，真实执行结果被 Conversation 接纳后才续接。
方法正文与 Resource 内容通过通用加载操作按当次引用读取，与业务 Tool 共用预算；仍是独立
目录。正文不提升为人格/权限，资源内容 hash 与定义 revision 分开，完整 Knowledge 消费仍待接线。
最终 `reply` 经角色边界、Intent 仲裁和 `ActionCommand` 外发，不再经过 ActionPlan 预分类。
未完成流、预算、重复调用、未知副作用、tier 与意愿拒绝均失败关闭；没有本地 stream 时不提升为云。
具体接线和未完成窗口见[唯一认知循环](../../implementation/Cognition认知核实现.md#唯一认知循环)。

`Intent.initiative` 区分响应性意图与主动意图。来自已准入、`address_mode=direct` 的 `PerceptionEvent` 且已经过 Deliberation 的回复或澄清属于 `reactive`，不再被用于角色自发行为的 willingness/activity 闸重复压制；ambient 感知以及 drive、affect 等角色自发行为属于 `proactive`，仍必须通过连续意愿阈值和 `CognitiveActivityPolicy.allows_proactive`。Skill 副作用无论来源都继续由 Kernel Skill Policy 与 Invocation Gateway 决定。

明确请求型 `agent_plan` / `agent_synthesis` 仍服务未迁移的 Kernel 编排，不能重新成为生产聊天旁路。
短程 ActionPlan 和非原生 Loop 入口已删除，测试已迁原生事件；旧 journal 只恢复只读
`PlanningDecisionSnapshot`，不重建行动。长期 Planning/承诺与请求型 Plan/Synthesis 保留实际消费者。

感知进入 Cognition `AttentionController` 时，`direct` 表示外部互动义务，必须以最高显著度参与本拍竞争，并在同分时优先于长驻的 internal drive；`ambient` 才按熟悉度、场景和当前注意力节律作为背景感知处理。是否允许外显回复由 `response_policy` 单独控制：`reply_allowed` 可进入 Deliberate/Volition 生成回复，`observe_only` 只写经历、情绪、关系观察和记忆候选，不调用回复推理。这个规则只依赖通用 `address_mode` 与 `response_policy`，不得为 QQ 群、直播间或其他平台写特殊分支。

## 长期承诺

Planning 已持久保存不可变目标/计划版本、完成条件、显式 accepted 承诺与同事务 Job request outbox；
重复身份不创建第二份，首次 due time 与 scope 不可悄悄替换。通过 `JobPort` 得到持久接纳才结束源
投递，回执不表示目标 completed；普通模型回复或工具调用不自动升级为长期承诺。目标配置 Host
已通过生产 Worker RPC 接真实 Planning store 与 Jobs 接纳，原 due/首次预算和 ACK 丢失重启已验证；
默认 handler 尚未注册，待办只排队、状态不假 ACK，Host 如实降级。Core 已实现有证据引用/live 复验的
语义评估、原 attempt 封口、同事务业务 receipt/承诺 revision；生产证据 Adapter、来源摘要/隐私域与
model-tier 绑定、显式接纳/执行 wire 和 Host 执行 Adapter 已接真实 owner。逐任务调度接纳、状态接收、
通知与再调度仍待接线，不能认作完整长期承诺链路。
持久对账 RPC 已接真实 Planning store；Host 分页恢复原 unknown，sealed/真实 receipt 驱动
Jobs 对账，保留原提交者和 completed=false。此接线不开放模型或扩大隐私权限，不解除 handler 降级。
详见[认知核实现](../../implementation/Cognition认知核实现.md#长期承诺与-jobs-源请求)。

## 记忆与连续性

会话不是由用户反复“新建聊天”才能成立的容器。Desktop 使用稳定的长期 `Conversation`，Conversation History 按空闲边界和片段数量自动形成 `Chapter`，再把连续原始消息压成多级 `Segment`；原始 Moment 始终留在 Conversation Log。外部平台由 Adapter 决定地址粒度，例如 QQ 私聊可一人一个 `external_space_key`、群聊可一群一个，特殊线程可提供 `external_thread_key`，但规范 ID 和权限域只能由 `core/conversation` 解析。

拓扑名词固定为：`ActorEndpoint` 是平台侧某个发言端点；`Continuity` 表示跨表面的身份连续性线索；`Scene` 是外部环境；`Conversation` 是长期对话流；`Chapter` 是自动形成的阶段；`Segment` 是可检索摘要；`Thread` 是 Conversation 内的显式支线；`Turn` 是一次处理闭环；`Moment` 是 Log 的不可变交互事实。当前跨边界稳定载体是 `ConversationAddress` 和 `ConversationContext`，Chapter/Segment 是 Conversation History 投影。

| 域 | Owner | 语义 |
|---|---|---|
| Conversation Working Set | `core/conversation` `ConversationController` | 从持久 History Store 恢复的有界进程缓存；不是事实源，重启后可恢复 |
| Conversation History | `core/conversation/src/glimmer_cradle/conversation/history/`、`data/state/cognition/conversations/conversations.db` | 从 Log 幂等派生的消息、Chapter、Segment 与 Conversation State 查询投影；可删除重建，数据路径待阶段 14 迁移 |
| Conversation Log | `ConversationRecorder` / `ConversationLog` | 月度 SQLite pack 中只追加的 Moment；保存全局 position、来源、因果、角色、保留上限和内容 |
| Episode Projection | `EpisodeProjection` | 从 Log 派生的经历边界与封口；物理库同存持久源请求，禁止整体删除重建 |
| Memory | `MemoryController` / `MemoryStore` | episodic、semantic、social、autobiographical、prospective、procedural 记忆及其版本、证据与纠错状态 |
| 记忆修订与证据 | `memory_revisions` / `memory_evidence` | 当前有效修订、历史有效期、来源 Moment 和 consolidation id |
| 关系投影 | `RelationshipProjection` / `relationship_*` | 按 checkpoint 从 Moment 幂等派生直接互动、环境观察、回复计数和有证据修订 |
| 知识库 | Cognition KnowledgeStore / KnowledgeIndex | 独立版本化配置 Vault 与获准 Resource 采集；正文更新/删除原子失效，Resource 经 live 权限复验与受监督重采集，Context 携修订/hash，不是角色经历；边界见 [Knowledge 实现](../../implementation/Cognition认知核实现.md#knowledge-来源与持久化) |
| 叙事投影 | Narrative journal | 从已持久化 Episode 派生的人类可读叙事，不替代 Ledger |

连续性链路固定为：

```text
normalized Perception / Emotion / Reply / Action / ActionResult / Silence
  -> Moment + SourceDescriptor + retention_ceiling
  -> Conversation Log
  -> Conversation Projection + Episode Projection
  -> durable Consolidation Job + ConsolidationCoordinator
  -> structured memory drafts + evidence validation
  -> versioned Memory / Relationship / Intention state
  -> budgeted retrieval
  -> ContextAssembler
```

`SourceDescriptor` 记录 provider kind/id/version、source event、schema、trust、privacy 和 cognitive effect。`retention_ceiling` 决定一条 Moment 最多能进入哪一层；只有 `memory_candidate` 才可参与记忆巩固。工具成功结果也只是候选证据，不自动成为事实；失败结果保留为 Experience，不能污染 Memory。

Global Workspace 的候选、竞争、广播和 `thought` Intent 属于易失注意力过程，只通过 span、metrics 或 Presentation `thought` frame 观察，不写入 Conversation Log。`MomentKind` 不包含 `thought`；未来反思、自我叙事或计划若需要持久化，必须定义带来源证据的独立认知产物，而不是把内部广播伪装成交互事实。

Episode 是巩固、叙事和回忆的批次，不是第二事实源。`reply` / `silence` 会把当前交互封口为 `interaction_completed` 并立即唤醒 `MaintenanceScheduler`；空闲超时和 `quiescent` 只补充收口无终结事件的批次。sealed Episode 先进入 `consolidation_jobs` 持久队列，再按 debounce、最大等待、lease 和退避重试批量消费。任务在模型推理前按 `recall_scope + disclosure_scope + 域 owner` 分区，同一次模型调用和现有记忆候选不得跨权限域。启动恢复先补投影、回收过期 lease 并收口中断 Episode；停机只封口、入队和 checkpoint，不执行模型推理。

Memory 采用 `candidate / active / disputed / superseded / redacted` 状态和时间有效修订。新观察不会静默覆盖过去；它关闭旧修订的 `valid_to`，写入新修订并保留证据。关系熟悉度从直接互动、环境观察和回复计数确定性派生，LLM 只能补充带证据的关系摘要，不能任意累加亲密度。

真实巩固 consumer 已查询 Memory 持久结果 receipt；业务修订与结果同事务提交，确认丢失后的恢复不会
再次推理已提交 Episode/version。Worker 的 Memory Job 执行/封口 RPC 已接同一接收 owner，并持久
核验原 attempt 与提交资格。源 request outbox 已与实际 Episode 封口/checkpoint 原子提交，重启保留
同一请求；接纳 ACK 不等于业务完成，已解决源记录也必须保留原身份。旧巩固队列仍是迁移窗口，
不能认作 Jobs 生产接线完成；Host 源投递与 handler/query adapter 已在目标 App owner 落位并通过真实
跨进程验证；App 的单循环持续调度、持久 unknown 分页与停机封口已接通。
默认生产 Worker 仍拒绝外部源投递，防止旧队列双消费；目标 Host 的局部配置/authority 路径、进程监督及 Memory 状态 wire/inbox 已接线，产品入口与状态投影消费
继续按执行记录推进。实现与 schema 升级边界见
[记忆持久化](../../implementation/Cognition认知核实现.md#记忆经历与持久化)。

上下文按固定分区装配：Conversation State、近期原始消息、相关历史 Segment、长期偏好、混合检索 Memory、角色知识、受作用域约束的近期 Experience。所有来源都在候选排序前按 `recall_scope` 以及 conversation/actor/scene owner 过滤；基础排序使用词项、时间、显著度、置信度和 token budget。系统显式启用 Embedding 后才附加语义相似度，未启用不是降级。桌面只读预览区分 Conversation 消息、Ledger Moment、Episode、活动 Memory、revision、evidence 和角色知识，不把预览条数冒充实际 Prompt 命中。

Kernel 不直接读写 Cognition 数据库。Extension 只提交平台中立 `ConversationAddress` 与清洗后的 `perception`/`evidenceProposal`；Kernel `ConversationDirectory` 生成不可逆的 canonical scene/conversation/continuity/thread/actor 和作用域。Extension 可以在自己的 storage 中保存业务状态，但公开 SDK 不提供第二套会话连续性入口，也不能读取、修改或删除 Memory。

角色配置采用最终 Character Package 目录：`character.manifest.yaml` 声明角色包身份和目录，`profile.yaml` 是作者人格种子，`dialogue.yaml` 是对话呈现策略，`safety.yaml` 是红线和边界，`knowledge/index.yaml + *.md` 只保存外部知识。目标 `persona/PersonaCompiler` 生成版本化稳定快照；model/memory 来源不能通过 mutation policy，也不会从知识库或运行记忆反向编译人格。

## 情感激活、认知活动、维护与外部注意力

`state/` 维护 Emotion、连续 affect activation、`engaged / ambient / quiescent` 三档 `CognitiveActivityState` 和对应资源策略。直接互动进入 `engaged`，背景观察最多进入 `ambient`，无活动时受最短驻留和 affect activation hold 约束逐级衰减。活动快照以 expected revision 写入 Cognition state DB，冷启动与 Conversation Log 活动投影合并；自动迁移只进入 state store、metrics、结构化日志和 span，不写 Experience，也没有 `arousal` Moment。

`application/maintenance/` 的 `MaintenanceScheduler` 拥有独立任务和间隔，串行调用 Episode/Relationship projection 与 `ConsolidationCoordinator`。终结 Moment 提供低延迟唤醒，sealed Episode 提供持久可恢复工作项，周期扫描提供补偿；`quiescent` 只提供一次强制封口提示。不存在 Dreaming 活动态，也不把维护运行解释为角色正在做梦。Global Workspace 广播同样是易失注意力过程，当前通用链路不会把它写成 Thought。

外部平台的注意力窗口由 Kernel `AttentionLeaseStore` 和 Extension Adapter 申请的 Attention Lease 维护；Cognition 不理解 QQ 群、WebUI 或其他平台细节。`CognitionService.Heartbeat` 只做 Kernel 到 Cognition 的活性探测；认知节拍由 `LoopController` 读取 `CognitiveActivityPolicy.frequency_hint_ms` 自主调度，主动性由 `allows_proactive` 约束。

按 [ADR-0002](../../decisions/ADR-0002-AttentionLease与CognitiveActivity分层.md)，Cognition 不拥有或查询 Kernel 的外部 scene/channel Attention Lease。它只消费规范化感知中的 `address_mode`、`response_policy`、`scene_id`、`actor_id/actor_name`。Cognition 自有的 `CognitiveAttentionLease` 仅在一次内部 focus 处理期间固定候选，不表达外部焦点，也不授予回复权。外部场景是否被关注属于 Kernel Attention Projection；情绪强度属于 Affect；认知资源档位属于 Cognitive Activity；是否愿意开口属于 Volition；Episode 和 Memory 维护属于 Maintenance Scheduler。

## 失败与降级语义

Cognition 的失败不是一个统一的“无回复”。至少要区分：

- 入站感知非法或被 Kernel gate 拒绝；
- 认知循环处理失败；
- context source 失败或预算裁剪；
- provider 限流、超时、空响应或不支持多模态；
- 工具计划失败、无 ready skill、无合适 skill、工具调用被拒绝或合成失败；
- 记忆写入失败、migration 失败或数据损坏；
- outbound 到 Kernel 失败。

这些失败必须带 trace，必要时进入 Cognition/Kernel DLQ。UI 只能显示受控错误或降级状态，不能把 provider 异常伪装成当前角色“沉默”。

实现入口见 [Cognition 认知核实现](../../implementation/Cognition认知核实现.md)，开发操作见 [Cognition 开发](../../../guides/subsystems/Cognition开发.md)。

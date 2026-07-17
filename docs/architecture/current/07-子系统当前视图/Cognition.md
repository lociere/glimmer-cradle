# Cognition 当前视图

> 范围：Python 认知核的当前职责、边界、认知循环、记忆连续性、上下文、推理和行动语义；不展开逐函数实现。
> 事实依据：`core/cognition/src/glimmer_cradle/cognition/`、`protocol/src/schemas/`、`configs/characters/selrena/`、历史 Cognition 架构材料与当前代码。
> 维护触发：认知循环、人格/情绪/觉醒、记忆、经历、上下文装配、推理 provider、Kernel IPC 或持久化 owner 变化。

Cognition 是当前角色的心智主权边界。用户输入、平台事件、语音转写、工具结果和桌面上下文只有被规范化为当前角色感知后，才能进入 Cognition；Cognition 输出的是行动、回复、情绪、思考和状态事件，而不是直接控制窗口、平台或进程。

生命周期结束同样遵守心智主权边界：Kernel 通过 `cognition_shutdown` 请求停机，Cognition 在回复确认后自行停止生产者、刷新 Experience、封口开放 Episode、关闭 Memory/telemetry 并退出；停机不运行记忆巩固模型，Kernel 只保留有界超时监督与强制回收兜底。

## 当前职责

| 职责 | 当前事实源 | 不承担 |
|---|---|---|
| 身份与人格 | `identity/`、`persona/`、`configs/characters/<character-id>/{persona,profile,dialogue}.yaml` | 平台账号、窗口状态、Extension 生命周期 |
| 情绪与觉醒 | `affect/` | UI 动画本地推断 |
| 经历之流 | `experience/`、`data/state/cognition/experience/` | 普通日志或聊天界面状态替代经历 |
| 记忆与知识 | `memory/`、`memory/storage/`、`data/state/cognition/memory/memory.db` | Kernel 记忆副本或 Extension 私写记忆 |
| 上下文装配 | `context/`、`PersonaProfileCompiler`、`DialoguePolicyBuilder`、`PromptAssembler` | 简单 prompt 拼接或知识库人格注入 |
| 推理与多模态 | `inference/` | provider key 管理或桌面 IO |
| 行动语义 | `cycle/controller.py`、`application/agent_*`、outbound adapter | 平台 payload、窗口控制、权限执行 |

## 当前结构

```text
core/cognition/src/glimmer_cradle/cognition/
├── host/{process,composition}.py      # 进程生命周期与唯一依赖组装
├── foundation/                        # config、event bus、path 等基础能力
├── ports/kernel/{inbound,outbound}/   # Kernel 协议边界适配
├── observability/                     # logger、trace、metrics、模型调用观测
├── protocol/generated/                # protocol schema 生成的 Python 投影
├── cycle/                             # controller、turn、providers、volition、行动出口
├── context/                           # 上下文装配与来源
├── conversation/                      # Ledger 派生的会话、章节、片段与工作集投影
├── inference/                         # 推理服务、LLM、embedding、多模态
├── identity/ persona/ affect/
├── memory/ maintenance/               # 版本化记忆、持久巩固任务与独立维护调度
├── experience/                        # Ledger、Episode 与叙事投影
└── application/                       # agent plan/synthesis 请求型应用用例
```

`host/composition.py` 是 Cognition 唯一组装点，`host/process.py` 只监督进程生命周期。跨边界模型来自 `glimmer_cradle/cognition/protocol/generated/`；不得在 Python 端手写 TypeScript 镜像。

## 唯一认知主线

当前认知主线是 `cycle/controller.py` 的 `CycleController`。控制器只编排阶段顺序：`CycleTurn` 持有单拍状态，`ReplyContextBuilder` 装配回复上下文，`ActionEmitter` 负责行动命令映射，`CycleContinuity` 在仲裁后写入会话与经历。它把感知处理为行动的基本语义顺序是：

```text
Perception
  -> Appraise
  -> Recall / Context Assembly
  -> Workspace Competition
  -> Deliberate / Reasoning
  -> Intend / Volition
  -> Act
  -> Experience / Episode / Consolidation
  -> Kernel outbound event
```

这条主线保证同一感知不会被旧用例、UI 层或平台 Adapter 重复编排。`application/agent_plan_use_case.py`、`agent_synthesis_use_case.py` 等用例可以服务工具规划与结果综合，但不能重新成为独立聊天回复主线。

当前聊天主循环能生成 `reply` 并通过 `ActionCommand` 外发；Deliberate 先由 `CognitiveActionPlanner` 生成结构化 ActionPlan，语义级判断当前目标应 `reply`、`skill_request`、`ask_clarification` 或 `noop`。`reply` 才继续普通 persona reply prompt；高置信度 `skill_request` 会停止普通回复并发出 `action_type=skill_request` 的 `ActionCommand`，携带 `original_goal`、`capability_kind`、`confidence`、`reason` 和可选 `planning_hint`；`ask_clarification` 生成 ActionPlan 驱动的澄清回复；`noop` 不发行动并记录 `action_plan_noop` 的 silence。Cognition 只表达行动语义，不读取 catalog、不执行 handler、不接触平台 IO；推理不可用或规划非法时不会用关键词规则兜底执行工具。Kernel 的 `SkillActionController` 接收该请求后暴露 character audience 的 ready catalog 给 `agent_plan` RPC，执行结果再通过 `agent_synthesis` RPC 回到 Cognition 合成角色回复。

`Intent.initiative` 区分响应性意图与主动意图。来自已准入、`address_mode=direct` 的 `PerceptionEvent` 且已经过 Deliberation 的回复、澄清或 Skill 请求属于 `reactive`，不再被用于角色自发行为的 willingness/activity 闸重复压制；ambient 感知以及 drive、affect 等角色自发行为属于 `proactive`，仍必须通过连续意愿阈值和 `CognitiveActivityPolicy.allows_proactive`。Skill 副作用无论来源都继续由 Kernel Skill Policy 与 Invocation Gateway 决定。

这条闭环仍保持单一认知主线：普通闲聊直接生成 `reply`；需要能力时生成 `skill_request` 并记录 `action` Moment，避免把“等待工具结果”误写成沉默。`agent_synthesis` 复用 `PersonaInjector` 的 persona/profile/dialogue/safety prompt 主体，只把外部能力结果作为不可信观察附加给模型；`agent_plan` / `agent_synthesis` 是 Cognition 给 Kernel 编排使用的辅助用例，不重新成为独立聊天回复主线。

感知进入全局工作区时，`direct` 表示外部互动义务，必须以最高显著度参与本拍竞争，并在同分时优先于长驻的 internal drive；`ambient` 才按熟悉度、场景和当前注意力节律作为背景感知处理。是否允许外显回复由 `response_policy` 单独控制：`reply_allowed` 可进入 Deliberate/Volition 生成回复，`observe_only` 只写经历、情绪、关系观察和记忆候选，不调用回复推理。这个规则只依赖通用 `address_mode` 与 `response_policy`，不得为 QQ 群、直播间或其他平台写特殊分支。

## 记忆与连续性

会话不是由用户反复“新建聊天”才能成立的容器。Desktop 使用稳定的长期 `Conversation`，Cognition 按空闲边界和片段数量自动形成 `Chapter`，再把连续原始消息压成多级 `Segment`；原始 Moment 始终留在 Ledger。外部平台由 Adapter 决定地址粒度，例如 QQ 私聊可一人一个 `external_space_key`、群聊可一群一个，特殊线程可提供 `external_thread_key`，但规范 ID 和权限域只能由 Kernel 解析。

拓扑名词固定为：`ActorEndpoint` 是平台侧某个发言端点；`Continuity` 表示跨表面的身份连续性线索；`Scene` 是外部环境；`Conversation` 是长期对话流；`Chapter` 是自动形成的阶段；`Segment` 是可检索摘要；`Thread` 是 Conversation 内的显式支线；`Interaction` 是一次处理闭环；`Moment` 是不可变经历事实。当前跨边界稳定载体是 `ConversationAddress` 和 `ConversationContext`，Chapter/Segment 是 Cognition 内部投影。

| 域 | Owner | 语义 |
|---|---|---|
| Conversation Working Set | `ConversationController` | 从持久 Conversation Store 恢复的有界进程缓存；不是事实源，重启后可恢复 |
| Conversation Store | `conversation/`、`data/state/cognition/conversations/conversations.db` | 从 Ledger 幂等派生的消息、Chapter、Segment 与 Conversation State 查询投影；可删除重建 |
| Experience Ledger | `ExperienceRecorder` / `ExperienceLedger` | 月度 SQLite pack 中只追加的 Moment；保存全局 position、来源、因果、角色、保留上限和内容 |
| Episode Projection | `EpisodeProjection` | 按 interaction + scene 从 Ledger 派生的边界单元；可删除、可重建、可封口 |
| Memory Substrate | `MemorySubstrate` / repositories | episodic、semantic、social、autobiographical、prospective、procedural 记忆及其状态 |
| 记忆修订与证据 | `memory_revisions` / `memory_evidence` | 当前有效修订、历史有效期、来源 Moment 和 consolidation id |
| 关系投影 | `RelationshipProjection` / `relationship_*` | 按 checkpoint 从 Moment 幂等派生直接互动、环境观察、回复计数和有证据修订 |
| 知识库 | Cognition knowledge repo | `scope=knowledge` 的 Knowledge Vault 条目，不是角色经历 |
| 叙事投影 | Narrative journal | 从已持久化 Episode 派生的人类可读叙事，不替代 Ledger |

连续性链路固定为：

```text
normalized Perception / Emotion / Reply / Action / ActionResult / Silence
  -> Moment + SourceDescriptor + retention_ceiling
  -> Experience Ledger
  -> Conversation Projection + Episode Projection
  -> durable Consolidation Job + ConsolidationCoordinator
  -> structured memory drafts + evidence validation
  -> versioned Memory / Relationship / Intention state
  -> budgeted retrieval
  -> Context Assembly
```

`SourceDescriptor` 记录 provider kind/id/version、source event、schema、trust、privacy 和 cognitive effect。`retention_ceiling` 决定一条 Moment 最多能进入哪一层；只有 `memory_candidate` 才可参与记忆巩固。工具成功结果也只是候选证据，不自动成为事实；失败结果保留为 Experience，不能污染 Memory。

Global Workspace 的候选、竞争、广播和 `thought` Intent 属于易失注意力过程，只通过 span、metrics 或 Presentation `thought` frame 观察，不写入 Experience。`MomentKind` 不包含 `thought`；未来反思、自我叙事或计划若需要持久化，必须定义带来源证据的独立认知产物，而不是把内部广播伪装成经历事实。

Episode 是巩固、叙事和回忆的批次，不是第二事实源。`reply` / `silence` 会把当前交互封口为 `interaction_completed` 并立即唤醒 `MaintenanceScheduler`；空闲超时和 `quiescent` 只补充收口无终结事件的批次。sealed Episode 先进入 `consolidation_jobs` 持久队列，再按 debounce、最大等待、lease 和退避重试批量消费。任务在模型推理前按 `recall_scope + disclosure_scope + 域 owner` 分区，同一次模型调用和现有记忆候选不得跨权限域。启动恢复先补投影、回收过期 lease 并收口中断 Episode；停机只封口、入队和 checkpoint，不执行模型推理。

Memory 采用 `candidate / active / disputed / superseded / redacted` 状态和时间有效修订。新观察不会静默覆盖过去；它关闭旧修订的 `valid_to`，写入新修订并保留证据。关系熟悉度从直接互动、环境观察和回复计数确定性派生，LLM 只能补充带证据的关系摘要，不能任意累加亲密度。

上下文按固定分区装配：Conversation State、近期原始消息、相关历史 Segment、长期偏好、混合检索 Memory、角色知识、受作用域约束的近期 Experience。所有来源都在候选排序前按 `recall_scope` 以及 conversation/actor/scene owner 过滤；基础排序使用词项、时间、显著度、置信度和 token budget。系统显式启用 Embedding 后才附加语义相似度，未启用不是降级。桌面只读预览区分 Conversation 消息、Ledger Moment、Episode、活动 Memory、revision、evidence 和角色知识，不把预览条数冒充实际 Prompt 命中。

Kernel 不直接读写 Cognition 数据库。Extension 只提交平台中立 `ConversationAddress` 与清洗后的 `perception`/`evidenceProposal`；Kernel `ConversationDirectory` 生成不可逆的 canonical scene/conversation/continuity/thread/actor 和作用域。Extension 可以在自己的 storage 中保存业务状态，但公开 SDK 不提供第二套会话连续性入口，也不能读取、修改或删除 Memory。

角色配置采用最终 Character Package 目录：`character.manifest.yaml` 声明角色包身份和目录，`profile.yaml` 是作者人格种子，`dialogue.yaml` 是对话呈现策略，`safety.yaml` 是红线和边界，`knowledge/index.yaml + *.md` 只保存外部知识。`PersonaInjector` 不从知识库或运行记忆反向编译人格。

## 情感激活、认知活动、维护与外部注意力

`affect/` 维护 Emotion 与连续的 affect activation；`activity/` 维护 `engaged / ambient / quiescent` 三档 `CognitiveActivityState` 和对应资源策略。直接互动进入 `engaged`，背景观察最多进入 `ambient`，无活动时受最短驻留和 affect activation hold 约束逐级衰减。自动迁移只进入 metrics、结构化日志和 span，不写 Experience，也没有 `arousal` Moment。

`maintenance/` 的 `MaintenanceScheduler` 拥有独立任务和间隔，串行调用 Episode/Relationship projection 与 `ConsolidationCoordinator`。终结 Moment 提供低延迟唤醒，sealed Episode 提供持久可恢复工作项，周期扫描提供补偿；`quiescent` 只提供一次强制封口提示。不存在 Dreaming 活动态，也不把维护运行解释为角色正在做梦。Global Workspace 广播同样是易失注意力过程，当前通用链路不会把它写成 Thought。

外部平台的注意力窗口由 Kernel `AttentionLeaseStore` 和 Extension Adapter 申请的 Attention Lease 维护；Cognition 不理解 QQ 群、WebUI 或其他平台细节。`life_heartbeat` 只做 Kernel 到 Cognition 的活性探测；认知节拍由 `CycleController` 读取 `CognitiveActivityPolicy.frequency_hint_ms` 自主调度，主动性由 `allows_proactive` 约束。

按 [ADR-0002](../../decisions/ADR-0002-AttentionLease与CognitiveActivity分层.md)，Cognition 不拥有 Attention Lease，也不查询 Kernel attention 内部对象。它只消费规范化感知中的 `address_mode`、`response_policy`、`scene_id`、`actor_id/actor_name`。外部场景是否被关注属于 Kernel Attention Projection；情绪强度属于 Affect；认知资源档位属于 Cognitive Activity；是否愿意开口属于 Volition；Episode 和 Memory 维护属于 Maintenance Scheduler。

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

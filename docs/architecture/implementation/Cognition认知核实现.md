# Cognition 认知核实现

> 范围：Python Cognition 如何实现人格、情绪、认知活动、后台维护、经历、记忆、上下文、推理、认知循环和 Kernel Service 边界；不写 LLM prompt 全文或字段全表。
> 源码依据：`core/cognition/src/glimmer_cradle/cognition/{domain,application,ports,adapters,host}/`。
> 维护触发：认知循环、DI、上下文来源、推理 provider、记忆/经历持久化、Kernel Service transport、协议生成物或测试入口变化。

## 目录

- [入口与组装](#入口与组装)
- [代码结构地图](#代码结构地图)
- [入站链路](#入站链路)
- [唯一认知循环](#唯一认知循环)
- [上下文与推理](#上下文与推理)
- [记忆、经历与持久化](#记忆经历与持久化)
- [出站链路](#出站链路)
- [调试入口](#调试入口)
- [验证](#验证)

## 入口与组装

| 入口 | 职责 |
|---|---|
| `host/process.py` | Python 进程入口、配置加载、Cognition Service host、生命周期监督 |
| `host/composition.py` | 唯一组装点，绑定 external Ports、persistence、memory、inference、cycle 与 adapters |
| `adapters/kernel/inbound_adapter.py` | Cognition Service DTO 到应用端口的入站映射 |
| `adapters/kernel/outbound_adapter.py` | 行动、状态和日志经 Kernel Control Service 回传 |
| `adapters/kernel/grpc_transport.py` | 动态回环 gRPC host/client、deadline、取消、typed detail 与 generation 校验 |
| `ports/kernel/models.py` | 不依赖 generated DTO 的进程内边界模型 |

Cognition 只依赖规范化感知、配置投影和生成契约。它不读取 Electron、平台 payload、Extension handler 或 Kernel 内部对象。

## 代码结构地图

Cognition 只保留五个源码职责根。Contract Spine 生成物位于仓库根
`contracts/generated/python/`，只能由 Kernel contract Adapter 引用，不得在 Cognition
侧手改或向 Application/Domain 泄漏。

```text
core/cognition/
├── pyproject.toml
├── uv.lock
├── src/glimmer_cradle/cognition/
│   ├── __init__.py
│   ├── domain/                         # 心智模型、不变量与内部模块 API
│   │   ├── activity/ affect/ conversation/
│   │   ├── experience/ identity/ persona/ volition/
│   │   └── configuration.py, memory.py, workspace.py
│   ├── application/                    # 认知循环、查询、维护与本地事务编排
│   │   ├── activity/ context/ conversation/ cycle/
│   │   ├── experience/ inference/ maintenance/ memory/
│   │   └── *_use_case.py
│   ├── ports/                          # 仅 Cognition 真实外部能力边界
│   │   ├── kernel/
│   │   └── clock.py, inference.py, observability.py,
│   │       persistence.py, trace_context.py
│   ├── adapters/                       # 外部能力与 contract edge 的具体实现
│   │   ├── kernel/ inference/ observability/ persistence/
│   │   └── clock.py, configuration.py, paths.py
│   └── host/
│       ├── process.py                  # 唯一 Python 进程入口与生命周期接入
│       └── composition.py              # 唯一 Composition Root
└── tests/
    └── test_architecture_layout.py     # 真实 import/dynamic-import 分层门
```

`host/process.py` 接受 Kernel 注入且已校验的原始配置 Document，再由
`adapters/configuration.py` 映射为 `domain/configuration.py` 的 immutable settings；
Character/Config/Memory canonical JSON Schema 仍由现有跨 owner consumer 持有，本切片没有
复制或迁移它们。provider、SQLite/file persistence、clock、path 与 observability concrete
全部在 Adapter；Host 只绑定 concrete、启动组件并执行 `start/ready/degraded/failed/restart/
stop/dispose` 生命周期。

旧平级领域/技术目录、`foundation/`、Cognition `protocol/generated/`、旧 import/re-export
与兼容入口均已删除。内部 identity/persona/affect/experience/memory/conversation/context/
deliberation/volition 仍是同一进程、同一一致性边界中的领域模块，不为其制造逐模块 Port、
伪 RPC 或万能 EventBus。

| 层 | 职责 | 依赖约束 |
|---|---|---|
| `domain/` | 心智模型、不变量、内部模块 API 与领域事件 | 不依赖 generated、transport、Adapter、Host 或 IO concrete |
| `application/` | Cycle、维护、查询、跨领域 use case 与本地事务 | 依赖 Domain 与 Ports，不依赖 generated、transport 或 concrete |
| `ports/` | Kernel、推理、持久化、时钟、观测等真实外部能力 | 不为内部模块造 Port，不暴露 concrete |
| `adapters/` | gRPC、provider、persistence、config/path、clock、observability | 映射外部 DTO/Document 后再调用 Application/Domain |
| `host/` | 进程入口、composition 与受监督生命周期 | 唯一 concrete graph owner，不承载心智判断 |

## 入站链路

```text
Kernel CognitionService request
  -> adapters/kernel/grpc_transport.py
  -> adapters/kernel/inbound_adapter.py
  -> ports/kernel/inbound/kernel_request_port.py
  -> PerceptionEventQueue
  -> CycleController
```

入站 adapter 的职责是协议清洗、trace 继承、错误归类和语义归一化。平台字段必须在 Kernel/Extension 边界清洗；Cognition 只看到通用 scene/source/content/trace 语义。

外部平台注意力不进入 Cognition 私有模型。Extension Adapter 可以把平台上下文映射为 attention channel，由 Kernel `AttentionLeaseStore` 维护短期焦点；进入 Cognition 的仍是 `address_mode`、`response_policy`、`source`、`content` 等通用感知。`life_heartbeat` 只返回活性状态，不生成 Thought、不衰减情绪；`CycleController` 按 `CognitiveActivityPolicy` 自主调度认知节拍。群聊、直播间、频道线程等平台差异不得写进认知循环。

`PerceptionProvider` 只负责把规范化入站事件投放为 `WorkspaceItem`。`address_mode=direct` 的感知显著度固定为最高值，表示“有人正在叫她”，避免被长驻 internal drive 挡住回复链路；`ambient` 和其他模式才继续按 familiarity 计算背景显著度。`response_policy=observe_only` 不改变 Appraise/Experience/Memory 链路，但在 Deliberate 阶段直接沉默，不调用回复推理；Consolidate 写入的 `silence` 会标记 `reason=observe_only`，近期经历召回时跳过这类 silence 文本，只保留对应 `perception` 的实际内容。工作区同分时仍由来源优先级决定当前焦点，直接感知优先于 drive。

## 唯一认知循环

`application/cycle/controller.py` 的 `CycleController` 是感知到行动的主线，但不再持有所有阶段实现：

1. perception queue；
2. affect/activity/emotion/persona/profile/dialogue/identity；
3. context assembly；
4. memory/knowledge/relationship source；
5. reasoning service；
6. volition/arbiter；
7. experience recorder；
8. outbound kernel event port。

单拍临时状态全部进入 `application/cycle/turn.py` 的 `CycleTurn`，每拍开始即重建；`reply_context.py` 的 `ReplyContextBuilder` 独占回复上下文收集与 prompt 分区；`action_emitter.py` 的 `ActionEmitter` 独占 Intent 到 `ActionCommand` 的映射与发送；`continuity.py` 的 `CycleContinuity` 只在仲裁完成后写入真实发生的 user/assistant 轮、REPLY/ACTION/SILENCE Moment。当前通用循环不生产 Thought，控制器只保留阶段顺序、Provider 隔离、Appraise、Deliberate、Volition 和真实经历提交。

旧的“收到消息直接生成聊天回复”通路不得恢复。内部驱动只能通过 Provider 进入 Cycle；工具规划、记忆巩固和合成必须以主循环或明确请求型 use case 接入，且不能对同一感知重复产生互相冲突的 action。

当前 `CycleController` 的 Deliberate 阶段以 `application/cycle/action_planner.py` 中的 `CognitiveActionPlanner` 作为本拍行动语义源。内部结构化 ActionPlan prompt 输出 `reply`、`skill_request`、`ask_clarification` 或 `noop` 以及 `capability_kind`、`confidence`、`reason`：`reply` 才进入普通人设回复生成；高置信度且 `capability_kind != none` 的 `skill_request` 会停止普通回复并由 `ActionEmitter.to_command()` 发出 `ActionCommand{action_type:"skill_request"}`；`ask_clarification` 生成由 ActionPlan 显式触发的澄清 reply，不落入普通 reply fallback；`noop` 不发 reply/skill_request，并由 `CycleContinuity` 写 `reason=action_plan_noop` 的 `silence` Moment。Cognition 不读取 Skill catalog、不执行 handler，也不接触平台 IO；ReasoningService 不可用、ActionPlan 非法或低置信度时不会用关键词兜底触发工具。

`AgentPlanUseCase` 与 `AgentSynthesisUseCase` 通过 Cognition Service `Plan` / `Synthesize` 服务 Kernel 的 Skill 编排。普通聊天链路中的闭环是：`CycleController ActionPlan skill_request -> Kernel SkillActionController -> SkillPlanningAppService -> SkillInvocationGateway -> Synthesize -> ChannelReplyEvent`。工具使用决定写入 `action` Moment，工具结果写入带 provider/source/schema 的 `action_result` Moment，最终合成文本再以这些结果为因写入 `reply` Moment 并回写场景会话；结果仍是不可信输入，是否形成 Memory 由 Episode 巩固和 evidence 校验决定。`Synthesize` 的 system prompt 由 `PersonaInjector.build_persona_prompt()` 生成人设/profile/dialogue/safety 主体，再追加外部能力结果处理规则；Kernel 不拼接人格表达。

`application/activity/` 是认知资源调度的唯一 owner；状态模型与纯转换位于 `domain/activity/`。`projection.py` 只从真实 Perception、Reply、Action 重建最近活动；`transition.py` 纯计算 `engaged / ambient / quiescent` 迁移；`controller.py` 只写 activity metrics、log、span 和 `CognitiveActivitySnapshot`。Affect activation 只是衰减 hold 输入，外部 Attention Lease 不参与活动态计算，任何自动迁移都不写 Experience。

`application/maintenance/scheduler.py` 拥有独立异步任务和配置间隔。`ExperienceRecorder` 在写入 `reply` / `silence` 后发出进程内提示，Scheduler 立即投影并巩固对应 sealed Episode；提示本身不可靠，真实待办来自 Episode Projection，配置间隔会重新扫描并补偿。进入 `quiescent` 只唤醒一次 Scheduler 并请求封口。`CycleController` 的 Consolidate 阶段只通过 `CycleContinuity` 提交本拍真实 Moment，不直接调用记忆巩固，也不制造 Dreaming 或 Thought。

## 上下文与推理

```text
ContextAssembly
  -> application/context/sources/*
  -> memory / knowledge / relationship / episodic
  -> budget and ranking
  -> ReasoningService
  -> inference gateway / configured cloud provider
```

Context 是注意力预算控制器，不是字符串拼接器。新增上下文来源必须声明 owner、成本、优先级、失败语义和是否进入经历/记忆。

`ReplyContextBuilder` 按固定分区装配 system prompt：Conversation State、近期原始消息、相关历史 Segment、长期偏好、混合检索 Memory、角色知识、近期 Experience 和多模态描述。`ConversationController` 在查询前补投影并从 SQLite 恢复有界 Working Set；近期 Experience 排除当前 trace。所有来源在排序前先按 `recall_scope` 与 conversation/actor/scene owner 过滤，私聊不会因词项相似而召回群聊的 `space_local` 内容。`observe_only` 召回实际 perception，不把策略性 silence 渲染成角色主动沉默。

出站回复会先经过 `reply_text.py` 归一化：剥除情绪标签、移除高置信度括号动作，并为普通闲聊生成 `payload.messages` 自然分段；完整语义仍保留在 `payload.text`。代码块、列表、表格等结构化输出不做聊天式拆分。

角色 prompt 分层由 `domain/persona/` 下三类组件完成：

| 组件 | 输入 | 输出 |
|---|---|---|
| `PersonaProfileCompiler` | `profile.yaml` / `CharacterProfileConfig` | 稳定人格段、表达倾向、示例、情绪/场景行为映射 |
| `DialoguePolicyBuilder` | `dialogue.yaml` / `DialoguePolicyConfig` | 对外回复呈现策略，包括短句、括号动作、Markdown 与代码规则 |
| `PromptAssembler` | persona/profile/dialogue、当前情绪、场景行为和动态上下文 | 每轮 system prompt |

`PersonaInjector` 是对话人格装配门面，不提供知识库 persona 或旧 reflection persona 编译入口。`KnowledgeInitPayload` 只进入 `application/memory/knowledge_base.py`。

## 记忆、经历与持久化

| 组件 | 实现位置 | 语义 |
|---|---|---|
| Experience Ledger | `domain/experience/events.py`、`adapters/persistence/experience/ledger.py`、`application/experience/recorder.py` | 不可变 Moment、月度 SQLite pack、全局 position、来源与因果 |
| Conversation Projection | `application/conversation/controller.py`、`adapters/persistence/conversation/store.py` | 可重建的消息、Chapter、Segment、Conversation State 与进程 Working Set |
| Episode Projection | `adapters/persistence/experience/episodes.py` | interaction/scene 分段、封口、待巩固队列与可重建投影 |
| Memory Substrate | `application/memory/substrate.py`、`adapters/persistence/memory/memory_repo.py` | 版本化记忆、证据、时间有效修订与有预算召回 |
| Consolidation | `application/memory/consolidation.py`、`adapters/persistence/memory/consolidation_job_repo.py` | 持久任务、权限域分批、结构化推理、证据校验、lease 与重试 |
| Relationship | `adapters/persistence/memory/relationship_projection.py`、`relationship_repo.py` | 从 Ledger 幂等派生互动计数、熟悉度与证据修订 |
| Knowledge | `application/memory/knowledge_base.py`、`adapters/persistence/memory/knowledge_repo.py` | 知识条目 |
| Vector | `adapters/persistence/memory/vector_repo.py` | 按 provider/model/dimension 隔离的可重建 embedding 索引；默认不启用 |
| Memory Database | `adapters/persistence/memory/database.py` | `data/state/cognition/memory/memory.db` |

长期连续性由 Cognition 拥有。Kernel 可以收到投影或行动结果，但不直接写 Cognition DB。

记忆分层规则：

1. Kernel 从 `ConversationAddress` 生成 canonical `ConversationContext`；Cognition 不接受 Extension 自造 canonical ID。
2. Conversation Store 只从 Ledger 投影，Working Set 只从 Store 恢复；没有第二套短期记忆或 transcript 写回。
3. Ledger、Conversation Segment、Memory revision 与 RecentExperience 都携带 scope；过滤先于检索与 Prompt 拼装。
4. Extension 可提交规范化 perception 或 `evidenceProposal`，但不能读写 Conversation/Memory。

## 记忆闭环通电状态

当前真实数据流为：

```text
本地对话 / 外部事件
  -> Kernel PerceptionAppService / AttentionSessionManager
  -> Cognition PerceptionProvider
  -> CycleController Appraise
  -> Experience Ledger
  -> ConversationProjection + EpisodeProjection
  -> consolidation_jobs -> scope-partitioned ConsolidationCoordinator
  -> versioned Memory / Relationship / Knowledge / RecentExperienceSource
  -> token-budgeted Context Assembly
```

已经通电的链路：

- 本地和外部感知会进入统一 `PerceptionProvider`，由 `CycleController` 写入 PERCEPTION、EMOTION、REPLY 或 SILENCE Moment。
- `CycleContinuity` 只写本轮真实发生的 user/assistant Moment；`ConversationController` 从 Ledger 增量投影并为下一轮恢复上下文。
- `ExperienceRecorder` 会把 Moment 写入 `data/state/cognition/experience/packs/YYYY/YYYY-MM.experience.db`；`catalog.db` 维护全局 position 和 pack 范围。
- `EpisodeProjection` 按 interaction、scene、conversation 与 recall/disclosure 权限域形成可重建 Episode；同一个 Episode 在物理表和查询键上都不能跨域。`reply` / `silence` 立即形成 `interaction_completed` 边界，`episode_idle_seconds`、`quiescent` 与停机只补充收口开放批次。启动时按 `seal_integrity_check` 校验投影数据库，先补投影所有已提交 Moment，再将遗留开放批次标记为 `process_interrupted`；封口后同 interaction 的迟到 Moment 会进入新 Episode，不改写已封口批次。
- `MaintenanceScheduler` 在正常运行中由终结 Moment 唤醒，并按 `schedule_interval_seconds` 对持久待办补偿扫描；`ConsolidationCoordinator` 只处理 `memory_candidate`，先写 `consolidation_jobs`，再按 scope/owner 分批 claim。停机只投影、封口和入队，不执行模型巩固。输出必须通过结构、evidence id 与目标权限域校验后才可写入 Memory。
- `KnowledgeBase` 启动时通过 Cognition Service `InitializeKnowledge` 注入角色知识，`knowledge_entry` 可被活动上下文检索。
- 工具结果通过 `agent_synthesis` 写入 `action_result` Moment；成功结果最多成为记忆候选，失败结果只保留为 Experience。
- provider 缺失、非法输出或证据越权会记录 failed consolidation run，并保留 Episode 供后续重试；没有 mock fallback。

## 出站链路

```text
CycleController / use case
  -> ports/kernel/outbound/kernel_event_port.py
  -> adapters/kernel/outbound_adapter.py
  -> generated KernelControlService request
  -> Kernel gRPC host
```

出站必须区分 reply、thought、emotion、`skill_request`、action command 和错误结果。`skill_request` 只承载目标、场景和 Cognition 的语义理由；目录、权限、确认、调用、审计和工具结果归一化由 Kernel 完成。所有跨边界结构来自 `contracts/generated/python/` 的 Protobuf 模型，且只在 Adapter 边缘出现；不要手写 `dict` 让字段漂移。

## 调试入口

| 症状 | 先查 |
|---|---|
| Cognition 进程未 ready | `host/process.py` 启动、配置、DB、provider warmup、generation/PID 注册、gRPC readiness |
| 输入进来但无行动 | inbound adapter、perception queue、`CycleController` tick、volition |
| 回复空或异常 | context assembly、ReasoningService、LLMEngine、provider 错误 |
| 记忆异常 | `adapters/persistence/memory/database.py`、`memory_repo.py`、`application/memory/substrate.py`、consolidation run |
| trace 断裂 | inbound gRPC metadata/DTO、context/reasoning span、outbound adapter |
| 重启后状态丢失 | `data/state/cognition/`、Experience catalog/pack、Episode Projection、Memory revision |

## 验证

```powershell
cd core/cognition
uv run pytest -q
```

根目录的 `pnpm test` 会先执行同一组 Cognition 测试，再执行 Kernel 测试；不得让认知核退出全仓验收主线。

涉及 Kernel↔Cognition Service 时先在根目录运行：

```powershell
pnpm contracts:generate
pnpm contracts:verify
```

涉及 provider、模型、embedding 或数据库迁移时，还需要验证空态、缺模型、坏数据、重复迁移、限流/超时和 outbound 失败。

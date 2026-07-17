# Cognition 认知核实现

> 范围：Python Cognition 如何实现人格、情绪、认知活动、后台维护、经历、记忆、上下文、推理、认知循环和 Kernel IPC；不写 LLM prompt 全文或字段全表。
> 源码依据：`core/cognition/src/glimmer_cradle/cognition/host/`、`foundation/`、`activity/`、`maintenance/`、`cycle/`、`context/`、`inference/`、`memory/`、`experience/`、`ports/kernel/`、`protocol/generated/`。
> 维护触发：认知循环、DI、上下文来源、推理 provider、记忆/经历持久化、Kernel IPC、协议生成物或测试入口变化。

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
| `host/process.py` | Python 进程入口、配置加载、IPC server、生命周期监督 |
| `host/composition.py` | 唯一组装点，连接 event bus、DB、memory、inference、cycle、adapters |
| `ports/kernel/inbound/` | Kernel 入站感知与请求的协议适配 |
| `ports/kernel/outbound/` | 行动、状态、错误和事件回传 Kernel |
| `protocol/generated/` | 由 `protocol/src/schemas/` 生成的 Python 契约投影 |

Cognition 只依赖规范化感知、配置投影和生成契约。它不读取 Electron、平台 payload、Extension handler 或 Kernel 内部对象。

## 代码结构地图

以下是 Cognition 当前完整物理结构。`protocol/generated/` 内文件逐项列出用于审计，但其唯一 owner 仍是 `protocol/src/schemas/`，不得在 Python 侧手改。

```text
core/cognition/
├── .flake8
├── pyproject.toml
├── uv.lock
├── src/glimmer_cradle/cognition/
│   ├── __init__.py
│   ├── host/
│   │   ├── __init__.py
│   │   ├── process.py                 # 进程生命周期监督
│   │   └── composition.py             # 唯一 Composition Root 与冻结组件图
│   ├── foundation/
│   │   ├── __init__.py
│   │   ├── config.py                  # 生成配置的进程聚合根
│   │   ├── exceptions.py
│   │   ├── lifecycle.py
│   │   └── path_utils.py              # Cognition 数据路径解析
│   ├── activity/
│   │   ├── __init__.py
│   │   ├── controller.py              # 活动信号、状态生命周期与受控投影
│   │   ├── transition.py              # 无副作用状态转换
│   │   ├── policy.py                  # 三档资源策略与转换阈值
│   │   └── projection.py              # 从真实 Experience 重建活动时间线
│   ├── ports/
│   │   ├── __init__.py
│   │   └── kernel/
│   │       ├── __init__.py
│   │       ├── inbound/
│   │       │   ├── __init__.py
│   │       │   ├── kernel_request_port.py # 请求型应用端口
│   │       │   ├── kernel_event_adapter.py
│   │       │   ├── kernel_ingress_cortex.py
│   │       │   └── parsed_perception.py
│   │       └── outbound/
│   │           ├── __init__.py
│   │           ├── kernel_event_port.py
│   │           ├── kernel_event_adapter.py
│   │           └── kernel_bridge.py       # ZMQ 通信 Bridge
│   ├── cycle/
│   │   ├── __init__.py
│   │   ├── controller.py              # 九阶段顺序、竞争与 Volition
│   │   ├── turn.py                    # 单拍临时状态
│   │   ├── appraisal.py               # 多模态感知、情绪评价、感知 Moment
│   │   ├── deliberation.py            # ActionPlan 与角色回复推理
│   │   ├── action_planner.py          # 结构化行动语义规划
│   │   ├── action_emitter.py          # Intent -> ActionCommand
│   │   ├── continuity.py              # 会话与经历连续性提交
│   │   ├── reply_context.py           # 回复上下文分区装配
│   │   ├── reply_text.py              # 外发/历史共用文本归一化
│   │   ├── perception_queue.py
│   │   ├── workspace.py
│   │   ├── providers/
│   │   │   ├── __init__.py
│   │   │   ├── base.py
│   │   │   ├── perception.py
│   │   │   ├── affect.py
│   │   │   ├── memory.py
│   │   │   ├── drive.py
│   │   │   └── social.py
│   │   └── volition/
│   │       ├── __init__.py
│   │       ├── willingness.py
│   │       └── arbiter.py
│   ├── identity/
│   │   ├── __init__.py
│   │   └── self_entity.py             # 当前角色领域根，由组件图独占
│   ├── persona/
│   │   ├── __init__.py
│   │   ├── persona_injector.py
│   │   ├── profile_compiler.py
│   │   ├── dialogue_policy_builder.py
│   │   └── prompt_assembler.py
│   ├── affect/
│   │   ├── __init__.py
│   │   ├── emotion.py
│   │   └── rules.py
│   ├── context/
│   │   ├── __init__.py
│   │   ├── assembly.py
│   │   └── sources/
│   │       ├── __init__.py
│   │       ├── base.py
│   │       ├── episodic_source.py
│   │       ├── knowledge_source.py
│   │       └── relationship_source.py
│   ├── inference/
│   │   ├── __init__.py
│   │   ├── service.py                 # 按活动策略选择真实后端
│   │   ├── cloud.py
│   │   ├── gateway.py                 # LLM provider gateway
│   │   ├── content.py
│   │   ├── multimodal.py
│   │   └── embedding.py
│   ├── experience/
│   │   ├── __init__.py
│   │   ├── events.py                  # Moment/SourceDescriptor
│   │   ├── ledger.py                  # 不可变事实账本
│   │   ├── recorder.py                # 单写者门面
│   │   ├── episodes.py                # 可重建 Episode Projection
│   │   └── narrative.py               # 零 token 叙事投影
│   ├── conversation/
│   │   ├── controller.py              # Ledger 增量投影、恢复与 Prompt 查询门面
│   │   ├── store.py                   # 消息、Chapter、Segment、State SQLite 投影
│   │   └── models.py                  # Working Set 与查询模型
│   ├── memory/
│   │   ├── __init__.py
│   │   ├── substrate.py               # 版本化记忆与有界召回
│   │   ├── consolidation.py           # Episode 巩固协调器
│   │   ├── relationship_projection.py
│   │   ├── knowledge_base.py
│   │   └── storage/
│   │       ├── __init__.py
│   │       ├── database.py
│   │       ├── consolidation_job_repo.py
│   │       ├── memory_repo.py
│   │       ├── relationship_repo.py
│   │       ├── knowledge_repo.py
│   │       └── vector_repo.py
│   ├── maintenance/
│   │   ├── __init__.py
│   │   └── scheduler.py                # 语义边界唤醒、周期补偿与独立 Memory 维护任务
│   ├── application/
│   │   ├── base_use_case.py
│   │   ├── agent_plan_use_case.py
│   │   └── agent_synthesis_use_case.py
│   ├── observability/
│   │   ├── __init__.py
│   │   ├── logger.py
│   │   ├── trace_context.py
│   │   ├── tracer.py
│   │   ├── metrics.py
│   │   ├── model_invocations.py
│   │   └── telemetry.py
│   └── protocol/
│       ├── __init__.py
│       └── generated/
│           ├── __init__.py
│           ├── config/
│           │   ├── __init__.py
│           │   ├── app_config.py
│           │   ├── audio_config.py
│           │   ├── avatar_config.py
│           │   ├── character_manifest_config.py
│           │   ├── character_profile_config.py
│           │   ├── cognition_config.py
│           │   ├── dialogue_policy_config.py
│           │   ├── extension_config.py
│           │   ├── inference_config.py
│           │   ├── ingress_gate_config.py
│           │   ├── ipc_config.py
│           │   ├── knowledge_base_config.py
│           │   ├── knowledge_index_config.py
│           │   ├── lifecycle_config.py
│           │   ├── llm_config.py
│           │   ├── memory_config.py
│           │   ├── observability_config.py
│           │   ├── safety_config.py
│           │   ├── skill_plane_config.py
│           │   └── surface_config.py
│           ├── enums/
│           │   ├── __init__.py
│           │   ├── cognitive_activity_state.py
│           │   ├── error_code.py
│           │   ├── event_outcome.py
│           │   ├── ipc_message_type.py
│           │   ├── model_invocation_capture_mode.py
│           │   ├── memory_kind.py
│           │   ├── memory_status.py
│           │   ├── metric_kind.py
│           │   └── moment_kind.py
│           ├── ipc/
│           │   ├── __init__.py
│           │   ├── agent_plan_payload.py
│           │   ├── agent_plan_result.py
│           │   ├── agent_synthesis_payload.py
│           │   ├── kernel_message_envelope.py
│           │   ├── knowledge_init_payload.py
│           │   ├── life_heartbeat_payload.py
│           │   └── life_heartbeat_result.py
│           └── models/
│               ├── __init__.py
│               ├── action_command.py
│               ├── cognitive_activity_policy.py
│               ├── cognitive_activity_snapshot.py
│               ├── audit_record.py
│               ├── avatar_action_state_document.py
│               ├── channel_reply_payload.py
│               ├── extension_runtime_projection.py
│               ├── intent.py
│               ├── model_invocations_record.py
│               ├── observability_event.py
│               ├── perception_event.py
│               ├── presentation_downstream_frame.py
│               ├── presentation_upstream_frame.py
│               ├── runtime_readiness_catalog.py
│               ├── skill_catalog_snapshot.py
│               ├── trace_context.py
│               ├── visual_command.py
│               └── workspace_item.py
└── tests/
    ├── test_affect_memory_providers.py
    ├── test_agent_plan_use_case.py
    ├── test_agent_synthesis_use_case.py
    ├── test_cognitive_activity.py
    ├── test_context_assembly.py
    ├── test_cycle_controller.py
    ├── test_dlq_cli.py
    ├── test_drive_social_providers.py
    ├── test_experience_architecture.py
    ├── test_global_workspace.py
    ├── test_inference_gateway.py
    ├── test_knowledge_base_persist.py
    ├── test_model_invocations.py
    ├── test_memory_architecture.py
    ├── test_metrics.py
    ├── test_perception_cycle.py
    ├── test_perception_provider.py
    ├── test_persona_injector.py
    ├── test_provider_contracts.py
    ├── test_reasoning_service.py
    ├── test_reply_text.py
    ├── test_telemetry_facade.py
    ├── test_trace_context.py
    ├── test_tracer.py
    ├── test_vector_repo.py
    └── test_volition.py
```

`.venv/`、`.pytest_cache/`、`__pycache__/`、构建输出和本地数据均为可重建产物，不属于认知核源码架构，因此不纳入上树。

已删除且不得恢复的旧物理入口包括：`main.py`、`container.py`、`core/`、`ipc_server/`、`cognition/`、`reasoning/`、`llm_engine/`、`multimodal/`、`emotion_matrix/`、`arousal/`、`persistence/`、`narrative/`、`thought/`，以及 Kernel 驱动的并行主动思维用例。进程内唯一性由 `CognitionComponents` 所有权保证，不使用 `SelfEntity`、`PersonaInjector`、`KnowledgeBase` 或 `KernelBridge` Singleton。

| 目录 | 职责 | 关键风险 |
|---|---|---|
| `activity/` | 活动信号投影、三档状态与资源策略 | 把情感激活、外部焦点或 Experience 混入调度状态 |
| `cycle/` | controller、turn、workspace、perception queue、provider、volition、action emitter、continuity | 出现第二条回复主线或控制器重新吸收组件职责 |
| `context/` | episodic/knowledge/relationship 等上下文来源和预算装配 | prompt 拼接绕过预算 |
| `inference/` | ReasoningService、cloud provider、LLM gateway、可选 embedding 增强、多模态 | provider 错误无诊断、模型 ready 假阳性或生产 mock |
| `conversation/` | Ledger 派生的长期 Conversation、Chapter、Segment、State 与有界 Working Set | 把投影当事实源或在 scope 过滤前召回 |
| `memory/` | 版本化长期记忆、knowledge、relationship、consolidator | 状态写错 owner或跨权限域对账 |
| `memory/storage/` | cognition DB、repo、migration、vector/graph | 迁移不可重复或破坏数据 |
| `maintenance/` | Episode/Relationship projection 与 Memory 巩固的独立生命周期 | 重新挂回每拍认知循环或伪装成 Dreaming 人格状态 |
| `experience/` | Moment、recorder、log writer、snapshot、replay | 把日志当经历 |
| `identity/ persona/ affect/` | 自我实体、人设、情绪与情感激活 | 被 Kernel/UI 反向驱动 |
| `application/` | agent plan、agent synthesis 请求型用例 | 独立聊天回复主线复活 |

## 入站链路

```text
Kernel IPC frame
  -> ports/kernel/inbound/kernel_event_adapter.py
  -> kernel_ingress_cortex.py / kernel_request_port.py
  -> parsed_perception.py
  -> PerceptionEventQueue
  -> CycleController
```

入站 adapter 的职责是协议清洗、trace 继承、错误归类和语义归一化。平台字段必须在 Kernel/Extension 边界清洗；Cognition 只看到通用 scene/source/content/trace 语义。

外部平台注意力不进入 Cognition 私有模型。Extension Adapter 可以把平台上下文映射为 attention channel，由 Kernel `AttentionLeaseStore` 维护短期焦点；进入 Cognition 的仍是 `address_mode`、`response_policy`、`source`、`content` 等通用感知。`life_heartbeat` 只返回活性状态，不生成 Thought、不衰减情绪；`CycleController` 按 `CognitiveActivityPolicy` 自主调度认知节拍。群聊、直播间、频道线程等平台差异不得写进认知循环。

`PerceptionProvider` 只负责把规范化入站事件投放为 `WorkspaceItem`。`address_mode=direct` 的感知显著度固定为最高值，表示“有人正在叫她”，避免被长驻 internal drive 挡住回复链路；`ambient` 和其他模式才继续按 familiarity 计算背景显著度。`response_policy=observe_only` 不改变 Appraise/Experience/Memory 链路，但在 Deliberate 阶段直接沉默，不调用回复推理；Consolidate 写入的 `silence` 会标记 `reason=observe_only`，近期经历召回时跳过这类 silence 文本，只保留对应 `perception` 的实际内容。工作区同分时仍由来源优先级决定当前焦点，直接感知优先于 drive。

## 唯一认知循环

`cycle/controller.py` 的 `CycleController` 是感知到行动的主线，但不再持有所有阶段实现：

1. perception queue；
2. affect/activity/emotion/persona/profile/dialogue/identity；
3. context assembly；
4. memory/knowledge/relationship source；
5. reasoning service；
6. volition/arbiter；
7. experience recorder；
8. outbound kernel event port。

单拍临时状态全部进入 `cycle/turn.py` 的 `CycleTurn`，每拍开始即重建；`reply_context.py` 的 `ReplyContextBuilder` 独占回复上下文收集与 prompt 分区；`action_emitter.py` 的 `ActionEmitter` 独占 Intent 到 `ActionCommand` 的映射与发送；`continuity.py` 的 `CycleContinuity` 只在仲裁完成后写入真实发生的 user/assistant 轮、REPLY/ACTION/SILENCE Moment。当前通用循环不生产 Thought，控制器只保留阶段顺序、Provider 隔离、Appraise、Deliberate、Volition 和真实经历提交。

旧的“收到消息直接生成聊天回复”通路不得恢复。内部驱动只能通过 Provider 进入 Cycle；工具规划、记忆巩固和合成必须以主循环或明确请求型 use case 接入，且不能对同一感知重复产生互相冲突的 action。

当前 `CycleController` 的 Deliberate 阶段以 `cycle/action_planner.py` 中的 `CognitiveActionPlanner` 作为本拍行动语义源。内部结构化 ActionPlan prompt 输出 `reply`、`skill_request`、`ask_clarification` 或 `noop` 以及 `capability_kind`、`confidence`、`reason`：`reply` 才进入普通人设回复生成；高置信度且 `capability_kind != none` 的 `skill_request` 会停止普通回复并由 `ActionEmitter.to_command()` 发出 `ActionCommand{action_type:"skill_request"}`；`ask_clarification` 生成由 ActionPlan 显式触发的澄清 reply，不落入普通 reply fallback；`noop` 不发 reply/skill_request，并由 `CycleContinuity` 写 `reason=action_plan_noop` 的 `silence` Moment。Cognition 不读取 Skill catalog、不执行 handler，也不接触平台 IO；ReasoningService 不可用、ActionPlan 非法或低置信度时不会用关键词兜底触发工具。

`AgentPlanUseCase` 与 `AgentSynthesisUseCase` 通过 `agent_plan` / `agent_synthesis` IPC 服务 Kernel 的 Skill 编排。普通聊天链路中的闭环是：`CycleController ActionPlan skill_request -> Kernel SkillActionController -> SkillPlanningAppService -> SkillInvocationGateway -> agent_synthesis -> ChannelReplyEvent`。工具使用决定写入 `action` Moment，工具结果写入带 provider/source/schema 的 `action_result` Moment，最终合成文本再以这些结果为因写入 `reply` Moment 并回写场景会话；结果仍是不可信输入，是否形成 Memory 由 Episode 巩固和 evidence 校验决定。`agent_synthesis` 的 system prompt 由 `PersonaInjector.build_persona_prompt()` 生成人设/profile/dialogue/safety 主体，再追加外部能力结果处理规则；Kernel 不拼接人格表达。

`activity/` 是认知资源调度的唯一 owner。`projection.py` 只从真实 Perception、Reply、Action 重建最近活动；`transition.py` 纯计算 `engaged / ambient / quiescent` 迁移；`controller.py` 只写 activity metrics、log、span 和 `CognitiveActivitySnapshot`。Affect activation 只是衰减 hold 输入，外部 Attention Lease 不参与活动态计算，任何自动迁移都不写 Experience。

`maintenance/scheduler.py` 拥有独立异步任务和配置间隔。`ExperienceRecorder` 在写入 `reply` / `silence` 后发出进程内提示，Scheduler 立即投影并巩固对应 sealed Episode；提示本身不可靠，真实待办来自 Episode Projection，配置间隔会重新扫描并补偿。进入 `quiescent` 只唤醒一次 Scheduler 并请求封口。`CycleController` 的 Consolidate 阶段只通过 `CycleContinuity` 提交本拍真实 Moment，不直接调用记忆巩固，也不制造 Dreaming 或 Thought。

## 上下文与推理

```text
ContextAssembly
  -> context/sources/*
  -> memory / knowledge / relationship / episodic
  -> budget and ranking
  -> ReasoningService
  -> inference gateway / configured cloud provider
```

Context 是注意力预算控制器，不是字符串拼接器。新增上下文来源必须声明 owner、成本、优先级、失败语义和是否进入经历/记忆。

`ReplyContextBuilder` 按固定分区装配 system prompt：Conversation State、近期原始消息、相关历史 Segment、长期偏好、混合检索 Memory、角色知识、近期 Experience 和多模态描述。`ConversationController` 在查询前补投影并从 SQLite 恢复有界 Working Set；近期 Experience 排除当前 trace。所有来源在排序前先按 `recall_scope` 与 conversation/actor/scene owner 过滤，私聊不会因词项相似而召回群聊的 `space_local` 内容。`observe_only` 召回实际 perception，不把策略性 silence 渲染成角色主动沉默。

出站回复会先经过 `reply_text.py` 归一化：剥除情绪标签、移除高置信度括号动作，并为普通闲聊生成 `payload.messages` 自然分段；完整语义仍保留在 `payload.text`。代码块、列表、表格等结构化输出不做聊天式拆分。

角色 prompt 分层由 `persona/` 下三类组件完成：

| 组件 | 输入 | 输出 |
|---|---|---|
| `PersonaProfileCompiler` | `profile.yaml` / `CharacterProfileConfig` | 稳定人格段、表达倾向、示例、情绪/场景行为映射 |
| `DialoguePolicyBuilder` | `dialogue.yaml` / `DialoguePolicyConfig` | 对外回复呈现策略，包括短句、括号动作、Markdown 与代码规则 |
| `PromptAssembler` | persona/profile/dialogue、当前情绪、场景行为和动态上下文 | 每轮 system prompt |

`PersonaInjector` 是对话人格装配门面，不提供知识库 persona 或旧 reflection persona 编译入口。`KnowledgeInitPayload` 只进入 `memory/knowledge_base.py`。

## 记忆、经历与持久化

| 组件 | 实现位置 | 语义 |
|---|---|---|
| Experience Ledger | `experience/events.py`、`ledger.py`、`recorder.py` | 不可变 Moment、月度 SQLite pack、全局 position、来源与因果 |
| Conversation Projection | `conversation/controller.py`、`store.py` | 可重建的消息、Chapter、Segment、Conversation State 与进程 Working Set |
| Episode Projection | `experience/episodes.py` | interaction/scene 分段、封口、待巩固队列与可重建投影 |
| Memory Substrate | `memory/substrate.py`、`memory/storage/memory_repo.py` | 版本化记忆、证据、时间有效修订与有预算召回 |
| Consolidation | `memory/consolidation.py`、`memory/storage/consolidation_job_repo.py` | 持久任务、权限域分批、结构化推理、证据校验、lease 与重试 |
| Relationship | `memory/relationship_projection.py`、`memory/storage/relationship_repo.py` | 从 Ledger 幂等派生互动计数、熟悉度与证据修订 |
| Knowledge | `memory/knowledge_base.py`、`memory/storage/knowledge_repo.py` | 知识条目 |
| Vector | `memory/storage/vector_repo.py` | 按 provider/model/dimension 隔离的可重建 embedding 索引；默认不启用 |
| Memory Database | `memory/storage/database.py` | `data/state/cognition/memory/memory.db` |

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
- `KnowledgeBase` 启动时通过 `KNOWLEDGE_INIT` 注入角色知识，`knowledge_entry` 可被活动上下文检索。
- 工具结果通过 `agent_synthesis` 写入 `action_result` Moment；成功结果最多成为记忆候选，失败结果只保留为 Experience。
- provider 缺失、非法输出或证据越权会记录 failed consolidation run，并保留 Episode 供后续重试；没有 mock fallback。

## 出站链路

```text
CycleController / use case
  -> ports/kernel/outbound/kernel_event_port.py
  -> ports/kernel/outbound/kernel_bridge.py
  -> generated KernelMessageEnvelope / ActionCommand / payload
  -> Kernel IPC
```

出站必须区分 reply、thought、emotion、`skill_request`、action command 和错误结果。`skill_request` 只承载目标、场景和 Cognition 的语义理由；目录、权限、确认、调用、审计和工具结果归一化由 Kernel 完成。所有跨边界结构来自生成模型；不要手写 `dict` 让字段漂移。

## 调试入口

| 症状 | 先查 |
|---|---|
| Cognition 进程未 ready | `host/process.py` 启动、配置、DB、provider warmup、IPC bind/connect |
| 输入进来但无行动 | inbound adapter、perception queue、`CycleController` tick、volition |
| 回复空或异常 | context assembly、ReasoningService、LLMEngine、provider 错误 |
| 记忆异常 | `memory/storage/database.py`、`memory_repo.py`、`memory/substrate.py`、consolidation run |
| trace 断裂 | inbound trace、context/reasoning span、outbound bridge |
| 重启后状态丢失 | `data/state/cognition/`、Experience catalog/pack、Episode Projection、Memory revision |

## 验证

```powershell
cd core/cognition
uv run pytest -q
```

根目录的 `pnpm test` 会先执行同一组 Cognition 测试，再执行 Kernel 测试；不得让认知核退出全仓验收主线。

涉及 protocol 时先在根目录运行：

```powershell
pnpm sync:contracts
```

涉及 provider、模型、embedding 或数据库迁移时，还需要验证空态、缺模型、坏数据、重复迁移、限流/超时和 outbound 失败。

# Cognition 认知核实现

> 范围：Python Cognition 如何实现人格、情绪、认知活动、后台维护、经历、记忆、上下文、推理、认知循环和 Kernel Service 边界；不写 LLM prompt 全文或字段全表。
> 源码依据：`core/cognition/src/glimmer_cradle/cognition/` 下的 v2.1 owner roots 与 Host/Adapter 边界。
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
| `apps/cognition-worker/.../__main__.py` | Python Worker 进程入口 |
| `apps/cognition-worker/.../rpc_service.py` | Cognition Service host、Kernel client、wire mapper、可观测性与生命周期监督 |
| `apps/cognition-worker/.../composition.py` | 唯一组装点；配置投影、路径输入及 Core/Adapter concrete graph owner |
| `apps/cognition-worker/.../adapters/` | Capability、Content、Conversation、Job、Model 与 Resource 的进程边界实现 |
| `apps/cognition-worker/.../adapters/cognition_mapper.py` | 感知规范化、Knowledge、Plan/Synthesis 及模型事件的 wire/Port 映射 |
| `apps/cognition-worker/.../adapters/conversation_mapper.py` | Conversation Moment 与历史查询/结果的 wire/Port 映射 |
| `apps/cognition-worker/.../readiness.py` | Conversation/状态库/投影/Loop/注册/唤醒/首条状态同步的业务 ready 条件与 stopping/stopped 状态 |
| `apps/cognition-worker/.../shutdown.py` | 生产组件的有序停机图、幂等共享收尾任务与取消等待隔离 |
| `core/cognition/.../ports/` | 不依赖 generated DTO 的消费方契约与进程内边界模型 |

Cognition 只依赖规范化感知、配置投影和生成契约。它不读取 Electron、平台 payload、Extension handler 或 Kernel 内部对象。v5 Perception Moment 写引用与语义，v4 记录继续读取；`transient` 不写 Moment。旧 URI 媒体只做当拍兼容，不保证恢复；视频和音频不冒充视觉图片输入。参见 [ADR-0020](../decisions/ADR-0020-Content资产单写者与恢复边界.md)。

## 代码结构地图

Cognition 只保留五个源码职责根。Contract Spine 生成物位于仓库根
`contracts/generated/python/`，只能由 Kernel contract Adapter 引用，不得在 Cognition
侧手改或向 Application/Domain 泄漏。

```text
core/cognition/
├── pyproject.toml
├── src/glimmer_cradle/cognition/
│   ├── __init__.py
│   ├── attention/ perception/          # 感知规范化、候选竞争与 focus lease
│   ├── context/                        # 来源、预算、压缩与信任
│   ├── state/ planning/ loop/          # 状态、计划与唯一迭代 Loop
│   ├── memory/ knowledge/ persona/     # 记忆、知识与人格 owner
│   ├── inference/                      # 通用请求/事件、模型 Port 与策略
│   ├── ports/                          # Cognition 消费方能力边界
│   └── adapters/persistence/           # Core-owned SQLite adapters
└── migrations/                         # 版本化 Cognition 数据迁移
apps/cognition-worker/src/glimmer_cradle/cognition_worker/
├── composition.py                      # 唯一 Composition Root 与 WorkerPaths
├── rpc_service.py                      # transport、观测与进程生命周期
├── readiness.py shutdown.py
└── adapters/                           # 外部能力 concrete 与 mapper
└── tests/
    └── test_architecture_layout.py     # 真实 import/dynamic-import 分层门
```

Worker `rpc_service.py` 接受 Kernel 注入且已校验的原始配置 Document，`composition.py` 将其
映射为 immutable settings，并由 `WorkerPaths` 解析安装根与 Local Data Domain 后向 Core
SQLite adapter、模型 provider、资产读取和可观测性注入具体路径。Core 不读取进程环境或
generated wire 类型；Worker 绑定 concrete、启动组件并执行
`start/ready/degraded/failed/restart/stop/dispose` 生命周期。

RPC Service 通过两个 mapper 转换现行 Contract Spine DTO，调用 Core/Conversation 的消费方 Port。
感知请求先映射与校验，再接纳 operation identity；非法请求重试不能产生 accepted 确认或污染 registry。
生成 wire、代次、trace、权限域、恢复 metadata 与兼容 Plan/Synthesis 字段继续采用唯一 Contract Spine。

Worker 启动逐项记录实际完成条件，首条状态同步成功前仍为 starting；Kernel 在同一请求 deadline 内
等待本代 ready，拒绝旧代、停机、降级与超时。Knowledge 初始化可在启动窗口进行，但普通感知、规划、
合成和历史查询须业务 ready。Shutdown ACK 前撤销 ready，拒绝新业务请求，保留控制查询与取消入口。
生产 Host 通过 shutdown coordinator 按主循环、RPC、认知生产者、投影、Conversation 单写者、领域库、
Kernel client、遥测的顺序收尾；RPC 取消的在途任务完成后才关闭领域库。并发停止共用一次回收，取消等待者
不取消收尾，单步异常不跳过后续组件；局部启动失败也回收 transport 与启动期遥测。

Python 主仓库通过根 uv workspace/lock 统一解析依赖。开发启动在共享根 `.venv` 中以 inexact sync
准备 Worker，保留 Audio 已安装 extras；安装态由产品显式注入独立解释器路径。

旧平级领域/技术目录、`foundation/`、Cognition `protocol/generated/`、旧 import/re-export
与兼容入口均已删除。内部 identity/persona/affect/experience/memory/conversation/context/
deliberation/volition 仍是同一进程、同一一致性边界中的领域模块，不为其制造逐模块 Port、
伪 RPC 或万能 EventBus。

| 层 | 职责 | 依赖约束 |
|---|---|---|
| Cognition owner roots | Attention、Context、Inference、Knowledge、Loop、Memory、Perception、Persona、Planning 与 State | 不依赖 generated、transport、Worker 或平台 IO concrete |
| `ports/` | Kernel、推理、持久化、时钟、观测等真实外部能力 | 不为内部模块造 Port，不暴露 concrete |
| Core `adapters/persistence/` | Cognition 自有 SQLite persistence | 接收显式数据库与迁移路径，不解析进程环境 |
| Cognition Worker | gRPC、provider、路径、时钟、标识与 observability concrete | 唯一进程 concrete graph owner，不承载心智判断 |

## 入站链路

```text
Kernel CognitionService request
  -> adapters/kernel/grpc_transport.py
  -> adapters/kernel/inbound_adapter.py
  -> ports/kernel/inbound/kernel_request_port.py
  -> ObservationNormalizer / ObservationQueue
  -> LoopController
```

入站 adapter 的职责是协议清洗、trace 继承、错误归类和语义归一化。平台字段必须在 Kernel/Extension 边界清洗；Cognition 只看到通用 scene/source/content/trace 语义。

外部平台注意力不进入 Cognition 私有模型。Extension Adapter 可以把平台上下文映射为 attention channel，由 Kernel `AttentionLeaseStore` 维护短期焦点；进入 Cognition 的仍是 `address_mode`、`response_policy`、`source`、`content` 等通用感知。`life_heartbeat` 只返回活性状态，不生成 Thought、不衰减情绪；`LoopController` 按 `CognitiveActivityPolicy` 自主调度认知节拍。群聊、直播间、频道线程等平台差异不得写进认知循环。

`PerceptionProvider` 只负责把规范化入站事件投放为 `Attention`。`address_mode=direct` 的感知显著度固定为最高值，表示“有人正在叫她”，避免被长驻 internal drive 挡住回复链路；`ambient` 和其他模式才继续按 familiarity 计算背景显著度。`response_policy=observe_only` 不改变 Appraise/Experience/Memory 链路，但在 Deliberate 阶段直接沉默，不调用回复推理；Consolidate 写入的 `silence` 会标记 `reason=observe_only`，近期经历召回时跳过这类 silence 文本，只保留对应 `perception` 的实际内容。`AttentionController` 同分时由来源优先级决定当前 focus，直接感知优先于 drive；内部 `CognitiveAttentionLease` 在本次处理期间固定 focus，并在消费、淘汰、取消或过期时释放。

## 唯一认知循环

`loop/loop_controller.py` 的 `LoopController` 是感知到行动的主线；迁移期阶段 helpers 仍在 `application/cycle/`，最终将并入目标 owner：

1. perception queue；
2. affect/activity/emotion/persona/profile/dialogue/identity；
3. context assembly；
4. memory/knowledge/relationship source；
5. reasoning service；
6. volition/arbiter；
7. experience recorder；
8. outbound kernel event port。

跨进程感知在 gRPC Adapter 只解释 wire enum/DTO，随后必须经 `perception/observation_normalizer.py`
校验 canonical Conversation identity、trace/interaction、payload digest、scope 与策略字段，再进入有界
`ObservationQueue`。队列满时明确返回被淘汰 Observation 以关闭对应 operation；非法未绑定输入返回
`INVALID_REQUEST`，不能以内存默认值进入 Cycle。旧 `application/cycle/perception_queue.py` 已删除。

单拍临时状态全部进入 `loop/step.py` 的 `LoopStep`，每拍开始即重建；`reply_context.py` 的 `ReplyContextBuilder` 独占回复上下文收集与 prompt 分区；`action_emitter.py` 的 `ActionEmitter` 独占 Intent 到 `ActionCommand` 的映射与发送；`continuity.py` 的 `CycleContinuity` 只在仲裁完成后写入真实发生的 user/assistant 轮、REPLY/ACTION/SILENCE Moment。当前通用循环不生产 Thought，控制器只保留阶段顺序、Provider 隔离、Appraise、Deliberate、Volition 和真实经历提交。循环以 expected revision 把拍数和运行终态写入独立 checkpoint；启动时先把遗留 `running` 状态落为 `interrupted`，再进入新一轮运行。

原生模型/工具迭代由 `LoopController.run_native()` 承担。模型事件中的 `ToolCall` 不再先分类为 `skill_request`；Loop 仅接受本 Step 经 `CapabilityPort.expose()` 暴露的能力名称，使用 `run_id + call_id` 形成稳定幂等键，把执行结果作为下一次模型请求的 `capability_results`。`StopPolicy` 同时限制 Step、能力调用次数和输出字符数；非法调用、未曝光能力和不完整事件流显式失败，不做关键词或静默降级。当前 Host 仍使用下述 ActionPlan 兼容链，待 Cognition Worker 的 capability adapter 接线后删除。

跨 owner 依赖由 `ports/{clock,content,conversation,capability,job,resource}_port.py` 描述，具体 Content blob、Conversation Log、Capability execution、Jobs scheduler 与 Resource registry 实现不得进入 Cognition Core。迁移期已有同进程对象尚未全部改接这些 Port；Cognition Worker mapper 接线和旧 Host 删除是结束条件。

旧的“收到消息直接生成聊天回复”通路不得恢复。内部驱动只能通过 Provider 进入 Cycle；工具规划、记忆巩固和合成必须以主循环或明确请求型 use case 接入，且不能对同一感知重复产生互相冲突的 action。

当前 `LoopController` 的 Deliberate 阶段以 `planning/PlanningController` 作为本拍行动语义源。内部结构化 ActionPlan prompt 输出 `reply`、`skill_request`、`ask_clarification` 或 `noop` 以及 `capability_kind`、`confidence`、`reason`：`reply` 才进入普通人设回复生成；高置信度且 `capability_kind != none` 的 `skill_request` 会停止普通回复并由 `ActionEmitter.to_command()` 发出 `ActionCommand{action_type:"skill_request"}`；`ask_clarification` 生成由 ActionPlan 显式触发的澄清 reply，不落入普通 reply fallback；`noop` 不发 reply/skill_request，并由 `CycleContinuity` 写 `reason=action_plan_noop` 的 `silence` Moment。每次真实规划或显式降级写入 `data/state/cognition/planning.sqlite`，供同一 trace 审计与恢复；Cognition 不读取 Skill catalog、不执行 handler，也不接触平台 IO。InferenceController 不可用、ActionPlan 非法或低置信度时不会用关键词兜底触发工具。

`AgentPlanUseCase` 与 `AgentSynthesisUseCase` 通过 Cognition Service `Plan` / `Synthesize` 服务 Kernel 的 Skill 编排。普通聊天链路中的闭环是：`LoopController ActionPlan skill_request -> Kernel SkillActionController -> SkillPlanningAppService -> SkillInvocationGateway -> Synthesize -> ChannelReplyEvent`。工具使用决定写入 `action` Moment，工具结果写入带 provider/source/schema 的 `action_result` Moment，最终合成文本再以这些结果为因写入 `reply` Moment 并回写场景会话；结果仍是不可信输入，是否形成 Memory 由 Episode 巩固和 evidence 校验决定。`Synthesize` 的 system prompt 由 `PersonaCompiler.build_persona_prompt()` 生成人设/profile/dialogue/safety 主体，再追加外部能力结果处理规则；Kernel 不拼接人格表达。

`state/` 是情绪与认知资源状态的唯一 owner。`cognitive_state.py` 定义 affect/activity 状态和资源策略，`decay.py` 纯计算情绪衰减与 `engaged / ambient / quiescent` 迁移，`state_controller.py` 从真实 Perception、Reply、Action 重建最近活动并驱动生命周期。`SqliteStateStore` 使用 `001-state.sql` 和 expected revision 写入 `data/state/cognition/state.sqlite`；冷启动把快照与 Conversation Log 的更新事实合并。控制器不把自动迁移写成 Experience；Kernel 外部 Attention Lease 也不参与活动态计算。

`application/maintenance/scheduler.py` 拥有独立异步任务和配置间隔。Conversation `ConversationRecorder` 在写入 `reply` / `silence` 后发出进程内提示，Scheduler 立即投影并巩固对应 sealed Episode；提示本身不可靠，真实待办来自 Episode Projection，配置间隔会重新扫描并补偿。进入 `quiescent` 只唤醒一次 Scheduler 并请求封口。`LoopController` 的 Consolidate 阶段只通过 `CycleContinuity` 提交本拍真实 Moment，不直接调用记忆巩固，也不制造 Dreaming 或 Thought。

## 上下文与推理

```text
ContextAssembler
  -> context/{source,trust,budget,compaction}.py
  -> application/context/sources/*（迁移中的具体 source adapters）
  -> memory / knowledge / relationship / episodic
  -> budget and ranking
  -> InferenceController
  -> inference model port / configured provider adapter
```

Context 是注意力预算控制器，不是字符串拼接器。`context/` 已成为 v2.1 canonical owner：候选分别携带
数据可信度与 instruction authority，外部/记忆文本不能自行升级为 user/system 指令；retrieval 配额由
`ContextBudget` 显式缩放，单项超限由 `ContextCompactor` 保留来源信息地截断，零预算明确终止。
`ContextAssembler` 统一执行来源异常隔离、信任降级、相关度排序与预算选择；MemoryProvider 将信任和权威
标签继续传播到 Workspace。新增上下文来源必须声明 owner、成本、优先级、失败语义和是否进入经历/记忆。

`inference/` 是 provider-neutral 推理 owner：`request.py` / `event.py` 定义文本、多模态及流事件，
`model_port.py` 定义模型与 realtime 外部能力边界，`InferenceController` 按 Cognitive Activity model tier
执行禁止、本地限定或 cloud→local 显式 fallback。供应商 HTTP、密钥、payload 与响应提取只在
Worker `adapters/model_client.py`；Core `ModelPort.generate` 为异步消费契约，CloudReasoning、
视觉专家、兼容 Plan/Synthesis 与 Memory 巩固直接 await。模型与云 Embedding 使用 HTTPX 异步
连接，取消不再遗留同步网络线程；Embedding 重试等待可取消，不重试已取消请求。
Provider 错误只暴露安全状态/类型，第三方请求日志不输出 URL；本地 CPU Embedding 线程计算仍需
后续独立生命周期收束。`RealtimeSession` 用 generation、单调 sequence 和 terminal 状态拒绝陈旧取消及晚到帧。

`ReplyContextBuilder` 按固定分区装配 system prompt：Conversation State、近期原始消息、相关历史 Segment、长期偏好、混合检索 Memory、角色知识、近期 Experience 和多模态描述。`ConversationController` 在查询前补投影并从 SQLite 恢复有界 Working Set；近期 Experience 排除当前 trace。所有来源在排序前先按 `recall_scope` 与 conversation/actor/scene owner 过滤，私聊不会因词项相似而召回群聊的 `space_local` 内容。`observe_only` 召回实际 perception，不把策略性 silence 渲染成角色主动沉默。

出站回复会先经过 `reply_text.py` 归一化：剥除情绪标签、移除高置信度括号动作，并为普通闲聊生成 `payload.messages` 自然分段；完整语义仍保留在 `payload.text`。代码块、列表、表格等结构化输出不做聊天式拆分。

角色 prompt 与稳定资料由目标 `persona/` owner 完成：

| 组件 | 输入 | 输出 |
|---|---|---|
| `profile.py` | Character Package 的 manifest/profile/dialogue/safety | 不可变 PersonaProfile、稳定人格段、表达策略及安全边界 |
| `revision.py` | PersonaProfile | 确定性内容摘要、单调 revision 与前序链接 |
| `mutation_policy.py` | expected revision、来源、权限、请求者和原因 | 显式授权或失败关闭 |
| `compiler.py` | 当前 revision、情绪与 address mode | 每轮 system prompt 与安全边界校验 |

`PersonaCompiler` 是现行运行时门面，不提供知识库 persona 或旧 reflection persona 编译入口。模型与 Memory 无权改写稳定资料；获授权更新也必须形成可审计 revision。`KnowledgeInitialization` 只进入 `knowledge/KnowledgeIndex` 的授权 ingestion。

## 记忆、经历与持久化

| 组件 | 实现位置 | 语义 |
|---|---|---|
| Conversation Log | `core/conversation/src/glimmer_cradle/conversation/log/` | 交互事实的不可变 Moment、月度 SQLite pack、全局 position、来源与因果；Cognition 只读消费 |
| Conversation Projection | `core/conversation/src/glimmer_cradle/conversation/{message,history}/` | Conversation owner 的可重建消息、Chapter、Segment、Conversation State 与进程 Working Set；Cognition Worker 只负责组合与消费 |
| Episode Projection | `adapters/persistence/sqlite_memory_store.py` 的 `EpisodeProjection` | 分段、封口与派生 checkpoint；同库持久源请求钉住 Episode 身份，不能整体删除重建 |
| Memory Controller | `memory/{memory,memory_controller,memory_store,provenance,correction}.py`、`adapters/persistence/sqlite_memory_store.py` | 版本化记忆、证据、时间有效修订、纠错与有预算召回 |
| Consolidation | `memory/consolidation.py`、`adapters/persistence/sqlite_memory_store.py` 的 `ConsolidationJobRepository` | 持久任务、权限域分批、结构化推理、证据校验、lease 与重试；Job adapter 待迁入 Jobs owner |
| Relationship | `adapters/persistence/sqlite_memory_store.py` 的 `RelationshipProjection` / `RelationshipRepository` | 从 Conversation Log 幂等派生互动计数、熟悉度与证据修订 |
| Knowledge | `knowledge/`、`adapters/persistence/sqlite_knowledge_store.py`、`migrations/003-knowledge.sql` | 来源受控、版本化、可失效的知识条目与独立索引 |
| Vector | `adapters/persistence/sqlite_memory_store.py` 的 `VectorRepository` | 按 provider/model/dimension 隔离的可重建 embedding 索引；默认不启用 |
| Memory Database | `adapters/persistence/sqlite_memory_store.py`、`migrations/002-memory.sql` | `data/state/cognition/memory.sqlite`；Job/checkpoint 表仍处于拆库迁移窗口 |

共享 Memory 连接的读写由 `SqliteMemoryStore.read()` / `transaction()` 串行化；Memory、Vector、
Relationship、关系 checkpoint 与旧巩固队列不再各自 commit。写事务使用 IMMEDIATE，BEGIN/业务写入/
commit 取消均等待回滚收尾再允许连接复用，回滚失败撤销并关闭连接；关闭本身被取消也先完成资源释放。
新库 DDL 与 schema metadata 在同一初始化事务，失败/取消不留下半初始化表。关系 checkpoint 只向前推进。
模型推理、向量编码和跨进程调用不在这些事务内；已提交但确认被取消不能推断未写入。

Memory schema 6 将修订/evidence、`memory_consolidation_receipts` 与每个 Episode/version 的
`memory_consolidation_inputs` 索引同事务提交；receipt 保存 operation、scope、输入/输出摘要、结果
Memory ID 与提交时间，不保存模型原文。noop 也形成结果 receipt。相同 operation/input/output 重复返回
原结果；输入 scope/digest 漂移、同 operation 输出冲突、重复修订同一 Memory 或无 receipt 的既有同批修订
均拒绝，不以 revision 去重伪装完整提交。

真实 `ConsolidationCoordinator` 先按 Episode/version 查询结果，再推理未确认项；重启后即使分批大小改变、
模型不可用或派生缓存刷新失败，也可从原结果修复缓存、队列与 Episode 投影，不重复推理已提交项。
旧巩固队列的 complete/fail 只接受对应 claimed attempt，完成批次中任一 attempt 失效则全部回滚。
Memory 的 Jobs 接收边界由 `memory_job_attempts` / `memory_job_authority` 持有：App 从 Contract Spine
映射原 job/scope/attempt/epoch/token/owner/deadline；登记与封口持久化，推理返回后的 IMMEDIATE 提交
重新检查身份、authority 和 lease，最终结果接纳 SQL 再检查数据库时钟。attempt applied、业务修订与 receipt
同事务提交；新 attempt/authority 和对账封口均拒绝旧提交。对账未知 attempt 先保存 sealed tombstone，
不能只查空结果就返回 not-applied；错误身份不封口真实 attempt。证据 ID 与观测时间跨重启保持稳定。

Worker 真实 composition 将同一个 `ConsolidationCoordinator` 注入受监督 `CognitionGrpcHost`，由
`ExecuteMemoryJob` / `ReconcileMemoryJob` 映射生成契约；Kernel 迁移期 transport 暴露同一 RPC。
对账是会持久封口的命令，不是无副作用的查询；generation 鉴权、readiness、取消和停机继续使用原 Service
边界。源 request outbox 已在真实 Episode 封口中写入；Host 投递 wire 与 Jobs handler/query adapter 已落位，生产 scheduler 与配置装配仍待接线，旧队列仍保留
既定退出门。不自动升级用户 v3/v4/v5 库；受控迁移、备份与恢复归阶段 14。

四个 Memory Jobs RPC 只在 `ConsolidationCoordinator(jobs=None)` 的外部 Jobs 模式开放。
实际 Worker CLI/Host/composition 已接 `memory_jobs_owner` 显式选择；默认产品入口仍为 legacy，
旧模式 RPC 返回 NOT_READY，禁止两套 owner 双消费。选择在 Log 单写者建立、Memory 连接后、维护
启动前通过 `select_consolidation_dispatch()` 原子持久绑定。未完成旧任务拒绝转交；external 绑定或
已有外部 attempt 拒绝 legacy 启动，旧 repository 的每个写事务检查该屏障。它仅为旧队列迁移窗口，
不是第二 authority，删除条件归执行记录。外部模式的维护只投影、封口和整理源请求，不直接运行模型；启用策略、salience 与
已提交结果由 Memory owner 判定，扫描源请求不会对已完成业务再次推理。
`apps/host/src/composition/cognition-job-adapter.ts` 先持久 Jobs 源 inbox/enqueue 再源 ACK；App 映射
完整源信封摘要（含首次 createdAt），Jobs 保持源 request/hash 与 Job ID 稳定，并恢复首次政策。
重投不以新配置或当前 retry due 替代首次 due/预算；事实/业务内容或 retry mode 漂移仍拒绝。
源 ACK 已提交但响应丢失后，源扫描不再返回该请求，已接纳 Job 继续执行；不以本地响应判断源回滚。
源最小快照与终态 tombstone 的保留规则见 [数据布局](../../reference/data-layout.md)。
App 将生成 `JobExecutionIdentity` 映射到 `ExecuteMemoryJob`，由 `ReconcileMemoryJob` 获取原 attempt
证据；只接受 `cognition.memory`、完全匹配的 identity、持久封口和有效证据摘要，业务结果排除易变 duplicate
提示。本地 AbortSignal 中断 RPC 后，App 通过独立的有界对账调用封口原 attempt，不复用已取消 signal；
封口不可用或业务已先提交时不得解释为回滚。`cancelled` 是撤销请求状态，不是未产生 Memory 副作用证明，
最终生产状态事件接纳仍须呈现真实业务结果/不确定性。`CognitionClient` 不发现或自造监督身份，端点/generation 由监督 owner 注入并在切代时关闭。
该 App 边界已纳入 workspace 与根 build/typecheck/test，真实跨进程验收使用 Worker Service、Memory/Log
与 Jobs SQLite。
`apps/host/src/composition/host.ts` 的 `HostJobsController` 以一个可取消 timer 连续驱动源投递、
到期恢复、有界 unknown 分页、Memory kind 的到期执行和可注入的状态接收方。前一轮完全结束才开始
下一轮；首个 unknown 暂不可查询不阻塞后续页。重复 start 共用同一启动 Promise；停机先撤销循环
signal 与执行接纳，等待在途封口和循环后关闭当前 generation client，注入 Store 则由装配方随后关闭。
快照只描述 Memory Jobs：源 RPC 未 ready/暂不可用时 degraded，unknown 未解决时
`jobs_recovery_pending`，authority 失效或非法 source/evidence 则 failed 并撤销 client；不得借此宣称
整个产品 ready。未注入持久状态 receiver 时 outbox 保持待确认，不能假 ACK。实例持有政策副本，
源已接纳工作跨重启恢复首次政策。Host 已通过 `HostJobsOwner` 注入实际持久 authority 并接通
续期/撤销/drain 确认，具体机制见 [Platform authority](./Platform原语实现.md#authority-与受控转移)。
生产进程 supervisor、配置/authority 路径加载、状态事件 wire/inbox
与旧队列/旧数据切换仍待完成。

`episodes.db` 的 `memory_request_outbox` 与 Episode 封口及 projection checkpoint 同事务提交，保存
稳定 request ID、Episode/version/scope/input digest、首次记录时间、接纳 Job ID 与源已解决标记，
不保存模型原文或复制 Moment 内容。摘要由源发布与接收执行共用的 `consolidation_input()` 生成，
证据不完整则拒绝提交；没有 `memory_candidate` 的 Episode 不发布请求。
`pending_job_requests()` 有界扫描未接纳且未解决项；`acknowledge_job_request()` 验证原请求完整身份，
重复同 Job 确认幂等，不同 Job 或 payload 拒绝。接纳不标记 Memory 完成；巩固/跳过结果与源解决标记
在同一投影事务更新，业务完成后迟到的接纳 ACK 仍可保存。旧 sealed 待办启动时增量补齐，不重算 Episode ID。
逻辑 Episode 仍由 Log 派生，但本物理库已含不可再生投递身份；只要存在源请求，普通 `rebuild()` 就拒绝。
该同库迁移窗口由 Cognition Memory 持有，阶段 14 在备份、原身份保持、outbox 恢复与 consumer-zero
验证后切换最终状态布局，不能把删除整个库当作索引维护。

长期交互连续性由 Conversation 拥有；Cognition 拥有 Experience、Memory、Persona 与推理语义。Kernel 可以收到投影或行动结果，但不直接写 Cognition/Conversation DB。

记忆分层规则：

1. `core/conversation` 从 `ConversationAddress` 生成 canonical `ConversationContext`；Kernel 注入 Platform identity，Cognition 不接受 Extension 自造 canonical ID。
2. Conversation History 只从 Conversation Log 投影，Working Set 只从 History 恢复；没有第二套短期记忆或 transcript 写回。
3. Conversation Log、Conversation Segment、Memory revision 与 RecentExperience 都携带 scope；过滤先于检索与 Prompt 拼装。
4. Extension 可提交规范化 perception 或 `evidenceProposal`，但不能读写 Conversation/Memory。

## 记忆闭环通电状态

当前真实数据流为：

```text
本地对话 / 外部事件
  -> Kernel PerceptionAppService / AttentionSessionManager
  -> Cognition PerceptionProvider
  -> LoopController Appraise
  -> Conversation Log
  -> ConversationProjection + EpisodeProjection
  -> consolidation_jobs -> scope-partitioned ConsolidationCoordinator
  -> versioned Memory / Relationship / Knowledge / RecentExperienceSource
  -> token-budgeted ContextAssembler
```

已经通电的链路：

- 本地和外部感知会进入统一 `PerceptionProvider`，由 `LoopController` 写入 PERCEPTION、EMOTION、REPLY 或 SILENCE Moment。
- `CycleContinuity` 只写本轮真实发生的 user/assistant Moment；`core/conversation` 的 `ConversationController` 从 canonical Conversation Log 增量投影并为下一轮恢复上下文。Cognition 只通过 Conversation Port 消费，不拥有日志写入与历史投影实现。
- Conversation `ConversationRecorder` 会把 Moment 写入兼容路径 `data/state/cognition/experience/packs/YYYY/YYYY-MM.experience.db`；`catalog.db` 维护全局 position 和 pack 范围。路径迁移留阶段 14，不改变当前 owner。
- `EpisodeProjection` 按 interaction、scene、conversation 与 recall/disclosure 权限域形成派生 Episode；同一个 Episode 在物理表和查询键上都不能跨域。`reply` / `silence` 立即形成 `interaction_completed` 边界，`episode_idle_seconds`、`quiescent` 与停机只补充收口开放批次。所有封口入口同事务发布源请求，失败不推进 checkpoint 或封口状态。启动时按 `seal_integrity_check` 校验投影数据库，先补投影所有已提交 Moment，再将遗留开放批次标记为 `process_interrupted`；封口后同 interaction 的迟到 Moment 会进入新 Episode，不改写已封口批次。源请求存在时禁止整体删除重建。
- `MaintenanceScheduler` 在正常运行中由终结 Moment 唤醒，并按 `schedule_interval_seconds` 对持久待办补偿扫描；`ConsolidationCoordinator` 只处理 `memory_candidate`，先写 `consolidation_jobs`，再按 scope/owner 分批 claim。停机只投影、封口和入队，不执行模型巩固。输出必须通过结构、evidence id 与目标权限域校验后才可写入 Memory。
- `KnowledgeIndex` 启动时通过 Cognition Service `InitializeKnowledge` 注入角色知识，`knowledge_entry` 可被活动上下文检索；首次独立库启动会从旧 Memory 表一次性导入，随后不双写。
- 工具结果通过 `agent_synthesis` 写入 `action_result` Moment；成功结果最多成为记忆候选，失败结果只保留为 Experience。
- provider 缺失、非法输出或证据越权会记录 failed consolidation run，并保留 Episode 供后续重试；没有 mock fallback。

## 出站链路

```text
LoopController / use case
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
| 输入进来但无行动 | inbound adapter、perception queue、`LoopController` tick、volition |
| 回复空或异常 | context assembly、InferenceController、LLMEngine、provider 错误 |
| 记忆异常 | `adapters/persistence/sqlite_memory_store.py`、`memory_controller.py`、consolidation run |
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

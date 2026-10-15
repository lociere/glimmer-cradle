# Cognition 认知核实现

> 范围：Python Cognition 如何实现人格、情绪、认知活动、后台维护、经历、记忆、上下文、推理、认知循环和 Kernel Service 边界；不写 LLM prompt 全文或字段全表。
> 源码依据：`core/cognition/src/glimmer_cradle/cognition/` 下的 v2.1 owner roots 与 Host/Adapter 边界。
> 维护触发：认知循环、DI、上下文来源、推理 provider、记忆/经历持久化、Kernel Service transport、协议生成物或测试入口变化。

## 目录

- [入口与组装](#入口与组装)
- [代码结构地图](#代码结构地图)
- [入站链路](#入站链路)
- [唯一认知循环](#唯一认知循环)
- [长期承诺与 Jobs 源请求](CognitionPlanning实现.md#长期承诺与-jobs-源请求)
- [上下文与推理](#上下文与推理)
- [记忆、经历与持久化](CognitionMemory与Knowledge实现.md#记忆经历与持久化)
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

Core 接收规范化感知、配置投影和消费方 Port，生成 wire 由 Worker 映射；心智域不导入 DTO，也不读取 Electron、平台 payload、Extension handler 或 Kernel 内部对象。v5 Perception Moment 写引用与语义，v4 记录继续读取；`transient` 不写 Moment。旧 URI 媒体只做当拍兼容，不保证恢复；视频和音频不冒充视觉图片输入。参见 [ADR-0020](../decisions/ADR-0020-Content资产单写者与恢复边界.md)。

## 代码结构地图

Cognition 按领域 owner 分根。Contract Spine 生成物位于仓库根
`contracts/generated/python/`，只能由 Worker transport/mapper 引用，不得在 Cognition
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

旧 host、domain/application 技术分组和 Core 内的 provider/transport 已拆到当前 owner；
不能从历史目录恢复一套兼容入口。内部逻辑仍按真实消费方和一致性边界组合，不为每个类制造 Port、
伪 RPC 或万能 EventBus。Conversation Log/History 的 owner 为独立 Conversation 模块。

| 层 | 职责 | 依赖约束 |
|---|---|---|
| Cognition owner roots | Attention、Context、Inference、Knowledge、Loop、Memory、Perception、Persona、Planning 与 State | 不依赖 generated、transport、Worker 或平台 IO concrete |
| `ports/` 与各领域 Port | 跨 owner 能力、模型、存储、时钟与观测的消费契约 | 不为内部模块造 Port，不暴露 concrete |
| Core `adapters/persistence/` | Cognition 自有 SQLite persistence | 接收显式数据库与迁移路径，不解析进程环境 |
| Cognition Worker | gRPC、provider、路径、时钟、标识与 observability concrete | 唯一进程 concrete graph owner，不承载心智判断 |

## 入站链路

```text
Kernel CognitionService request
  -> Worker rpc_service.py / adapters/cognition_mapper.py
  -> Core ports / perception/observation_normalizer.py
  -> ObservationNormalizer / ObservationQueue
  -> LoopController
```

入站 adapter 的职责是协议清洗、trace 继承、错误归类和语义归一化。平台字段必须在 Kernel/Extension 边界清洗；Cognition 只看到通用 scene/source/content/trace 语义。

外部平台注意力不进入 Cognition 私有模型。Extension Adapter 可以把平台上下文映射为 attention channel，由 Kernel `AttentionLeaseStore` 维护短期焦点；进入 Cognition 的仍是 `address_mode`、`response_policy`、`source`、`content` 等通用感知。`life_heartbeat` 只返回活性状态，不生成 Thought、不衰减情绪；`LoopController` 按 `CognitiveActivityPolicy` 自主调度认知节拍。群聊、直播间、频道线程等平台差异不得写进认知循环。

`PerceptionProvider` 只负责把规范化入站事件投放为 `Attention`。`address_mode=direct` 的感知显著度固定为最高值，表示“有人正在叫她”，避免被长驻 internal drive 挡住回复链路；`ambient` 和其他模式才继续按 familiarity 计算背景显著度。`response_policy=observe_only` 不改变 Appraise/Experience/Memory 链路，但在 Deliberate 阶段直接沉默，不调用回复推理；Consolidate 写入的 `silence` 会标记 `reason=observe_only`，近期经历召回时跳过这类 silence 文本，只保留对应 `perception` 的实际内容。`AttentionController` 同分时由来源优先级决定当前 focus，直接感知优先于 drive；内部 `CognitiveAttentionLease` 在本次处理期间固定 focus，并在消费、淘汰、取消或过期时释放。

## 语义与来源边界

规范化感知携带身份、来源、scope、retention ceiling 与回复许可：observe-only 可被观察，不因此获得回复或外部动作权限。
短期 attention/workspace 候选不等于持久交互事实；Conversation 只写已发生 Moment，History 可重建，
Cognition 通过 Port 派生 Episode/有证据 Memory 与独立 Knowledge。稳定身份不是模型即时推断，外部内容不升级为指令或 persona。
精确实体语义由 [Conversation](Conversation实现.md) 与[记忆/知识](CognitionMemory与Knowledge实现.md)一处解释。

Worker business-ready 与 Memory Jobs ready 分开：前者核对 `readiness.py`/RPC 的真实 gate，
后者还需要 Host handler、原源请求/receipt、状态投递和实际产品 consumer。局部装配或历史跨进程 PASS 不证明默认产品已切换。

## 唯一认知循环

`loop/loop_controller.py` 的 `LoopController` 是感知到行动的主线；阶段处理由 `loop/step.py` 等当前领域文件提供：

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

单拍临时状态进入 `loop/step.py` 的 `LoopStep`，每拍重建；`context/assembler.py` 的
`ReplyContextBuilder` 收集上下文与 prompt 分区；`loop/run.py` 的 `ActionEmitter` 映射 Intent，
`CycleContinuity` 在仲裁后提交 REPLY/SILENCE。原生 ToolCall 的 ACTION 与结果接纳沿
Capability/Conversation adapter 单独落实，不伪造外显意图。当前通用循环不生产 Thought。
REPLY/SILENCE 跨过真实 Log flush 屏障后才完成持久 Turn；提交失败落为 failed，取消落为 interrupted，
不把缓冲 append 冒充 durable receipt。循环以 expected revision 保存拍数和终态；启动将遗留 running 落为 interrupted，再启动新运行，
这个周期 checkpoint 不是持久原生 Run 的恢复证明。

原生模型/工具迭代由 `LoopController.run_native()` 承担。模型事件中的 `ToolCall` 不再先分类为
`skill_request`；每个 Step 重新请求 `CapabilityPort.expose()`，校验 Run/Step 及唯一名称，调用绑定
该 Step 的定义 ID/revision，而不是模型自报版本。Tool、Skill 摘要、Resource 是独立模型输入。
使用 `run_id + call_id` 形成稳定幂等键，校验返回调用身份后把已接纳结果作为下一次模型请求的
`InferenceRequest.history`：每项 `InferenceStep` 保留该次助手文本、完整 `ModelToolCall` 与真实结果，
供应商 adapter 据此续接，不把结果伪装成用户消息。`capability_results` 只保留消费兼容元数据，
不是另一历史 owner。最终回复只取最后无调用 Step，之前文本仍计入输出预算。
模型协议的通用 `glimmer_load_skill` / `glimmer_read_resource` 加载操作选择独立目录，不给每个
方法注册假 Tool。Core 将方法/资源 ID 绑定到当次曝光的定义 revision，实际 reader 参数与原始
助手调用参数分别保留；加载与业务 Tool 共用调用预算、意愿、重复身份和未知结果闸。
正文和资源内容只作为不可信结果续接，不进入 system 人格、执行权限或 Memory。
`StopPolicy` 限制 Step、能力调用次数、输出字符和总时长；整个调用批次在首个副作用前验证身份、
参数与预算。未完成流不派发，重复 ID、未知副作用、未曝光能力失败关闭；提前退出立即关闭流。

Worker `CapabilityClient` 已删除虚构的字典 `capability.expose/invoke` transport，消费 typed
`CapabilityService` 的真实 gRPC client。它绑定完整 Conversation/交互/隐私上下文，先写原生
ToolCall/方法加载/资源读取 ACTION 并刷盘，才携原事实引用派发。响应只定位真实 Log 接纳的结果事件；scope、
交互、定义版本、调用身份或终态投影冲突、receipt 缺失均失败，wire result 不冒充经历或 Memory。
生产 Worker composition 已把真实 `ModelClient` 和按完整当前感知创建的 `CapabilityClient` 注入
同一 Loop；canonical `source_provider_id` 从 DTO 经 Observation 传递，不从 Actor/origin 猜测。
ToolCall ACTION 关联实际 Perception，结果保持原 ACTION 引用，最终 REPLY 关联已接纳结果。
默认普通聊天已经切换原生链，但完整 Host 权限/持久 Run broker 仍未完成，不能称整体 ready。
`ReadSkill` / `ReadResource` 使用唯一生成 RPC 外壳与共享加载内容定义；实际正文限 16 KiB、
资源 UTF-8 内容限 32 KiB。资源定义 revision 与内容 SHA-256 分开，Worker 从已接纳 Log
核验 reference/hash/media 后才续接。旧无实现的 `resource.read` 字典 transport 已删除；
`resource_client.py` 分别拥有原生加载的内容解码和显式 Knowledge 采集/复验 Adapter，二者不提升
彼此权限。受控来源的持久采集、live Context、可信 App 管理 RPC 与显式审批重启重采集已接通，
详见下文；供应商主动订阅、产品权限 UI 和持久 Run 恢复仍未完成，原生 Step 材料不会自动提升为 Knowledge。

跨 owner 依赖由 `ports/{clock,content,conversation,capability,job,resource}_port.py` 描述，具体 Content blob、Conversation Log、Capability execution、Jobs scheduler 与 Resource registry 实现不得进入 Cognition Core。迁移期已有同进程对象尚未全部改接这些 Port；Cognition Worker mapper 接线和旧 Host 删除是结束条件。

旧的“收到消息直接生成聊天回复”通路不得恢复。内部驱动只能通过 Provider 进入 Cycle；工具规划、记忆巩固和合成必须以主循环或明确请求型 use case 接入，且不能对同一感知重复产生互相冲突的 action。

生产 Deliberate 使用 persona/context 构造同一个原生推理请求，不再先用 ActionPlan 分类普通聊天。
`observe_only` 不推理；只有当前 `cloud_allowed` 进入已装配云 stream，`local_only`/`none` 不提升为云。
每次推理前重验 tier，每次曝光和实际工具派发前按 direct/reactive 或 ambient/proactive 意愿复验。
最终回复仍经人格边界、Intent 仲裁与 ActionEmitter。模型/执行失败关闭真实 Turn，不冒充成功沉默。
短程 ActionPlan 分类器、分类常量、旧 Goal、Loop 的非原生推理入口及 SkillRequest 意图/发送分支已删除；
测试直接消费原生事件，不保留改名分类器或直调推理 fallback。长程 Planning/承诺及下面明确请求型
Plan/Synthesis 不随其删除。`PlanningDecisionSnapshot` 只读旧 `planning_decision` 原始字段；
`SqlitePlanningStore.latest_decision_snapshot()` 不解释行动/能力、不授予权限、不恢复待执行请求，
旧 record/latest 写入/ActionPlan 重建入口已删除。旧表、索引与 migration 保留历史数据和重开路径，
不删除用户行、不隐式迁库；不再产生新的短程决策。

`AgentPlanUseCase` 与 `AgentSynthesisUseCase` 通过 Cognition Service `Plan` / `Synthesize` 服务仍未迁移的 Kernel Skill 编排。保留链路是：`Kernel SkillActionController -> SkillPlanningAppService -> SkillInvocationGateway -> Conversation 接纳结果 -> Synthesize -> ChannelReplyEvent`，不再是生产普通聊天入口。原 ACTION 刷盘与已接纳结果引用保持，Synthesis 不写第二份执行事实；其人格主体仍由 Core 编译，不由 Kernel 拼接。缺失/冲突引用不合成，外部结果仍是 experience/untrusted 观察，不直接成为 Memory。接纳规则见[Conversation 实现](Conversation实现.md#history-与恢复)。

现行 `Plan` 的方法目录、选择引用和正文独立于 Tool 建议：Core Port 使用 `SkillSummary`、
`SkillReference`、`SkillMaterial`，Worker mapper 消费唯一生成 DTO。第一次模型输入只含目录，
最多选择两份匹配定义 revision 的方法；App 复验后以不可信材料提供正文、保持原用户目标。
模型输出不能扩大可用 Tool，方法正文及 allowed-tools 不授予权限、不作为执行结果或 Memory
事实。引用/重复身份/正文预算在进入模型前校验；正文不拼入 system 人设。此接线仍服务
上述请求型兼容编排；原生加载沿上文独立链路，不能据此声明完整 CapabilityPort broker 已完成。

`state/` 是情绪与认知资源状态的唯一 owner。`cognitive_state.py` 定义 affect/activity 状态和资源策略，`decay.py` 纯计算情绪衰减与 `engaged / ambient / quiescent` 迁移，`state_controller.py` 从真实 Perception、Reply、Action 重建最近活动并驱动生命周期。`SqliteStateStore` 使用 `001-state.sql` 和 expected revision 写入 `data/state/cognition/state.sqlite`；冷启动把快照与 Conversation Log 的更新事实合并。控制器不把自动迁移写成 Experience；Kernel 外部 Attention Lease 也不参与活动态计算。

`memory/consolidation.py` 的 `MaintenanceScheduler` 拥有独立异步任务和配置间隔。Conversation `ConversationRecorder` 在写入 `reply` / `silence` 后发出进程内提示，Scheduler 立即投影并巩固对应 sealed Episode；提示本身不可靠，真实待办来自 Episode Projection，配置间隔会重新扫描并补偿。进入 `quiescent` 只唤醒一次 Scheduler 并请求封口。`LoopController` 的 Consolidate 阶段只通过 `CycleContinuity` 提交本拍真实 Moment，不直接调用记忆巩固，也不制造 Dreaming 或 Thought。

## 长期承诺

长期承诺与普通工具迭代的状态、身份和生命周期不同，详细来源、评估、Jobs、通知与恢复见
[Planning 组件说明](CognitionPlanning实现.md)。接纳、执行完成、目标 completed 与真实送达分别核验。

## 上下文与推理

```text
ContextAssembler
  -> context/{source,trust,budget,compaction}.py
  -> context/assembler.py（ReplyContextBuilder 与来源装配）
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
Worker `adapters/model_client.py`（阶段 9 supplier Extension 迁移窗口）；Core `ModelPort.generate` 为异步消费契约，CloudReasoning、
视觉专家、兼容 Plan/Synthesis 与 Memory 巩固直接 await。模型与云 Embedding 使用 HTTPX 异步
连接，取消不再遗留同步网络线程；Embedding 重试等待可取消，不重试已取消请求。
Provider 错误只暴露安全状态/类型，第三方请求日志不输出 URL；本地 CPU Embedding 线程计算仍需
后续独立生命周期收束。`RealtimeSession` 用 generation、单调 sequence 和 terminal 状态拒绝陈旧取消及晚到帧。

`ModelClient` 已删除无生产实现的字典 ModelTransport，直接连接同一 LLMEngine 的真实 SSE。
原生流只支持现行 OpenAI-compatible `openai`/`deepseek` 路由，优先显式 provider key，否则
使用配置的 default_route/根模型；自定义 body/extractor 或其他格式明确失败，不猜测供应商模型。
保留实际 assistant tool_calls 与 role=tool 的 call ID 续接，格式依据
[官方工具流说明](https://developers.openai.com/api/docs/guides/function-calling)。按 index 汇集交错参数，
只有合法 finish_reason 与 DONE、完整 object JSON 才输出 ToolCall；截断/过滤/重复键或 ID 拒绝。
请求 1 MiB、流 2 MiB、frame 256 KiB、单调用参数 64 KiB 有界；取消和输出提前退出关闭实际 socket。
这不等于所有 provider、音频/realtime 或跨重启 Run/checkpoint 已实现。

`ReplyContextBuilder` 按固定分区装配 system prompt：Conversation State、近期原始消息、相关历史 Segment、长期偏好、混合检索 Memory、角色知识、近期 Experience 和多模态描述。`ConversationController` 在查询前补投影并从 SQLite 恢复有界 Working Set；近期 Experience 排除当前 trace。所有来源在排序前先按 `recall_scope` 与 conversation/actor/scene owner 过滤，私聊不会因词项相似而召回群聊的 `space_local` 内容。`observe_only` 召回实际 perception，不把策略性 silence 渲染成角色主动沉默。

出站回复会先经过 `loop/step.py` 的 `normalize_reply_text` 归一化：剥除情绪标签、移除高置信度括号动作，并为普通闲聊生成 `payload.messages` 自然分段；完整语义仍保留在 `payload.text`。代码块、列表、表格等结构化输出不做聊天式拆分。

角色 prompt 与稳定资料由目标 `persona/` owner 完成：

| 组件 | 输入 | 输出 |
|---|---|---|
| `profile.py` | Character Package 的 manifest/profile/dialogue/safety | 不可变 PersonaProfile、稳定人格段、表达策略及安全边界 |
| `revision.py` | PersonaProfile | 确定性内容摘要、单调 revision 与前序链接 |
| `mutation_policy.py` | expected revision、来源、权限、请求者和原因 | 显式授权或失败关闭 |
| `compiler.py` | 当前 revision、情绪与 address mode | 每轮 system prompt 与安全边界校验 |

`PersonaCompiler` 是现行运行时门面，不提供知识库 persona 或旧 reflection persona 编译入口。模型与 Memory 无权改写稳定资料；获授权更新也必须形成可审计 revision。`KnowledgeInitialization` 只进入 `knowledge/KnowledgeIndex` 的授权 ingestion。

## 记忆与知识

来源、保留上限、修订、权限失效、巩固和 Memory Jobs 的详细链路由
[Memory 与 Knowledge 组件说明](CognitionMemory与Knowledge实现.md) 维护。
工具 action_result 的 canonical 事件、untrusted 内容与记忆候选不能混为一谈；该页保留当前接线及未验窗口。

## 出站链路

```text
LoopController / use case
  -> ActionEmitter / 注入的 action_sink
  -> Worker rpc_service.py 的 Kernel client
  -> generated KernelControlService PublishAction request
  -> Kernel gRPC host
```

当前 `loop/run.py` 的 `ActionEmitter.to_command()` 只将已仲裁的 reply 转成输出命令，并可附带情绪快照；
原生工具调用走注入的 Capability Port，结果由 Conversation 接纳，不经旧 SkillRequest 意图分支。
Worker 的 `publish_action()` 仍保留现行 wire 的 `skill_request` 字段映射，这是兼容边缘，不能据此称 Loop 仍产生该意图。
跨进程 DTO 由 Worker 边缘消费 `contracts/generated/python/` 的唯一模型；Core 内部命令投影与 wire DTO 分开，
不另建手写 DTO 或把生成类型引入心智领域。

## 调试入口

| 症状 | 先查 |
|---|---|
| Cognition 进程未 ready | Worker `__main__.py`、`rpc_service.py`、`readiness.py`；配置、DB、provider、generation/PID 注册与首条状态同步 |
| 输入进来但无行动 | inbound adapter、perception queue、`LoopController` tick、volition |
| 回复空或异常 | context assembly、InferenceController、LLMEngine、provider 错误 |
| 记忆异常 | `adapters/persistence/sqlite_memory_store.py`、`memory_controller.py`、consolidation run |
| trace 断裂 | inbound gRPC metadata/DTO、context/reasoning span、outbound adapter |
| 重启后状态丢失 | `data/state/cognition/`、Experience catalog/pack、Episode Projection、Memory revision |

## 验证

```powershell
uv run --frozen --no-sync --project core/cognition --extra dev pytest -q core/cognition/tests
```

上述命令在依赖已准备好的仓库根运行。根 `pnpm test` 委派 `test:all`，经过版本/架构与构建后覆盖各领域、
Worker 和产品测试，实际顺序由根 package.json 维护；定向 Cognition 测试不能代表全套门已通过。

改变 Service/Document 契约时在根目录运行生成与验证；只调试现有接口时按实际 fixture 取证：

```powershell
pnpm contracts:generate
pnpm contracts:verify
```

涉及 provider、模型、embedding 或数据库迁移时，还需要验证空态、缺模型、坏数据、重复迁移、限流/超时和 outbound 失败。

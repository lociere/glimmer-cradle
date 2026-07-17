# Configuration Reference

> 范围：系统配置、Cognition 配置、Extension 配置、密钥、环境变量和运行时投影的权威规则。
> 事实依据：`configs/`、`protocol/src/schemas/config/`、配置 normalizer、Kernel/Cognition/Desktop/Engine/Extension 读取代码。
> 维护触发：新增配置文件、配置键、默认值、密钥来源、Schema、normalizer、UI 配置投影或 owner 变化。

## 配置域

| 域 | 目录/入口 | 主要 owner | 消费者 |
|---|---|---|---|
| 系统配置 | `configs/system/*.yaml` | Kernel | Kernel、Desktop 投影、Engine runtime、Skill Plane |
| Character Package 配置 | `configs/characters/<character-id>/*.yaml`、`knowledge/*.md` | Cognition | 当前激活角色的最小身份、作者种子、对话策略、provider、知识和推理 |
| Extension 配置 | `configs/extensions/*.yaml` | Extension Host | 对应扩展、Kernel Extension runtime |
| Extension manifest | `data/packages/extensions/<id>/<version>/extension-manifest.yaml` | 已安装扩展包 | Extension Host、Skill Plane、权限检查 |
| 密钥 | `configs/secrets/` 或环境变量 | 用户/部署环境 | Provider、MCP、扩展、模型服务 |
| 环境变量 | `GLIMMER_CRADLE_*` 等显式覆盖 | 启动环境 | Kernel/Engine/Avatar/Provider |
| UI 投影 | Electron main/Kernel 提供的受控模型 | 对应 owner | Renderer |

普通配置不得包含密钥明文。Renderer 不直接读取 YAML 或 secret 文件；它只能消费受控投影，并通过白名单 API 请求保存允许编辑的配置。

`configs/system/identity.yaml` 必须显式提供 `character.active_id` 和 `character.profile_root`。Kernel 启动不会创建缺失的系统配置、Character Package 文件或目录，也不会回退到某个内置角色；当前选择的角色包缺少 manifest、persona、dialogue、safety、inference、provider 或知识索引时，启动应明确失败。开发仓库的受版本控制模板以及未来安装器负责初始配置投影。

## 变更规则

- 新配置必须有 Schema 或显式 normalizer，并说明默认来源。
- 一个配置键只有一个写入 owner；其他 runtime 只能消费投影。
- 路径配置必须经过 resolver，不能在业务代码拼接源码相对路径或安装相对路径。
- 密钥只允许引用“存在/缺失/来源”状态，不显示明文。
- 需要重启的配置必须在 UI/日志中显式标记，不能静默延迟生效。
- 删除配置键时同步迁移、旧键搜索、文档和示例。

## 常见配置文件职责

| 文件 | 职责 |
|---|---|
| `configs/system/kernel.yaml` | Kernel lifecycle、transport、Ingress、runtime 总控 |
| `configs/system/avatar.yaml` | Avatar 启停、Presentation 端口、UnityAvatarHost 启动策略和情绪映射 |
| `configs/system/surfaces.yaml` | Desktop Surface 与 Desktop Shell 端口；不拥有 Avatar |
| `configs/system/audio.yaml` | TTS/ASR 启停、TTS 路由、韧性、缓存和 provider 执行参数 |
| `configs/system/embedding.yaml` | 可选语义向量增强、选定 provider 与执行参数 |
| `configs/system/skills.yaml` | Skill Plane、MCP server、user skill 等能力 provider 配置 |
| `configs/system/observability.yaml` | 日志、trace、metrics、DLQ、模型调用观测、保留期、index 与 diagnostic bundle 策略 |
| `configs/system/memory.yaml` | Conversation 工作集/投影、Experience、长期记忆巩固任务与混合召回策略 |
| `configs/system/identity.yaml` | 系统身份、默认标识和 active character 选择 |
| `configs/characters/<character-id>/character.manifest.yaml` | 该角色包身份、最小名称锚点、persona mode 与目录声明 |
| `configs/characters/<character-id>/profile.yaml` | 该角色的作者人格种子：身份事实、性格轴、关系姿态、情绪行为、场景行为、表达倾向 |
| `configs/characters/<character-id>/dialogue.yaml` | 该角色的对话呈现策略：短句、复杂回复、括号动作、Markdown/代码和分段规则 |
| `configs/characters/<character-id>/safety.yaml` | 该角色的红线和安全边界 |
| `configs/characters/<character-id>/inference.yaml` | 该角色的推理参数与 provider 行为 |
| `configs/characters/<character-id>/providers.yaml` | 该角色的 LLM provider 路由和可用性 |
| `configs/characters/<character-id>/voice.yaml` | 该角色的稳定声音身份、表达参数和 provider 声线绑定 |
| `configs/characters/<character-id>/knowledge/index.yaml` | 该角色的 Knowledge Vault 索引，正文为 `knowledge/*.md` |
| `configs/extensions/active.yaml` | Extension 激活集合；每项包含精确 `id` 与 `version` |
| `configs/extensions/*.yaml` | 单个扩展的运行配置 |

## Character Package 配置

Character Package 是角色作者设定的事实源，不是 RAG 资料库：

| 文件 | Schema | 语义 |
|---|---|---|
| `character.manifest.yaml` | `CharacterManifestConfig` | 角色包身份、最小名称锚点、`persona_mode`、资产/知识/迁移目录 |
| `profile.yaml` | `CharacterProfileConfig` | 稳定人格作者种子；不进入向量库，不由运行时改写 |
| `dialogue.yaml` | `DialoguePolicyConfig` | 输出呈现策略；不承载人格事实 |
| `safety.yaml` | `SafetyConfig` | 红线和安全边界；不承载人格叙述或外部知识 |
| `voice.yaml` | `VoiceConfig` | 声音身份、语言、表达和 provider voice id；不承载密钥或系统路由 |
| `knowledge/index.yaml` | `KnowledgeIndexConfig` | 外部知识索引；Kernel 加载 Markdown 后组装为 `KnowledgeBaseConfig` |

`profile.yaml` 由 Cognition 的 `PersonaProfileCompiler` 编译为稳定人格段；`dialogue.yaml` 由 `DialoguePolicyBuilder` 编译为输出策略；`PromptAssembler` 再组合 persona segment、dialogue policy、当前情绪、场景行为和动态上下文。记忆巩固使用独立结构化指令，不复用对外聊天格式，也不改写 profile。

角色设定、情绪行为、示例台词、安全边界和表达规则不允许放进 `knowledge/`。发现这类内容时，应迁入 `profile.yaml`、`dialogue.yaml` 或 `safety.yaml`，而不是新增知识条目。

## Character Inference 配置

`configs/characters/<character-id>/inference.yaml` 的 `life_clock` 只配置 Kernel 侧活性探测和外部注意力触发参数，不拥有 Cognition 的活动调度。

| 键 | Owner | 语义 |
|---|---|---|
| `heartbeat_enabled` | Kernel LifeClock | 是否发送无状态活性探测；主动行为由 Cognition `CognitiveActivityPolicy.allows_proactive` 与 Volition 决定。 |
| `heartbeat_interval_ms` | Kernel LifeClock | 未收到 Cognition `state_sync` 频率提示时的兜底探测间隔。收到 `CognitiveActivityPolicy.frequency_hint_ms` 后以活动策略频率为准。 |
| `focus_duration_ms` | Kernel Attention | Extension 或系统申请临时焦点时使用的默认 lease 时长。 |
| `ingress_debounce_ms` / `ingress_focused_debounce_ms` | Kernel AttentionSession | 入站感知合并窗口；是否使用 focused 窗口由 `AttentionProjection.mode` 决定。 |
| `ingress_max_batch_messages` / `ingress_max_batch_items` | Kernel AttentionSession | 单次入站批处理上限。 |
| `summon_keywords` / `focus_on_any_chat` | Kernel Attention Trigger | 外部消息如何触发 Attention Lease；不直接改变 Cognition `CognitiveActivityState`。 |

旧 `focused_interval_ms`、`ambient_interval_ms`、`default_mode` 和 `active_thought_modes` 已退出当前契约。不要通过配置 attention mode 来表达主动性；活动调度属于 Cognition Cognitive Activity，外部焦点属于 Kernel Attention Projection，最终是否行动属于 Volition。

## System Audio 配置

`configs/system/audio.yaml` 是音频能力启停的系统事实源，Schema 为 `AudioConfig`。Control Center 通过 Electron main 的受控投影编辑它；Renderer 不直接读写 YAML。

TTS 与 ASR 默认关闭。二者是可选输入/表达增强，不是基础运行形态的 readiness 前提；未启用时状态为 `disabled/stopped`，系统整体仍为 ready。只有用户显式启用后，provider 缺密钥、缺模型、超时或失败才属于该能力的 unavailable/degraded。

| 键 | Owner | 语义 |
|---|---|---|
| `tts.enabled` | Kernel AudioService | 是否启用角色语音生成。关闭后不启动 TTS lane。 |
| `tts.route.primary/fallbacks` | Audio Engine | 有序 TTS 路线；当前只有 `dashscope-cosyvoice`，fallback 为空。 |
| `tts.route.circuit_breaker.*` | Audio Engine | 连续失败阈值和恢复窗口。 |
| `tts.cache.*` | Kernel AudioService | 是否缓存，以及按修改时间计算的最大保留天数。 |
| `tts.providers.dashscope-cosyvoice.*` | CosyVoice adapter | endpoint、model、格式、采样率、超时和有界重试。 |
| `asr.enabled/provider/resource_id` | Audio Engine | FunASR 启停与资源选择；provider 当前固定为 `funasr`。 |

`voice.yaml` 的 `bindings.dashscope-cosyvoice.voice_id` 为空时，TTS 明确 unavailable，不生成替代声线。API Key 使用 `DASHSCOPE_API_KEY`，或写入 `configs/secrets/secrets.yaml` 的 `audio.dashscope.api_key`；环境变量优先，明文不进入普通配置和日志。未来微调 TTS provider 通过相同路由契约接入后，可成为 primary，并把 CosyVoice 配置为 fallback。

ASR 当前主线为 FunASR，因此 Control Center 只暴露启停，不提供不能立即生效的 provider 选择。音频配置保存后完整生效边界仍是重启 Glimmer Cradle。

## System Embedding 配置

`configs/system/embedding.yaml` 是语义向量增强的系统事实源，Schema 为 `EmbeddingConfig`。默认 `enabled: false`；此时 Memory 和 Knowledge 使用词项、时间、显著度、置信度、关系与作用域规则完成基础召回，不访问网络、不导入本地模型，也不标记系统降级。

启用后必须通过 `route.provider` 显式选择 `dashscope-text-embedding` 或 `local-sentence-transformers`。不同 provider 的向量空间与维度不保证兼容，因此不做透明 fallback；向量记录按 provider、模型和维度组成的 `model_id` 隔离。DashScope 使用 `DASHSCOPE_API_KEY`，文档建索引使用 `text_type=document`，查询使用 `text_type=query`。本地模型目录相对 `data/models/` 解析，默认不允许自动下载。

## 内部通信配置

内部通信只配置策略，不配置稳定端口：

| 配置 | 当前语义 |
|---|---|
| `kernel.ipc.bind_address` | 固定为 `tcp://127.0.0.1:*`，Kernel 绑定后把真实 Cognition RPC 地址直接注入子进程。 |
| `surfaces.yaml` | 不含 Desktop WebSocket 端口；Desktop 从本代 endpoint catalog 发现。 |
| `avatar.yaml` | 不含 Avatar WebSocket 端口；Kernel 启动 Unity 时直接注入。 |
| `data/run/host/endpoints.json` | Kernel 生成的可再生目录，不是用户配置，不得手改或跨启动缓存。 |

NapCat 的 `transport.port` 属于 Extension 自有第三方协议配置。默认 `0` 由 Adapter 启动时选择空闲回环端口；远程 NapCat 连接必须显式填写端口。它不进入 Kernel 内部 endpoint catalog。

## Cognition 连续性配置

`configs/system/memory.yaml` 由 `MemoryConfig` Schema 约束，分别配置可恢复工作集、Conversation 投影、Experience Ledger、持久巩固任务和混合召回。所有数量都是上限或触发阈值，不会让缓存成为历史事实源。

| 键 | Owner | 语义 |
|---|---|---|
| `working.max_messages_per_conversation` | ConversationController | 单个进程内 Conversation working set 上限。 |
| `working.hydrate_recent_messages` | ConversationController | 从 Conversation Store 恢复到 working set 的最近消息上限。 |
| `working.context_message_limit` | ReplyContext | 每次 Prompt 允许直接携带的最近原文条数。 |
| `conversation.segment_target_messages` | ConversationStore | 形成一级 Segment 的连续消息目标数。 |
| `conversation.chapter_idle_minutes` | ConversationStore | 空闲多久后自动结束当前 Chapter。 |
| `conversation.chapter_segment_limit` | ConversationStore | 单 Chapter 的一级 Segment 上限。 |
| `conversation.state_update_messages` | ConversationStore | 更新 Conversation State 的增量消息阈值。 |
| `conversation.history_candidate_limit` / `history_result_limit` | ConversationStore | 历史 Segment 粗召回与最终返回上限。 |
| `conversation.summary_max_chars` | ConversationStore | 可重建摘要的最大字符数。 |
| `experience.*` | ExperienceRecorder / EpisodeProjection | Ledger pack、flush、Episode idle 封口与完整性检查策略。 |
| `consolidation.batch_size` / `max_batch_moments` | ConsolidationCoordinator | 单轮领取任务与送入一次权限域内巩固的 Moment 上限。 |
| `consolidation.debounce_seconds` / `max_wait_seconds` | ConsolidationJobRepository | 正常去抖与最晚可执行期限。 |
| `consolidation.lease_seconds` / `retry_base_seconds` | ConsolidationJobRepository | durable job 租约和指数退避基数。 |
| `consolidation.minimum_salience` | ConsolidationCoordinator | 进入长期记忆候选队列的 Episode 最低显著度。 |
| `consolidation.autobiographical_evidence_threshold` | ConsolidationCoordinator | 自传记忆要求的最少独立 Moment 证据数。 |
| `consolidation.schedule_interval_seconds` | MaintenanceScheduler | 长驻进程的后台维护检查周期。 |
| `retrieval.token_budget` / `candidate_limit` / `result_limit` | MemorySubstrate | Memory 候选、最终结果与 token 预算。 |
| `retrieval.semantic_weight` | MemorySubstrate | 混合召回中 embedding 相似度权重，其余权重保留给词项、时间、显著度和置信度。 |

停机只执行 Ledger flush、Episode/Conversation 投影、巩固任务入队和数据库 checkpoint；不会为了整理长期记忆在退出关键路径调用模型。长驻本地进程与云端服务都由 `MaintenanceScheduler` 在运行期间按语义边界、去抖和最晚期限推进 durable jobs。

## Extension 配置约定

Extension 配置只描述该扩展自己的平台接入、依赖路径、权限边界内的策略和用户可调项。平台特有策略必须在 Adapter 内收敛成通用感知语义，不能要求 Cognition 理解平台字段。

NapCat adapter 的群聊注意力使用 `ingress.group_focus_scope`：

| 值 | 语义 |
|---|---|
| `sender` | 默认。群聊中某个用户唤醒后，只对该用户续期注意力；同一用户在窗口内继续说话不需要唤醒词，其他成员普通消息不触发回复。 |
| `group` | 群级注意力。群被唤醒后，窗口内所有成员消息都作为连续对话进入。 |

`source_focus_policies.group` 仍决定是否需要唤醒词和是否有超时窗口；`group_focus_scope` 只决定焦点窗口归属于“发送者”还是“整个群”。

这些配置只影响 Kernel 外部注意力窗口和 Adapter 如何申请焦点；它们不直接改变 Cognition `CognitiveActivityState`，也不授予工具执行权限。Extension 通过 `sceneAttention.requestAttentionLease()` 申请 Attention Lease，`group_focus_scope` 对应 lease 的 `channel_id` 粒度。

## 环境变量边界

环境变量用于部署覆盖、密钥注入或本地调试，不应替代普通配置事实源。音频密钥使用 `DASHSCOPE_API_KEY`；进程级超时可用 `GLIMMER_CRADLE_AUDIO_TTS_TIMEOUT_MS`、`GLIMMER_CRADLE_AUDIO_ASR_TIMEOUT_MS` 覆盖；FunASR 的本机缓存调试方式见 [音频引擎开发指南](../guides/subsystems/音频引擎开发.md)。

## 验证

- 运行 `pnpm check:architecture`，确认通用层没有角色硬编码、废弃 workspace 入口或绕过可信 Router 的 Desktop IPC。
- 配置变更后运行相关 Schema/normalizer 测试。
- 启动时缺失配置、非法类型、非法路径、缺密钥都应给出可定位错误。
- Control Center 保存设置后能显示保存中、成功、失败、需要重启和校验错误。
- `rg` 搜索旧键、旧路径和旧默认值无运行时残留。

操作指南见 [功能开发与缺陷修复](../guides/development/功能开发与缺陷修复.md) 和 [数据迁移与恢复](../guides/operations/数据迁移与恢复.md)。

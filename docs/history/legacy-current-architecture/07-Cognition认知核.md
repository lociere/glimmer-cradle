# 07 - Cognition 认知核

> 迁移材料：当前规则见 `docs/architecture/current/07-子系统当前视图/Cognition.md`、`docs/architecture/implementation/Cognition认知核实现.md` 与 `docs/guides/subsystems/Cognition开发.md`。本页不再更新。

> 物理位置：`core/cognition/src/selrena/`
> 定位：**月见的认知核心**——思考、情绪、记忆、人格的全部实现
> 最后更新：2026-06-12

> 本文描述**当前已落地**结构。已落地：阶段 1（`experience/`）/ 阶段 2
> （`persistence/`，长期记忆与短期记忆已收归认知核）/ 阶段 3（observability）/
> 阶段 4（`arousal/` 觉醒态机）/ 阶段 5（`cognition/` 工作区+循环+Provider+Volition；
> `context/`、`reasoning/`；阶段 7.5b-7 起为感知唯一编排者）/ 阶段 P
> （`protocol/generated/` 取代 `ipc_server/contracts/`，跨语言 JSON Schema codegen）。
> 完整架构蓝图见 [月见架构蓝图](../../architecture/blueprint/月见架构蓝图.md)。

---

## 一、设计原则

- Cognition 认知核是 Cognition / Adapter / Kernel 架构中的认知载体
- **零平台协议**：严禁引入任何平台特定概念（QQ/CQ 码/user_id/group_id）。层内仅使用通用路由字段（`scene_id` / `source`）
- **强类型契约**：所有跨层数据交换使用 Pydantic 模型或 Dataclass，禁止裸 `dict` 穿透
- **全异步**：全局 `asyncio`，严禁主线程阻塞操作
- **依赖倒置**：应用层通过抽象端口（`ports/`）定义入站接口，适配器实现具体协议转换
- **冻结人设**：配置由 Kernel 内核注入后在运行时冻结（`Final` + `frozen=True`），防止人格漂移

---

## 二、分层模型与 Cognition / Adapter / Synapse 映射

```
┌─────────────────────────────────────────────────────────┐
│  Kernel（内核）                                      │
│  ZMQ IPC 双向通信                                        │
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│  IPC 适配层（Adapter / Cortex）                          │
│  ipc_server/                                             │
│  协议清洗 · 归一化 · 路由转发                              │
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│  应用编排层（编排）                                       │
│  application/                                            │
│  用例串联 · 流程编排 · 不处理规则                          │
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│  推理层（Cognition 认知核 支撑）                                  │
│  llm_engine/                                             │
│  LLM 引擎 · 多模态路由 · 向量化引擎                      │
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│  认知域（Cognition 认知核 核心）                                  │
│  identity/ emotion_matrix/ memory/              │
│  persona/ thought/ multimodal/                           │
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│  基础设施层                                               │
│  core/ · experience/ · persistence/                       │
│  事件总线 · 日志 · 配置 · 经历日志 · 本地持久化            │
└─────────────────────────────────────────────────────────┘
```

**概念映射表**：

| Cognition / Adapter / Synapse 概念 | Python 物理位置 | 职责 |
|---|---|---|
| **Cognition 认知核（认知核心）** | `identity/` `emotion_matrix/` `memory/` `persona/` `thought/` `multimodal/` `llm_engine/` | 情绪、记忆、人格、思维、推理 |
| **Adapter / Cortex（适配层）** | `selrena/protocol/generated/` + `ipc_server/inbound/` + `ipc_server/outbound/` | 协议清洗、归一化、IPC 通信。**阶段 P.7 起契约提级**：原 `ipc_server/contracts/` 改名 `selrena/protocol/`，跨语言 schema codegen 产物 |
| **Synapse（突触）** | `core/event_bus.py` | 领域事件发布/订阅解耦 |
| **经历层 / 持久化层**（蓝图阶段 1/2） | `experience/` `persistence/` | 经历日志（脊柱①）· 认知核本地持久化 `cognition.db` |

---

## 三、目录结构

```
selrena/
├── __init__.py                          # 顶层导出
├── main.py                              # 生命周期入口（唯一启动点）
├── container.py                         # DI 容器（唯一跨层组装点）
│
├── core/                                # ── 基础设施层 ──
│   ├── config.py                        # Pydantic 配置模型（frozen=True）
│   ├── event_bus.py                     # 领域事件总线（Synapse 核心）
│   ├── exceptions.py                    # 统一异常体系
│   ├── lifecycle.py                     # 生命周期接口
│   ├── path_utils.py                    # pathlib 路径工具
│   ├── scene_id.py                      # scene_id 路径清洗
│   └── observability/
│       ├── logger.py                    # 统一日志器
│       ├── trace_context.py             # 三层 trace 上下文（boot/trace/span，蓝图 §6.2）
│       ├── tracer.py                    # 追踪工具
│       └── dlq_manager.py               # 死信队列（aiosqlite）
│
├── experience/                          # ── 经历层（蓝图阶段 1）──
│   ├── events.py                        # Moment + MomentKind + AffectSnapshot（蓝图 §4.1）
│   ├── log_writer.py                    # append-only 分段写入器
│   ├── snapshot.py                      # 状态快照读写
│   ├── replay.py                        # 读取 / 完整性校验 / fold / 重放
│   └── recorder.py                      # ExperienceRecorder（经历记录门面）
│
├── persistence/                         # ── 持久化层（蓝图阶段 2，cognition.db）──
│   ├── database.py                      # cognition.db 连接 + schema + 版本迁移（schema v3）
│   ├── memory_repo.py                   # 长期记忆 CRUD
│   ├── knowledge_repo.py                # 知识库条目 CRUD
│   ├── vector_repo.py                   # embedding 向量读写（float32 BLOB）
│   ├── relationship_repo.py             # 关系（intimacy / 接触轨迹）— 阶段 5.6b
│   ├── memory_graph_repo.py             # 记忆图谱节点+边 + 多跳遍历 — 阶段 6.1
│   ├── memory_graph_retriever.py        # HippoRAG 风格多跳检索（入口+扩展+touch_activated）— 阶段 6.6
│   └── migration.py                     # 内核旧库 cognition_core.db → cognition.db 一次性迁移
│
├── arousal/                             # ── 觉醒态机（蓝图阶段 4，§3.4）──
│   ├── states.py                        # ArousalState/Profile（generated）+ PROFILE_BY_STATE + ArousalConfig
│   ├── state_machine.py                 # 纯函数 tick()：衰减阶梯 + 情绪 hold + 显式唤醒
│   ├── projection.py                    # last_interaction_at 投影自经历之流
│   └── manager.py                       # ArousalManager（异步 tick + Moment 埋点 + state_sync 出口）
│
├── cognition/                           # ── 认知循环（蓝图 §3.3 / 阶段 5）──
│   ├── workspace.py                     # GlobalWorkspace（容量+注意力排序竞争）
│   ├── loop.py                          # CognitiveLoop（九阶段 tick；5.9 默认开）
│   ├── perception_queue.py              # PerceptionEventQueue（IPC ↔ Loop 缓冲）
│   ├── providers/                       # 5 个 Provider（感知 / 情感 / 记忆 / 驱力 / 社交）
│   ├── volition/                        # 意愿 + 仲裁（5.7）
│   └── reflection/                      # ── 反思引擎（蓝图 §4.2 / 阶段 6.3+6.4）──
│       ├── episode.py                   # Episode 切分（并查集联通分量）
│       ├── strategy.py                  # ReflectionStrategy Protocol + MockReflectionStrategy
│       ├── llm_strategy.py              # ReasoningServiceReflectionStrategy + JSON 解析器（6.4）
│       └── engine.py                    # ReflectionEngine（tick + maybe_tick 幂等钩子 + 限速 + 水位）
│
├── narrative/                           # ── 叙事日记（蓝图 §6.5 / 阶段 6.8）──
│   └── journal.py                       # NarrativeJournal brief 模式（render_brief 纯函数）
│
├── context/                             # ── 上下文装配（阶段 5.4）──
│   ├── assembly.py                      # ContextAssembly 装配器 + 预算裁剪
│   └── sources/                         # ContextSource：episodic / knowledge / relationship
│
├── reasoning/                           # ── 推理服务抽象（阶段 5.5）──
│   ├── service.py                       # ReasoningService + ModelTierEnum
│   ├── cloud.py                         # 包装 LLMEngine
│   └── local.py                         # 本地小模型 stub（local_only tier）
│
├── protocol/                            # ── 跨语言契约 codegen 产物（蓝图阶段 P.7）──
│   └── generated/{enums,models,ipc,config}/
│
├── application/                         # ── 应用编排层 ──
│   ├── base_use_case.py                # 用例基类（统一追踪·异常捕获）
│   ├── active_thought_use_case.py      # 主动思维用例
│   ├── agent_plan_use_case.py          # Agent 规划用例（LLM 驱动工具规划）
│   └── agent_synthesis_use_case.py     # Agent 工具结果合成用例
│
├── emotion_matrix/                      # ── Cognition 认知核：情绪系统 ──
│   ├── emotion_system.py               # 连续情绪流（自然衰减·触发·变化）
│   └── emotion_rules.py                # 情绪规则引擎
├── identity/                            # ── Cognition 认知核：自我实体 ──
│   └── self_entity.py                  # SelfEntity（认知根节点·单例）
├── llm_engine/                          # ── 推理层 ──
│   ├── llm_engine.py                   # LLM 推理引擎（本地 + API 双模式）
│   ├── multimodal_router.py            # 多模态路由器（结构化 items 分发）
│   └── embedding_engine.py             # 向量嵌入引擎（可选）
├── memory/                     # ── Cognition 认知核：记忆与会话 ──
│   ├── long_term_memory.py             # 长期记忆（向量语义检索 + bigram 退化）
│   ├── short_term_memory.py            # 短期记忆（场景隔离·重要度排序）
│   ├── knowledge_base.py               # 世界知识库（仅 scope=knowledge）
│   ├── memory_consolidator.py          # 闲时记忆固化
│   └── scene_session.py                # 场景会话（scene_id 隔离·摘要压缩）
├── multimodal/                          # ── Cognition 认知核：多模态内容模型 ──
│   └── multimodal_content.py           # 多模态语义模型
├── persona/                             # ── Cognition 认知核：人格系统 ──
│   ├── persona_injector.py             # 人设认知编译器（compile + build_persona_prompt）
│   └── persona_knowledge.py            # 人设知识加载器（预留）
├── thought/                             # ── Cognition 认知核：主动思维 ──
│   ├── thought_system.py               # 主动思维（内核生命时钟驱动）
│   └── thought_pool.py                 # 思维候选库
├── tts_engine/                          # ── 语音输出能力（预留） ──
└── ipc_server/                          # ── Adapter / Cortex（不含契约，契约已提级至 selrena/protocol/）──
  ├── inbound/
  │   ├── perception_port.py          # 入站抽象接口
  │   ├── kernel_ingress_cortex.py    # Cortex 皮层（原始 IPC → 标准格式；解析时用 cognition_core.protocol.generated 模型）
  │   └── kernel_event_adapter.py     # 入站适配器（实现 PerceptionPort）
  └── outbound/
    ├── kernel_event_port.py        # 出站抽象接口
    ├── kernel_bridge.py            # ZMQ IPC 通信桥接（唯一出口）
    └── kernel_event_adapter.py     # 出站适配器（领域事件→IPC 消息）
```

> **阶段 P.7 改名说明**：原 `selrena/ipc_server/contracts/kernel_ingress_contracts.py`
> 手写 Pydantic 镜像已删除。现 IPC 契约模型统一由 `selrena/protocol/generated/`
> 提供（codegen 自 `protocol/src/schemas/ipc/*.schema.json`，跨语言单一事实源 ——
> 铁律 1）。运行时校验仍由 Pydantic 完成；改 schema 后跑 `pnpm sync:contracts`
> 同步两端。

---

## 四、模块详解

### 4.1 基础设施层（`core/`）

纯工具性基础设施，不含任何业务逻辑。

#### DomainEventBus — 领域事件总线

单例，实现发布/订阅模式，是 **Synapse（突触）** 概念的物理实现。

- 异步分发（`async def publish`），单处理器异常不传染
- 全链路 `trace_id` 自动透传
- 零模块直接依赖——所有跨模块通信必须经事件总线

```python
# 发布领域事件
await event_bus.publish(SomeDomainEvent(...))

# 订阅事件（容器初始化时注册）
event_bus.subscribe(SomeDomainEvent, handler)
```

> 注：原记忆同步事件（`MemorySyncEvent` / `ShortTermMemorySyncEvent`）已随蓝图
> 阶段 2「持久化收归认知核」移除——长期记忆改为直接写 `cognition.db`，不再经
> 事件总线回传内核。事件总线作为解耦原语保留。

#### cognition_core.protocol.generated — IPC 入站契约（阶段 P 起 codegen）

Pydantic 强类型模型，由 `protocol/src/schemas/ipc/*.schema.json` codegen 而成。
定义 Kernel 内核 → Python 所有入站消息的签名：

| 模型（`cognition_core.protocol.generated.ipc.*`） | 用途 |
|---|---|
| `KernelMessageEnvelope` | IPC 消息统一信封（type + trace_id + payload） |
| `PerceptionEvent` | 感知事件（含 `address_mode: 'direct' \| 'ambient'` + content + items） |
| `LifeHeartbeatPayload` | 生命心跳载荷 |
| `AgentPlanPayload` | Agent 规划载荷（user_goal / available_tools: ToolDescriptor[]） |
| `AgentSynthesisPayload` | Agent 工具合成载荷（original_goal / tool_results[]） |
| `KnowledgeInitPayload` | 知识库初始化载荷（version / retrieval / entries[]） |

> 长期记忆同步记录（原 `KernelLongTermMemoryRecord`）已随阶段 2「持久化收归
> 认知核」移除 —— 长期记忆改为认知核本地 `cognition.db` 直接写，不再走 IPC。

---

### 4.2 认知域（`identity/` `emotion_matrix/` `memory/` `persona/` `thought/` `multimodal/`）— Cognition 认知核 核心

所有模块均为纯领域逻辑，**零 IO**、**零平台协议**、**零框架依赖**。

#### SelfEntity — 灵魂根节点

全局唯一单例，所有意识子系统的聚合根：

```
SelfEntity（单例）
 ├── emotion_system: EmotionSystem         # 情绪系统
 ├── long_term_memory: LongTermMemory      # 长期记忆
 ├── knowledge_base: KnowledgeBase         # 知识库
 ├── persona_injector: PersonaInjector     # 人设编译器
 ├── thought_system: ThoughtSystem         # 主动思维
 ├── persona_config: PersonaConfig (Final) # 冻结人设
 └── inference_config: InferenceConfig (Final)
```

核心约束：
- 配置在构造时注入并标记为 `Final`，运行时不可修改
- 每个场景拥有独立的 `SceneSessionRuntime`（会话+短期记忆+锁），通过 `scene_id` 隔离
- 持有 `validate_boundary()` 方法——人设红线校验，拦截违规生成

#### EmotionSystem — 情绪系统

连续情绪流，不随对话结束重置：

- 7 种情绪类型：calm / happy / shy / angry / sulky / curious / sad
- 自然衰减机制（时间推移 → 强度递减）
- 输入触发 + 主动思维触发双通道

#### Memory — 记忆系统

| 层 | 模块 | 生命周期 | 持久化 |
|---|---|---|---|
| 长期记忆 | `long_term_memory.py` | 终身 | 向量语义检索 / bigram 退化 + 重要度加权；**经 `persistence/` 直接读写 `cognition.db`** |
| 短期记忆 | `short_term_memory.py` | 场景隔离 | working memory，固定容量 + 重要度淘汰；**纯内存、不持久化** |
| 世界知识库 | `knowledge_base.py` | 持久 | **仅管理 `scope=knowledge` 条目**；支持 `full_injection`（全量注入）和 `semantic_rag`（向量检索 Top-K）；**经 `KnowledgeRepository` 持久化到 `cognition.db`** |

**v4.0 变更**：知识库不再承载人设信息。所有 `scope=persona` 条目由 `PersonaInjector.compile()` 接管编译，知识库仅负责世界知识。

**蓝图阶段 2 变更（持久化收归认知核）**：

- **长期记忆**——启动时经 `MemoryRepository` 从 `cognition.db` 全量加载（`load_persisted()`）；
  `add()` 直接写库。不再经事件总线同步到 Kernel 内核。首次启动若检测到内核旧库
  `cognition_core.db`，由 `persistence/migration.py` 一次性迁移历史记忆。
- **短期记忆**——是 working memory（蓝图 §4.3：易失），退回纯内存，不再持久化；
  对话的持久记录由经历日志（L1）承担。
- **知识库**——条目经 `KnowledgeRepository` 持久化到 `cognition.db`；启动时
  `load_persisted()` 从库加载。`knowledge_init` IPC 保留为知识库的**预填摄入途径**
  ——config 来源条目以 `source='config'` 写入库，再从库重载。
- 原 `MemorySyncEvent` / `ShortTermMemorySyncEvent` / `MemorySyncUseCase` 同步链路已移除。

#### ThoughtSystem — 主动思维

由内核生命时钟的心跳驱动，基于当前情绪 + 长期记忆 + 人设配置生成内心活动。不是只有用户说话才活着。

#### PersonaInjector — 人设认知编译器

v4.0 **认知编译模型**——将离散的知识库条目编译为连贯的人格认知结构，替代旧版的"最小锚定集"方式。

**编译阶段** `compile(entries: List[PersonaCompileEntry])`：
- 接收所有 `scope=persona` 的条目，按 `compile_group` 分桶、按 `priority` 排序
- 编译产物：
  - `_identity_paragraph`：身份 + 特质 → 连贯段落（非 bullet list），中文语句直接拼接
  - `_style_paragraph`：语言风格描述
  - `_example_block`：对话示例
  - `_emotion_behaviors: Dict[str, str]`：`emotion:shy` → 条件行为
  - `_context_behaviors: Dict[str, str]`：`context:ambient` → 环境感知行为
  - `_safety_block`：安全红线

**组装阶段** `build_persona_prompt(emotion_state, address_mode)`：
- 确定性组装——不调用 LLM，纯字符串拼接
- 输出结构：

```
你是{name}。{identity_paragraph}

{style_paragraph}

{example_block}

[当前情绪] {emotion_type}（强度 {intensity}）

[情绪行为] ← 仅当存在 emotion:{current_type} 条目时注入
[环境行为] ← 仅当 address_mode=ambient 且存在 context:ambient 条目时注入

[回复呈现]
[对话策略]
[红线]
```

**模式分支**：
- `persona_mode == local_finetune`：跳过身份/风格/示例/特质（已烘焙进权重），仅输出 1 行锚定 + 情绪 + 回复呈现 + 红线
- 其他模式：完整编译输出

**回复正文约束**：
- Cognition 不再要求 LLM 在可见正文前写 `[开心]` / `[思考]` 等情绪标签；情绪已由独立 `emotion` 帧承载。
- 当用户明确要求代码、配置、Markdown、命令或文件内容时，系统提示要求模型优先输出完整可复制内容，并使用 fenced code block 保留换行和缩进。
- 回复发往 Kernel 前会剥除偶发情绪标签，避免历史提示或模型惯性把标签混入 Control Center 气泡。

#### 认知编译架构（v4.0 注入策略全貌）

人格与知识信息分三层注入，职责彻底分离：

| 层 | 来源 | 内容 | 策略 |
|---|---|---|---|
| **层1：冻结配置** | `configs/cognition/persona.yaml` | 名字/昵称、persona_mode、安全红线 | 构造期注入，运行时 `Final` 冻结 |
| **层2：认知编译** | `configs/cognition/knowledge-base.json` (scope=persona) | 人格血肉（身份/特质/风格/示例/情绪行为/环境行为/安全） | `PersonaInjector.compile()` 一次性编译为连贯段落 + 条件映射；`build_persona_prompt()` 每轮确定性组装 |
| **层3：世界知识** | `configs/cognition/knowledge-base.json` (scope=knowledge) | 事实性知识（定义/规则/背景信息） | `KnowledgeBase.get_knowledge(query)` — `full_injection` 全量注入或 `semantic_rag` 检索 |

三层协作产生的最终 `system_message` 结构：

```
[层2] 你是月见。{compiled_identity_paragraph}
      {style} {example} {emotion_behavior} {context_behavior}
      {format} {dialogue_strategy} {safety}

===== 世界知识 =====    ← [层3] knowledge scope 按 query 检索或全量注入
===== 长期偏好 =====
===== 相关记忆 =====
===== 短期记忆 =====
===== 多模态语义 =====
```

`persona_mode == local_finetune` 时，层2 仅输出最小锚定（1 行名字 + 情绪 + 格式 + 红线），身份/风格/示例/特质已烘焙进模型权重。

---

### 4.3 推理层（`llm_engine/`）

纯算力封装，不含业务规则。

#### LLMEngine — LLM 推理引擎

- 支持本地模型（llama.cpp/GGUF）和云端 API（OpenAI 兼容格式）双模式
- 仅接收完整 `LLMRequest`（含 system + history messages），返回纯文本
- 可插拔替换——更换模型仅需修改此文件

#### MultimodalRouter — 多模态路由器

基于结构化 `PerceptionModalityItemModel` 进行语义转述：

```
输入: PerceptionEventContentModel（含 text + items[]）
     ↓
分离: image_items / video_items
     ↓
策略: core_direct → 直接构建多模态描述
      specialist_then_core → 先调专家模型再汇总
     ↓
输出: MultimodalRouteResult
      ├── primary_text（用户原文）
      ├── semantic_text（多模态语义描述）
      ├── image_items / video_items
      └── strategy
```

`semantic_text` 最终注入 LLM 系统消息的 `===== 多模态语义 =====` 段。

#### EmbeddingEngine — 向量嵌入引擎

基于 `sentence-transformers` 的可选语义编码引擎，为**长期记忆语义检索**和**知识库 semantic_rag 模式**提供向量化能力：

- 启动期加载：仅在 `load()` 被显式调用后才初始化模型，不在 import 时加载；配置启用时属于 Cognition readiness 的一部分
- 自动准备：`model_path` 指向 `data/models/embedding/...` 本地落盘目录；目录缺失且 `auto_download: true` 时，按 `model_id` 在启动期下载并保存
- 优雅降级：`sentence-transformers` 未安装、下载失败或模型加载失败时 `is_available()` 返回 `False`，LTM 退化为 bigram 检索，KB 退化为全量注入
- 接口：`encode(texts) → np.ndarray`、`encode_single(text) → np.ndarray`、`cosine_similarities(query_vec, matrix) → np.ndarray`
- 由 `container.py` 根据 `InferenceConfig.embedding` 配置决定是否加载，并同时注入 `KnowledgeBase` 与 `LongTermMemory`

---

### 4.4 应用编排层（`application/`）

唯一允许同时引用 domain 与 inference 的层级，仅做流程串联，**不处理规则**。

> 阶段 7.5b-7：**ChatUseCase 已删除**。其全部对话编排职责（多模态路由 / 情绪更新 /
> 记忆与知识 / 人设 prompt / LLM 生成 / 红线校验 / 会话沉淀 / 经历埋点）已迁进
> CognitiveLoop 九阶段。感知唯一去向 = PerceptionEventQueue → CognitiveLoop。
> 详见 [阶段7-自主输出通路设计.md](../../history/architecture-decisions/阶段7-自主输出通路设计.md) §九 与 7.5b-1~5。

#### ActiveThoughtUseCase — 主动思维用例

接收内核生命心跳 → 调用 `ThoughtSystem.generate_thought()` → 返回内心活动。

#### AgentPlanUseCase — Agent 规划用例

接收 TS 层传入的用户目标 + 可用工具列表，LLM 驱动推理后返回结构化工具建议：

```
输入: AgentPlanInput(user_goal, available_tools: List[dict])
  ↓ LLM 推理（规划系统提示 + 工具列表）
  ↓ JSON 解析（支持代码块包裹提取）
输出: AgentPlanOutput(summary, reasoning, suggestions: List[MCPToolSuggestion])
```

LLM 生成失败时优雅降级——返回空 suggestions + 错误摘要，不中断主流程。工具实际调用在 TS 层（MCP 调度）完成。

#### AgentSynthesisUseCase — Agent 工具结果合成用例

接收 TS/MCP 层工具执行结果列表，由 LLM 合成为月见自然语言回复，闭合 Agent 循环：

```
输入: AgentSynthesisInput(original_goal, tool_results: List[dict])
  ↓ LLM 推理（以月见口吻解读工具结果，提炼对用户有意义的结论）
输出: AgentSynthesisOutput(reply_content, emotion_state)
```

Python 层只做「结果 → 角色语言」的语义合成；情绪随合成内容自然更新后随响应回传。

---

### 4.5 IPC 端口与契约层（`selrena/protocol/generated/` + `ipc_server/inbound/` + `ipc_server/outbound/`）

依赖倒置边界——仅定义抽象接口，不做实现。

| 端口 | 方向 | 定义的信号 |
|---|---|---|
| `PerceptionPort` | 入站 | on_life_heartbeat / on_knowledge_init / on_agent_plan / on_agent_synthesis（感知不走端口，由 container `_on_perception` 直接解析入 PerceptionEventQueue） |
| `KernelEventPort` | 出站 | send_state_sync / send_log / send_action_command |

> 蓝图阶段 2 完成后，记忆持久化收归认知核 `cognition.db`，记忆同步的入站
> （`on_memory_init`）与出站（`send_memory_sync` / `send_short_term_memory_sync`）
> 信号均已移除。

---

### 4.6 入站/出站适配层（`ipc_server/inbound/` + `ipc_server/outbound/`）— Adapter/Cortex

协议脏数据的最后防线，归一化后再传入 Cognition 认知核。

#### KernelIngressCortex — Cortex 皮层

将 Kernel 内核发来的原始 `dict` 解析并验证为 Pydantic 契约模型：

```python
def parse_perception_message(self, message: dict) -> ParsedPerception:
    envelope = KernelMessageEnvelope.model_validate(message)  # 验证信封
    payload = PerceptionEventPayloadModel.model_validate(envelope.payload)  # 验证载荷
    return ParsedPerception(
        model_input=payload.content.model_dump(),
        scene_id=payload.source,
        familiarity=payload.familiarity,
        address_mode=payload.address_mode,       # 平台无关的语义寻址模式
        trace_id=envelope.trace_id,
    )  # 输出强类型模型
```

**关键**：`dict` 仅在此层存在，一旦通过 Pydantic 验证即变为强类型模型，向内层绝不传递裸 dict。

#### KernelBridge — ZMQ IPC 通信桥接

Cognition 认知核与 Kernel 内核通信的**唯一出口**：

- ZMQ REP 模式，异步收发
- 消息处理器注册制（`register_handler`）
- 并发安全（`asyncio.Lock` 保护发送）
- 完整错误处理 + trace_id 透传

---

### 4.7 经历层与持久化层（`experience/` `persistence/`）

蓝图阶段 1/2 落地的两个新基础设施层。

#### experience/ — 经历层（脊柱①）

月见经历的一切（感知 / 思维 / 情绪 / 回复 / 沉默 / 反思）作为不可变 **Moment**
追加进**经历之流**——一条 append-only、分段 JSON Lines 的真相记录，
Moment 之间通过 `causation_ids` 编织因果网（蓝图 §4.1）。

- `ExperienceRecorder`——经历记录统一门面，由 `CognitiveLoop` 各阶段埋点调用
- 每个 Moment 携带 `kind / content / causation_ids / affect / importance`
- `trace_id` 在 Moment 上为薄注解（与 telemetry 关联用，可空）
- 启动恢复：载入最近快照 + fold 尾段确定续号
- 物理位置 `data/state/experience/`；详见 [08 §八](./08-记忆与日志架构.md)

#### persistence/ — 持久化层（`cognition.db`）

认知核唯一接触 SQLite 的地方。单库 `data/state/cognition/cognition.db` 承载 L2 长期记忆、
L3 知识库、L4 向量 —— 三者同库可原子写，相似度计算仍在 Python 侧（numpy）。

- `CognitionDatabase`——连接管理、schema 初始化、版本化迁移
- `MemoryRepository` / `KnowledgeRepository`——长期记忆 / 知识条目 CRUD
- `VectorRepository`——embedding 以 float32 BLOB 持久化（按 model 标识；
  换模型即视为 stale，加载时重算）。**省去每次启动全量重算 embedding。**
- `migration.py`——内核旧库 `cognition_core.db` → `cognition.db` 一次性迁移
- 详见 [阶段2-数据持久化设计](../../history/architecture-decisions/阶段2-数据持久化设计.md)

---

## 五、数据流全链路

### 5.1 用户消息 → AI 回复

```
Kernel 内核 ──ZMQ──→ KernelBridge.receive_loop()
                   │
                   ↓ dispatch by type="perception_message"（仍走 RPC 作投递确认）
              container._on_perception(msg)
                   │  KernelIngressCortex.parse_perception_message()
                   │      dict → Pydantic 验证 → ParsedPerception
                   │  → PerceptionEventQueue.put(PerceptionEntry)（含原始 model_input）
                   │  → return None  # 无回复，RPC 应答仅作投递确认
                   ↓
              CognitiveLoop 后台 tick（蓝图九阶段）：
                   Sense   ：PerceptionProvider drain 队列 → WorkspaceItem
                   入站边界：container._on_perception 入队 → wake_now → notify_external_input
                   Appraise：multimodal_router 路由（图片/视频）
                           ：emotion_system.update_by_input（情绪评价）
                           ：写 PERCEPTION + EMOTION Moment（因果链）
                   Recall  ：MemoryProvider 检索（图谱 + 向量入口）
                   Compete ：注意力排序竞争（salience + 来源优先级 + 新鲜度）
                            ：direct perception 同分压过长驻 drive → 广播
                   Deliberate: 富上下文 prompt（人设 + 摘要 + 短期/长期/知识 + 媒体描述）
                            → ReasoningService（按 arousal tier 选云/本地）
                            → 红线校验 → _pending_reply
                   Intend  : Volition 仲裁 → accepted reply intent
                   Act     : ActionCommand → outbound.send_action_command（ZMQ 单向推送）
                   Consolidate: 写 REPLY/SILENCE Moment + 因果链
                              ：会话写回 user/assistant 轮 + 短期记忆
                              ：仅消费带 scene_id + trace_id 的本拍外部 perception 广播，
                                避免同一外部输入跨 tick 重复回复
                   ↓ ZMQ 推送 action_command
              Kernel 内核 IPCServer ACTION_COMMAND handler（7.4）
                   │  → normalizeReplyMessages(text, messages)
                   │  → new ChannelReplyEvent({trace_id, text, messages, emotion_state, target_channel})
                   │  → EventBus.publish → ActionStreamManager → 插件 → 用户
```

> 阶段 7.5b-7：感知不再走 PerceptionPort + ChatUseCase 的 RPC 链路；回复改由
> CognitiveLoop Act 经 ACTION_COMMAND 异步推送。`action_command` 是 Python → Kernel
> 单向事件，不需要 `success_response`；路由语义由 `ActionCommand.target.scene_id`
> 显式承载，`trace_id` 只负责追踪与扩展短期路由表关联。
> `ActionCommand.payload.text` 是完整回复正文；`payload.messages` 是可选消息切片。
> Kernel 会用 protocol runtime 的 `normalizeReplyMessages()` 补齐切片，再投递给桌面或平台适配器。

### 5.2 记忆持久化（认知核本地）

蓝图阶段 2 起，长期记忆由认知核直接持久化到 `data/state/cognition/cognition.db`，不再回传内核：

```
启动序列（main.py）：
  CognitionDatabase.connect()                    → data/state/cognition/cognition.db
    │（首次启动）migrate_legacy_long_term_memory() ← 内核旧库 cognition_core.db
    ↓
  LongTermMemory.load_persisted()  ← MemoryRepository 全量加载入内存

写入：
  LongTermMemory.add(fragment)
    ↓
  MemoryRepository.upsert_long_term()            → data/state/cognition/cognition.db
```

短期记忆是 working memory，纯内存、不落库。对话内容的持久记录由经历日志
（L1，见 [08 §八](./08-记忆与日志架构.md)）承担。

### 5.3 多模态处理链路

```
TS 插件 CortexOutput.inputItems[]
  ↓ inbound-pipeline.ts（items 透传）
TS PerceptionAppService（items 转发）
  ↓ AttentionSessionManager.mergeRequests（items 合并）
TS AIProxy → ZMQ
  ↓
Python PerceptionEventContentModel.items[]
  ↓
MultimodalRouter.route()
  ├── image_items → 语义描述
  └── video_items → 语义描述
  ↓
semantic_text 注入 LLM 系统消息
  ↓
LLMEngine.generate() → AI 回复
```

---

## 六、DI 容器初始化顺序

`container.py` 是**唯一允许跨层调用**的组装点，按严格依赖顺序初始化：

```
1. 基础设施层   DomainEventBus / KernelBridge / ExperienceRecorder
               CognitionDatabase / MemoryRepository（持久化层）
2. 领域层       SelfEntity（灵魂根节点）+ PersonaInjector.init()
               LongTermMemory.bind_repository()（注入持久化仓库）
3. 推理层       LLMEngine / MultimodalRouter / EmbeddingEngine（可选）
               EmbeddingEngine → KnowledgeBase.set_embedding_engine()
               EmbeddingEngine → LongTermMemory.set_embedding_engine()
4. 认知循环     PerceptionEventQueue / CognitiveLoop / Provider / ReasoningService
               ActiveThoughtUseCase / AgentPlanUseCase / AgentSynthesisUseCase
5. 适配器层     InboundAdapter / IngressCortex / OutboundAdapter
6. 事件注册     KernelBridge.register_handler()
```

> `container.init()` 只**构造**实例。异步动作——`CognitionDatabase.connect()`、
> 旧库迁移、`LongTermMemory.load_persisted()`、`ExperienceRecorder.start()`——
> 在 `main.py` 启动序列中完成。

---

## 七、依赖方向规则

```
                  ┌──────────────┐
                  │  container   │ ← 唯一跨层组装点
                  └──────┬───────┘
                      │ 可访问所有层
        ┌────────────────────┼────────────────────────────┐
        ↓                    ↓                            ↓
      ipc_server/        application/     identity/... + memory/ + llm_engine/
      (Adapter/Cortex)   (编排)           (Cognition 认知核)
        │                    │                            │
        │                    ├──→ llm_engine/            │
        │                    └──→ Cognition 认知核 模块          │
        │                                                 │
        └──→ contracts / ports                           ↓
                                       core/
                                     (基础设施)
```

| 层 | 允许依赖 | 禁止依赖 |
|---|---|---|
| `core/` | 标准库 | 任何其他层 |
| `experience/` | `core/` | 其他所有层 |
| `persistence/` | `core/` | 其他所有层 |
| `identity/` `emotion_matrix/` `memory/` `persona/` `thought/` `multimodal/` | `core/` `persistence/`（仅 `memory/` 用） | `llm_engine/` `application/` `ipc_server/` |
| `llm_engine/` | `core/` + Cognition 认知核 模块（仅配置/模型读取） | `application/` `ipc_server/` |
| `application/` | `core/` `llm_engine/` `experience/` + Cognition 认知核 模块 | `ipc_server/` |
| `ipc_server/` | `core/` `application/` + 契约模型 | Cognition 认知核 私有实现细节 |
| `container.py` | 所有层 | —（唯一例外） |

---

## 八、代码规范检查清单

- [ ] 所有函数包含 Type Hints（参数 + 返回值）
- [ ] 跨层数据交换仅用 Pydantic 模型或 Dataclass
- [ ] 零 `time.sleep()` / 零同步 `requests` / 零同步文件 IO
- [ ] 路径处理统一使用 `pathlib.Path`
- [ ] 日志使用 `get_logger("module_name")`
- [ ] Cognition 认知核 模块（identity/emotion_matrix/memory/persona/thought/llm_engine）零平台特定字段（user_id/group_id/qq/cq）
- [ ] 新模块通过 `DomainEventBus` 订阅/发布接入，禁止直接 import 跨模块
- [ ] 新用例继承 `BaseUseCase`，包含 trace_id 透传和异常捕获

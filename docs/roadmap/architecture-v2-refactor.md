# Architecture Baseline v2.1 重构执行记录

> 范围：本地仓库渐进重构的审计、阶段计划、验收证据和未完成项。
> 事实依据：起始 commit `0f793adbba586c7a80a841c56ea3fbe40a1183b8`、实际源码及用户提供的两份原文。
> 维护触发：阶段、候选、所有权、验证或迁移风险变化。

## 目标与执行边界

用户授权按 [冻结基线](../architecture/blueprint/Glimmer_Cradle_Architecture_Baseline_v2.1_Frozen.md)
和 [执行要求](../architecture/blueprint/Glimmer_Cradle_Codex_Refactor_Prompt_v2.1.md) 完成重构。
冻结基线决定目标边界，执行要求决定阶段与验收。当前执行任务为唯一工作树写入 owner。
开始时工作树干净；本次包含本地代码、测试、文档与迁移实现，生产迁移、发布和推送不在当前授权内。
已有运行数据不得删除；历史发布事实不回写。不得把局部检查通过写成整体重构完成。

## 冻结基线与防漂移门禁

- 规范修订 1：依据用户本轮授权与 ADR-0021，修正 Runtime、Embodiment/Avatar、wire/domain、第三方依赖及改名兼容规则；命名指南和 agent 入口同步，基线锁更新为 v2.0-r1。未进行产品代码或数据迁移。

- [执行宪章](../architecture/blueprint/Architecture_Baseline_v2.1_执行宪章.md) 固定权威顺序、目标边界、迁移纪律和偏离处理。
- `architecture-baseline-v2.lock.json` 固定当前已授权基线修订与执行要求的 SHA-256，并显式固定五个目标根、七个 Core 模块和迁移政策；原始基线保留在 Git `cbb6c853`。
- `check:architecture` 在其他边界规则前验证基线锁；原文、锁定决策或文件缺失都会失败。
- 架构目标变更必须同时具备用户明确决策、accepted ADR、新的版本化基线以及 lock/gate 更新；普通实现切片无权改写目标。

## v2.1 完整目标补齐（2026-09-21）

依据 [ADR-0023](../architecture/decisions/ADR-0023-最终目标蓝图与物理目录契约.md) 切换 v2.1。
本轮仅更新设计、文件清单及其校验机制，未迁移产品代码和数据；下文初始审计与已完成阶段保持历史事实。
首要原则是核心不为第三方环境特化；可选接入因独立演进与生命周期采用 Extension，基础依赖和 App 技术不机械扩展化。

新增差距：Conversation interaction/delivery 与持久 Turn 分工；Cognition state/knowledge/planning/checkpoint；
Execution journal/outbox/unknown；Jobs fencing；共用 Host；authority handover；完整 TS/Python/C#/Unity/native 制品与恢复门。
具体目标路径见 [物理目录](../architecture/blueprint/Glimmer_Cradle_Target_Physical_Layout_v2.1.md)，不能继续用初始审计表的概念路径作为最终路径。
下一实现切片须按该清单补当前 → 目标的文件映射；`check:target-layout:final` 在迁移树上预期失败。
当前架构旧路径规则仍服务于迁移事实，阶段 15 必须切换为最终依赖/路径规则并清空迁移例外。

命名终审将 22 个含混路径收束为“语义限定词 + 职责后缀”：Port 与具体 SQLite Adapter 分名，
Host 权限入口显式使用 `*-broker`，Lease/Node/Compatibility 按所属语义限定，Python 源文件统一
`snake_case`。清单校验现会拒绝连字符 Python 文件名；文件名属于物理契约，后续改名须同步清单、生成树、
引用方、测试与基线锁。

本轮验证（2026-09-21；本地 dirty 候选，仅文档、agent 路由、基线锁和 repo-checks 工具/命令变化）：

- PASS：目录规范/生成树同步，1,097 个目标文件与 333 个父目录；六份规范源的摘要锁一致。
- PASS：repo-checks 全部 22 项测试；含缺项、多项、非法路径、大小写/文件目录冲突、职责限定命名、Python `snake_case`、展示树漂移与最终实物模式反例。
- PASS：`pnpm check:docs`（111 份活跃页）、`pnpm check:encoding`、`pnpm check:architecture`、根 `pnpm typecheck`、根 `pnpm build`。
- 预期 FAIL：最终源码文件核对缺少 816 个目标文件、存在 1,116 个清单外现行文件，无其他规格错误。完整差距输出在本地 `build/reports/architecture-v2/target-layout-final.json`；这些数量反映迁移差距，不代表可直接删除文件。
- 未执行：产品数据迁移、真实扩展/设备、C#/Unity/native 新目标构建与最终安装恢复；本轮没有实现这些新目标，不宣称已经通过。
- 证据失效条件：清单/树/摘要/校验器或被验证构建输入变化；后续切片按相关输入重新验证。

## 第零阶段：初始审计

下表的测试列是定位到的覆盖入口，执行结果另行记录；尚未完成的调查不表示没有风险。

| Path | Language/process | Current responsibility | Current dependencies | Canonical state owned | Public API | Vendor/platform coupling | Target module | Migration risk | Tests covering it |
|---|---|---|---|---|---|---|---|---|---|
| `core/kernel/src/runtime`、`composition` | TS / 主 Host | 监督、装配、业务接线 | Kernel application/adapters、Extension Host、SDK、contracts | 运行就绪状态、生命周期 | Kernel package 入口、runtime ports | 装配与产品能力绑定 | 通用监督入 platform；业务装配入 apps | 高：停机、取消、ready 不得改变 | `tests/runtime`、runtime integration tests |
| `core/kernel/src/application/skill-plane/skill-action-controller.ts` | TS / 主 Host | 规划、执行、合成、发布与重试 journal | Planning service、Cognition RPC、Reply publisher | 内存 operation journal | `handleActionCommand` | 固定 skill_request 流程 | capabilities execution + apps bridge；语义入 cognition loop | 高：重试可能重复外部动作 | 同名 `.test.ts` |
| `core/kernel/src/application/use-cases/skill-planning-app.service.ts` | TS / 主 Host | 目录筛选、调用规划、指令二次规划、执行 | Catalog、gateway、Cognition RPC | 无独立 durable state | plan、executeSuggestion | `MCPToolSuggestion` 名称；skill/tool 耦合 | capabilities exposure/execution；规划迁 cognition | 高：已有 scope/audience/ready 过滤须保留 | `user-skill-planning.test.ts` |
| `core/kernel/src/application/skill-plane/skill-registry.ts` | TS / 主 Host | 一个 Skill 下装 tools/resources/prompts | skill-plane ports | 注册定义与 provider health 缓存 | registerSkill、getCatalogSnapshot | provider kind 含 mcp_server | tools registry / skills catalog / resources registry | 中：不能把存在直接等同暴露 | skill scope 与 catalog 测试 |
| `core/kernel/src/adapters/skill-plane/mcp-server` | TS / 主 Host | MCP 连接、重连、能力包装 | MCP SDK、ConfigManager、readiness | 连接与重试状态 | SkillProvider | MCP Tool/Resource/Prompt | apps 或 extension bridge，内部使用通用契约 | 高：重连/销毁与注册撤销 | MCP readiness 与 gateway 测试待逐项核对 |
| `core/kernel/src/application/capabilities/conversation/conversation-directory.ts` | TS / 主 Host | 外部地址生成稳定 conversation/thread/scope | StableIdentityPort、application models | 无独立存储 | resolve | provider 字符串开放；无封闭平台 enum | conversation/binding | 高：改变 ID 算法会割裂既有历史 | `conversation-directory.test.ts` |
| Cognition `loop/` 与迁移期 `application/cycle` helpers | Python / Cognition | native iterative Loop、deliberation、行动与回复 | persona、inference、experience、memory | LoopStep + durable checkpoint | LoopController | helper 文件尚待并入目标 owner | cognition/loop；Turn 属于 conversation | 高：普通聊天与工具调用必须共用迭代链 | `test_cycle_controller.py`、`test_loop_checkpoint.py` |
| `core/cognition/.../application/agent_plan_use_case.py`、`agent_synthesis_use_case.py` | Python / Cognition | 一次计划和结果合成 | ModelPort、SelfEntity、experience | 非独立 owner | AgentPlan/AgentSynthesis use case | JSON 规划协议、SkillToolSuggestion | cognition/loop/step | 高：现有 RPC producer/consumer 成对替换 | 对应用例及 gRPC transport tests |
| `core/cognition/.../adapters/inference/gateway.py`、`cloud.py` | Python / Cognition | HTTP provider payload、响应解析、推理后端 | urllib、LLMSettings、observability | provider 调用状态 | LLMEngine.generate | OpenAI-compatible payload；local/cloud 分支 | provider 实现迁 app/extension；核心保留 inference contract | 高：当前接口只返回字符串，不支持原生 tool calls | model invocation / inference tests 待细分 |
| `core/cognition/.../adapters/persistence/experience/ledger.py` | Python / Cognition | 单写者分包 Moment 日志 | SQLite、文件 writer guard | Moment ordered log、position | append、flush、query | 无厂商语义 | conversation/log 拥有交互事实；其他经验须分类 | 极高：禁止丢失已有 Experience 与因果链 | `test_experience_architecture.py` |
| `core/cognition/.../adapters/persistence/conversation/store.py` | Python / Cognition | 从 Moment 投影历史、章节、工作集 | aiosqlite、Moment、paths | 投影 checkpoint；不拥有原始交互事实 | project、checkpoint、history queries | 无厂商语义 | conversation/history | 极高：schema v3 不匹配目前要求删除重建，须改迁移路径 | `test_conversation_architecture.py` |
| Cognition `memory/` 与迁移期 `adapters/persistence/memory` projections | Python / Cognition | 记忆、关系、向量、巩固队列 | SqliteMemoryStore、Episode、MemoryStore | Memory；巩固 Job 目前同库 | controller/repositories | Job/checkpoint 尚待拆库 | cognition/memory；队列 lifecycle 入 jobs | 高：跨表一致性、租约和幂等 | `test_memory_architecture.py` |
| `core/cognition/.../domain/persona` | Python / Cognition | profile 编译、人设及对话策略 | canonical profile 与领域配置 | 编译后 persona 数据 | profile compiler / prompt assembler | 角色资料不应迁成通用硬编码 | cognition/persona | 中：稳定关系与动态记忆分离 | `test_persona_mutation.py` |
| `core/cognition/.../application/inference/service.py` | Python / Cognition | 按活动 tier 选择 local/cloud | ReasoningBackendPort | 无 durable state | request | backend location 与业务策略结合 | cognition inference policy + platform topology public contract | 中：保留禁止推理和真实降级语义 | inference tests 待细分 |
| `core/avatar/src` | C# / Avatar | Avatar command、manifest、行为配置 | domain/application/ports | 身体命令与投影，具体写入链待核对 | command sink | 需核查渲染参数是否已隔离 | embodiment；renderer contract | 高：C# 编译与 Unity 投影 | `AvatarCoreTests.cs` |
| `hosts/unity-avatar-host` | C# / Unity | Unity/Cubism 渲染与原生合成接线 | Avatar Core、generated C#、native | Renderer 实例状态 | Avatar transport adapter | Unity/Live2D/Cubism | renderer extension/host adapter | 高：真实 Unity 构建与桌面透明窗口 | host tests、Unity 专门构建门 |
| `engines/audio`、Kernel audio adapters/config | Python audio / TS Host | ASR/TTS 处理、路由、缓存与 readiness | audio proto、provider 实现 | 音频临时数据、缓存 | audio service ports | Core AudioConfig 显式 CosyVoice、FunASR | speech provider boundary；通用 content 与 capabilities | 高：实时流、取消、就绪 | audio tests、`official-audio-engine.grpc.test.ts` |
| `hosts/extension-host/src` | TS / 独立子进程 | 加载、注册、超时、销毁、IPC | process protocol、module API | pending requests、handlers、disposables | process request/response | 子进程本身没有 OS sandbox | apps/extension-host | 极高：权限 broker、Secret、崩溃隔离 | `main.test.ts`、Kernel extension supervision tests |
| `packages/extension-sdk` | TS / 公开包 | 扩展 API、manifest、契约、打包 | contracts、validation、ws | 无核心 canonical state | package exports | SDK utilities 与 Host API 需重新定界 | extension-sdk | 高：已发布消费方兼容 | SDK tests、verify:release、template tests |
| `contracts` | proto / TS、Python、C# | wire 生成、Document schema、兼容基线 | buf、protoc、多语言工具链 | 唯一 wire/schema source | generated package + JSON Schema | 现有 kernel/audio/avatar package | protocol；Document schema 迁各 owner | 极高：不可制造第二 wire source；保留 field numbers | contracts:verify、roundtrip、breaking、generated clean |
| `products/desktop`、`products/personal-server` | Electron/TS/React / 产品进程 | UI、Surface Gateway client、打包 | Kernel、contracts、SDK 与产品工具 | UI projection、连接态 | 产品启动入口 | Desktop 平台 IO | apps/desktop、apps/server | 高：安装路径、打包及跨端 UI | 产品 tests、UI tests、smoke |
| `tools/*`、`deploy`、`native`、`configs`、`assets`、`templates` | 多语言 / 工程与运行数据 | 工具、安装事务、原生支持、配置与资产 | 多个现有路径 | 配置/资产与安装事务分别有 owner | root scripts / package-local commands | Windows/Linux、角色资产 | 随真实 owner 归属五个根边界 | 极高：根树迁移不能删除用户数据或供应链保障 | tooling / deploy / native / product tests |

## 已确认的冲突与最高风险耦合

1. 旧 Blueprint/AGENTS 禁止恢复 `protocol/`，v2 要求 `protocol/proto/`；须通过 ADR 明确替代目标，迁移前仍保留唯一现行 `contracts` writer。
2. Kernel package 当前直接依赖 `extension-sdk`、`extension-host` 和 MCP SDK，不可原样搬为 platform。
3. `skill_request` 同时存在于 Python classifier、TS ActionCommand、proto、SDK、transport 和测试；不能局部删 enum 而断开链路。
4. `SkillActionController` 的 operation journal 承担重试去重；统一 Loop 必须延续 operation/tool call identity 与 recovery-required。
5. ExperienceLedger 才是现行 canonical source；ConversationStore 是 projection。迁移是 owner 变更，不是把投影升为第二事实源。
6. `ConsolidationJobRepository` 与 Memory database/Episode 耦合，提取 Jobs 要保留 claim lease、attempt 和恢复语义。
7. 现行 ModelPort 只有字符串响应，native ToolCall/ToolResult 需要贯穿 contract、provider mapper、transport 和 Loop。
8. 已发布 SDK/扩展、模板、安装制品引用现有布局；源码迁移不能冒充外部分发已升级。
9. C# Avatar / Unity / native 是真实产品链路，五根目录收敛不能只迁 TS/Python 后遗漏它们。
10. package manifests 为 `0.2.6`，与当前协作约定的开发 `0.1.0` 不一致；版本事实源和发布历史须先核对，禁止顺手递增或重写历史。

已确认 vendor leakage：Core `AudioConfig.ts` 的 CosyVoice/FunASR 领域配置；Core inference gateway 的 provider payload；Core MCP adapter 的 SDK 依赖及业务层 `MCPToolSuggestion` 名称。
Live2D 的注释命中不等于领域类型泄漏，须按实际字段/调用核验。
静态环核查：TypeScript compiler AST 扫描 383 个 tracked 非测试 TS/TSX 文件、1382 个 import/export/require/type-import，
相对路径图未发现 SCC 环；26 个相对引用不在本次源文件集合内，package alias/外部模块未进入该图，因此不宣称全仓无环。
Python AST 扫描 Cognition 130 个模块、346 条内部依赖（包含 TYPE_CHECKING 与函数内 import），未发现 SCC 环。
原始结果在 `build/reports/architecture-v2/{ts,python}-import-audit.json`；后续护栏须补 package graph 与解析范围。

## 迁移顺序与阶段计划

| 阶段 | 可验收产物 | 状态 |
|---|---|---|
| 0 | 审计表、依赖环、state conflicts、vendor list、迁移顺序 | 已完成初始基线；后续阶段继续收窄 owner 调查 |
| 1 | v2 权威入口、ADR、增量边界检查与显式 legacy debt | 已完成：51 条例外、68 处起始命中；CI 接入 contract architecture gate |
| 2 | platform primitive 提取；业务装配留 composition | 进行中：Clock/Identity/Observability/Lifecycle/Events 与 Configuration 校验机制已切入 `core/platform`；Kernel 保留 Schema 装配、readiness、领域事件、durable replay 与 DLQ policy |
| 3 | Content/AssetRef、真实消费者和存储 port | 已完成：Content、资产库、Extension/Desktop ingress、Contract Spine、Cognition/Experience、恢复文档与独立只读审查均通过 |
| 4 | Conversation log/history/binding/Turn/interaction/delivery 唯一 owner | 进行中：v2.0 owner 与单写者已收束；按 v2.1 补持久 Turn、interaction/delivery、工具调用恢复及目标物理路径 |
| 5 | native iterative Loop、Context budget/trust、Memory/Persona/Observation | 进行中：Context、Perception Observation、Attention、Inference、State、Planning、Memory、Knowledge、Loop controller/checkpoint、原生 ToolCall 迭代、消费方 Ports、回复上下文/正文处理与版本化 Persona canonical owner 已落位；Cognition Worker adapters 接线、其余 Loop helpers 及 Memory Jobs/projection checkpoint 解耦仍待迁移 |
| 6 | Tool/Skill/Resource 分离、Step Surface 与 execution | 待执行 |
| 7 | Durable Jobs persistence/recovery/cancellation | 进行中：独立 Jobs SQLite、scope 幂等、持久 trigger/attempt、lease/fencing、authority 拒旧写、取消、unknown 对账、状态 outbox/ACK 与 retention 已实现；Memory 原 attempt receipt/fencing、原子源 outbox、目标 Host 源投递/handler/query 与持续单循环调度已落位并通过真实跨进程验证；生产进程监督/config/authority、状态事件接纳与旧数据切换待完成 |
| 8 | Embodiment semantic model 与 renderer 隔离 | 待执行 |
| 9 | SDK public contracts、brokered Extension Host | 待执行 |
| 10 | MCP Tool/Resource/Prompt normalization | 待执行 |
| 11 | protocol 单一 wire source、mapper、兼容基线 | 待执行 |
| 12 | apps 启动入口与 topology-driven composition | 待执行 |
| 13 | Conversation/Memory/Persona/Job/Config Authority 矩阵 | 待执行 |
| 14 | 带版本数据迁移、fixtures、恢复、幂等 | 待执行 |
| 15 | legacy consumer-zero 删除、CI 严格门和六条主链验收 | 待执行 |

每阶段先更新本记录中的计划，再实施；完成报告按执行要求 §20 的九项填写。
阶段 0 完成时 public API、持久数据与运行链路尚未修改；阶段 2 已调整 Platform public API 与 Kernel 生命周期接线，阶段 3 已完成 Content/AssetRef 持久边界。后续切片的当前变化与验证以本页对应记录为准；基线及执行要求是目标来源，不代表未列明的迁移已经完成。

### v2.1 当前路径到目标文件映射（阶段 4）

本表是阶段 4 的迁移输入，不表示目标文件已经实现；精确目标路径仍以
[`architecture-target-v2.1.json`](../architecture/blueprint/architecture-target-v2.1.json) 为准。
每次物理迁移须同时切换消费者、测试、构建入口和旧路径删除门，禁止按表机械复制形成双 owner。

| 当前事实 | v2.1 目标文件 | 本阶段处理与删除门 |
|---|---|---|
| 已拆分的 Binding 与 SQLite adapter | `core/conversation/src/binding/{binding.ts,binding-resolver.ts,binding-store-port.ts}`、`src/adapters/storage/sqlite-binding-store.ts` | 已完成；稳定 ID、旧地址样本与 Kernel consumer 均走公开根 API，旧聚合实现已删除 |
| 已落位的 TS interaction 协调 | `core/conversation/src/interaction/{input.ts,input-deduplicator.ts,interaction-controller.ts,interruption.ts}` | 已接入现行 Kernel ingress 并校验持久 Turn 的 payload digest；阶段 12 由 Host `turn-processor-adapter.ts` 绑定 Python Conversation 确认 Port |
| 已落位的 TS delivery 状态 | `core/conversation/src/delivery/{delivery-controller.ts,delivery-store-port.ts,output-generation.ts,playout.ts,receipt.ts}` 与 SQLite adapter | generation/epoch、晚到输出、unknown 恢复及 Desktop/Personal Server 真实 Surface receipt 已接线；阶段 12 迁入共用 Host composition |
| 已拆分的 Python ordered log | `src/glimmer_cradle/conversation/log/{record.py,position.py,reader.py,writer.py,commit_barrier.py}` 与 `adapters/persistence/{log_store.py,writer_guard.py}` | 源码与 wheel 均已 consumer-zero 删除旧聚合文件；保留 v4/v5 ID、position、单写者和 pack 读取，数据路径迁移仍等待阶段 14 备份/恢复 |
| 已拆分的 Python History | `history/{checkpoint.py,history_reader.py,projection.py,working_set.py}` 与 `adapters/persistence/history_store.py` | v3→v4、多 thread、分页、重建和权限反例继续通过；`conversations.db` 始终为投影 |
| `src/glimmer_cradle/conversation/turns/*` 与 Cognition `CycleTurn` | `turns/{turn.py,turn_controller.py,turn_store_port.py}`、`adapters/persistence/sqlite_turn_store.py` | 目标 Turn 文件和持久 adapter 已就位并持久输入摘要；Conversation Turn 与 Cognition Step 分离，旧空摘要失败关闭，跨进程查询 adapter 仍待阶段 12 |
| Cognition `CycleContinuity`、`AgentSynthesisUseCase` 的 action/result 记录 | Conversation Log 的 ACTION → ACTION_RESULT → REPLY 因果事实；跨进程映射暂经现行 cognition proto | 本切片先确保副作用前 flush、稳定 invocation 与幂等重放；阶段 6 切换 native ToolCall/ToolResult 后删除 `skill_request` 兼容链 |
| `core/cognition/.../host/*` 中 Conversation/Cognition 同进程装配 | `apps/cognition-worker/src/glimmer_cradle/cognition_worker/{composition.py,rpc_service.py,shutdown.py}` | 已迁移生产入口、composition、runtime 打包与 Kernel 启动模块；clients/mappers 拆分及 Conversation 跨进程确认仍待完成 |
| Kernel composition、Surface history 与 skill action 接线 | `apps/host/src/adapters/protocol/conversation-mapper.ts`、`composition/{domain-owners.ts,turn-processor-adapter.ts}`、`gateway/conversation-routes.ts` | 阶段 12/15 消费者切换并通过本地/headless 共用 Host 验收后删除旧 Kernel 业务接线 |

## 兼容窗口与删除门

### 阶段 7 Jobs 基础切片计划（2026-10-06）

阶段 5 的 Memory 巩固仍持有私有 durable queue，不能把该队列改名后认作 Jobs。
先补目标 `core/jobs` 的真实独立执行 owner：SQLite 单写者、scope 内幂等触发、due time、
持久 attempt、单调 fencing token、租约续期/失效、authority epoch 拒旧写、取消与 retention。
JobController 通过 App 注册 handler 执行；Scheduler 只处理调度，不理解 Memory 或认知目标。
默认无法证明幂等的工作在执行中断后进入 unknown，只有显式 idempotent 工作可自动重试。
验证重复/冲突触发、双连接 claim、过期与旧代拒写、重启恢复、取消后的晚到结果和保留窗口。
此切片只创建独立库，不读取或迁移用户 Memory 数据；Memory producer/handler、跨库提交协议、
Host/Worker broker 和 Jobs 配置 Schema/catalog 的原子切换继续留待后续接线，阶段 7 不提前完成。

实现候选：`core/jobs` 的独立 SQLite adapter/消费方 Port、JobController、Scheduler、TriggerController、
Recovery/Retention controller 及五份目标测试已落位，根 build/test 纳入私有 `0.1.0` 包，pnpm 锁只增加
该 importer，未升级第三方依赖。库使用 owner/application ID 与 schema version 拒绝误用旧库；claim、
续期、完成、authority 切换和去重均为独立 IMMEDIATE 事务，不跨 await 持有 SQLite 写锁。
完成与续期要求 live lease、当前 epoch/owner/token；取消持久撤销后才传播 AbortSignal，晚到成功不改写
取消事实。执行只读取持久 Job，不信调用方 claim snapshot；重复同 attempt 共用执行 Promise。
handler 异常只记录稳定错误码；非幂等副作用不明进入 unknown，明确幂等且未耗尽 attempt 才退避重试。
retention 不删除 unknown，终态清理保留 scope/key/digest 的 tombstone，不能因清理重新触发。

当前候选验证：Jobs 15 项 PASS（真实 SQLite 双连接、关闭/重开、过期边界、旧 authority/owner/token、
续期不缩短、重复/冲突触发、claim 内容伪造、handler 策略/失败、取消/收尾及 retention）；Jobs typecheck/build、
offline frozen install、根 typecheck/build、architecture、目标清单规格、docs/encoding/diff PASS。
根验证之后新增的 Jobs 反例/收尾策略已由同包 typecheck/build 重验，其余根构建输入不变。
未完成项仍为上文持久周期/事件 trigger、cross-store commit/unknown 对账、真实 Memory 与 broker 消费方、
安装/恢复和固定候选独立审查；未创建生产库、迁移运行数据或宣称阶段 7 完成。

后续持久触发切片：事件 occurrence 与 Job 入队在同一 Jobs SQLite 事务确认；周期触发的 occurrence、
next due 与入队也在同一事务提交。定义保持不可变，同 trigger ID 的内容冲突失败关闭；启停使用 revision CAS，
已确认 occurrence 保留稳定身份，重复 tick 或重启不重放。UTC 固定间隔显式选择 all/latest 补偿政策，
每次 materialize 有界；禁用不取消已生成 Job。测试覆盖断点回滚、双连接竞争、停用/旧 revision、
晚到/重复事件、周期 backlog 与重启恢复。新库 schema version 升为 2，旧候选 v1 库拒绝自动改写，
生产库尚未创建；配置 Schema/catalog、产品接线及跨库提交不在这个触发切片中伪造完成。

持久触发实现候选（2026-10-06）：目标 `schedule.ts`/`trigger.ts` 与实际 SQLite/Scheduler 已接通；
事件 occurrence 与固定 input 分区，事件不能覆盖模板；已确认事件在停用后仍可返回 duplicate，
新的事件被拒绝。周期 next due、occurrence 与 Job 在同一 IMMEDIATE 事务确认，all/latest 明确区分
逐项补偿与只取最近到期项，最多 1000 项/批。两真实 Node 进程同时触发同一 SQLite 周期只生成
一组身份；在第二个 occurrence INSERT 注入 SQLite ABORT 时，第一项 Job/receipt 与 checkpoint
全部回滚，移除 fixture 故障后从原 due 完整恢复。一次性 trigger 经真实 Scheduler 调用 handler
后 checkpoint 终结，重复 tick 不执行。旧候选 v1 库拒绝隐式升级并保留原 Job/版本。
Jobs 22 项、根 typecheck/build PASS；architecture、目标清单规格、docs/encoding/diff PASS。
运行库路径/用户数据、跨进程 wire 与第三方依赖均未改变；仍不宣称 broker/Memory 接线、
跨库提交、unknown 对账或阶段 7 的完整安装恢复门已完成，独立审查留待固定最终候选。

下一 Jobs 恢复切片：持久保存每次 attempt 的原 epoch/owner/token，失效/切代后也保留对账依据。
unknown 只能通过 App 注册的结果查询 Port 获取绑定 Job/scope/attempt/lease 的证据，再以 revision/epoch
CAS 更新；查询失败、无证据、旧代或不匹配证据不允许重放。not-applied 证据还必须证明旧 attempt
已被接收 owner 封口，不能把“暂时查不到”视为安全重试。状态转换与待发布 outbox 原子提交，接收方
幂等接纳后才 ack；验证目标库已提交但 Jobs 完成 ACK 丢失、outbox 接收后 ACK 丢失、旧证据晚到及
retention 不删除未投递事实。schema 升到 3，旧候选库只在受控迁移下升级；不改用户生产数据。
本切片验证 Jobs 与独立目标 SQLite 的提交窗口，不冒充真实 Memory/Host/Worker broker 已切换。

恢复实现候选（2026-10-06）：每次 claim 原子保存原 attempt epoch/owner/token，续期与结束状态持久记录；
handover 只变更 Job 当前 authority/fence，原执行身份保持不变。App 结果查询 Port 返回绑定身份的证据，
revision/epoch CAS 接纳 applied/failed，只有接收 owner 已封口且确认未提交的 not-applied 可在预算内重试。
状态、最小证据身份/摘要和 outbox 同事务提交；同证据重复幂等、内容冲突拒绝，旧证据不解决新 attempt。
投递由 RecoveryController 的有界 App receiver 调用完成，接收方业务/inbox 提交后才 ACK；失败、取消、
错误确认身份或切代保留待投递事实。retention 等待全部 outbox ACK 后清理终态大记录与已确认事件，
保留最小 attempt/证据、tombstone 和 occurrence；不删除 unknown。

本地候选验证覆盖两个独立 SQLite 的目标业务/receipt 已提交、Jobs 完成 ACK 丢失并重开恢复；
接收业务/inbox 回滚与提交后 ACK 丢失重投；旧 writer 被接收方 fence 拒绝；查询失败/取消/错证据、
旧 revision/authority/attempt，以及 outbox/审计故障回滚 enqueue/claim/finish/cancel/recover/handover。
schema 3 拒绝旧候选 v1/v2 隐式升级，原数据和版本保持。Jobs 31 项、包 typecheck/build、根
typecheck/build PASS；architecture、目标清单规格（非最终实物）、docs/encoding/diff PASS。
生产数据路径、wire、依赖和公开 SDK 未变化；真实 Memory 的源业务 request outbox、handler、生产
接收 fencing/receipt、Host/Worker broker、配置 Schema/catalog、安装恢复及最终独立审查仍待完成。
下一依赖切片接通真正的 Host→Worker Jobs handler/query 边界与 Memory 业务/request outbox，
以生产调用链的幂等 receipt、提交点 fencing 和恢复证明替换私有巩固队列；旧 owner 只有在 consumer-zero、
旧样本迁移和验证通过后才删除，不用本地目标库 fixture 代替生产接收端。

Memory 接收端前置切片：真实 Memory/Vector/Relationship/旧巩固队列共享一条 aiosqlite 连接，
分散的 BEGIN/commit 在 await 间可交叉；Jobs 生产 receipt/fencing 不能建立在这个提交边界上。
先由 `SqliteMemoryStore` 唯一拥有进程内读写串行化和 IMMEDIATE 事务提交/回滚，所有消费者统一使用；
取消涵盖 BEGIN、业务写入与 commit，回滚完成前不释放连接。验证并发向量写不提交未完成 Memory batch、
取消后数据库无半写且连接可复用、读取不暴露未提交记录、独立连接锁竞争与异常恢复。
此项不改变 Memory schema 或用户数据，不把旧巩固队列认作 Jobs；完成后继续 production broker/receipt 接线。

Memory 共享连接候选（2026-10-06）：独立 SQLite reader 复现向量 writer 误提交未完成 Memory batch；
统一事务 owner 后向量必须等 Memory 回滚才提交，所有生产 repository 的读写与关系 checkpoint 均使用
store 的串行边界。BEGIN、业务写入和 commit 取消都等待清理；重复取消不提前释放 owner，回滚失败
撤销连接，关闭取消保留取消语义但先收完资源。新库 DDL/schema metadata 初始化失败原子回滚，
两独立连接竞争仍由 SQLite IMMEDIATE 锁裁决。commit 已发生而确认丢失的反例如实保留已写记录，
不能推断未提交；真实 Memory receipt/fencing 与 Jobs broker 仍为下一必需步骤。
Memory 定向 20 项、Cognition 全量 224 项、Worker 全量 62 项、真实 Kernel→Worker 集成 5 项 PASS；
正常停机 exitCode 0 / signal null，崩溃恢复中的 SIGTERM 为主动注入。根 typecheck/build、Ruff I/F、
architecture、目标清单规格（非最终实物）、docs/encoding/diff PASS。Data Layout 的 Memory 路径旧误写已按
真实 composition 修正为 `data/state/cognition/memory.sqlite`，不是运行数据迁移。
Memory schema 3、wire、依赖和生产路径不变，未执行用户数据迁移或删除旧巩固队列；独立审查留最终候选。

Memory receipt 切片计划：Memory owner 将修订/evidence、批次结果 receipt 与每个 Episode/version 的
scope/input 摘要索引在同一事务提交。恢复按每个 Episode 查询，而非仅按重试时可能变化的分批 ID；
已提交结果先对账，不重新调用模型，noop 也有持久结果。相同 operation/input 重复幂等，变更 scope/
version/输入或同 operation 的不同输出拒绝；receipt 不存在不构成 not-applied 或自动重放的证明。
现行真实巩固 consumer 立即接入，旧队列完成/失败只接受对应 claimed attempt，完成后投影确认丢失可
从 receipt 修复。schema 升到 4，仅测试新库与旧 schema 拒绝路径，不自动改写用户 v3 数据；迁移/备份
仍归阶段 14。Jobs 原 attempt 的生产 fencing/封口、源 request outbox 与跨进程 broker 继续待接线。

Memory receipt 候选（2026-10-06）：真实 Memory 修订/evidence、批次结果与 Episode/version 输入索引
同事务提交；scope/input/output 冲突拒绝，noop 也保存结果。相同 operation/input/output 重复返回原
receipt；重复 Memory 修订和没有原子 receipt 的既有同批修订不冒充成功。真实巩固 consumer 在推理前
查询结果，已提交批次即使重启改为单 Episode 分批、模型不可用、缓存刷新或队列/投影 ACK 丢失也不再推理。
旧队列 complete/fail 绑定 claimed attempt；完成中任一旧 attempt 冲突回滚整个批次，晚到 fail 不重开已完成项。
Memory 定向 46 项 PASS（含三个 SQLite 提交点故障、输入索引第二项失败、两独立连接竞争、提交确认取消、
真实 consumer 三种 ACK/缓存丢失重开恢复与旧 attempt 反例）；Cognition 全量 250 项、Worker 62 项、
真实 Kernel→Worker 5 项、根 typecheck/build PASS。Ruff I/F、architecture、目标清单规格（非最终实物）、
docs/encoding/diff PASS；独立审查继续留固定最终候选。Memory schema 4 仅创建测试新库，旧 v3 拒绝隐式
升级且数据保留；wire、公开 SDK、依赖与生产路径未变，未执行用户数据迁移。
此 receipt 仍是 Memory 领域结果，不是绑定 Jobs 原 epoch/owner/token 的生产接收证明。下一切片继续
将 request outbox、接收端原 attempt 封口/提交 fencing、Host→Worker handler/query 和 Jobs 配置装配
接入实际调用链；旧巩固队列在 consumer-zero、旧样本迁移与恢复门通过后删除，阶段 7 不提前完成。

Memory Jobs 接收切片计划：Memory 保存原 job/scope/attempt/epoch/token/owner 和 lease deadline，
登记/封口与业务提交共享同一个 IMMEDIATE 边界。新 authority 拒绝旧提交；对账先持久封口再读取结果，
未知 attempt 也保存拒绝晚到执行的 tombstone，不把空查询当 not-applied。结果 receipt 与 attempt 接纳
同事务提交；推理不持有事务，提交前再次核验原身份和 deadline。跨进程定义归现行 Contract Spine，
Worker 的真实 composition 接入该接收 owner；Kernel 迁移期 transport 消费同一生成契约。此切片不
宣称 source request outbox、生产 Jobs scheduler 装配或旧队列 consumer-zero 完成；这些紧随接收边界接线。

Memory Jobs 接收候选（2026-10-06）：原 job/scope/attempt/epoch/token/owner/deadline 登记到 Memory
owner；新 attempt/authority、租约失效或显式对账封口均拒绝旧提交，结果接纳 SQL 最后核验数据库时钟。
未到达的 attempt 先持久 sealed tombstone 再返回 not-applied，错误身份不能封口真实执行；业务 receipt、
attempt applied 与观测时间同事务提交。同一证据 ID/观测时间在重复确认和重启后保持稳定。
真实 Worker composition 将同一 ConsolidationCoordinator 接到 `ExecuteMemoryJob` /
`ReconcileMemoryJob`，Kernel transport 使用唯一生成契约；generation、readiness、typed recovery action、
取消/停机仍走受监督 Service。并发 RPC 即使共用 trace 也按实际 task 持有资源，不覆盖在途收尾 owner。

Memory 定向 61 项、Cognition 全量 265 项、Worker 全量 69 项 PASS；真实 SQLite 覆盖未知 attempt
封口、原 identity 冲突、新 attempt/authority、推理中封口、提交末端 deadline、applied/receipt 故障回滚及
旧 v3/v4 拒绝隐式升级并保留业务数据。Worker RPC 覆盖真实提交/重开/重复、封口晚到执行、非法 generation/
scope/整数，以及相同 trace 的并发停机收尾。Kernel→Worker 定向集成 6 项 PASS，新增真实进程重启对账
并保持原 epoch/token 与稳定证据；正常停机 exitCode 0 / signal null。
Contract Spine generate/verify PASS：22 项护栏、兼容门、TS/Python/C# roundtrip、确定性生成及 clean 检查；
未刷新 Proto 兼容基线。根 typecheck/build、Ruff I/F、architecture、目标清单规格（非最终实物）、
docs/encoding/diff PASS，独立审查仍留固定最终候选。
验证资源纪律：contracts 生成会重建 Python projection，SDK build 会短暂清理 dist；实际 Worker 重启/集成
不得与这些任务并发。本候选在确认 ModuleNotFoundError / SDK entry 缺失属于该竞争后，固定产物串行重验通过，
未放宽断言或超时。Memory schema 为 5，未迁移用户库、创建生产 Jobs 库或切换旧巩固队列；下一步仍为
源 request outbox、Host handler/query 与 scheduler/config 的实际消费装配，再满足旧 owner 删除门。

Memory 源请求切片计划（2026-10-06）：在 Episode 封口与 projection checkpoint 的同一 SQLite 提交中
记录具有 Episode/version/scope/input digest 的稳定请求；没有可接受 Memory 证据的 Episode 不产生请求。
重启扫描、重复确认与 ACK 丢失均保留同一请求身份，拒绝不同 payload 或不同 Job 的确认。
请求接纳只结束源投递，不代表 Memory 结果或 Jobs 终态；已持久请求约束 Episode 的删除/重建，不能
继续把该数据库整体视为可随意删除缓存。当前执行 owner 独占写入；不修改用户数据，不切换旧执行队列，
Host wire/handler/scheduler 的真实消费接线紧随其后。验证封口/请求/checkpoint 原子回滚、重启重放、
确认冲突、已接受请求的重建保护及原有投影/巩固链路，再执行根基线和文档门禁。

源请求候选（`a3b4f154` 上本轮 Memory/投影与相关文档 dirty 范围）：所有实际封口入口均在同一
SQLite 事务中写入 `memory_request_outbox`，终结 Moment、强制/闲置封口和进程中断恢复不会留下
“Episode 已封口或 checkpoint 已推进但请求未保存”的半提交。request ID、scope/input digest 与首次时间
跨重启重放保持不变；有界扫描只返回未接纳、未解决项。完整源请求与原 Job 绑定确认幂等，冲突拒绝；
接纳不完成 Memory，业务/跳过结果与源解决标记同事务更新，迟到 ACK 仍可持久绑定。
原证据缺失失败关闭；已有源记录（含已解决记录）禁止普通重建，以免原随机 Episode ID 和 Job 幂等身份丢失。
同库窗口由 Cognition Memory 持有，退出门为阶段 14 的备份、原身份保留/outbox 恢复与 consumer-zero。

13 项新增反例及 Cognition 全量 278 项、Worker 69 项 PASS；真实 Kernel→Worker 启停、重启对账、
取消、崩溃后失败关闭与显式恢复共 6 项 PASS。根 `pnpm typecheck`、`pnpm build`、Ruff I/F、
architecture、目标清单规格（非最终实物）、docs（111 页）、encoding 和 diff 检查 PASS。
本切片未改变 wire、Schema 事实源、生成物或依赖；复用 `a3b4f154` 的完整 Contract Spine 22 gate 证据。
没有迁移用户数据或创建生产 Jobs 库，独立审查仍归固定最终候选；下一步接源投递 wire 与 App 层
`cognition-job-adapter`，贯通 Host Jobs handler/query、scheduler/config，旧巩固队列继续保留到删除门。

Host Memory Jobs 消费切片计划（2026-10-06）：在唯一 Cognition Service 增量定义源请求扫描/接纳 ACK，
Worker 只在显式外部 Jobs 模式暴露待投递请求，禁止与旧队列同时消费。目标 `apps/host` 首先落真实
`cognition-job-adapter` 与生成契约 client/mapper；依赖仅 Contracts/Jobs，不把旧 Kernel 整体搬入 App。
源接纳先持久 Jobs enqueue 再 ACK，同一请求重放保持 Job 身份；执行与对账严格核验原 attempt/scope/
epoch/token/owner，丢失结果 ACK 只通过 Memory 原持久 receipt 恢复，不因 RPC 超时猜测无副作用。
完成实际跨进程 Worker→Host SQLite→Memory 执行/unknown 对账及拒旧证据测试，更新 build/workspace
消费和事实文档。生产 scheduler/config、最终 Host 启动与旧数据切换仍未完成，不提前删除旧 owner。

本候选实现：外部 Jobs 模式的维护只发布/整理源请求，启用、salience 和已有业务 receipt 仍由 Memory
判断；旧队列模式的源 RPC 明确 NOT_READY。目标 Host workspace 新增实际生成契约 client、job mapper
与 CognitionJobAdapter，只有 Contracts/Jobs 依赖，不移动旧 Kernel 业务或建立空启动入口。源 enqueue
提交后再 ACK，响应取消/丢失不撤销 Jobs；execute/query 绑定原 attempt 并验证可信 owner、持久封口、
原 identity、结果/证据摘要与安全整数。本地取消另外发送有界封口 RPC，晚到原 attempt 不再提交 Memory。
源投递政策需保持原快照直到 ACK，政策漂移失败关闭；生产配置变更/retention 必须补齐未确认源的原政策
恢复。`cancelled` 不承诺业务回滚，状态事件接纳与观测须保留已提交结果或不确定性，不能只凭本地取消清理。

Host 14 项（含真实跨进程源 ACK 丢失、Worker/Jobs 重启后的原 receipt 对账、未到达原 attempt 封口与
新 attempt、非法 generation、真实在途模型取消/拒晚到重放及证据漂移）PASS；Cognition 全量 279 项、
Worker 72 项 PASS。新增 Host App 的 legacy package/tool 依赖护栏反例通过，并补齐 side-effect import
检查。新增依赖复用仓库锁定版本，pnpm 离线安装成功，锁文件仅增加 Host importer。
Contract Spine 完整 22 gate、兼容门、TS/Python/C# source ACK round-trip、确定性生成与 clean PASS；
首次 inventory 缩写和生成归一化文件写入失败已分别补全/重新生成后串行复验，未刷新兼容基线或降低断言。
固定输入为 `2e070b85` 上本轮 Worker/Memory/Contracts、Host workspace、根构建测试/锁、护栏与相关文档
候选；根 `pnpm typecheck`、`pnpm build`、Kernel 6 项真实进程测试、repo-checks 27 项、
文档 111 页链接检查、编码、架构护栏与 diff 检查均 PASS；target-layout 为 spec-only PASS，
不代表最终物理目录已完成。独立审查仍归最终固定候选。
下一步接实际产品监督、Jobs schema/catalog/scheduler 与状态事件接纳，贯通配置选择外部 owner、旧数据
受控迁移与 consumer-zero 后删除旧巩固队列；阶段 7、整体 Host 迁移与完整重构仍未完成。

### 阶段 7 Host 持续调度生命周期（2026-10-06 当前候选）

上一轮 `d4c7ee44` 已接通 App client/mapper/handler。本轮由当前会话唯一写入 owner 接入
目标 `apps/host/src/composition/host.ts` 的 Memory Jobs 持续驱动：有界源投递、持久 unknown
分页对账、到期执行以及可注入的持久状态接收方；不伪造整个 Host readiness 或状态事件 ACK。
停止先撤销接纳和 timer/RPC，再等待执行封口与循环，最后关闭当前 generation client；Store
仍由注入它的装配 owner 拥有。authority epoch 由权威 owner 注入，不在循环中生成。
Core 只增加通用 kind 过滤、分页查询及 signal 截止，不依赖 Cognition 或 App。

已验证真实 Worker 自动执行/响应丢失后的自动对账、重复启动与无重叠循环、取消模型与 drain、
读源期间停机、跨 authority 拒旧主、非法源失败关闭、unknown 扫描公平性、未知 kind 不被 Memory
切片提前 dead-letter；Node timer 超限直接拒绝，避免变成 1ms 热循环。Core Jobs 33 项 PASS；
Host 22 项 PASS。固定输入为 `d4c7ee44` 上本轮 Host composition/公开入口/测试、Core Jobs
StorePort/SQLite/Scheduler/测试、两包 README 与相关 Current/Implementation/执行记录；未改
Python、wire、生成物、锁文件或 SQLite schema，上一候选 Cognition/Worker 与契约全量证据可复用。
根 `pnpm typecheck`、`pnpm build`、架构、111 页文档、编码与 diff 检查 PASS；target-layout
仍为 spec-only PASS，不代表最终实物完成。本轮未启动生产数据库、迁移真实用户数据或发布产品；
旧队列因默认生产 consumer 未切换而保留。独立审查仍归整体最终固定候选。
生产监督/authority 持久配置、配置 schema/catalog、状态事件 wire/inbox、
未确认源政策快照/retention、旧数据迁移与队列删除仍须继续，不能以此切片声明阶段 7 完成。

### 阶段 3 完成切片（2026-09-20 固定方案）

本切片完成 Content/AssetRef 的真实 producer→Contract Spine→Cognition→Experience 链路；阶段 4 的
Message/Conversation owner 迁移不提前实施。仅 `experience` 与 `memory_candidate` 的新媒体进入
持久资产库；`transient` 只在当拍使用。平台 Adapter 负责提供媒体字节，Core 不抓取不可信 URL。

1. 建立私有 `core/content` 的 Text/Image/Audio/Video/File `ContentPart`、`AssetRef` 和存储 port。
   Kernel 是本地文件适配器唯一 writer，`data/state/content/assets/` 按随机 ID 原子保存不可变字节与
   SHA-256；`data/work/content/` 只存有限时上传。Cognition 只读并校验；路径不进入持久引用或公开 API。
2. Extension Host 提供 `PERCEPTION_WRITE` 下分块上传与一次性绑定 token，限制 1 MiB/块、
   256 MiB/资产、30 分钟暂存；提交失败清理暂存，已持久保存但 Ledger 尚未确认的资产不自动删除，
   报为待核查孤儿。产品录音仅在 ASR 成功后将音频引用与可信转写送入感知。
3. `contracts/proto/` 是唯一跨进程 Content wire source；Cognition `PerceptionContent.parts = 6`
   为新入口，`items = 5` 限期读取。Experience 新 Moment 保存语义和引用而非媒体字节，旧 v4
   只读兼容。旧 URI-only Extension 事件仅在旧边界当拍消费，不伪造持久资产；退出门为阶段 9
   独立扩展消费方切换及阶段 14 旧样本/恢复验证。
4. `IdentityRouter` 无生产消费者，迁移分类反例到真实 Extension ingress 后物理删除；不搬入 Content。
   当前各类旧占位媒体不作为资产迁移输入。存储 owner 的长期取舍写 ADR，并同步 Current、
   Implementation、Reference、恢复 Guide 与本记录。

验收：上传越权/超限/错误摘要/断线/重复提交、原子写与重启损坏读取、五类 Content 跨进程、
ASR 成败、v4/旧音频与过期 URI、备份恢复；`pnpm contracts:generate`、`pnpm contracts:verify`、
Cognition 全量、相关 Kernel/SDK/产品集成测试、根 typecheck/build、架构/编码门。固定候选独立
只读审查通过后方可将阶段 3 标记完成。

候选实现：`core/content` 只拥有纯类型与 Port；Kernel `FileAssetStore`、`StagedAssetUploads` 是资产单写者与暂存 owner，Extension Host IPC 受 `PERCEPTION_WRITE` 约束，产品录音 ASR 成功后才保存音频。Attention 批处理/中断保留 `parts` 与感知完成承诺。Cognition gRPC 读取 `parts`，只读资产校验后仅将图片交视觉 provider；Experience v5 存引用、语义及旧 URI 不可恢复标记，v4 继续读取。`IdentityRouter` 已 consumer-zero 删除。长期取舍见 [ADR-0020](../architecture/decisions/ADR-0020-Content资产单写者与恢复边界.md)。

剩余兼容入口与删除门：`PerceptionContent.items = 5`、SDK `PerceptionModalityItem` 及 Cognition URI-only 分支仅供已发布 Extension 的旧事件当拍读取，媒体不可保证恢复；阶段 9 切换独立扩展消费者、阶段 14 用旧样本与恢复验收后删除。Experience v4 是长期历史读取入口，不批量伪造资产；迁移样本与备份必须同时覆盖 Ledger 和 Content 资产。`Message` owner 留阶段四。提交成功但 Moment 尚未确认的资产保留，Kernel 记录待核查孤儿，不自动删除。

固定候选门禁已通过：`pnpm contracts:generate` 与 `pnpm contracts:verify`（含 TS/Python/C# Content roundtrip）、Cognition 全量 256 项、Kernel 全量 203 项（另 7 项跳过）、Extension SDK 10 项、Extension Host 4 项、Desktop 10 项、架构与编码检查，以及根 `pnpm typecheck`/`pnpm build`。新增定向用例覆盖 token 越权/限额/摘要/中断/重复提交、畸形第三方 proposal 的全 token 清理、资产原子落盘/损坏/重启/备份恢复、五类 Content、停止竞态、产品 ASR 成败、v4 与旧视频音频降级。固定候选的独立只读复审确认 Attention 停止窗口、媒体批处理/结算和 Extension token 清理边界均无阻塞问题，阶段 3 完成。生成 DTO 的本次有意变更只暂存于 Git index，以满足 `check-generated-clean` 对工作树无差异的要求；未提交或推送。

### 阶段 4 Conversation owner 迁移计划

阶段 4 按风险拆成连续切片，但只保留一个 Conversation 领域 owner；目录出现不代表阶段完成。

1. 先建立私有 `core/conversation`，迁入稳定 `ConversationAddress`、`ConversationContext` 与
   `ConversationDirectory` binding 解析。Kernel 只负责注入 Platform `StableIdentity` 并消费解析结果；
   Extension SDK 继续保留公开发布投影，Adapter edge 负责结构映射。旧 Kernel 定义与实现消费者归零后
   物理删除，不保留第二套算法。验收稳定 ID、thread/continuity、visibility scope 和非法/空白输入边界。
2. 审计现有 Experience Ledger 中 interaction fact 与 Cognition-only experience 的实际种类、producer、
   causation、Episode/Memory 消费者及 v4/v5 数据。设计 Conversation Log 单写者与旧 Ledger 读取迁移；
   在迁移和恢复样本固定前，不双写、不移动 `data/state/cognition/experience/`，也不把可重建
   `conversations.db` 升为事实源。
3. 将 Message、Turn、ordered log、History projection 迁入 Conversation owner；Cognition 只通过 Port
   读取模型上下文并消费允许形成 Experience/Memory 的事实。Turn 保留完整交互周期，模型 Step 留待阶段 5
   在 Cognition Loop 内收束。模型可见 ToolCall/ToolResult 必须能从 log 或稳定引用恢复。
4. 将外部 endpoint/thread binding 的持久语义收束为 opaque ref；核心不得出现平台字段。逐项分类
   `Session`：Surface/Auth/transport 连接继续作为 Runtime Session，持久聊天只使用 Conversation。
5. 阶段验收覆盖旧 Ledger/Conversation DB 样本、重建、损坏、幂等、权限域漂移、分页 cursor、停机窗口、
   普通对话和工具结果恢复；运行 Cognition 全量、相关 Kernel/产品集成、架构/编码/文档门以及根
   `pnpm typecheck`/`pnpm build`。固定候选独立只读审查通过后才把阶段 4 标记完成。

首个切片只迁移 binding 的类型与确定性解析，不改 wire、公开 SDK、持久数据、稳定 ID 算法或用户可见行为。
兼容窗口仅限公开 Extension SDK 投影；它不是 Core 的事实源，退出条件归阶段 9 的 SDK 消费方迁移。

实施结果：新增私有双语言 owner `core/conversation`。TypeScript 包拥有
`ConversationAddress`、`ConversationContext` 与 `ConversationDirectory`，继续消费 Platform
`StableIdentity`；Kernel 旧类型定义、Directory 实现与测试已 consumer-zero 删除。Python 包拥有
Message/WorkingSet、Turn、canonical Conversation Log 单写者、History Store/Controller 及其 Port，
Cognition 只在 Worker composition 注入 Conversation reader 与兼容数据路径；旧 Cognition
`domain/application/adapters` Conversation 与 Experience Log 实现已物理删除。
稳定 ID、SQLite schema v3、checkpoint、分页 cursor 与 `data/state/cognition/conversations/` 路径均未改变。

原 Experience Ledger 的现行种类均为已发生交互事实：perception、emotion、reply、action、
action result 与 silence；候选 thought、循环节拍、provider 故障和维护调度仍只进 observability。
`moment_id`、全局 position、causation、v4/v5 读取、月度 pack 与 `data/state/cognition/experience/`
物理路径保持不变，避免数据改写和双写；路径版本迁移与旧样本恢复留阶段 14。Cognition 的 Episode、
Relationship、Context 与 Memory 只通过 `ConversationLogReaderPort` 消费并形成 Experience 投影。
长期取舍见 [ADR-0022](../architecture/decisions/ADR-0022-ConversationLog与Experience投影边界.md)。

Turn 由 Conversation 拥有稳定交互身份、Conversation/continuity/thread 与 scope；Cognition `CycleTurn`
只组合该 Turn 和模型循环瞬态，模型 Step 留阶段 5 收束。仓库中的 Surface Gateway、WebSocket、认证和
provider session 均为连接或授权生命周期，不是持久聊天实体；核心持久连续性只使用 Conversation。

阶段 4 尚未标记完成：下述 v2.0 固定候选的完整门禁曾通过，但 v2.1 已扩大 Conversation 的目标范围；
该证据不能覆盖新增 interaction/delivery、持久 Turn 与物理目录契约。依用户授权，非必要中间审查延后到
整体重构固定候选集中执行；高风险持久化与跨进程边界仍必须在最终候选接受前完成独立只读审查。

固定候选证据：`@glimmer-cradle/conversation` TypeScript 3 项与 Python 4 项、Cognition 全量 256 项、
Kernel 全量 201 项（另 7 项跳过；原 2 项 Directory 测试已迁至 Conversation）、Desktop 10 项，
根 `pnpm typecheck` / `pnpm build`、docs、architecture、encoding、version 与 `git diff --check` 均 PASS。
新增用例覆盖单写者、重启 position、History 重建、transient 排除与损坏 gap 检出；既有用例继续覆盖
v4/v5、catalog 重建、scope 漂移、稳定 cursor、Episode 恢复和工具结果来源/因果。架构门首跑发现 Cognition
深导入 Conversation 内部 `log/ports`，改为根入口公开契约后重跑通过；Cognition 全量和 Conversation
双语言测试也在该修复后再次通过。并行早期首跑曾因 Conversation 包尚未构建而使 Kernel typecheck
报模块缺失，按根构建依赖顺序重跑即通过；两次失败均已修正且不属于当前候选。

v2.1 继续实施后，上述 v2.0 固定候选证据仅作为历史输入，不再代表阶段 4 当前候选已经通过。
当前切片补 ACTION 副作用前 durable barrier、稳定 invocation 的 ToolCall/ToolResult/Reply 因果链和幂等
重放，并同步 Contract Spine 的调用元数据。History v3→v4 迁移释放 SQLite 重命名后遗留的旧索引名，新增
无损迁移与同 conversation 多 thread 隔离反例。Conversation 持久 Turn 已具备幂等接纳、上下文冲突拒绝、
乐观修订、合法终态和重启中断恢复；Cognition 普通回复/沉默在 Log 提交后完成 Turn，能力请求等待
ToolCall/ToolResult/Reply flush 后完成。Conversation Python 14 项、相关 Cognition 47 项定向测试与
Cognition 全量 258 项 PASS。
Contract Spine 完整 verify（21 项 gate、inventory、Buf lint/breaking、JSON Schema、toolchain、三语言
roundtrip、generated-clean）、docs、architecture、encoding、根 typecheck/build 与 `git diff --check` 均 PASS。
interaction、delivery、目标物理拆分和阶段 14 数据迁移仍属于阶段 4/后续依赖工作，因此不标记阶段完成。

后续 Binding 物理切片把 `src/index.ts` 的聚合实现拆入 `src/binding/{binding,binding-resolver,
binding-store-port}.ts`，并以 `migrations/001-binding.sql`、`SqliteBindingStore` 和 Kernel composition 建立
真实持久消费者。数据库只保存 opaque identity，不保存外部 account/space/thread/actor 键；同一地址的
权限分类漂移拒绝覆盖。Conversation TS 5 项、Kernel 全量 202 项（另 7 项跳过）及 typecheck PASS；
Conversation tarball 同时包含编译后的 adapter/API 与唯一 SQL migration。interaction/delivery 尚未实现，
本切片不扩大阶段完成声明。

Interaction/Delivery 实施切片新增目标清单中的全部 TS owner 文件、`migrations/002-delivery.sql` 与三份目标
测试入口。Interaction 已接入 Kernel `PerceptionAppService`，按 provider event identity/content digest 去重，
同 route 新输入使旧 generation 失效；Delivery 已接入普通与工具回复唯一 publisher，以进程 authority epoch、
destination generation 和稳定 trace output identity 防止晚到/重放。EventBus 发布成功只形成 sent；异常形成
可恢复 unknown，播放只按 receipt 推进实际 heard range。Conversation 当前 11 项与 Kernel 相关 17 项定向
测试 PASS；Kernel 首轮全量发现 Application 直接导入 `node:crypto` 的架构门违规，已改为 composition
注入 Platform identity digest。修复后 Kernel 全量 204 项 PASS（另 7 项跳过）。Surface wire 的 delivery
receipt/播放回执尚未接线，跨重启 ingress 去重仍需消费 Python 持久 Turn 确认。因此阶段 4 继续进行，
不宣称 interaction/delivery 完成。Conversation tarball 已包含 Interaction/Delivery 编译产物与两份 SQL
migration；docs、architecture、encoding、根 typecheck/build 与 `git diff --check` 均 PASS。

Python 源码根物理迁移切片将唯一包入口从 `python/glimmer_cradle/conversation/` 切换为
`src/glimmer_cradle/conversation/`，pytest 测试统一归入 `core/conversation/tests/`；setuptools、pytest、
根测试脚本、Cognition workspace editable dependency 与实现文档已同步，旧源码和旧测试入口 consumer-zero
删除。迁移后的 Conversation Python 14 项、Cognition 全量 258 项、Conversation TS/Node 11 项均 PASS。
该切片只收束源码根，不改 SQLite 数据路径或 schema；Log/History/Message 聚合文件仍须按目标职责继续拆分，
因此不宣称目标物理目录或阶段 4 完成。

Python 职责拆分切片进一步删除 `events/fact/factory/ledger/recorder`、`history/store/controller`、单数
`message/` 与通用 `ports.py` 聚合入口；Log record/position/reader/writer/commit barrier、History
checkpoint/projection/reader/working set、复数 Messages 和 persistence adapters 均按 v2.1 文件契约归位。
writer guard 从 SQLite adapter 中独立并保持跨进程 fencing；History/Turn 新库由
`migrations/python/{001-history,002-turns}.sql` 作为唯一 fresh-schema 来源，wheel 明确携带且隔离安装读取通过。
Conversation 精确清单已无缺失文件；Python 主仓库依赖现由根 uv workspace/lock 统一解析，Conversation
不再保留子项目锁。新增公开 API、投影缓存失效、writer fencing 与固定 v4/v5/playout fixture 反例后，
Conversation Python 18 项、TS 9 项、Cognition 全量 258 项和 Kernel 全量 204 项（另 7 项跳过）PASS；
clean wheel 与 npm tarball 均只携带目标入口和四份 migration，隔离 wheel 安装可读取 Python SQL。
docs、architecture、encoding、根 typecheck/build 与 `git diff --check` 均 PASS。Surface receipt 与跨重启
ingress 确认仍未接线，阶段 4 继续进行。

Surface receipt 切片随后为 Contract Spine 增加 typed `DeliveryReceiptCommand`，Reply/Audio projection 传播
output/destination/authority epoch/generation，音频另传播 segment index/count。Kernel 将回执交给
Conversation `DeliveryController`；Desktop 以 renderer 文字投影和 HTMLAudioElement 的真实 started/ended/error
反馈分别提交 delivered 与播放回执，多段播放累计实际已听范围且只在末段完成；Personal Server 只在认证
浏览器 WebSocket 发送成功后提交 delivered。陈旧 generation、冲突 receipt、非法时间和倒退进度均拒绝。
InteractionController 也已在内存去重前消费可注入的持久 Turn 确认，重启样例不会重调 processor；但当前
Kernel 入口尚未接入 Python Turn adapter，完整跨进程/跨重启冲突确认仍归阶段 12 Host/Worker 接线，不能提前
宣称完成。当前切片的 Contract gates/inventory/schema/toolchain 与
TypeScript/Python/C# roundtrip、根 typecheck、Conversation/Kernel build、repo-checks 22 项、Desktop 11 项和
Personal Server Surface Proxy 3 项已通过。后续在解除环境限制后的同一固定候选上重跑完整
`pnpm contracts:verify`，21 项 gate、inventory、Buf lint/breaking、JSON Schema、toolchain、三语言 roundtrip、
generated-clean 以及根 `pnpm build`（含 Desktop/Personal Server Vite）均通过。

持久 Turn 摘要切片随后把 Kernel 接纳使用的 payload digest 随 Perception origin 传播到 Cognition，并由
Python `ConversationTurn` / SQLite store 持久化；`InteractionController` 仅在 identity 与摘要同时匹配时接受
跨重启重复。旧 002 schema 原位补空摘要列，历史行因无法证明内容一致而失败关闭。Conversation Python 19 项、
Cognition 258 项、定向 Ruff、Conversation/Kernel typecheck 与 build 均通过；后续同一候选的完整
Contract Spine 与根 build 已补跑通过。阶段 12 的真实 Python Turn query adapter 仍未实现。

阶段 5 首个 Context 切片把旧 `application/context` 的领域 DTO 与 assembly 物理迁入目标
`cognition/context/{source,trust,budget,compaction,assembler}.py`，删除旧 assembly/base 双 owner，并让 Host
composition、MemoryProvider 及四类现行 source 直接消费新入口。Context 候选现在正交携带数据可信度与
instruction authority；未经相应证明的 user/system authority 降级为 data，retrieval budget 显式缩放，单项
超限按可追溯 metadata 压缩，零预算终止。具体 Memory/Knowledge/Relationship/Experience source adapters
仍在迁移路径，待对应 owner 阶段物理归位；本切片不宣称 native Loop 或阶段 5 完成。

Perception/Observation 切片随后把 `PerceptionEntry` 与旧 Cycle 队列迁为目标
`perception/{observation,observation_normalizer,observation_queue}.py`，gRPC Adapter、Host composition、
PerceptionProvider 与测试只消费新公共入口。Normalizer 在入队前校验 canonical Conversation identity、scope、
trace/interaction 与 payload digest，并归一 familiarity；未绑定输入以 typed `INVALID_REQUEST` 失败关闭。
有界队列继续 drop-oldest 并返回被淘汰 Observation，使 operation registry 能进入真实 failed 终态；旧
`application/cycle/perception_queue.py` 已 consumer-zero 删除。

Persona 切片把旧 `domain/persona` 的 profile、dialogue 与 prompt 拼装物理迁入目标
`persona/{profile,revision,mutation_policy,compiler}.py`，并由 SelfEntity、Cycle 与 Agent Synthesis 直接消费
`PersonaCompiler`。Character Package 作者种子会确定性生成初始 revision 和内容摘要；后续改写必须携带
expected revision、明确来源、author/editor 权限、请求者与原因，冲突或 model/memory 来源均失败关闭。
`schemas/persona.schema.json` 固定 Cognition-owned 审计文档，`tests/fixtures/persona.yaml` 与
`test_persona_mutation.py` 覆盖编译、提示词、安全边界、revision 链及越权反例；旧 Persona owner 已
consumer-zero 删除。revision 持久化将在 Cognition state store 迁移时接入，本切片不把进程内 revision
冒充 durable state。

Cognition Attention 切片把旧 `domain/workspace.py` 的有界候选、显著度竞争、过期清理和当前焦点迁入目标
`attention/{attention,attention_controller,attention_lease}.py`，Provider、Cycle、gRPC cancel 与 Host composition
只消费新 owner。内部 `CognitiveAttentionLease` 在一次认知 focus 处理期间固定候选，消费、淘汰、取消或候选
过期时释放；它不等同于 Kernel 面向外部 scene/channel 的 `AttentionLease`，不授予回复或工具执行权。
direct Perception 的同分优先级、ambient 成功语义、drop/eviction 终态和 Clock 注入均保持；旧 workspace owner
已 consumer-zero 删除。

Inference 切片把旧 `application/inference/service.py` 与 `ports/inference.py` 迁入目标
`inference/{request,event,model_descriptor,model_port,inference_controller,realtime}.py`。Cycle、Agent、Memory、
Host 与 provider adapters 只消费新公共面；文本/多模态请求和输出不含供应商 payload，模型档位禁止、cloud
失败后 local fallback 与真实 unavailable 语义保持。Realtime session 以单调 event sequence 和 generation
约束取消，terminal 后拒绝晚到帧；具体 realtime provider 尚未接入，因此不宣称完整低延迟音频链完成。

State 切片把旧 `domain/affect`、`domain/activity` 与 `application/activity` 收束进目标
`state/{cognitive_state,decay,state_controller,state_store}.py`。情绪衰减与活动档位转换成为不读系统时间的纯策略，
现行 Emotion/Cognitive Activity 消费者只使用新公共面；活动恢复继续合并 Conversation Log 真实活动时间线。
新增 `migrations/001-state.sql` 与 `adapters/persistence/sqlite_state_store.py`，Host 在活动控制器启动前连接独立
state DB，按 expected revision 乐观写入，并在正常停机前刷新、随后关闭。当前持久化覆盖 Cognitive Activity；
Emotion、Persona revision 与其他 State 子域将在统一 state controller 后续切片纳入同一版本模型。

Planning 切片把主循环中的 `application/cycle/action_planner.py` 收束为目标
`planning/{goal,plan,commitment,planning_controller,planning_store}.py`，Deliberation 只消费注入的
`PlanningController`。规划仍只表达 `reply / skill_request / ask_clarification / noop` 语义，不读取 Skill catalog、
不执行能力也不接触平台 IO。新增 `migrations/004-planning.sql` 与
`adapters/persistence/sqlite_planning_store.py`，Host 在 Cycle 前连接 `data/state/cognition/planning.sqlite`，
将真实规划与显式降级按 trace 写入可恢复 journal。同步纠正本轮新引入 State 数据路径为蓝图规定的
`data/state/cognition/state.sqlite`；二者均未形成历史发布数据，不建立第二兼容路径。长期 Goal/Commitment
状态机、Job Port 与 completion condition 仍待后续 Planning/Jobs 切片，不能把当前决策 journal 冒充完整长期承诺。

Memory 领域切片把旧 `domain/memory.py`、`application/memory/{substrate,consolidation}.py` 迁入目标
`memory/{memory,memory_controller,memory_store,provenance,correction,consolidation}.py`，Host、Context、Maintenance
与测试只消费 `MemoryController` 公共面。证据去重与空证据失败关闭成为独立 provenance 规则，修订操作到
`active / disputed / superseded / redacted` 的状态映射成为纯 correction policy。旧内嵌 DDL 已改为唯一
`migrations/002-memory.sql`，数据库入口迁到 `adapters/persistence/sqlite_memory_store.py`，运行路径同步对齐
`data/state/cognition/memory.sqlite`。Knowledge 已在下一切片拆出；现行 v3 库仍暂含 Relationship、Consolidation
Job 与 projection checkpoint 表。旧 repository 子文件只作为该 store 的内部投影实现保留，退出条件为 Jobs
owner 与 checkpoint store 接线并完成旧样本迁移。

Knowledge 切片把旧 `application/memory/knowledge_base.py` 与 Memory persistence 内的 `knowledge_repo.py` 收束为
目标 `knowledge/{source,ingestion,transformation,index,retrieval,freshness,revision,invalidation,knowledge_store}.py`。
`SqliteKnowledgeStore` 使用唯一 `migrations/003-knowledge.sql` 和蓝图路径
`data/state/cognition/knowledge.sqlite`，保存递增 revision、内容摘要、来源、tombstone 与独立可重建 embedding；
配置替换在单事务中增量修订，删除要求 expected revision，model/memory 来源不能取得修改权限。首次连接仅在
新库为空时读取旧 `memory.sqlite.knowledge_entry` 并形成 revision 1，随后只写新库、不双写；旧 Memory fresh
schema 已删除 Knowledge 表。当前生产知识均来自 Character Package 配置；未来外部资料采集仍须通过明确
Resource/Content Port 与授权 ingestion，不能绕过 Knowledge owner。

Loop/checkpoint 切片把旧 `application/cycle/controller.py` 与 `turn.py` 迁入目标
`loop/{loop_controller,step}.py`，运行时与 gRPC adapter 只消费 `LoopController`；其余 Appraise、Deliberate、
Act、Continuity 与 Provider helpers 暂留 `application/cycle/`，退出条件是合并进目标 Loop/Attention/Perception
owner 后删除整个旧目录。新增 `checkpoint.py`、`run.py`、`recovery.py`、`stop_policy.py`、
`migrations/005-checkpoints.sql` 与 `SqliteCheckpointStore`，使用蓝图路径
`data/state/cognition/checkpoints.sqlite`。Loop 启动恢复 cycle count，把上次 `running` 解释为 interrupted；每拍终态、
异常、中断和正常停止均按 expected revision 写 checkpoint，陈旧 writer 失败关闭。Memory 库中的
`projection_checkpoints` 仍只服务 Relationship 派生投影，待其 owner 迁移时另行拆出，不与 Loop checkpoint 混用。

原生工具迭代切片新增消费方 `ports/capability_port.py` 与 `LoopController.run_native()`：每次 Run 先按 scope 获取能力曝光，模型 `ToolCall` 只可命中曝光集合，调用使用 `run_id:call_id` 幂等键，结果原样进入下一模型 Step。`StopPolicy` 对 Step、能力调用次数与输出字符数执行硬上限；未知能力、非法参数和不完整流均失败关闭。`test_loop_native_tools.py` 固定 ToolCall/ToolResult 两步闭环与零调用预算反例。Cognition Worker 尚未存在，因此生产装配仍走 ActionPlan 兼容路径；该路径的删除条件是 Worker adapter、Conversation Log 幂等接纳和 durable execution journal 完成接线。

消费方 Port 切片把旧 `ports/clock.py` 迁为清单规定的 `clock_port.py`，并补齐 `content_port.py`、`conversation_port.py`、`job_port.py` 与 `resource_port.py`。Core 契约只描述 Cognition 所需的受限资产读取、Conversation 事实读写、幂等长期工作请求和带 revision/principal 的资源读取；实现与 wire mapper 留在 App。目标 Cognition 源码缺项因此只剩 owner Schema、README 与测试装配入口；Schema 在 `contracts/json-schema` 仍是现行唯一事实源期间不会复制，必须随 catalog、consumer 和验证流程原子迁移。

Cognition 包入口切片新增目标 `README.md`，并把共享确定性测试 adapter 从清单外 `tests/support.py` 迁入目标 `tests/conftest.py`；299 项测试保持通过。Cognition 物理清单至此只缺 5 个 owner Schema，这些文件将在现行 Contract Spine catalog 与所有消费方可原子切换时迁移。

Cognition Worker 入口切片把生产 composition 与受监督 RPC 进程从 Core `host/` 迁入 `apps/cognition-worker`，Kernel 启动命令和 Desktop Python runtime 同步切到 `glimmer_cradle.cognition_worker`，Core 不再发布进程脚本。新增 worker config、readiness 状态、幂等有序 shutdown 协调器，以及 capability/content/conversation/job/model/resource mapper/client；RPC roundtrip 固定能力幂等键、模型事件顺序和 Content digest 失败关闭。Worker 测试已加入根测试入口。当前 `rpc_service.py` 仍包含兼容生命周期主体，clients 也尚未连接真实 Host broker；退出条件是这些 adapter 的生产接线与 flush/recovery 门完成后进一步收束。Cognition wheel 构建额外清理旧 `build/lib` 包投影，fresh runtime 冒烟已证明已删除模块不会泄漏进安装制品。

Loop helper 归位切片把角色回复所需的会话、记忆、知识与经历装配并入目标
`context/assembler.py`，把情绪标签/舞台动作清洗及自然聊天分段并入目标 `loop/step.py`；
所有生产与测试消费者已切换，旧 `application/cycle/reply_context.py` 和 `reply_text.py`
consumer-zero 后物理删除。Context 信任/预算装配与回复 prompt 的固定分区仍是同一 owner 中的两种入口，
没有复制实现；其余 appraisal、deliberation、continuity、action emitter 与 provider helpers 仍按职责等待
后续原子归位，不能据此宣称旧 `application/cycle` 已清空。

Perception operation 归位切片把 RPC 接纳、运行、取消、终态查询与有界历史登记并入目标
`perception/observation_queue.py`，与 Observation 的入队、淘汰和 Loop 消费共享同一领域生命周期；
Worker composition、Loop、Kernel wire adapter 与测试均改用 `glimmer_cradle.cognition.perception`
公共入口。旧 `application/cycle/perception_operations.py` consumer-zero 后物理删除，未改变
operation/trace 冲突、取消 task 或 terminal trimming 语义，也没有把 transport DTO 引入领域 owner。

Perception Provider 随后从旧 `application/cycle/providers` 迁入目标 `loop/loop_controller.py`：
Observation 继续由 Perception owner 定义和排队，Loop 的 Sense 阶段负责把它 drain 为 Attention，
direct/ambient 显著度、actor/model input 与 scope/digest 传播保持不变。Worker 和测试只消费
`glimmer_cradle.cognition.loop` 公共入口，旧 `providers/perception.py` consumer-zero 后删除；
其余四类 provider 尚未归位，旧 providers package 仍有明确退出条件。

Affect/Drive Provider 归位切片把情绪快照候选、内在动机随时间累积与满足衰减迁入目标
`loop/step.py`，State 继续只拥有情绪和活动事实，Loop 只在单拍边界把这些事实映射为 Attention。
Worker composition 与测试改用 Loop 公共入口，旧 `providers/{affect,drive}.py` 及已无消费者的
全局 provider class registry 删除；Memory/Social provider 仍留在旧目录，待 Context 与关系投影
依赖同时归位后删除，避免制造 State→Attention 的反向依赖。

Memory/Social Provider 收口切片把 ContextAssembler 的有界召回和关系投影的只读候选映射归入
`loop/step.py`，Loop→Context 成为架构测试固定的正向领域依赖；Context 与关系 repository 仍分别
拥有来源装配和持久事实，Loop 不写入它们。统一 `Provider` 契约同时迁入 Loop 公共入口，Worker 与
全部测试消费者完成切换，旧 `application/cycle/providers/` 五个实现及 package 入口 consumer-zero
后物理删除。至此旧 providers owner 清空；剩余 Cycle helpers 仍需按 appraisal、deliberation、
continuity 与 action emission 的职责继续归位。

Cycle helper 最终收口切片把感知评价与回复决策并入目标 `loop/step.py`，把已仲裁 ActionCommand
映射、外部副作用前的 durable flush barrier 以及 reply/silence outcome 提交并入目标 `loop/run.py`。
`LoopController` 只从目标 Loop 文件装配这些协作者；旧 `application/cycle/{appraisal,deliberation,
action_emitter,continuity}.py` consumer-zero 后物理删除。至此 `application/cycle/` 已无手写源码；
Loop 对旧 `application/context/sources` 的 RecentExperienceSource 依赖仍待 Context source adapter
归位，不能提前移除迁移期 application 依赖例外。

Context source 收口切片随后把 Episodic Memory、近期 Conversation Experience、Knowledge 与
Relationship 四类只读来源归入目标 `context/source.py`，Worker、Loop 与测试只消费 Context 公共入口。
旧 `application/context/` 五个手写文件 consumer-zero 后物理删除；Context→Memory/Knowledge 公共面
成为架构测试允许的正向依赖，持久 writer 仍归原领域 owner。Loop 已不再导入任何 Cognition
Application 模块，因此同步删除了 Loop→Application 的迁移期依赖例外。

Memory maintenance 收口切片把独立节拍、静息封口提示、终结 Moment 唤醒和 Consolidation 生命周期
归入目标 `memory/consolidation.py`，Worker 与测试改用 Memory 公共入口；旧
`application/maintenance/` 删除。零消费者的 `NarrativeJournal` 及其专用 `NarrativeEntry` renderer
不在 v2.1 物理清单内，也未参与持久恢复或公开 wire，因此连同 `application/experience/` 和对应
`domain/experience/narrative.py` 物理删除；Episode 持久模型与 projection port 保持不变。

Legacy Agent RPC 用例收口切片把 Plan/Synthesize 的输入输出移入现有 Kernel request port models，
当时把仅服务该 RPC 的执行与生命周期包装收束到迁移期 `adapters/kernel/inbound_adapter.py`；Worker composition、
gRPC transport、port 与测试不再依赖 Cognition Application。旧 `application/{base_use_case,
agent_plan_use_case,agent_synthesis_use_case}.py` 及空 package 物理删除，Cognition 架构门同步移除
`application` 源码根与 Ports→Application 依赖。Plan/Synthesize wire 仍有 Kernel 生产消费者，需在
native capability loop、execution journal 和新 Host broker 接线后原子删除；本切片不把 adapter
内的兼容 RPC 实现冒充最终 Core owner。

Loop 意愿与仲裁收口切片把 `Intent`、连续意愿公式、认知活动态阈值与回复唯一性仲裁归入目标
`loop/step.py`，这些对象只描述单拍候选及其胜出结果，不再作为横跨 owner 的通用 Domain。
`LoopController`、Run outcome 与测试统一消费 Loop 公共入口，旧 `domain/volition/` 四个文件
consumer-zero 后物理删除；主动性闸、响应性意图豁免、抑制原因和 ID/时间边界注入语义保持不变。
Loop 对其余旧 Domain 的依赖仍来自 Episode、Relationship 等尚未归位事实，本切片不扩大删除范围。

Memory 投影模型与 Store 收口切片随后把 `Episode`、`RelationshipRecord` 归入目标
`memory/memory.py`，把 Episode 投影、巩固任务和关系投影的持久边界归入目标
`memory/memory_store.py`。Context 只保留其消费关系投影所需的最小 `RelationshipReader`，Loop 经
Context 公共入口依赖该只读契约；旧 `domain/experience/episode.py`、`domain/relationship.py` 与
清单外 `ports/persistence.py` consumer-zero 后物理删除。架构门同步移除 Ports、Loop、Memory 对
通用 Domain 的迁移期依赖，未改变 Conversation Log 派生、关系证据计数或巩固重试语义。

Domain 异常与指标清理切片确认旧 `domain/exceptions.py` 仅剩配置映射与推理 adapter 两类消费者，
其余异常类型和本地 `ErrorCode` 已无生产引用；配置错误随现行配置投影收口，推理错误归真实 provider
adapter。`MetricKind` 仅描述 observability adapter 的落盘事件类型，随其实现归位。旧
`domain/{exceptions,metrics}.py` consumer-zero 后物理删除，未改变异常字符串、`code` 值或指标 wire。

SelfEntity 解耦切片拆除跨 Persona、State、Memory、Knowledge 与 Inference 的旧领域根：Worker
`composition.py` 现在以 `CharacterSession` 仅持有进程会话期组件与 wake/sleep 状态；Core 推理 adapter
直接接收模型配置，Context 直接接收 Memory/Knowledge reader，感知评价直接接收多模态主模型名，
Kernel 入站 adapter 只接收 Knowledge 初始化对象。旧 `domain/identity/` 两个文件及所有
`SelfEntity`/`self_entity` 活跃引用 consumer-zero 后删除，Domain 的架构允许依赖同步收紧为自身。
该迁移保持 persona revision、情绪状态、边界校验与状态投影行为，不把 App 会话容器重新导出给 Core。

Persona 配置投影归位切片把 Character Manifest、Profile、Dialogue 与 Safety 的强类型模型迁入目标
`persona/profile.py`，Compiler、Mutation Policy 与测试均改用 Persona 公共入口。完整 Worker Document
聚合与 fail-closed mapper 暂收束在配置 adapter，不再迫使旧 Domain 反向依赖 Persona；Persona→Domain
迁移期依赖已从架构门移除。Inference、Memory、Embedding 与 Loop 配置仍在旧聚合文件，需按各自
owner 继续拆分后才能删除 `domain/configuration.py` 与清单外配置 adapter。

Inference 配置投影归位切片把模型生成参数、生命时钟、多模态与动作流策略迁入目标
`inference/model_descriptor.py`；provider 路由、凭据和 HTTP 请求/响应模板随真实推理 adapter 收口，
避免把 vendor payload 伪装成 provider-neutral Core 模型。Multimodal、Worker mapper 与测试已切换新入口，
旧配置聚合不再定义任何 Inference/LLM 类型；Memory、Embedding、Loop 配置仍待后续 owner 拆分。

配置投影最终拆分切片把 Working/Conversation/Experience/Consolidation/Retrieval 策略归入
`memory/memory.py`，Loop 容量与兜底节拍归入 `loop/loop_controller.py`，Embedding provider 配置归
其 adapter；完整 Worker Document 与 fail-closed 映射继续由过渡配置 adapter 组装。所有活跃消费者
完成切换后，最后的 `domain/configuration.py` 与空 `domain/__init__.py` 物理删除，Cognition 架构门
移除 Domain 源码根以及 Adapters→Domain/Application 依赖。五个目标 owner Schema 尚未落盘，必须在
Contract Spine catalog 与验证链原子切换时完成，不能以本次 Python 投影归位冒充 Schema 迁移完成。

Cognition owner Schema 切片随后补齐物理清单最后五个缺项。Character Manifest、Loop、Inference 与
Memory Schema 由各 owner 的严格 Pydantic 模型确定性派生；Knowledge 新增不含向量运行态的
`KnowledgeSourceRecord`，并验证目标 fixture。架构测试逐字重建五份 Schema，防止手改与模型漂移；
文件明确标记为 `InternalPolicy`/`InternalSourceRecord`，不替代也不复制 `contracts/` 中 Kernel→Worker
跨进程 Document wire，Contract Spine catalog、兼容基线与 generated DTO 因此无需变更。

Clock/Identity adapter 归位切片把系统时间、单调时间与 UUID concrete 移入唯一 Worker composition，
Core 继续只消费 `ClockPort`；`IdGeneratorPort` 收入目标 `ports/__init__.py` 公共面，不再占用清单外文件。
测试改用确定性 test adapter，旧 `adapters/{clock,identity}.py` 与 `ports/identity.py` consumer-zero 后
物理删除。Core 没有新增直接系统能力，Worker 仍是这些进程资源的唯一装配 owner。

Cognition 工具元数据清理切片删除已被 Ruff 调用链替代的 `.flake8`，以及无内容的
`tests/__init__.py`；pytest 以 `pythonpath = ["src", ".", ...]` 显式支持 PEP 420 测试命名空间。
`setup.py` 仍负责 wheel 构建前清除 stale `build/lib`，需先建立等价的现代构建入口再删除。Python 主仓库
依赖已经由根 uv workspace/lock 统一解析，旧子项目锁已删除。

Worker 配置投影归位切片把完整运行配置、Action Stream 进程设置与 fail-closed Document mapper
移入目标 `cognition_worker/composition.py`。这些类型描述 Kernel 注入给 Worker 的进程配置聚合，不是
环境中立 Cognition Core 模型；RPC host、生产组装与映射测试统一消费 Worker owner。清单外
`cognition/adapters/configuration.py` 在旧导入 consumer-zero 后物理删除，字段、严格校验与稳定错误码
保持不变，未新增 wire 契约或兼容导出；Worker 的 Core deep-import 基线随之从 `19/6` 收紧为
`18/5`，后续 adapter 归位只能继续递减。

Content 本地资产 adapter 归位切片把 UUID、元数据、大小与摘要校验实现移入目标 Worker
`adapters/content_client.py`，由 composition 使用当前 state/work roots 显式注入；Core 的多模态路由
只保留最小读取协议，在未装配能力时如实降级。旧 `cognition/adapters/content/` 两个清单外文件在
consumer-zero 后物理删除；跨重启读取、图片 data URL、损坏拒绝和音视频不伪装为视觉输入的行为不变。

Memory SQLite 物理归位切片把版本化记忆、向量、关系、巩固队列、关系投影与 Episode 投影集中到
目标 `adapters/persistence/sqlite_memory_store.py`，并由目标 persistence 包入口统一导出。旧
`persistence/{memory,experience}/` 八个清单外文件在所有生产与测试消费者切换后物理删除；事务、租约、
摘要校验、幂等 checkpoint 与可重建 Episode 语义保持不变。Worker composition 的 Core deep-import
基线因公共入口收束从 `18` 降为 `7`，不保留旧模块兼容导出。

Observability Port 公共面切片把 Logger、Span 与 Observability 的消费方协议并入目标
`ports/__init__.py`，所有 Core 消费者只从受控公共入口导入。旧 `ports/observability.py` 以及无额外
语义的 `adapters/__init__.py`、`adapters/inference/__init__.py` 在 consumer-zero 后删除；协议方法与
依赖注入行为不变，也不为后续清单外 observability concrete 建立兼容壳。

Python Namespace 空壳清理继续删除 Kernel Port 子树三个空 `__init__.py`，以及只重复暴露可直接导入
子模块的 Observability `__init__.py`。setuptools namespace discovery 与现有模块入口保持可用；真实
Kernel wire adapter 和 observability concrete 尚未归位，本切片不提前宣称对应边界完成。

Model provider gateway 归位切片把同步 LLM provider、配置投影、错误映射与现有流式 ModelClient 合并到
目标 Worker `adapters/model_client.py`。Worker composition、Cloud bridge 与测试消费者完成切换，旧
Core `adapters/inference/gateway.py` 物理删除；模型请求/事件契约仍由 Core Inference 公共面拥有，
provider payload 与凭据继续只存在于 App adapter。

同切片随后把只包装同步 provider 的 `CloudReasoning` 一并收入 Worker `model_client.py`，删除第二个
Core inference concrete；composition deep-import 基线由 `7` 收紧为 `5`。Model client 仍有一处对
旧 Core model-invocation observability concrete 的迁移期依赖，已单独锁定为 `2`，退出条件是 App
observability adapter 完成接线，禁止该债务增长。

Embedding provider 归位切片把 DashScope 与本地 Sentence Transformers 的配置投影、模型缓存、
批处理和向量归一实现收入目标 Worker `adapters/model_client.py`。Worker composition 与测试完成切换，
旧 Core `adapters/inference/embedding.py` 在 consumer-zero 后物理删除；Core Memory 仍只通过注入的
Embedding Port 使用向量能力。composition deep-import 基线由 `5` 收紧为 `4`；model client 对旧
Core 路径 helper 的一处依赖与 observability concrete 一同锁定为 `3`，待 Worker 路径与
observability adapter 归位后清零，不建立 Core 兼容壳。

多模态模型路由归位切片把 Content 引用归一、视觉消息构造、specialist/core-direct 策略与
模型调用收入目标 Worker `adapters/model_client.py`；资产字节校验仍由注入的
`FileAssetReader` 拥有。Worker composition 与测试完成切换后，旧 Core
`adapters/inference/multimodal.py` consumer-zero 并物理删除；音频只消费可信转写、视频显式降级与
旧 URI-only 当拍兼容语义不变。composition deep-import 基线由 `4` 收紧为 `3`。

Kernel 出站转发空壳清理切片让已拥有 gRPC channel、认证与 wire mapper 的 `KernelGrpcClient`
直接实现 `KernelEventPort` 所需的 state/log/action 方法，删除只委托同一 client 的清单外
`adapters/kernel/outbound_adapter.py`。Composition 和 RPC 生命周期统一持有同一 client，未改变端点注册、
鉴权证明、幂等键、deadline 或跨进程契约。

Kernel 入站应用编排归位切片把 Agent Plan/Synthesis 兼容用例与 `KernelRequestPort`
实现收入 Worker `composition.py`，并由组装根注入 Observability，不再读取 Core 进程全局
logger。Kernel request Port 与 DTO 经目标 `ports/__init__.py` 公开，消费方不再深导入嵌套
port 文件。旧 `adapters/kernel/inbound_adapter.py` consumer-zero 后物理删除；Action RPC 仍是
阶段 5 兼容窗口，待 native Loop producer/consumer 全部切换后再删除用例本身。Composition
deep-import 基线由 `3` 收紧为 `2`。

Kernel gRPC transport 归位切片把 Cognition Service host、Kernel Control client、wire mapper、认证证明、
deadline/cancellation 与 typed failure 统一迁入目标 Worker `rpc_service.py`。Composition 改为只接收
`action_sink` 并返回领域组件图；RPC 生命周期创建 client/server，注入入站 Port、注册动态
回环端点并负责 ready/停机顺序。旧 `adapters/kernel/{grpc_transport.py,__init__.py}` 物理删除，
generated wire 类型不再进入 Cognition Core；目标 Core `ports/__init__.py` 只公开 Worker 所需的
Kernel request 消费方契约。

Kernel 消费方 Port 公共面收束切片把 Agent/Knowledge/Conversation request DTO、`KernelRequestPort`
与 `KernelEventPort` 定义本体并入目标 `ports/__init__.py`。Core Knowledge、Worker RPC/Composition
与测试全部改用公开入口；旧 `ports/kernel/{models.py,inbound/kernel_request_port.py,
outbound/kernel_event_port.py}` 三个清单外文件 consumer-zero 后物理删除，不保留嵌套
namespace 或兼容导出。

Telemetry 重导出门面清理切片确认 `adapters/observability/telemetry.py` 没有生产消费者，
只重复暴露 logger/metrics/tracer/trace-context API，且不在 v2.1 物理清单。该门面与只验证重导出的
`test_telemetry_facade.py` 一并物理删除；metrics、tracer 与 trace context 的行为测试仍保留，
不改变生产可观测性链路。

Worker 可观测性装配倒置切片让 `compose_cognition()` 显式接收 `ObservabilityPort`，
不再在组装函数内创建文件型 concrete。RPC 进程入口成为 `FileObservability` 的唯一生产
创建点，测试也显式注入；composition deep-import 基线由 `2` 收紧为 `1`。该调整
为后续将 logger/metrics/tracer/trace-context concrete 整体归入 Worker 生命周期建立单一边界。

Worker adapter 可观测性注入切片移除 model client 与 Memory SQLite store 对 Core logger/model
invocation concrete 的直接依赖。Composition 按职责注入 `LoggerPort`，并把模型调用记录器
作为 callback 传入 `LLMEngine`；未装配记录器时不写伪造观测数据。Model client
deep-import 基线由 `3` 收紧为 `1`，剩余一处仅为待归位的模型路径 helper；生产
recorder 暂由 RPC 唯一进程 owner 注入。

模型调用观测归位切片把 capture policy、脱敏、JSONL 索引、full bundle 与 trace timeline
落盘实现迁入目标 Worker `rpc_service.py`。`LLMEngine` 只调用注入的 recorder callback，
测试与生产入口共用 Worker owner；旧 Core
`adapters/observability/model_invocations.py` consumer-zero 后物理删除。

Worker 进程可观测性归位切片按 trace context、structured logger、metrics、tracer 与
`FileObservability` 的依赖顺序整体迁入目标 `rpc_service.py`。生产与测试统一消费
Worker owner，旧 Core `adapters/observability/{binding,logger,metrics,trace_context,tracer}.py`
五个清单外文件物理删除。RPC deep-import 基线由 `6` 收紧为 `1`，剩余债务仅为
路径 helper。

Worker 路径装配归位切片新增 `composition.py` 内的 `WorkerPaths`，由进程环境唯一解析安装根与
Local Data Domain，并向 SQLite adapters、模型 provider、资产读取和可观测性显式注入具体路径。
Core persistence 不再解析进程环境，`model_client.py` 不再决定模型/缓存根；旧 Core
`adapters/paths.py` 与只验证该旧 owner 的测试 consumer-zero 后物理删除，路径契约转由 Worker
公共行为测试覆盖。Composition、model client 与 RPC 的最后三条 deep-import 迁移例外同步清零。

Cognition Experience CLI 清理切片确认 `core/cognition/tools/experience.py` 没有脚本入口、测试或
生产消费者，且会绕过 Conversation owner 直接读取持久事实。按 v2.1 精确清单物理删除该工具，
交互事实检视与恢复继续通过 Conversation owner API、fixtures 与恢复门完成，不建立替代旁路。

DLQ 工具测试归位切片把 Kernel DLQ 对 legacy Cognition source 的只读兼容断言并入工具 owner
`core/kernel/tests/tools/test_dlq.py`，删除 Cognition 下跨 owner 加载 Kernel CLI 的测试文件。
真实 dispatcher receipt、owner mismatch 与 replay 失败闭合仍由同一目标测试入口覆盖。

Cognition 架构测试归位切片把 owner Schema 的确定性投影断言并入目标 `test_public_api.py`，并将
直接系统时钟/UUID、内部 `*Port`、模块级可变 locator/global 禁令迁入仓库级 Python AST 架构门。
repo-checks 新增负向 fixture 固定四类反例，旧 `test_architecture_layout.py` 删除后不丢失约束。

Cognition 测试配置 helper 归位切片把 Kernel 规范化 Character Document fixture 并入目标
`tests/conftest.py`，配置映射与生产可观测性组装测试切换到单一共享入口；清单外
`tests/config_fixture.py` consumer-zero 后删除。

Loop 回复投影测试归位切片把展示注解清理、对话分段与结构化代码块保持断言并入目标
`test_public_api.py`，删除清单外 `test_reply_text.py`；回复正文仍由 Loop 公共入口唯一暴露。

Embedding provider 测试归位切片把禁用基线、DashScope query/document 语义与本地 provider
路径注入失败闭合迁入 Worker 目标 `test_public_api.py`。清单外 Cognition
`test_embedding_engine.py` 删除，模型/缓存根由 Worker 注入的边界获得直接反例覆盖。

Loop Provider 契约测试归位切片把五类 Sense provider 的继承、名称集合、唯一性、稳定装配次序与
抽象基类失败闭合并入目标 `test_loop_native_tools.py`，删除清单外
`test_provider_contracts.py`，不再把已归位 provider 描述成 stub。

Inference 路由测试归位切片把禁止推理、local-only、cloud 优先、本地降级、双后端失败与公开默认值
并入目标 `test_realtime_cancellation.py`，删除清单外 `test_reasoning_service.py`。实时 session 与
请求级后端策略由同一 Inference owner 验证，未引入 provider concrete。

Knowledge 持久加载测试归位切片把空库与按优先级加载已启用条目的断言并入目标
`test_knowledge_revision.py`，删除清单外 `test_knowledge_base_persist.py`。KnowledgeIndex 仍通过
独立 store 绑定，不把 Memory 旧库恢复入口重新提升为常态 owner。

Memory 向量持久测试归位切片把 BLOB roundtrip、模型隔离、覆盖与删除断言并入目标
`test_memory_correction.py`，删除清单外 `test_vector_repo.py`。可重建向量仍由 Memory store
事务边界管理，模型切换不会误读旧模型向量。

Content/Multimodal adapter 测试归位切片把资产跨重启摘要校验、四类 Content 路由、损坏降级与
旧 URI-only 媒体兼容并入 Worker 目标 `test_rpc_roundtrip.py`，删除 Cognition Core 下清单外
`test_content_asset.py`。平台文件 IO 与历史 wire 兼容由 Worker edge 验证。

Loop Sense provider 行为测试归位切片把 Affect、Memory、Drive 与 Social 的来源投影、空焦点、
时间累积和关系证据断言并入目标 `test_loop_native_tools.py`，删除两个清单外 provider 测试文件。
Provider 合同与实际来源行为由同一目标入口覆盖。

Worker Agent Plan 兼容测试归位切片把 Kernel skill/tool identity、参数提示与 prompt exposure 断言
并入目标 `test_rpc_roundtrip.py`，并在 Worker `conftest.py` 建立确定性 ID 与空观测测试 adapter。
清单外 Cognition `test_agent_plan_use_case.py` 删除；兼容用例仍等待 native Loop 全链切换后的删除门。

Worker trace/metrics 测试归位切片把 boot/trace/span 三层注入、合成 trace、显式 trace 保持、JSONL
落盘、trace 关联与高基数 label 清理并入目标 `test_process_recovery.py`。两个 Cognition 下清单外
可观测性测试删除，未启动 metrics 仍保持安全 no-op。

Worker tracer 测试归位切片把属性、duration、异常状态、嵌套 parent、远端 parent 与 contextvar
恢复断言并入目标 `test_process_recovery.py`，删除 Cognition 下清单外 `test_tracer.py`；未启动
tracer 的 span 仍保持安全 no-op。

Worker 模型调用留痕测试归位切片把 summary hash、full capture 分类次序/manifest/timeline、
provider payload 与错误脱敏并入目标 `test_process_recovery.py`，删除 Cognition 下清单外
`test_model_invocations.py`。prompt 正文只在 full 模式落盘，summary 与日志均不泄漏正文。

Worker inference gateway 测试归位切片把 models contract、缺失/未知 provider 失败闭合、空媒体与
音频不进入视觉 provider 的断言并入目标 `test_rpc_roundtrip.py`，删除 Cognition 下清单外
`test_inference_gateway.py`。历史 audio 分类与禁用时可信转写继续保留。

Cognitive Activity 测试归位切片把状态转换表、最短驻留、affect hold、quiescent、policy 完整性、
持久恢复与 Conversation 事实投影断言并入目标 `test_state_decay.py`，删除清单外
`test_cognitive_activity.py`。活动状态转换本身仍不得伪造 Conversation Moment。

Worker Agent Synthesis 兼容测试归位切片把 Persona prompt、外部错误诚实表达、ToolCall →
ToolResult → Reply 因果顺序、来源元数据、Turn 完成与幂等 replay 并入目标
`test_rpc_roundtrip.py`。Worker `conftest.py` 补齐确定性时钟和 Conversation recorder adapter，
清单外 Cognition `test_agent_synthesis_use_case.py` 删除。

Worker 配置与生产组装测试归位切片把规范化 Character Document fixture、严格字段/范围失败闭合、
非 canonical provider key 反例和生产 logger sink 可达性迁入 Worker 目标测试入口。Cognition 下
`test_configuration_adapter.py` 与 `test_production_observability_composition.py` 删除，配置投影和
进程 concrete graph 由真实 owner 验证。

Context 装配测试归位切片把来源激活、记忆相关度/近时度、排序、预算裁剪、压缩 provenance、
失败隔离、分组与候选上限并入目标 `test_context_budget.py`；伪造 instruction authority 的装配反例
并入目标 `test_context_trust.py`。清单外 `test_context_assembly.py` consumer-zero 删除，Cognition
225 项与 Worker 38 项均 PASS，测试项数量和原有断言保持，最终物理差距进一步降为 1,568 项。

Worker gRPC 测试归位切片把真实 Service 感知去重、输入绑定、代次拒绝、队列溢出终态、deadline、
取消传播、Loop 中断、readiness/Shutdown 及 typed error/recovery metadata 并入目标
`test_rpc_roundtrip.py`；注册失败后 capability secret 与 nonce 清零归入 `test_process_recovery.py`。
清单外 Cognition `test_kernel_cognition_grpc_transport.py` 删除，测试资源使用 Worker 的时钟、ID、
observability 与 recorder adapter；Core 中无消费者的规范化配置夹具同步删除。Core 214 项与
Worker 49 项 PASS，总覆盖项不变；Ruff、docs、encoding、architecture 与 diff 检查 PASS 后固定提交。
最终物理差距为 1,567 项。

Loop 感知/仲裁测试归位切片把注意力容量、竞争/衰减、focus lease、感知 FIFO/容量/规范化、
PerceptionProvider 投影、willingness 阈值及行动仲裁并入目标 `test_loop_native_tools.py`。
旧 `test_global_workspace.py`、`test_perception_provider.py` 与 `test_volition.py` consumer-zero 删除；
全部 Core 214 项 PASS，覆盖数量和断言保持，最终物理差距为 1,564 项。

Worker 生产 wire 映射接线切片将感知、Knowledge、Plan、Synthesis 与历史查询从 RPC service 内联转换
迁入目标 `adapters/cognition_mapper.py` 与 `conversation_mapper.py`，真实 RPC 调用唯一 mapper，保留
默认值、scope、identity 和 protobuf Struct 语义。感知输入在 operation 接纳前校验，修复非法请求先
占用 registry 后在重试中被误报 accepted 的缺陷；反例覆盖重复拒绝、无残留、修正后同 identity 接纳。
真实 gRPC 测试覆盖 Knowledge 初始化、Plan 参数/结果、Synthesis 因果字段与历史 position/cursor 往返。
Worker 50 项、Core 214 项、真实 Kernel/Worker 生命周期 4 项、完整 `pnpm contracts:verify`、根
typecheck/build 均 PASS；首次契约生成一致性检查失败后单独复验及完整重跑通过，未修改生成物或降低门禁。
本切片不新增协议源，不宣称 capability/model/job/resource broker、readiness/shutdown 或阶段 5 已完成。

Worker 生命周期接线切片将真实启动条件交给目标 `readiness.py`，Conversation 单写者、状态库、
投影、Loop、Kernel 注册、角色唤醒及首条状态投影全部成功后才 ready；Shutdown ACK 前撤销 ready，
普通感知/Plan/Synthesis/History 在未就绪或停机时失败关闭，启动窗口保留 Knowledge 初始化。
Kernel 在同一 deadline 内等待本代 starting → ready，旧代、停机、降级和超时不开放 ingress。
目标 `shutdown.py` 持有有序组件关闭图，生产 Host 调用唯一幂等 coordinator：先停止主循环和 RPC，
再停生产者、封口投影和 Conversation 单写者，最后关闭领域库、Kernel client 与遥测。RPC 在途任务
取消后等待收尾，防止其继续写已关闭的库；主循环异常或单个组件失败不跳过后续回收。即使 composition
未产生组件图，也关闭 transport 和启动期遥测。并发 stop 与取消等待不会重复或中断回收。
定向反例覆盖首投影阻塞/失败前不 ready、未就绪拒绝感知、Shutdown 后拒绝新输入、重复 ACK、在途
Synthesis 取消收尾、部分启动、主循环故障、History 关闭失败及继续回收。Worker 57 项、Core 214 项、
Kernel 209 项（7 项条件跳过）、Ruff、architecture/docs/encoding/diff 与根 typecheck/build PASS。
实际 Kernel/Worker 进程的启动/停止/新代恢复、崩溃撤销 ingress、失败恢复链 4 项 PASS；Windows
仍偶发进入既有超时进程树回收，不将这一证据写成每次均优雅退出。该现象及固定候选的生命周期
独立审查、最终主链门仍须收尾。诊断日志显示领域组件约 0.2 秒内已经记录停止，但进程随后仍未退出；
下一步核查事件循环收尾和遗留线程/任务，而非扩大超时或把 fallback 当作优雅停止。
本切片不改变进程或数据 owner，不宣称阶段 5 完成。

Worker 取消传输切片：停机诊断在循环关闭时确认无遗留 async task，残余非守护线程正在
`urllib` 模型 HTTP 的 DNS/TLS 调用中。取消 `asyncio.to_thread` 的等待者没有终止底层请求。
Worker 模型与云 Embedding HTTP 已改为 HTTPX 可取消异步传输，ModelPort 与全部生产消费者
同时切换；视觉专家路由不再把网络请求藏入线程，Embedding 重试等待也可取消。Provider 失败只记录
安全状态/类型，HTTPX/httpcore 的请求 URL 日志关闭，避免地址中的凭据进入日志。
回环慢响应反例验证 CloudReasoning、视觉专家与 Embedding 取消关闭连接且无后台重试；真实
Kernel→Worker 测试使用隔离数据目录、本地慢响应 provider 和测试密钥，断言双代正常停止及在途
Plan 网络请求取消后均为 exit 0 / 无 signal，而非接受进程树强制回收。未扩大 stop 超时或降低门禁。
本地 CPU Embedding 线程计算不在该网络修复范围；该切片不代表全部平台/生产场景已证明优雅退出，
最终生命周期独立审查和完整主链验收仍需完成。

本切片证据（2026-10-06，当前 dirty 源码/根 uv 锁候选）：Worker 62 项、Core 214 项、
Kernel 209 项（8 项条件跳过，真实 Worker 进程 5 项另行启用并通过）、Desktop 打包契约 5 项 PASS。
Contracts 全量验证含 22 项 gates、根锁 inventory/toolchain、TS/Python/C# round-trip 与 generated-clean
PASS；根 typecheck/build、architecture/docs/encoding/diff PASS。改动测试的 Ruff 与模型边界源码
import/unused 检查 PASS；未宣称旧大型迁移文件的全部 lint 已收束。取消链路无持久数据迁移、公开 wire
变更或版本递增；仍未执行最终 OCI/安装制品及完整产品主链验收。

### 阶段 2 后续候选审计与 Configuration 切片

本轮基于 `cbb6c853`，由当前任务独占写入；不提交、不推送。

| 候选 | 真实实现与消费者 | 所有权判断及本轮决策 |
|---|---|---|
| Scope | `application/skill-plane/scope.ts` 被 SkillRegistry、执行网关使用；按 ConversationContext 的 provider/scene/conversation 判断可见性 | 含能力暴露语义，保留现 owner；尚无成熟 typed facets primitive |
| Topology | `adapters/endpoints/endpoint-registry.ts` 被 Cognition transport、AvatarController、ControlSurfaceGateway 与 bootstrap 使用；Python inference service 按 local/cloud 回退 | catalog 绑定 Kernel purpose、RunRoot、launch generation；推理回退是领域策略，均不整体迁移 |
| Configuration | `adapters/config/document-validator.ts` 被 ConfigManager 和 ConfigApplicationAdapter 使用；`composition/product-composition-validator.ts` 有同类 AJV 实现 | 提取通用校验器；Schema 集合、业务文档类型、配置加载/写入及装配策略留 Kernel |
| Security | ExtensionProcessHost 使用 SDK permission 声明并 broker `secrets.get`；Cognition transport 使用 HMAC 握手；server auth 管理产品登录 | 分别绑定公开 SDK、握手协议和产品会话，未确认可共用且不反向依赖 SDK 的 primitive，本轮保留 |
| Streams/Transport | ActionStreamManager 发布带 scene/channel/emotion 的领域事件；Cognition/Audio adapters 承载 generated gRPC DTO、取消与就绪 | 当前不是独立通用流实现，不把领域事件改名成 Stream，不迁移整套 transport |

完成态及顺序：

1. create `core/platform/src/configuration/index.ts`，拥有 schema 注入、AJV 编译缓存、原地默认值与错误格式；只依赖 AJV，不引用 Contract Spine 或产品 Schema。
2. retain `core/kernel/src/adapters/config/document-schema-registry.ts`，注入唯一 `contracts/json-schema/` 的配置集合；retain 产品装配 validator 的业务入口，由它注入产品 Schema。
3. cut ConfigManager、ConfigApplicationAdapter 与产品装配校验到 Platform；保留配置的 formats 校验，以及产品装配原有未安装 formats 的行为。UserSkillSource 的严格 metadata 校验策略不同，留原 owner。
4. verify 默认值、未知字段拒绝、格式、跨 Schema 引用、实例隔离与真实消费者，再以旧 import consumer-zero 删除 `core/kernel/src/adapters/config/document-validator.ts`；无兼容壳。
5. package export 提供 `@glimmer-cradle/platform/configuration`；构建输出为 `dist/configuration`。不改变 installed host、运行数据、配置键或安装路径，无持久数据迁移。

验收：Platform 单测、Kernel 配置/装配/架构定向测试、production bootstrap smoke、架构/编码门、根 typecheck/build；固定源码候选后独立只读审查共享 owner 边界。

切片交付记录：

- 问题与决策：配置和产品装配分别持有通用 AJV 机制；以 Platform 为唯一机制 owner，保留 Schema 与业务策略的现行 owner。
- 修改文件：`core/platform/src/configuration/index.ts`、`src/index.ts`、`package.json`、`tests/configuration-validator.test.mjs`；Kernel `package.json`、`src/adapters/config/{config-manager,config-application-adapter,document-schema-registry,yaml-normalizers}.ts`、`src/composition/product-composition-validator{,.test}.ts`；删除 Kernel `src/adapters/config/document-validator.ts`；更新锁文件及 Current 10/11、本执行记录。
- public API：私有 workspace 包新增 `@glimmer-cradle/platform/configuration` 的 `ConfigurationValidator<Name>`、`ConfigurationValidation<T>`，根入口同步导出。公开 Extension SDK 与 wire API 不变。
- 数据与兼容：无数据迁移、无配置键/默认值变更、无兼容壳；旧校验器源码消费者为零并物理删除。Kernel 的严格 UserSkill metadata AJV 校验保留，因其策略不同；不是本切片的旧 owner。
- 剩余违规与后续 TODO：阶段 2 的其他 Namespace 未满足成熟 primitive 提取门；Scope 的能力可见性、Kernel endpoint catalog 的产品装配耦合、Security 的 SDK permission 依赖与 Transport 的领域 DTO 耦合保留在上述审计表。Topology 的三个发布者及 Desktop/Server reader 共享 `host/endpoints.json`，但路径、purpose、启动代次与握手/ready 由产品链固定；目前不能用迁移目录替代跨产品 ServiceLocation 模型。随阶段 12 的 topology-driven composition 核对该边界；不预建 namespace。其余全局违规仍见本页“已确认的冲突与最高风险耦合”。
- 独立审查：固定于 `cbb6c853` 上本轮 Configuration dirty 源码候选；只读审查未发现阻塞缺陷，确认机制/Schema 边界、formats 策略、旧消费者归零与 package/lock 一致。审查未重复执行测试。

### 阶段 3 初始审计与边界清理切片

现行 `PerceptionModalityItem` 分别见 Kernel `ports/application-models.ts`、Extension SDK 的公开模型、
`contracts/proto/glimmer/cognition/v1/cognition_service.proto` 的 `ModalityItem` 与 Cognition Python 的推理输入；
这些是不同边界的现行事实，不能把其中一份复制到 `core/content` 作为第二份跨进程契约。
只有 `uri`/`mime_type`，没有稳定的 `assetId`、可恢复 storage port、大小/校验和与 locator 权限；
现行数据与历史读取的迁移/恢复链尚未核对，不能凭临时 URI 生成 AssetRef。Message 的 sequence 与 actor
属于 Conversation，不随 Content 移动。审计时 `CQ:record` 标为 `video` 且带 `audio/*`，Python router 只按
`image`/`video` 分类；下述音频分类切片已同步 SDK 类型与 Cognition producer/consumer，并覆盖旧事件。

先实施局部且可验证的防腐边界清理：Kernel `application/ingress/identity-router.ts` 已将 CQ 码解析成通用
URI/MIME，却将原始 `[CQ:...]` 写入 `content.items.metadata.original_cq`；全仓活跃源码无该字段消费者。
移除这两处写入并验证 image/record/video 的中立输出，不改变 wire 字段、URI、既有数据和执行路径。
此切片最终路径仍在 Kernel 现行 ingress adapter；它不创建 Content 空目录，不宣称 Content/AssetRef 已完成。
删除门为 `original_cq` 源码写入与消费均为零；历史持久事实保留。

边界清理结果：`original_cq` 在活跃源码无读写；image、record、video 保持原 URI/MIME 与现行
modality，`IdentityRouter` 定向反例 1 项 PASS。`pnpm check:architecture`、`pnpm check:encoding`、
根 `pnpm typecheck` 与根 `pnpm build` exit 0；在此之前通过的 Configuration 27 项定向测试和
production bootstrap smoke 所覆盖的配置/组装输入未变，可复用，但它们不验证新的 CQ 清洗断言。
本切片未修改持久数据、公开 SDK 或跨进程 wire；旧数据若包含 `original_cq` 仍按原样保存，
之后数据迁移要用旧样本另行评估。未运行全量 Cognition、UI、Unity、生产部署测试。

后续 Content 结构切片的门：先确定资产 ID 与存储 port、旧 URI 读取/回退及恢复样本，再确定
`core/content/{text,image,audio,video,file,asset}` 中有真实消费者的完成态子树；按 Contract Spine 的唯一
wire source 更新 mapper 与多语言测试；所有旧 owner consumer-zero 后才删除。该决定仍属阶段 3，
不提前迁移 Conversation、Extension SDK 或历史日志。

持久化链复核：Cognition gRPC transport 将 `content.items` 放入 `model_input`，PerceptionProvider 仅将其
传给当拍的 PerceptionAppraiser；Appraiser 写入 Experience Ledger 的 perception Moment `content` 只有
路由后的文本、`has_multimodal` 和交互属性，没有原始 item、URI 或媒体字节。Ledger 原样持久化该
Moment `content_json`，Conversation Store 由其投影。因此旧 Moment 无法反推出原始媒体，也不能凭
Ledger 为旧 URI 批量生成 AssetRef；迁移样本需区分“仅有语义文本的历史记录”和仍可访问原始媒体的
来源，缺失媒体时保留文本并明确不可恢复。新资产须在媒体可访问时由明确 owner 持久保存，再向
Content 暴露稳定 ID；不能把 Audio Engine lease、可重建 TTS cache 或 `data/work/` 截图当成持久存储。

### 阶段 3 无消费者语义模型删除切片

删除门：`core/cognition/.../adapters/inference/content.py` 的 `MultimodalContent`/`MultimodalType`
在活跃源码没有导入或实例化，`adapters/inference/__init__.py` 未导出它们；实际输入解析与媒体路由由
同目录 `multimodal.py` 承担。历史架构文档保留原貌。删除该旧文件及 Kernel ingress 中将规范化
媒体项误称为 `MultimodalContent` 的注释，不新增替代模型或兼容导出，不变更 wire、持久数据或行为。
验收为 consumer-zero 搜索、Cognition 全量测试、根 typecheck/build、架构与编码检查。

结果：旧 `content.py` 已物理删除，Kernel ingress 两处注释使用现行“感知媒体项”术语；活跃
Python/TypeScript 无 `MultimodalContent`、`MultimodalType` 或该模块的导入；旧名称仅留在本执行记录与历史文档。
`uv run pytest -q` 在 Cognition 253 项 PASS；根 `pnpm typecheck`、`pnpm build`、
`pnpm check:architecture`、`pnpm check:encoding` 和 `git diff --check` exit 0。该删除不构成
Content/AssetRef 的结构迁移，阶段 3 仍等待稳定资产 ID、持久存储 port 与迁移样本。

### 阶段 3 音频媒体分类切片

后续核验：`contracts/proto/glimmer/engine/audio/v1/audio_engine.proto` 的 `AudioMediaReference`
是短期 lease（带 expiry、access、size、SHA-256），`OfficialAudioEngineClient` 在停机、失败或重启时
回收 media root；它不能充当长期 `AssetRef`。本切片前 `CQ:record` 在 Kernel 输出 `video` + `audio/*`，
Cognition 的 `MultimodalRouter` 按 `video` 把该 URI 送到视觉 provider，导致媒体类别错误。

本切片将 `CQ:record` 正规化为 `audio`，在 Kernel 内部模型与 Extension SDK 的现有公开边缘类型中
允许 audio；proto `ModalityItem.modality` 已是 string，不新增 wire 字段或第二契约源。Cognition
路由按 audio modality 或旧 `video + audio/*` 识别语音，禁止送到视觉 provider；已有可信语义文本可
继续使用，无转写时只陈述“用户发送了语音，但当前没有可用的转写文本”。记录/体验的历史数据不回写，
旧组合的读取兼容由 Cognition router 持有，退出条件为阶段 14 旧事件 fixtures 与数据迁移通过。
不建立通用 `AudioContent` 或 `AssetRef` 空目录；真实 Content owner 的结构迁移仍取决于前述存储门。

验收：Kernel image/record/video 转换及感知 modality 测试、Cognition 新旧音频与混合视觉路由反例、
SDK/Kernel 类型检查、Contract Spine verify、根架构/编码/typecheck/build。停止点为分类与降级
语义完整，不变更 Audio Engine lease、用户媒体文件、历史日志或用户配置。

切片结果：Kernel `IdentityRouter` 将新语音项标为 `audio`，同一感知 envelope 的 modality
列表也包含 `audio`；SDK 的类型联合仅追加 `audio`，proto `ModalityItem.modality` 继续使用既有
string field。Cognition `MultimodalRouter` 对新 `audio` 和旧 `video + audio/*` 都走音频分支，
不再将音频 URI 交给视觉模型；可信且已 resolved 的转写继续使用，缺少转写时如实呈现能力限制。
历史记录不回写；旧组合的读取分支由 Cognition 持有，阶段 14 的旧事件 fixtures/数据迁移门通过后
再删除。没有新的 `core/content` 包或 `AssetRef`，阶段 3 仍未完成。

验证（`cbb6c853` 上本轮 dirty 候选）：Kernel ingress 定向 2 项、Cognition 相关 49 项及全量
253 项、Extension SDK 10 项 PASS；`pnpm check:architecture`、`pnpm check:encoding`、根
`pnpm typecheck`、根 `pnpm build` exit 0。首次 `pnpm contracts:verify` 因本机缺少锁定的
.NET SDK 8.0.423 在 toolchain gate 停止；2026-09-20 按 `contracts/toolchain.json` 的 URL、
archive SHA-512 和 launcher SHA-256，将该 SDK 装入被忽略的 `contracts/.tools/dotnet/`。
补齐后首次完整验证的 21 项 gates、inventory、Buf lint/breaking、JSON Schema、toolchain、
TS typecheck 及 TS/Python/C# roundtrip 全部通过，generated-clean 因生成前后文件集合变化失败；
生成清理后单独复验通过，再完整重跑 `pnpm contracts:verify`，全部 gate 及 generated-clean
exit 0。`contracts/generated` 与 compatibility 无 tracked 改动，`pnpm check:architecture`、
`pnpm check:encoding` 和 `git diff --check` 复验通过。
本轮未运行完整产品 UI/Unity/部署测试，也未验证已分发的独立扩展。公开 SDK union 是兼容扩展，
但正式发布前仍需检查独立扩展消费方与发行门。高风险跨语言候选仍待固定候选上的独立审查。

兼容入口只允许位于旧边界 adapter，且委托新 owner；禁止两份独立实现和双写。
执行 owner 负责以下窗口：Conversation legacy reader 到阶段 14 fixtures/重建/恢复验收；
旧 Action RPC 到阶段 5 新旧 producer/consumer 全切换；旧 SDK 导入到阶段 9 消费方验证；
旧路径到阶段 12 安装/打包入口切换。最终阶段 15 逐项确认 consumer-zero 后删除。
不同于 runtime compatibility，已发布历史制品与 tag 永远保持真实，不删除或覆写。

## 验证证据

### 根 Python workspace 收敛（2026-10-06）

根 `pyproject.toml` 明确纳入 Contracts、Python round-trip、Conversation、Cognition、Cognition Worker、
Audio 与 Desktop runtime 七个成员，根 `uv.lock` 是主仓库唯一 Python 解析锁。成员依赖统一声明
`workspace = true`；五份旧子项目锁已在 consumer-zero 后删除，独立 Extension 模板锁仍属于模板后续迁移。
Inventory/Toolchain、离线 round-trip、Desktop runtime manifest 与打包导出均切换根锁。
Worker 根测试脚本改为使用 Worker 自己的项目元数据。

开发 Cognition 从根 `.venv` 启动，按 Worker 成员执行 inexact sync，防止共享环境卸载 Audio extras。
Desktop 显式安装 Contracts、Conversation、Cognition、Worker 和 Audio 五个本地 distribution，并核验
Worker/Conversation 的安装产物。Personal Server Python builder 一次选择 Worker 与 Audio（tts），
最终镜像只复制非 editable 根环境并注入解释器路径；不复制 Python 源码树或依赖运行时 uv sync。

当前候选证据：根锁检查、Contracts 工具链和离线 Python round-trip PASS；Inventory 13 项、Desktop
打包契约 5 项、Deploy/供应链契约 13 项 PASS；Conversation 19 项、Cognition 225 项、Worker 38 项、
Audio 11 项 PASS。隔离目录非 editable 安装五个本地 distribution、`-I` imports 与 Worker `--help`
PASS；Contracts 全量 gates 22 项、Kernel 全量 205 项（7 项条件跳过），以及真实 Kernel→Worker
启动、双代 ready、崩溃恢复、失败关闭和显式恢复 4 项 PASS。Windows 停机
部分场景仍使用已有强制进程树回收路径；本切片未改变该策略。Linux 目标 dry-run PASS；本机没有 Docker，
实际 OCI 构建仍须在最终产品候选执行。根 typecheck/build、docs、encoding、architecture 和
`git diff --check` PASS；最终物理差距为 1,569 项，整体重构继续进行。


- 2026-09-20 文档整理：保留现有分类；旧蓝图、旧目标树、旧母路线与 now 快照归入 History，
  重建 v2 迁移地图、补齐 Platform 实现和里程碑索引。新增 `check:docs` 并接入 `check:pr`，
  检查活跃 Markdown 的本地文件链接与入口可达性，不代替源码/设备/生产验收。
  生命周期审阅发现当前 stop/observer 异常会中断后续停止，详见 Platform 实现；后续阶段 2 需按资源回收风险评估修订，
  本轮文档工作未改变该行为。
  验证：repo-checks 16 项通过，106 份活跃 Markdown 本地链接与入口可达性通过，章节锚点另行复核；
  架构/编码检查、根 `pnpm typecheck` 与 `pnpm build` 通过。未执行全产品测试、Unity/设备矩阵或生产验收。
- 阶段 0 起始输入：上述 commit；当时新增的只有两份原文副本及本记录，尚无产品源码改动。
- 起始根 `pnpm check:architecture`、`pnpm typecheck`、`pnpm build`：PASS，exit 0。
- 阶段 1：repo-checks 11 项（含 6 项 v2 反例）、`pnpm check:encoding`、`pnpm check:architecture` PASS；
  `contracts verify:architecture` 的 21 项 gates、inventory、Buf lint/breaking、JSON Schema、generated clean PASS。
- 阶段 2 当前切片：Clock/Identity/Observability 旧 Kernel port consumer-zero 后已删除；通用 LifecycleCoordinator
  负责阶段启动、并行收敛、逆序停机与单调时间计时，Kernel observer 继续拥有 readiness、领域事件和日志投影。
  `@glimmer-cradle/platform test`（2 项）、Kernel 定向测试（17 项，覆盖架构与迁移后的 Observability consumer）、
  Kernel typecheck、production bootstrap smoke、根架构/编码检查、根 `pnpm typecheck` 与 `pnpm build` PASS。
- 阶段 2 Events 切片：Platform 只新增 product-neutral live-event publisher/subscription contract；Kernel
  `event-bus.port` 组合该 contract，并继续独占领域事件、durable replay inventory/ack、DLQ 与失败策略；
  EventBus replay 定向测试（7 项）、Kernel 架构测试（6 项）、Platform 测试（2 项）、根架构/编码检查、
  production bootstrap smoke、根 `pnpm typecheck` 与 `pnpm build` PASS。
- 阶段 2 Configuration 切片（`cbb6c853` 上上述 dirty 范围，2026-09-19，Windows / pnpm 11.13.0）：
  `pnpm --filter @glimmer-cradle/platform test` 6 项 PASS；
  `pnpm --filter @glimmer-cradle/kernel exec vitest run --threads false src/adapters/config/config-manager.active-extensions.test.ts src/application/use-cases/config-application.service.test.ts src/composition/product-composition-validator.test.ts tests/architecture`
  5 文件、27 项 PASS；`pnpm check:architecture`、`pnpm check:encoding`、根 `pnpm typecheck`、根 `pnpm build` 全部 exit 0。
  `pnpm --filter @glimmer-cradle/kernel smoke:bootstrap` PASS：真实 Cognition 注册/ready、应用 RUNNING、逆序停止、Cognition exit 0；使用临时 data root，未覆盖完整 Desktop UI/Audio/Avatar/安装制品。
  首次离线依赖安装因 store 缺 tarball 失败，联网 `pnpm install --ignore-scripts` 成功；锁文件只调整 AJV 依赖 owner，未升级版本。
  此后仅文档证据更新；测试输入变更时按影响重验。
- 防漂移门禁：repo-checks 新增冻结 lock 正反测试，当前 repo-checks 14 项与 `check:architecture` PASS；
  原始基线或执行要求哈希、五个目标根、七个 Core 模块、迁移政策发生未受控变化时检查失败。
- 本轮未运行全量测试、proto verify、UI/Unity 与生产环境验收；上述定向测试及本地 production composition smoke 不代表全产品或部署验收。
- 收尾归档：阶段证据保持本页；最终当前事实同步 Current/Implementation/Reference，任务完成后按文档规范归档执行记录。

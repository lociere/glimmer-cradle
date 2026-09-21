# Architecture Baseline v2.0 重构执行记录

> 范围：本地仓库渐进重构的审计、阶段计划、验收证据和未完成项。
> 事实依据：起始 commit `0f793adbba586c7a80a841c56ea3fbe40a1183b8`、实际源码及用户提供的两份原文。
> 维护触发：阶段、候选、所有权、验证或迁移风险变化。

## 目标与执行边界

用户授权按 [冻结基线](../architecture/blueprint/Glimmer_Cradle_Architecture_Baseline_v2.0_Frozen.md)
和 [执行要求](../architecture/blueprint/Glimmer_Cradle_Codex_Refactor_Prompt_v2.0.md) 完成重构。
冻结基线决定目标边界，执行要求决定阶段与验收。当前执行任务为唯一工作树写入 owner。
开始时工作树干净；本次包含本地代码、测试、文档与迁移实现，生产迁移、发布和推送不在当前授权内。
已有运行数据不得删除；历史发布事实不回写。不得把局部检查通过写成整体重构完成。

## 冻结基线与防漂移门禁

- 规范修订 1：依据用户本轮授权与 ADR-0021，修正 Runtime、Embodiment/Avatar、wire/domain、第三方依赖及改名兼容规则；命名指南和 agent 入口同步，基线锁更新为 v2.0-r1。未进行产品代码或数据迁移。

- [执行宪章](../architecture/blueprint/Architecture_Baseline_v2.0_执行宪章.md) 固定权威顺序、目标边界、迁移纪律和偏离处理。
- `architecture-baseline-v2.lock.json` 固定当前已授权基线修订与执行要求的 SHA-256，并显式固定五个目标根、七个 Core 模块和迁移政策；原始基线保留在 Git `cbb6c853`。
- `check:architecture` 在其他边界规则前验证基线锁；原文、锁定决策或文件缺失都会失败。
- 架构目标变更必须同时具备用户明确决策、accepted ADR、新的版本化基线以及 lock/gate 更新；普通实现切片无权改写目标。

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
| `core/cognition/.../application/cycle` | Python / Cognition | 注意、deliberation、ActionPlan 分类、回复 | persona、inference、experience、memory | 当前 Turn 临时状态 | CycleController | skill_request 前置分类、固定 capability categories | cognition/loop、attention、perception；Turn 入 conversation | 高：普通聊天与工具调用必须共用迭代链 | `test_cycle_controller.py` |
| `core/cognition/.../application/agent_plan_use_case.py`、`agent_synthesis_use_case.py` | Python / Cognition | 一次计划和结果合成 | LLMPort、SelfEntity、experience | 非独立 owner | AgentPlan/AgentSynthesis use case | JSON 规划协议、SkillToolSuggestion | cognition/loop/step | 高：现有 RPC producer/consumer 成对替换 | 对应用例及 gRPC transport tests |
| `core/cognition/.../adapters/inference/gateway.py`、`cloud.py` | Python / Cognition | HTTP provider payload、响应解析、推理后端 | urllib、LLMSettings、observability | provider 调用状态 | LLMEngine.generate | OpenAI-compatible payload；local/cloud 分支 | provider 实现迁 app/extension；核心保留 inference contract | 高：当前接口只返回字符串，不支持原生 tool calls | model invocation / inference tests 待细分 |
| `core/cognition/.../adapters/persistence/experience/ledger.py` | Python / Cognition | 单写者分包 Moment 日志 | SQLite、文件 writer guard | Moment ordered log、position | append、flush、query | 无厂商语义 | conversation/log 拥有交互事实；其他经验须分类 | 极高：禁止丢失已有 Experience 与因果链 | `test_experience_architecture.py` |
| `core/cognition/.../adapters/persistence/conversation/store.py` | Python / Cognition | 从 Moment 投影历史、章节、工作集 | aiosqlite、Moment、paths | 投影 checkpoint；不拥有原始交互事实 | project、checkpoint、history queries | 无厂商语义 | conversation/history | 极高：schema v3 不匹配目前要求删除重建，须改迁移路径 | `test_conversation_architecture.py` |
| `core/cognition/.../adapters/persistence/memory` | Python / Cognition | 记忆、关系、向量、巩固队列 | CognitionDatabase、Episode、memory ports | Memory；巩固 Job 目前同库 | repositories | 存储与业务队列耦合 | cognition/memory；队列 lifecycle 入 jobs | 高：跨表一致性、租约和幂等 | `test_memory_architecture.py` |
| `core/cognition/.../domain/persona` | Python / Cognition | profile 编译、人设及对话策略 | canonical profile 与领域配置 | 编译后 persona 数据 | profile compiler / prompt assembler | 角色资料不应迁成通用硬编码 | cognition/persona | 中：稳定关系与动态记忆分离 | `test_persona_injector.py` |
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
7. 现行 LLMPort 只有字符串响应，native ToolCall/ToolResult 需要贯穿 contract、provider mapper、transport 和 Loop。
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
| 4 | Conversation log/history/binding/Turn 唯一 owner | 进行中：owner、单写者与完整门禁已收束，固定候选独立审查待执行 |
| 5 | native iterative Loop、Context budget/trust、Memory/Persona/Observation | 待执行 |
| 6 | Tool/Skill/Resource 分离、Step Surface 与 execution | 待执行 |
| 7 | Durable Jobs persistence/recovery/cancellation | 待执行 |
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

## 兼容窗口与删除门

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

阶段 4 尚未标记完成：当前固定候选的完整门禁已通过；仍须满足高风险持久化 owner 变更的独立只读
审查要求。未获得独立审查前不进入下一阶段写入。

固定候选证据：`@glimmer-cradle/conversation` TypeScript 3 项与 Python 4 项、Cognition 全量 256 项、
Kernel 全量 201 项（另 7 项跳过；原 2 项 Directory 测试已迁至 Conversation）、Desktop 10 项，
根 `pnpm typecheck` / `pnpm build`、docs、architecture、encoding、version 与 `git diff --check` 均 PASS。
新增用例覆盖单写者、重启 position、History 重建、transient 排除与损坏 gap 检出；既有用例继续覆盖
v4/v5、catalog 重建、scope 漂移、稳定 cursor、Episode 恢复和工具结果来源/因果。架构门首跑发现 Cognition
深导入 Conversation 内部 `log/ports`，改为根入口公开契约后重跑通过；Cognition 全量和 Conversation
双语言测试也在该修复后再次通过。并行早期首跑曾因 Conversation 包尚未构建而使 Kernel typecheck
报模块缺失，按根构建依赖顺序重跑即通过；两次失败均已修正且不属于当前候选。

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

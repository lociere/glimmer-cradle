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

- [执行宪章](../architecture/blueprint/Architecture_Baseline_v2.0_执行宪章.md) 固定权威顺序、目标边界、迁移纪律和偏离处理。
- `architecture-baseline-v2.lock.json` 固定用户原始基线与执行要求的 SHA-256，并显式固定五个目标根、七个 Core 模块和迁移政策。
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
| 2 | platform primitive 提取；业务装配留 composition | 进行中：Clock/Identity/Observability/Lifecycle/Events public contracts 已切入 `core/platform`；Kernel 保留 readiness、领域事件、durable replay 与 DLQ policy |
| 3 | Content/AssetRef、真实消费者和存储 port | 待执行 |
| 4 | Conversation log/history/binding/Turn 唯一 owner | 待执行 |
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
当前 public API、持久数据与运行链路尚未修改。两份原文只作为要求来源，不代表实现完成。

## 兼容窗口与删除门

兼容入口只允许位于旧边界 adapter，且委托新 owner；禁止两份独立实现和双写。
执行 owner 负责以下窗口：Conversation legacy reader 到阶段 14 fixtures/重建/恢复验收；
旧 Action RPC 到阶段 5 新旧 producer/consumer 全切换；旧 SDK 导入到阶段 9 消费方验证；
旧路径到阶段 12 安装/打包入口切换。最终阶段 15 逐项确认 consumer-zero 后删除。
不同于 runtime compatibility，已发布历史制品与 tag 永远保持真实，不删除或覆写。

## 验证证据

- 起始输入：上述 commit；本次复制的两份原文及本记录为唯一新增文件，尚无产品源码改动。
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
- 防漂移门禁：repo-checks 新增冻结 lock 正反测试，当前 repo-checks 14 项与 `check:architecture` PASS；
  原始基线或执行要求哈希、五个目标根、七个 Core 模块、迁移政策发生未受控变化时检查失败。
- 单元/集成、proto verify、UI/Unity/生产：尚未运行，不能引用旧报告作本候选通过依据。
- 收尾归档：阶段证据保持本页；最终当前事实同步 Current/Implementation/Reference，任务完成后按文档规范归档执行记录。

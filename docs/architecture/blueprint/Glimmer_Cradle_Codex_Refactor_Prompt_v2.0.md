# Codex 最终重构执行提示词：将 Glimmer Cradle 重构到 Architecture Baseline v2.0 (Frozen)

> 本文可直接交给 GPT Codex / ChatGPT Work / Coding Agent。Architecture Baseline v2.0 (Frozen) 是唯一目标基线，旧 v1.0 文档和旧目录设计均视为已被取代。

---

## 0. 你的角色与任务边界

你现在是 Glimmer Cradle（微光摇篮）项目的首席架构重构工程师。你的任务不是做 demo，不是机械移动文件，也不是为了目录漂亮重写仓库；你的任务是**在保持项目持续可构建、可测试、可运行的前提下，将真实代码逐步迁移到最终冻结架构，并用自动化规则阻止架构回退。**

最终仓库 namespace：

```text
glimmer-cradle/
├── core/
│   ├── platform/
│   ├── content/
│   ├── conversation/
│   ├── cognition/
│   ├── capabilities/
│   ├── jobs/
│   └── embodiment/
├── extension-sdk/
├── apps/
│   ├── desktop/
│   ├── server/
│   ├── cognition-worker/
│   └── extension-host/
├── protocol/
│   └── proto/
└── docs/
```

**不要一次性创建所有空目录。** 目标是职责/依赖/状态所有权正确，物理目录只在存在真实代码时建立。

---

## 1. 不可违反的架构规则

1. `core/**` 只允许 vendor-neutral 的产品核心语义；QQ、Discord、Telegram、VRChat、Live2D、OpenAI、Anthropic、Gemini、GitHub、CosyVoice 等不得成为 Core 类型、枚举或依赖。
2. `core/platform` 是底层运行平台；不得依赖 `conversation/cognition/capabilities/jobs/embodiment`。
3. `core/content` 只定义 Text/Image/Audio/Video/File/Asset 等通用内容，不定义 Message，也不定义平台 payload。
4. Message/Turn/Log/History/Binding 属于 `core/conversation`；Runtime Session 不等于 Conversation。
5. Step 属于 `core/cognition/loop`；Turn 属于 Conversation。
6. Context/Memory/Persona/Inference/Perception/Attention 属于 Cognition；不预建 Knowledge/Reasoning/Orchestration God-module。
7. 普通聊天和工具调用使用统一 Cognition Loop，不允许 `skill_request`、Dialogue/Agent 前置 LLM 分类器。
8. Tool/Skill/Resource 分离；不得用 `Registry<any>` 统一整个 Capability 世界。
9. Registry presence 不等于 model exposure；必须有 Tool/Capability Surface 选择。
10. Job 只用于 scheduled/persistent/resumable/long-running 工作，不替代当前 Turn 的多步 cognition loop。
11. Live2D/VRM/VRChat 是 Embodiment renderer/bridge 实现，不进入 semantic state。
12. Extension 只能依赖 `extension-sdk` 和明确 public contract，不允许穿透 Core internal。
13. Core 绝不能依赖 `extension-sdk`。
14. MCP 是 bridge：Tool/Resource/Prompt 必须规范化到 Glimmer 内部概念。
15. Local/Cloud/Hybrid 是 topology，不允许三套业务代码。
16. `.proto` 是 TS/Python 跨边界 wire schema 的唯一真相源；Domain type 与 generated wire type 必须隔离。
17. Extension Host 保持独立进程；独立进程不是 Sandbox，必须逐步使用 brokered API/permissions。
18. canonical state 只能有一个 Owner；History/Projection 不能成为第二写源。
19. 不新增 `common/shared/utils/runtime/services/managers` 等模糊大目录。
20. 每一步重构必须可测试、可回滚，禁止一次性大爆炸式重写。

---

## 2. 第零阶段：先审计仓库，禁止直接改目录

先阅读：

- 当前架构文档；
- package manifests / pyproject / tsconfig；
- TS Kernel/Host；
- Python Cognition；
- Tool/Skill/MCP；
- Extension Host；
- Desktop/UI/Live2D/Voice；
- persistence/config；
- local/cloud communication；
- JSON Schema / proto / contracts；
- scheduler/task/job 实现。

输出一份审计表，每个关键模块记录：

```text
Path
Language/process
Current responsibility
Current dependencies
Canonical state owned
Public API
Vendor/platform coupling
Target module
Migration risk
Tests covering it
```

重点搜索现有坏味道：

```text
SkillActionController
skill_request
action_planner
agent_plan
agent_synthesis
hard-coded tool categories
Character*/Self*/Assistant*/Agent* Manager/Controller
QQ/Discord/VRChat enum or type in core
Live2D parameters outside adapter
OpenAI/provider-specific request types leaking inward
Event Bus used for request/response
TS/Python duplicate schemas
local/cloud forked business logic
utils/common/shared/runtime/services/managers junk drawers
```

如果文件名已经变化，寻找语义等价实现。

在任何大规模修改前，输出：

- current → target mapping；
- dependency cycles；
- state ownership conflicts；
- vendor leakage list；
- 5~10 个最高风险耦合；
- 推荐迁移顺序；
- 需要保留兼容 adapter 的位置。

---

## 3. 第一阶段：建立架构护栏和 Public API 规则

在移动大量文件前先建立约束，否则重构会反复回退。

### 3.1 Package/Module exports

为每个已有目标模块定义明确 public entrypoint；禁止深路径引用 internal implementation。

目标 public boundary：

```text
core/platform
core/content
core/conversation
core/cognition
core/capabilities
core/jobs
core/embodiment
extension-sdk
```

### 3.2 Architecture tests

尽早添加：

- dependency direction test；
- circular dependency check；
- forbidden vendor import/name test；
- forbidden deep import test；
- extension → internal import test；
- core → extension-sdk dependency test；
- generated proto modification test。

测试先允许 legacy exception list，再随着迁移逐步清零；不要因为现状有违规就放弃自动约束。

### 3.3 ADR/文档

将 Architecture Baseline v2.0 设为权威文档。旧 v1.0 标记 superseded，不允许 Codex 继续按照旧树创建 root-level cognition/content 等目录。

---

## 4. 第二阶段：把旧 Core 收敛为 core/platform

目标：旧 TS Kernel/基础设施语义迁入：

```text
core/platform/
├── kernel/
├── lifecycle/
├── scope/
├── events/
├── streams/
├── transport/
├── topology/
├── time/
├── security/
├── configuration/
└── observability/
```

### 4.1 从 Kernel 移除业务逻辑

如果当前 Kernel/Controller 内存在以下内容，迁出：

- LLM semantic planning；
- tool/skill semantic selection；
- response synthesis；
- persona/memory decisions；
- vendor provider logic；
- Live2D/QQ/platform logic。

Kernel 最终只负责 service composition、lifecycle、scope 和低层协调。

### 4.2 删除模糊目录

不要保留万能：

```text
core/services
core/scheduling
core/policy
```

语义改为：

- service registration → `platform/kernel`；
- time primitives → `platform/time`；
- durable work scheduling → `core/jobs/scheduler`；
- security primitives → `platform/security`；
- tool/action policy → `capabilities/execution/policy`。

### 4.3 通信原语

审计 Event Bus：

```text
request/response → service call
fact notification → event
continuous data → stream
historical truth → durable domain log
```

不要用一个总线代替所有 IPC/Service API。

### 4.4 Topology

建立 vendor-neutral Node/Service location model。删除 LocalManager/CloudManager/HybridManager 式分支。

---

## 5. 第三阶段：建立 core/content

目标：

```text
core/content/
├── text/
├── image/
├── audio/
├── video/
├── file/
└── asset/
```

### 5.1 统一 Content 类型

建立稳定 vocabulary，例如：

```text
ContentPart
TextContent
ImageContent
AudioContent
VideoContent
FileContent
AssetRef
```

具体字段以真实需求为准，避免过度抽象。

### 5.2 Message 移出 Content

如果旧代码存在 `content/message`，迁到 `core/conversation/message`。Message 是 interaction envelope，不是 media/content type。

### 5.3 AssetRef

查找 base64、大文件 inline、重复二进制传输。设计 AssetRef + AssetStore port，逐步让 Conversation/Proto/Memory 传引用而非长期内联大 payload。

### 5.4 平台类型清洗

迁移：

```text
QQImage/DiscordAttachment/... → ImageContent/FileContent
platform audio                → AudioContent
upload                         → FileContent/AssetRef
```

平台原始 payload 只允许留在 Extension Adapter。

不要创建闭合 `Platform` enum。

---

## 6. 第四阶段：从 Cognition 中抽出 core/conversation

目标：

```text
core/conversation/
├── message/
├── turn/
├── log/
├── history/
└── binding/
```

### 6.1 Conversation 是 canonical durable interaction state

把当前聊天记录、message persistence、turn timeline、external thread mapping 从 Cognition 内部剥离。

### 6.2 Runtime Session 不等于 Conversation

检查所有 `Session` 类型。逐一分类：

- 持久聊天线程 → Conversation；
- 当前进程/连接/运行作用域 → Platform Scope/Runtime Session；
- 模型 provider session → Provider-specific adapter state。

禁止一个 Session 类型承担三种语义。

### 6.3 Turn 与 Step

保留 Turn 在 Conversation；将模型 Step 移入 `core/cognition/loop/step`。

### 6.4 Log / History

确定一个 canonical append-only/ordered log。History 是 projection/read model，不允许双写。

模型可见的 ToolCall/ToolResult 如果需要重建上下文，应以 durable fact 或可解析引用进入 Conversation Log。

### 6.5 Binding

外部平台 thread/id 通过 opaque ref 绑定。核心不能理解 qqGroupId、discordGuildId 等字段。

---

## 7. 第五阶段：重构 core/cognition

目标：

```text
core/cognition/
├── inference/
├── context/
├── memory/
├── persona/
├── perception/
├── attention/
└── loop/
    └── step/
```

### 7.1 删除 skill_request / Agent 前置分类

如果当前存在：

```text
input
→ classifier(reply/skill_request/...)
→ planner
```

移除这条双模型/多模型前置分类链。改成统一 Turn → Context → Step。

模型每个 Step 可自然产生：

- final response；
- tool call；
- job request；
- continuation；
- optional clarification（只在真实必要时）。

### 7.2 替换固定 agent_plan / agent_synthesis

如果当前有 `agent_plan_use_case.py`、`agent_synthesis` 或等价逻辑：

- 不再固定 planner 一轮 + synthesis 一轮；
- 使用 native tool calling / iterative loop；
- ToolResult 进入下一 Step；
- 增加 max_steps、max_tool_calls、timeout、token/cost budget、cancel。

### 7.3 拆 SkillActionController

若 TS `SkillActionController` 或等价类同时做 planning、policy、execution、synthesis、publish，拆为清晰职责：

```text
Cognition/Turn Bridge
Capability Execution Gateway
Output/Reply Publisher
```

Semantic decision 在 Python Cognition；TS Host 负责执行、policy、delivery 和宿主能力。

### 7.4 Context

实现/整理 Contributor 机制：

- Persona；
- Conversation projection；
- Memory；
- Resource；
- Skill guidance；
- Tool Surface；
- selected Observation；
- operational runtime context。

流程：

```text
collect → retrieve → filter → rank → budget → assemble → project
```

Fragment 至少考虑 authority/trust 与 priority 分离，防止外部内容 prompt injection 覆盖 canonical instructions。

### 7.5 Memory

整理 episodic/semantic/relationship/retrieval/consolidation/store 逻辑。不要为了架构图创建空文件夹。

建立受控写入：candidate extraction → dedup/policy/importance → store → optional consolidation。

模型不得直接永久改 Persona。

### 7.6 Persona

把角色基础设定、行为习惯、稳定关系定义、examples 变为 canonical persona data；若有 Character Card/System Prompt，做 importer/compiler，不保留外部格式作为 runtime domain model。

### 7.7 Perception / Attention

把 screen/mic/system/time/extension/task completion 等输入规范化成 Observation。绝大多数 Observation 不直接触发 LLM，先经过 Attention/Relevance Gate。

### 7.8 不预建 Knowledge/Reasoning/Orchestration

若旧目录存在但只是杂物容器：

- Knowledge 内容映射到 Resource/Memory/Context source；
- Orchestration 改为明确 Loop/Bridge/Router；
- Reasoning 没有独立算法/状态时不设模块。

---

## 8. 第六阶段：重构 core/capabilities

目标：

```text
core/capabilities/
├── tools/
├── skills/
├── resources/
├── exposure/
└── execution/
    ├── policy/
    ├── router/
    ├── target/
    └── executor/
```

### 8.1 Tool

统一 ToolDefinition/ToolCall/ToolResult/ToolProvider。Native/Extension/MCP/Remote 仅保留 provenance。

### 8.2 Skill

Skill 与 Tool 解耦，多对多。保留/引入 progressive disclosure；不要把完整 Skill 内容每轮都塞进 context。

### 8.3 Resource

Resource 是可读取/引用内容能力，不等于 Memory/Knowledge。外部 Project file、MCP Resource、document source 都可以实现 Resource Provider。

### 8.4 Registry 分离

删除/避免万能 CapabilityRegistry：

```text
tools/registry
skills/catalog
resources/registry
```

共享底层 registration primitive 可以在 Platform Kernel，但领域 registry 由各自模块拥有。

### 8.5 Exposure

实现 Step-level Capability/Tool Surface。支持 DIRECT/DEFERRED/HIDDEN 或等价状态；按权限、节点可用性、上下文相关性过滤。

### 8.6 Execution

执行路径：

```text
ToolCall
→ action policy/confirmation
→ router
→ execution target
→ executor
→ normalized result
```

Shell 等 broad escape hatch 必须高权限；稳定敏感操作优先 structured tool。

---

## 9. 第七阶段：把长期 Task 重构为 core/jobs

目标：

```text
core/jobs/
├── trigger/
├── scheduler/
├── persistence/
├── recovery/
└── cancellation/
```

### 9.1 识别真正 Job

仅迁移满足以下语义的工作：

- scheduled/later；
- persistent across process restart；
- resumable；
- long-running；
- requires cancellation/retry/recovery。

当前 Turn 的多步 tool loop 不迁到 Jobs。

### 9.2 Task 命名清理

区分 Python asyncio task、user task、agent task、durable Job。不要全局机械 rename；只把 durable background work 统一为 Job 语义。

### 9.3 Job 不拥有 Capability/Cognition

Job subsystem 管 lifecycle/time/state。业务 Handler 通过 public ports 在 composition 中调用 capability/cognition；禁止 Jobs 内直接 import cognition internal。

### 9.4 恢复与幂等

Job state 至少考虑：id、state、revision、trigger、attempt、idempotency key、owner/authority node、created/updated timestamps。

---

## 10. 第八阶段：重构 core/embodiment

目标：

```text
core/embodiment/
├── state/
├── expression/
├── pose/
├── motion/
├── gaze/
├── gesture/
├── lip-sync/
└── renderer/
```

建立 renderer-independent semantic model。

迁移/隔离：

- Live2D parameter → Live2D Extension Adapter；
- VRM blendshape → VRM Extension；
- VRChat OSC/expression parameter → VRChat Extension；
- Q sprite specifics → Renderer Extension。

Core 只保留 Expression/Pose/Gaze/Gesture/Motion/LipSync 等稳定语义。

TTS/ASR 不放入 Embodiment；只将 speaking/viseme timing 等表现数据投影为 lip-sync state。

---

## 11. 第九阶段：Extension SDK 与第三方彻底隔离

目标：

```text
extension-sdk/
├── manifest/
├── api/
├── contributions/
├── lifecycle/
├── permissions/
└── compatibility/
```

### 11.1 SDK 原则

Extension SDK 不重新发明第二套 domain types；它只公开允许扩展使用的 Core public contracts，并提供注册/lifecycle/permission API。

### 11.2 Contribution Types

根据真实需求提供：

- Inference/Model Provider；
- Tool/Skill/Resource contribution；
- Conversation endpoint adapter；
- Observation source；
- speech/content processing provider；
- embodiment renderer；
- UI contribution；
- Job trigger/handler；
- MCP bridge。

不要一次性创建所有 contribution interface；以真实实现驱动。

### 11.3 Manifest / Permission

Manifest 至少：id、version、apiVersion、entrypoint、permissions、contributions、compatibility。

### 11.4 Extension Host

保留独立进程。逐步把系统访问收敛到 Brokered Host API：filesystem/network/process/credentials/microphone 等必须显式权限。

支持 extension health、timeout、restart、disable、quarantine。

### 11.5 Vendor leakage 清零

将 QQ、OpenAI、Live2D、VRChat 等实现移到 Extension/Provider package。若当前尚不能一次迁出，建立 compatibility adapter + TODO migration issue，不得继续新增 Core coupling。

---

## 12. 第十阶段：MCP 归一化

MCP Client/Server 类型只存在 integration/extension boundary。

```text
MCP Tool     → Tool
MCP Resource → Resource
MCP Prompt   → Context/Prompt contribution
```

保留 MCP server/provenance metadata 供 audit/debug，但不要让 Cognition 需要判断 `if source == MCP` 才执行正常逻辑。

---

## 13. 第十一阶段：Protocol / Protobuf

目标：

```text
protocol/
└── proto/
    └── glimmer/
        └── <domain>/v1/
```

### 13.1 先找真实跨边界 contract

只为以下真实边界定义 proto：

- TS Host ↔ Python Cognition Worker；
- Desktop/Server ↔ worker；
- Host ↔ Extension Host（若最终选择 protobuf）；
- Local ↔ Cloud 需要共享的稳定消息。

不要把所有内部 class 都 proto 化。

### 13.2 单一 wire source

```text
.proto
→ generated TS
→ generated Python
```

删除重复手写 wire schema；generated code 不允许编辑。

### 13.3 Domain/Wire Mapper

禁止 generated message 直接成为 Memory/Conversation/UI domain object。每个边界建立 mapper。

### 13.4 版本

使用 `package glimmer.<domain>.v1`；遵循 Protobuf field compatibility。不要自造 framing/version manager，除非真实 transport 要求。

---

## 14. 第十二阶段：Apps 与进程拓扑

目标：

```text
apps/
├── desktop/
├── server/
├── cognition-worker/
└── extension-host/
```

### 14.1 Apps 必须薄

Apps 负责 composition/bootstrap/adapters，不把可复用领域逻辑复制在 Desktop/Server 两边。

### 14.2 Cognition Worker

明确 Python worker 的启动入口、健康检查、IPC、shutdown/cancel、streaming。不要因为 Python 进程存在就复制一个独立架构树。

### 14.3 RuntimeNode

建立 local-main/cloud-main 等 node descriptor，Service/Capability Router 根据可用性、信任、执行目标路由。

### 14.4 Local/Cloud/Hybrid

搜索所有 `if local / if cloud / if hybrid` 业务分叉。能由 node/service availability 解决的必须改为 topology-driven composition。

---

## 15. 第十三阶段：Hybrid State Authority

这是重构验收的必查项，不要只解决“能连上”。

为每个 durable aggregate 写明：

```text
Owner module
Authority node / single writer rule
Revision/version
Replication/cache behavior
Offline behavior
Conflict policy
Idempotency strategy
```

至少覆盖：Conversation Log、Memory、Persona、Job State、Config/Extension State。

优先单权威 + replica/cache；不要默认 last-write-wins；append-only log 与 mutable state 使用不同同步策略。

---

## 16. 第十四阶段：数据与兼容迁移

不要直接删除旧存储/字段。

对每类 state：

1. 明确 canonical owner；
2. 编写 migration reader/writer；
3. 新旧双读或一次性迁移（按风险选择）；
4. 用 version 标识 schema；
5. 增加 fixture 回归测试；
6. 新路径稳定后再删除 legacy path。

特别检查：Conversation history、Memory、Persona、tool registry cache、job state、extension settings、assets。

---

## 17. 第十五阶段：最终架构 Enforcement

必须让 CI 自动防止回退。

最终至少具有：

- dependency graph/layer test；
- circular import test；
- vendor keyword/import leakage test；
- public/internal import enforcement；
- Extension SDK compatibility test；
- manifest schema test；
- proto generation/compatibility test；
- no duplicate wire contract test；
- generated source clean check；
- unit/integration tests for Turn/Tool/Job/Extension flows。

逐步删除 audit 阶段的 legacy exception list，最终应接近空。

---

## 18. 重点实现链路验收

### 18.1 普通对话

```text
Adapter → Content/Message → Conversation Turn → Context → Step → Response → Log → Output
```

### 18.2 Tool

```text
Step → ToolCall → Exposure/Policy → Router/Target/Executor → Result → next Step
```

### 18.3 Job

```text
Request/Event → Job persistent state → Scheduler/Trigger → Handler → Completion/Event
```

### 18.4 External platform

```text
QQ/Discord/... payload
→ Extension Adapter
→ generic Content + Conversation binding
```

核心不能知道平台名字。

### 18.5 Embodiment

```text
ExpressionIntent → semantic EmbodimentState → renderer extension
```

### 18.6 Hybrid

```text
same core modules + different RuntimeNode placement
```

不存在独立 Hybrid business implementation。

---

## 19. 代码质量与命名要求

优先使用精确职责名：Registry、Catalog、Resolver、Router、Assembler、Projection、Store、Repository、Scheduler、Executor、Provider、Adapter、Host。

谨慎/禁止：Manager、Utils、Misc、Shared、Common、Runtime（无上下文）、EverythingService、CapabilityRegistry<any>。

任何新 abstraction 必须回答：

```text
What state does it own?
What lifecycle does it own?
Who consumes its public API?
Why can it not belong to an existing module?
Does it reduce coupling?
```

答不上来就不要新增模块。

---

## 20. 每个阶段的 Codex 输出格式

每个阶段先计划，再改代码；完成后输出：

1. 发现的问题；
2. 本阶段架构决策；
3. 修改文件列表；
4. 新/变更 public API；
5. 数据迁移影响；
6. 删除/保留的 legacy compatibility；
7. 运行的 lint/typecheck/test 命令与结果；
8. 剩余架构违规；
9. 下一阶段建议。

不要说“以后再做”而没有记录为明确 issue/TODO；不要删除尚有调用方的旧路径。

---

## 21. 最终验收清单

- [ ] root-level 已收敛为 `core / extension-sdk / apps / protocol / docs`；
- [ ] `core` 内模块为 `platform/content/conversation/cognition/capabilities/jobs/embodiment`；
- [ ] 旧 root-level cognition/content/capabilities/embodiment 已迁移或兼容关闭；
- [ ] Platform 不依赖高层模块；
- [ ] Message 已从 Content 移入 Conversation；
- [ ] Runtime Session 与 Conversation 已分离；
- [ ] Turn 与 Cognition Step 已分离；
- [ ] Conversation Log 是 canonical source，History 是 projection；
- [ ] `skill_request`/Dialogue-Agent 前置分类已移除；
- [ ] 固定 agent_plan/agent_synthesis 流水线已替换为 iterative loop；
- [ ] SkillActionController 或等价 God Controller 已拆分；
- [ ] Context/Memory/Persona/Perception/Attention 职责清楚；
- [ ] 没有为了结构完整保留空 Knowledge/Reasoning/Orchestration；
- [ ] Content 全部 vendor-neutral，支持 AssetRef；
- [ ] Tool/Skill/Resource Registry/Catalog 分离；
- [ ] Capability Exposure 不会无脑暴露全部工具；
- [ ] Durable background work 已统一为 Job 语义；
- [ ] Job 与 Turn Loop 不混淆；
- [ ] Live2D/VRChat 等已隔离为 Renderer/Extension；
- [ ] Extension 只依赖 SDK/public contracts；
- [ ] Extension Host 保持独立，权限逐步 broker 化；
- [ ] MCP 只作为 bridge；
- [ ] `.proto` 是 wire single source；
- [ ] Domain code 不依赖 generated protobuf object；
- [ ] `apps/cognition-worker` 明确；
- [ ] Local/Cloud/Hybrid 使用同一 Core；
- [ ] durable aggregates 有明确 Authority/Revision/Conflict policy；
- [ ] architecture tests 能阻止 vendor leakage、deep import、反向依赖；
- [ ] 没有新增 common/shared/utils/runtime/services/managers 垃圾桶；
- [ ] build、lint、typecheck、unit/integration tests 通过。

---

## 22. 推荐提交顺序

不要一次性重写。推荐独立、小步、可回滚的提交序列：

```text
01 architecture audit + guardrails
02 core/platform extraction
03 core/content normalization + AssetRef
04 core/conversation extraction
05 cognition loop/context/memory/persona cleanup
06 capabilities registry/exposure/execution split
07 durable jobs extraction
08 embodiment semantic abstraction
09 extension-sdk + vendor isolation
10 MCP normalization
11 protobuf wire contracts + mappers
12 apps/process composition + cognition-worker
13 topology + hybrid state authority
14 storage/data migrations
15 remove legacy paths
16 strict architecture tests + final docs
```

每个提交都必须保持可编译/可测试。若迁移必须跨多个提交，使用 compatibility facade，不允许长时间形成两个永久真相源。

---

## 23. 最终完成状态

重构完成后，项目应具备以下性质：

- 任何具体平台/模型/渲染实现都可以拔掉，Core 仍然完整；
- 普通聊天与 agentic tool use 是同一 Cognition Loop 的不同深度；
- Conversation、Memory、Persona、Job、Embodiment 各有唯一状态所有权；
- 外部平台输入统一转为 Content/Conversation，外部能力统一通过明确 contract 接入；
- Local/Cloud/Hybrid 只改变部署图，不改变领域代码；
- Extension Host 故障不会拖垮主进程；
- TS/Python 边界由 versioned protobuf wire schema 管理；
- 架构规则被 CI 自动执行，而不是依赖开发者记忆；
- 后续增加 QQ、其他社交平台、新模型、新 TTS、新 Avatar、新 MCP Server 时，不需要修改核心领域类型。

如果现有实现的某个局部方案经过验证明显优于本提示词的具体实现建议，可以保留更好的实现，但**不得违反 Architecture Baseline v2.0 的模块所有权、依赖方向、第三方隔离、状态单一所有者与 public boundary 原则**；偏离必须在最终报告中明确说明并记录 ADR。

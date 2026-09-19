# Glimmer Cradle（微光摇篮）最终冻结架构规范

版本：Architecture Baseline v2.0 (Frozen)  
状态：**最终冻结；取代 Architecture Baseline v1.0**  
用途：作为 Glimmer Cradle 后续代码组织、重构、评审、扩展、协议设计、部署与长期演进的唯一架构基线。

---

## 1. 冻结声明与适用范围

本文件冻结的是**长期架构边界与依赖规则**，不是要求一次性创建全部目录，也不是冻结具体实现技术。

本次冻结后，以下内容视为稳定架构决策：

1. 仓库根级只保留 `core / extension-sdk / apps / protocol / docs`；
2. 产品本体采用 **Layered Modular Core**，核心模块统一收敛到 `core/`；
3. `core` 内固定七个长期模块：`platform / content / conversation / cognition / capabilities / jobs / embodiment`；
4. 所有第三方平台、模型厂商、渲染器、外部协议实现必须通过 Extension/Provider/Adapter 进入；
5. 本地、云端、混合属于运行拓扑，不形成三套领域代码；
6. TypeScript / Python 是实现语言与进程边界，不决定领域边界；
7. `.proto` 只定义跨语言/跨进程 wire contract，不能替代内部 domain model；
8. 以后新增一级 Core 模块必须满足严格的架构提升条件，不能因为“概念重要”就平铺。

冻结不限制：模型、数据库、向量库、TTS/ASR、渲染技术、具体 UI 框架、具体 transport 的替换。

---

## 2. 架构目标与非目标

Glimmer Cradle 是面向单用户长期运行的持续型 AI 角色/数字伴侣系统。架构需要同时支持：

- 本地独立、云端独立、本地+云端混合；
- TypeScript 主机侧与 Python Cognition Worker 协作；
- 普通聊天、情绪陪伴、长期记忆、多步工具调用、后台工作；
- 文字、图片、音频、视频、文件等通用内容；
- Live2D、Q 版、VRM、3D、VRChat 等可替换具身实现；
- Skills、Tools、Resources、MCP、第三方扩展；
- 长期稳定的 Persona、Relationship、Memory 与 Conversation continuity；
- 未来模型、语音、Avatar、交互平台全部更换后仍无需推翻顶层结构。

非目标：

- 不把项目做成通用 Agent Framework；
- 不为了形式对称建立 `Self / Character / World / Agency / Presence` 等哲学模块；
- 不为了“高级架构”提前微服务化；
- 不建立 Local/Cloud/Hybrid 三套代码；
- 不将所有外部系统抽象成一个万能 Provider/Registry；
- 不让第三方名称进入核心领域类型。

---

## 3. 最终仓库根级结构

```text
glimmer-cradle/
├── core/
├── extension-sdk/
├── apps/
├── protocol/
└── docs/
```

根级目录只表达五种真正不同的仓库边界：

- `core`：Glimmer 自身 vendor-neutral 的产品核心；
- `extension-sdk`：向外部扩展公开、可版本化的稳定 API/Contribution boundary；
- `apps`：可以实际启动的 composition roots；
- `protocol`：跨语言、跨进程、跨节点的 wire contract；
- `docs`：架构、协议、开发和迁移文档。

**不再允许**把 `cognition / content / jobs / capabilities / embodiment` 等继续提升到仓库根级。它们是 Core 内的 bounded modules，而不是五个独立产品。

---

## 4. Core：Layered Modular Core

### 4.1 最终结构

```text
core/
├── platform/
├── content/
├── conversation/
├── cognition/
├── capabilities/
├── jobs/
└── embodiment/
```

`core` 不是“杂物目录”，而是产品本体的命名空间。七个模块具有不同职责、数据所有权和依赖约束，但共同属于 Glimmer 的 vendor-neutral 核心。

### 4.2 为什么不是继续平铺仓库根目录

独立生命周期、独立状态所有权意味着需要**模块边界**，不意味着必须占据仓库一级目录。目录层级负责组织，模块 API 与依赖规则负责真正隔离。

### 4.3 Core 模块提升规则

未来只有同时满足大部分以下条件，才允许新增新的 `core/<module>`：

- 有独立 canonical state ownership；
- 有独立生命周期；
- 有明确且稳定的 public API；
- 有多个独立消费者；
- 无法自然归属现有七个模块；
- 提升后能减少耦合，而不是只增加概念层级；
- 已有真实实现需求，而不是为未来猜测预建。

`knowledge / world / presence / interaction / agent / workflow / audio` 等名称不得仅因“重要”而提升为 Core 一级模块。

---

## 5. core/platform：运行底座

### 5.1 职责

`platform` 只负责整个产品都可依赖的低层机制，不拥有任何 Cognition、Tool、Persona、Avatar 或第三方业务语义。

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

### 5.2 Kernel

Kernel 必须保持小而稳定，只处理：

- service registration/resolution；
- composition primitives；
- lifecycle coordination；
- scoped service context。

Kernel 禁止知道：LLM、Memory、Tool、Skill、Persona、Live2D、QQ、OpenAI、VRChat 等概念。

### 5.3 Scope

Scope 表达可见性、生命周期和上下文，不等于安全沙箱。推荐以 typed facets 表达：

- runtime node；
- runtime session；
- user；
- extension；
- execution target；
- authority/permission context。

不要用深层 class inheritance 构造 Scope 类型树。

### 5.4 Events / Streams / Durable Log 三分法

三类通信必须严格区分：

- **Durable fact**：需要重启后重建产品事实，例如 conversation message、tool result、job lifecycle event；
- **Live event**：运行期事实通知，例如 extension loaded、node health changed；
- **Stream**：连续高频数据，例如 LLM token、PCM、ASR partial、lip-sync signal。

通信选择：

```text
明确一对一请求/响应 → Service Call
事实通知/多订阅者     → Event
连续高频数据          → Stream
需要重建历史的事实     → Durable domain log
```

禁止把 Event Bus 当所有组件通信的唯一通道。

### 5.5 Topology

`platform/topology` 只描述运行节点与服务位置：

```text
RuntimeNode
NodeId
ServiceLocation
ConnectivityState
TrustLevel
ExecutionLocation
```

典型节点：`local-main`、`cloud-main`、未来可能的 `phone`。位置是 topology，不是 architecture。

### 5.6 Time

Core 只提供 Clock、Timer、Deadline、Monotonic Time 等时间 primitive。长期工作调度不属于 Platform，而属于 Jobs。

### 5.7 Security

`platform/security` 负责底层安全 primitive：

- identity / principal；
- authorization primitive；
- permission；
- trust；
- credential access boundary；
- approval primitive。

具体 Tool 的危险操作策略属于 `capabilities/execution`；Extension 权限声明属于 `extension-sdk`。

### 5.8 Observability

统一关联：

- trace id；
- conversation id；
- turn id；
- cognition step id；
- tool call id；
- job id；
- extension id；
- runtime node id。

要求 structured logs、metrics、traces 与 cause chain，不用字符串拼接替代可观测上下文。

---

## 6. core/content：通用信息模型

### 6.1 目标

Content 定义“系统中流动的信息是什么”，而不是“来自哪个平台”。

```text
core/content/
├── text/
├── image/
├── audio/
├── video/
├── file/
└── asset/
```

典型公共类型：

```text
ContentPart
TextContent
ImageContent
AudioContent
VideoContent
FileContent
AssetRef
```

### 6.2 Message 不属于 Content

Message 是包含 actor、时间、conversation、content parts 的交互 envelope，因此归 `core/conversation/message`。Content 本身保持纯粹。

### 6.3 AssetRef

大体积图片、音频、视频和文件不得长期以 base64 内联在日志、数据库或 protobuf 中。统一使用 `AssetRef`：

```text
AssetRef
├── assetId
├── mediaType
├── size?
├── checksum?
└── optional locator capability/reference
```

Content 只拥有引用语义；实际存储可以是本地文件、缓存、对象存储或远程节点。

### 6.4 Vendor 数据隔离

Core 中禁止出现：

```text
QQImage
DiscordAttachment
TelegramPhoto
VRChatAsset
OpenAIFile
```

平台 Adapter 必须先转换为通用 Content。Vendor-specific metadata 只能保留在 Extension 自有数据或 opaque provenance/sidecar 中，Core 不解释。

### 6.5 多模态与 Content 的关系

`multimodal` 是能力特征，不是底层数据命名空间。Text/Image/Audio/Video/File 才是稳定数据语言。

ASR/TTS/图像理解等处理能力不得因为处理 Audio/Image 就塞进 Content；其 provider contract 应由真正的消费领域或扩展贡献面拥有。

---

## 7. core/conversation：持久交互事实

### 7.1 职责

Conversation 独立于 Cognition，因为历史展示、分页、搜索、跨端恢复和外部 thread 绑定即使不启动模型也成立。

```text
core/conversation/
├── message/
├── turn/
├── log/
├── history/
└── binding/
```

### 7.2 Conversation 与 Runtime Session

必须区分：

- **Conversation**：可长期持久存在的交互序列；
- **Runtime Session**：一次进程/客户端/连接运行期间的作用域，属于 Platform Scope/Host state。

程序关闭可以结束 Runtime Session，但 Conversation 继续存在。禁止再把二者混用同一个 `Session` 名称。

### 7.3 Turn 与 Step

- `Turn`：一次外界输入引起的完整交互周期，属于 Conversation；
- `Step`：一次模型推理步骤，属于 Cognition Loop。

```text
Turn
├── Step 1 → ToolCall
├── Step 2 → ToolCall
└── Step 3 → FinalResponse
```

### 7.4 Durable Conversation Log

Conversation Log 是交互事实的 canonical source。建议持久：

- user/actor message；
- assistant message；
- model-visible tool call/result；
- turn begin/end；
- explicit interruption/cancellation；
- 与交互语义直接相关的 durable observation。

不持久高频 token、PCM、avatar frame、鼠标移动。

原则：**任何未来需要重建模型可见历史的重要事实，应当能够从 durable log 或其引用中恢复。**

### 7.5 History 是 Projection

`history` 是从 canonical log 派生的 read model/projection/cache，不是第二个可独立写入的真相源。

### 7.6 Binding

`binding` 负责将外部 endpoint/thread 与内部 Conversation 关联。核心只保存 opaque reference：

```text
EndpointRef
ExternalThreadRef
ActorRef
```

不得在 Core 中出现 `qqGroupId`、`discordGuildId` 等平台字段。

---

## 8. core/cognition：认知系统

### 8.1 最终结构

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

不预建 `knowledge / reasoning / orchestration / working-memory` 等模糊目录，只有真实职责出现后才允许提取。

### 8.2 非 Agent-centric

普通聊天与工具调用使用同一个 Turn/Cognition loop。不存在用户可见的 Agent Mode，也不使用单独 LLM 分类器先判断“Dialogue 还是 Agent”。

```text
普通聊天：Turn → Step → Response
工具调用：Turn → Step → ToolCall → Observation → Step → Response
```

Agentic behavior 只是 Cognition Loop 在需要行动时自然延长。

### 8.3 Inference

`inference` 拥有模型推理 contract：

```text
ModelRequest
ModelResponse
ModelCapabilities
InferenceProvider
StreamingResponse
```

OpenAI、Anthropic、Gemini、Qwen、Ollama 等只能作为 Provider 实现，不能进入核心 model type。

### 8.4 Context

Context 只回答：**当前这个 Step 的模型应该看到什么。**

推荐流程：

```text
collect → retrieve → filter → rank → budget → order → assemble → project
```

Context Contributor 可以来自：

- Persona；
- Conversation projection；
- Memory；
- Resource；
- Skill guidance；
- current Tool Surface；
- selected Observation；
- Runtime operational context。

建议 Context Fragment 保留：source、semantic role、authority/trust、priority、scope、freshness、provenance、token cost、placement、content。

**Authority/Trust 与 Priority 必须分开。** 外部网页、文件、ToolResult 不得覆盖 canonical persona/system policy。

### 8.5 Memory

Memory 属于 Cognition 的长期经验能力。逻辑上可区分：

- episodic；
- semantic；
- relationship；
- retrieval；
- consolidation；
- store。

不要为了理论完整性强制创建一堆空目录。

Memory write path：

```text
conversation/event
→ candidate extraction
→ policy / dedup / importance
→ durable memory
→ optional consolidation
```

模型不得直接无审核修改 canonical Persona。

### 8.6 Persona

Persona 是参与认知的稳定资料，不是 CharacterController/Self Runtime。

逻辑内容包括：identity、personality、behavior、stable relationship definition、examples。外部 Character Card 仅作为 Import Format，导入后转为 canonical persona data。

动态关系历史属于 Memory；稳定关系定义属于 Persona。

### 8.7 Perception 与 Attention

外部屏幕、麦克风、系统状态、时间、任务结果、Extension event 等先规范化为 Observation，再由 Attention/Relevance Gate 决定是否值得进入 Cognition。

```text
Source → Observation → Attention → Context / Trigger
```

禁止“任何环境变化都直接触发一次 LLM”。

### 8.8 Loop / Step

Cognition Loop 只处理语义推进：

```text
Context
→ Inference Step
→ FinalResponse | ToolCall | JobRequest | Continue
→ Observation
→ next Step
```

必须支持 max steps、max tool calls、timeout、token/cost budget、cancellation。

---

## 9. core/capabilities：系统可以做什么

### 9.1 最终结构

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

### 9.2 Tool

Tool 是结构化可执行动作。核心公共语义：

```text
ToolDefinition
ToolCall
ToolResult
ToolProvider
```

Native/Extension/MCP/Remote 只能作为 provenance/source，不形成不同 Tool type。

### 9.3 Skill

Skill 是“如何完成某类工作的可复用方法/知识/流程包”，不是 Tool 的父类。Skill 与 Tool 多对多。推荐支持 `SKILL.md + scripts/references/assets` 与 progressive disclosure。

### 9.4 Resource

Resource 表达可读取、可引用、可提供给 Context 的内容来源。它不是 Memory，也不自动等于 Knowledge Base。

### 9.5 不建立万能 Registry

每类 capability 拥有自己的注册语义：

```text
tools/registry
skills/catalog
resources/registry
```

禁止使用一个 `Registry<any>` 或 `CapabilityRecord` 承载所有类型。

### 9.6 Exposure / Tool Surface

Registry 中“存在”不等于每个 Step 都“暴露给模型”。Exposure 负责从大 Registry 中构建小型 Tool Surface。

建议状态：

```text
DIRECT
DEFERRED
HIDDEN
```

支持工具搜索/延迟加载。不要把几百个完整 schema 每轮注入模型上下文。

### 9.7 Execution

执行路径：

```text
ToolCall
→ execution policy
→ router
→ target
→ executor
→ normalized ToolResult
```

Execution 决定“怎么安全执行”，Cognition 决定“是否调用”。

### 9.8 Policy 所有权

Platform Security 提供底层权限 primitive；Capabilities Execution Policy 负责 Tool/Action 级别的 confirmation、danger level、target restrictions、audit。

---

## 10. core/jobs：跨时间存在的工作

### 10.1 为什么是 Job 而不是 Task

`Task` 在 AI、async、workflow 中过于多义。这里定义的是可持久化、可调度、可恢复、可取消、可能脱离当前 Turn 的后台工作，因此统一使用 `Job`。

```text
core/jobs/
├── trigger/
├── scheduler/
├── persistence/
├── recovery/
└── cancellation/
```

### 10.2 Job 与 Turn 的边界

- 当前交互中的多步工具调用：继续属于 Cognition Loop；
- 只有需要 later / scheduled / persistent / resumable / long-running 时才创建 Job。

### 10.3 Job 不拥有业务能力

Jobs 管理时间与生命周期，不重新定义 Tool/Skill/Cognition。Job Handler 通过公开 Port/Composition 使用需要的能力。

避免 `jobs → cognition implementation` 的强耦合。需要 Cognition 的 Job 由 composition/adapters 连接公开接口。

### 10.4 Trigger

Trigger 可以来自时间、durable event、外部 webhook/extension event 或显式请求，但 Trigger 只声明何时唤醒，不夹带平台具体类型。

---

## 11. core/embodiment：具身语义

### 11.1 最终结构

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

### 11.2 稳定语义

Core 只定义：ExpressionState、PoseState、GazeTarget、MotionIntent、GestureIntent、LipSyncState、EmbodimentRenderer 等通用语义。

禁止把 Live2D 参数、VRM blendshape、VRChat expression parameter 写入核心类型。

### 11.3 Renderer

Live2D、Sprite、VRM、Unity、VRChat 都是 Renderer/Bridge Extension。核心只发语义状态或 intent。

### 11.4 Speech 与 Lip-sync 分离

TTS/ASR 属于语音能力/Provider；Embodiment 只关心 speaking state、phoneme/viseme timing、lip-sync signal 等身体表现。

---

## 12. extension-sdk：唯一正式扩展边界

### 12.1 最终结构

```text
extension-sdk/
├── manifest/
├── api/
├── contributions/
├── lifecycle/
├── permissions/
└── compatibility/
```

### 12.2 依赖方向

```text
Core public contracts
        ↑
Extension SDK
        ↑
Third-party Extension
```

Core **绝不能依赖 extension-sdk**。SDK 只是把允许给外部代码使用的稳定 contract 重新组织为公共开发面。

### 12.3 Contribution Model

Extension 可按需贡献：

- Model/Inference Provider；
- Tool Provider；
- Skill Package；
- Resource Provider；
- Conversation Endpoint Adapter；
- Observation Source；
- Speech/Content processing Provider；
- Embodiment Renderer/Bridge；
- UI Contribution；
- Job Trigger/Handler；
- MCP Bridge。

每个 contract 应由真正拥有语义的 Core module 定义，Extension SDK 只公开允许使用的表面，避免 SDK 自己成为第二套领域模型。

### 12.4 Manifest

至少声明：

```text
id
version
apiVersion
entrypoint
permissions
contributions
compatibility
```

### 12.5 Extension Host 与安全

独立进程是隔离层，但不等于 Sandbox。最终模式应是：

```text
Extension
→ Extension Host
→ Brokered Host API
→ Core/Capabilities
```

扩展默认不能直接获得整个文件系统、任意网络、全部 secret 或系统进程权限。支持 disable/restart/quarantine。

### 12.6 第三方命名禁区

`core/**` 中禁止出现 QQ、Discord、Telegram、OpenAI、Anthropic、Gemini、VRChat、Live2D、GitHub、CosyVoice 等作为领域类型/枚举值。允许出现在 tests、fixtures、docs、extensions/provider implementation。

---

## 13. MCP 的最终定位

MCP 是外部互操作协议，不是 Glimmer 内部 Capability 类型。

```text
MCP Client Bridge
→ Tool      → core/capabilities/tools
→ Resource  → core/capabilities/resources
→ Prompt    → cognition context/prompt contribution
```

保留 provenance，但 Cognition 消费统一的 Tool/Resource/Context contribution。

不允许 `MCPTool` 在核心业务流里长期传播。

---

## 14. apps：Composition Roots

```text
apps/
├── desktop/
├── server/
├── cognition-worker/
└── extension-host/
```

Apps 负责启动、组合、进程 wiring 和 adapter bootstrap，不拥有可复用核心领域逻辑。

### 14.1 Desktop

组合本地 Platform、Conversation/Content、Capabilities、Embodiment、UI、Cognition client/local worker、Extension Host client。

### 14.2 Server

组合云端常驻服务、durable stores、Cognition worker、Capabilities/Jobs、Extension Host；不假定存在显示器、麦克风或 Avatar renderer。

### 14.3 Cognition Worker

Python 可执行进程，承载 `core/cognition` 的 Python 实现与必要 adapter。逻辑架构仍属于 Core，不因为语言而另造一个领域。

### 14.4 Extension Host

独立 Node/TS 进程，负责扩展发现、验证、加载、生命周期、权限桥接、贡献注册和故障隔离。

---

## 15. protocol：Wire Boundary

### 15.1 最终结构

```text
protocol/
└── proto/
    └── glimmer/
        ├── cognition/v1/
        ├── capabilities/v1/
        ├── content/v1/
        ├── conversation/v1/
        └── embodiment/v1/
```

不预建 `framing/` 或自创 versioning runtime。若使用 gRPC/IPC，其 framing 由 transport 实现承担。

### 15.2 Contract / Wire / Transport 三层

```text
Domain/Public Contract
        ↕ mapper
Wire Schema (.proto)
        ↓ generated TS/Python
Transport (IPC/gRPC/WebSocket/...)
```

`.proto` 是跨语言 wire contract 的唯一真相源，但不是整个项目 domain model 的真相源。

### 15.3 版本

使用 protobuf package namespace 明确主版本：

```text
package glimmer.cognition.v1;
```

遵循 additive-first 演进：新增 optional field 优先，避免复用 field number，breaking change 升 major package。

### 15.4 禁止重复手写

禁止同时手写 `turn.ts + turn.proto + turn.py` 三份跨语言 schema。Generated code 不允许人工修改，Domain 与 Wire 通过 mapper 隔离。

---

## 16. 逻辑依赖方向

推荐底层关系：

```text
platform
   ↑
content
   ↑
├── conversation
├── capabilities
├── jobs
└── embodiment

cognition
├── depends on conversation public API
├── depends on capabilities public contracts
├── depends on jobs public contracts when scheduling is needed
├── depends on embodiment intent contracts when expression is needed
├── depends on content
└── depends on platform primitives
```

核心禁止：

```text
platform      → cognition          ❌
content       → cognition          ❌
conversation  → cognition          ❌
capabilities  → cognition/internal ❌
jobs          → cognition/internal ❌
embodiment    → cognition/internal ❌
core          → extension-sdk      ❌
core          → vendor package     ❌
```

跨模块协作只能使用 public contracts/ports，不允许 import 对方 internal implementation。

---

## 17. Public API / Internal API 规范

每个 Core 模块必须明确 Public Surface：

```text
public contract
internal implementation
adapter/infrastructure
```

可通过 package exports、Python package API、lint rule 或目录约定实现。Extension 只能访问 Extension SDK；Core 模块之间也优先访问对方 public API。

禁止：

- 导入别的模块 `internal/*`；
- 通过深路径绕过 package exports；
- 把数据库实体、ORM model、generated protobuf class 当 public domain type；
- 为了省事共享 mutable singleton state。

---

## 18. 状态所有权与持久化

Canonical state 必须有唯一 Owner：

```text
Conversation log          → core/conversation
Conversation history view → projection only
Memory                    → core/cognition/memory
Persona canonical data    → core/cognition/persona
Tool/Skill/Resource defs  → core/capabilities respective registries
Job state                 → core/jobs
Embodiment live state     → core/embodiment (usually transient)
Node topology             → core/platform/topology
Extension manifest/state  → extension-host / extension-owned namespace
Asset reference semantics → core/content/asset
```

禁止两个模块共同写一个 canonical store。

ORM/table/storage technology 是 adapter，不是状态所有权本身。

---

## 19. Local / Cloud / Hybrid 与 State Authority

### 19.1 同一架构，不同拓扑

不建立 `local/ cloud/ hybrid/` 三套业务实现。RuntimeNode 宣告 services/capabilities/resources/execution targets/health/trust。

### 19.2 单权威 + 副本原则

单用户、少量节点场景优先：

```text
Durable Aggregate
→ one Authority Node / single writer
→ replicas / caches / journals
```

每个 durable aggregate 至少具备 revision/version、source node、idempotency information。

### 19.3 Append-only 与可变状态

Conversation log 等 append-only data 较容易同步；Memory consolidation、Persona mutation、Job state 等可变 canonical state 使用单 writer 或 optimistic concurrency，禁止简单 last-write-wins 覆盖全部。

### 19.4 Offline

本地离线可写 local journal；恢复连接后通过 event/version/idempotency merge。具体同步算法可以渐进实现，但架构和 wire schema 必须预留版本与来源信息。

---

## 20. 核心运行链路

### 20.1 普通聊天

```text
External Input
→ App/Extension Adapter
→ Content + Conversation Message
→ Turn
→ Cognition Context Assembly
→ Inference Step
→ Final Response
→ Conversation Log
→ Output Adapter
```

### 20.2 Tool 调用

```text
Turn
→ Context
→ Step
→ ToolCall
→ Capability Exposure/Policy
→ Execution Router/Target/Executor
→ ToolResult
→ Conversation durable fact when model-visible
→ next Step
→ Response
```

### 20.3 长期 Job

```text
Turn/Event
→ Job Request
→ Job persistence/scheduler
→ trigger
→ public handler/adapter
→ capability and/or cognition flow
→ durable Job state/event
→ optional Conversation notification
```

### 20.4 Perception

```text
Screen / Mic / System / Extension Event
→ normalized Observation
→ Attention Gate
→ Context or proactive trigger
```

### 20.5 Embodiment

```text
Cognition ExpressionIntent
→ Embodiment semantic state
→ Renderer Extension
→ Live2D / Sprite / VRM / VRChat / future renderer
```

### 20.6 Voice

```text
AudioContent
→ speech recognition provider
→ TextContent / Observation
→ Cognition
→ Text response
→ speech synthesis provider
→ AudioContent
→ lip-sync timing
→ Embodiment
```

Speech provider 不应被强行建模成普通 Tool，尤其在实时语音链路中。

---

## 21. 能力暴露与模型上下文规范

Tool Registry 可以很大，单 Step 的 Tool Surface 必须小。支持：

- direct exposure；
- deferred/tool search；
- hidden/internal capability；
- capability-specific permission filtering；
- node/target availability filtering。

原则：**Registry presence ≠ model visibility。**

Context budget 同理：所有 Persona/Memory/Resource 都可以存在，但不等于同时进入 Context。

---

## 22. 命名规范

推荐术语：

- `Core`：产品核心命名空间；
- `Platform`：共享运行底座；
- `Kernel`：最小 service/lifecycle/composition 核；
- `Runtime`：只用于明确运行态组件，例如 ModelRuntime，不做万能目录；
- `Host`：承载/组合组件的可执行进程；
- `Provider`：某 contract 的实现来源；
- `Adapter`：边界转换；
- `Registry`：注册与查找；
- `Catalog`：可发现定义集合；
- `Resolver`：解析引用；
- `Router`：选择目标；
- `Assembler`：组装多来源信息；
- `Projection`：从 canonical log/state 派生的 read model；
- `Store/Repository`：持久访问；
- `Executor`：执行；
- `Job`：跨时间持久工作。

谨慎或禁止泛化：`Manager / Utils / Misc / Shared / Common / World / Ecosystem / Runtime(顶级无上下文) / Registry<any>`。

---

## 23. 第三方与平台无关规范

禁止 closed-world 平台枚举：

```text
type Platform = 'qq' | 'discord' | 'vrchat'  ❌
```

使用开放引用和 capability negotiation：

```text
ExtensionId
EndpointId
ExternalThreadRef
OriginRef
CapabilityId
```

只有在多个实现长期共享稳定语义后才提升核心抽象：**Extract abstraction only after semantic convergence.**

---

## 24. Extension 治理与安全

Extension Manifest 声明 permissions、contributions、apiVersion、compatibility。加载流程：

```text
discovery
→ manifest validation
→ compatibility check
→ permission/trust evaluation
→ isolated load
→ contribution registration
→ health supervision
```

Extension Host 崩溃不得拖垮 Desktop/Server 主进程。支持 timeout、restart、disable、quarantine。

Secret 使用 brokered credential handle，不把全部秘密直接注入 Extension 进程。

---

## 25. 架构测试与自动约束

必须将架构变成可执行规则，而不是只写在文档中。建议建立：

- dependency direction test；
- forbidden deep import test；
- vendor leakage test；
- extension public API compatibility test；
- protobuf duplicate/manual schema test；
- generated-code modification check；
- circular dependency check；
- canonical state ownership review；
- protocol compatibility test；
- Extension manifest schema test。

CI 中至少运行 lint、typecheck、unit test、architecture test、proto compatibility/generation check。

---

## 26. 渐进式实现原则

目录树是 Architecture Namespace Map，不是空目录清单。

1. 先固定 contract 与依赖，再移动实现；
2. 不创建没有真实代码的装饰性目录；
3. 一个逻辑子模块只有在职责/实现数量足够时再物理拆分；
4. 每个迁移阶段保持 build/test 可用；
5. 先增加新路径并切流，再删除旧路径；
6. 不为了和文档字面一致而降级已有更优实现；
7. 任何偏离必须记录 ADR/架构说明。

---

## 27. 明确禁止事项

长期禁止：

- `SelfManager / CharacterController / AssistantManager / AgentManager` God Object；
- `SkillActionController` 同时承担规划、策略、执行、合成与发布；
- `skill_request` 之类前置 LLM Agent/Dialogue 分类器；
- Kernel 内做 semantic planning / response synthesis；
- 所有通信都塞 Event Bus；
- 所有长期信息都塞 Memory/Knowledge；
- Content 中出现平台特有 Message/Attachment 类型；
- Core 中出现具体 vendor/platform enum；
- Live2D 参数进入 Embodiment semantic model；
- MCP 类型在内部业务层传播；
- Local/Cloud/Hybrid 三套逻辑；
- generated protobuf class 作为领域实体；
- 手写重复 TS/Python wire schema；
- Extension 穿透 SDK import Core internal；
- 无限制的 `common/shared/utils/runtime/services/managers` 垃圾桶目录；
- 为理论完整性提前构建 Knowledge/Workflow/World 等空系统。

---

## 28. 从 v1.0 到 v2.0 的冻结变更

本版本明确取代此前 v1.0：

```text
旧：root/core                  → 新：core/platform
旧：root/content               → 新：core/content
旧：root/cognition             → 新：core/cognition
旧：root/capabilities          → 新：core/capabilities
旧：root/embodiment            → 新：core/embodiment
旧：cognition/conversation     → 新：core/conversation
旧：capabilities/tasks         → 新：core/jobs
旧：content/message            → 新：conversation/message
旧：content/metadata           → 删除，改为明确 provenance/annotation/opaque extension data
旧：cognition/knowledge        → 暂不建独立系统，使用 Resource/Context Source
旧：cognition/reasoning        → 暂不预建
旧：cognition/orchestration    → cognition/loop
旧：memory/working             → 暂不预建，避免与 Context/Conversation 重叠
旧：embodiment/speech          → embodiment/lip-sync
旧：core/services              → platform/kernel/service primitives
旧：core/scheduling            → jobs/scheduler；Platform 仅保留 time primitive
旧：core/policy                → platform/security + capabilities/execution/policy
旧：protocol/versioning/framing→ 简化为 versioned proto namespace + transport-owned framing
旧：apps 缺少 Cognition Worker → 新增 apps/cognition-worker
```

---

## 29. 最终验收标准

- [ ] 仓库根级只有 Core/Extension SDK/Apps/Protocol/Docs 等真实边界；
- [ ] Core 内七个固定模块职责明确；
- [ ] Platform 不依赖任何产品高层模块；
- [ ] Content 完全平台无关并支持 AssetRef；
- [ ] Conversation 与 Runtime Session 不混用；
- [ ] Conversation Log 是 canonical fact source，History 是 projection；
- [ ] Turn 与 Cognition Step 分离；
- [ ] Cognition 无 Agent/Dialogue 前置模式分类；
- [ ] Memory/Persona/Context 边界明确；
- [ ] Perception 先形成 Observation，再经 Attention Gate；
- [ ] Tool/Skill/Resource 各自有明确 registry/catalog，不存在万能 Registry；
- [ ] Tool Surface 支持小范围、延迟暴露；
- [ ] Job 仅用于跨时间工作，不替代 Cognition Loop；
- [ ] Live2D/VRChat 等只存在于 Extension/Adapter；
- [ ] Extension 只依赖 Extension SDK/public contracts；
- [ ] Extension Host 独立且使用 brokered API/permissions；
- [ ] MCP 仅是 bridge；
- [ ] `.proto` 是 wire single source，Domain 不依赖 generated type；
- [ ] Local/Cloud/Hybrid 共用同一领域实现；
- [ ] durable state 有明确 Authority/Owner；
- [ ] CI 可以检测非法依赖、vendor leakage、protocol duplication；
- [ ] 不存在为了目录美观建立的大量空 namespace。

---

## 30. 最终心智模型

```text
                       GLIMMER CORE

┌──────────────────────────────────────────────────────┐
│ Platform                                              │
│   how the system runs                                │
├──────────────────────────────────────────────────────┤
│ Content       Conversation      Capabilities          │
│ information   durable dialogue  what can be done      │
│                                                      │
│ Jobs          Embodiment                              │
│ work in time  body semantics                          │
├──────────────────────────────────────────────────────┤
│ Cognition                                             │
│ context · memory · persona · inference · perception  │
│ attention · iterative semantic loop                  │
└──────────────────────────────────────────────────────┘

Extension SDK  = stable public seams
Apps           = executable composition roots
Protocol       = wire boundary
```

“月见”不是其中某一个 Character/Self/Agent 对象，而是 Persona、Memory、Conversation continuity、Cognition、Capabilities、Jobs、Embodiment 与持续运行共同形成的统一主体体验。

---

## 31. 架构变更治理

本版本冻结后，不再因为审美偏好调整顶层结构。未来架构变更必须基于真实工程证据，并记录原因、替代方案、迁移成本与兼容策略。

允许的正常演进：

- 模块内部重构；
- 增加新的 Provider/Adapter/Extension；
- 新增 public contract 的兼容版本；
- 当真实职责成熟时提取二级子模块；
- 在满足 Core 模块提升规则时，经 ADR 审核新增模块。

不允许：仅因为“名字更高级”“看起来更对称”“某个框架这么做”就推翻本基线。

---

## 32. 参考架构依据（仅作设计参考，不形成依赖）

本架构综合吸收但不绑定以下成熟体系的共同原则：

- VS Code：layered/modular core、Platform layer、Extension Host、public extension API；
- DeepSeek Harness / Cordis：service graph、scope、lifecycle、session/tool/loop seam、durable vs live event；
- OpenClaw：capability-specific contracts、plugin ownership、public SDK boundary、provider isolation；
- Microsoft Agent Framework：agent run 与 workflow/long-running state 的边界、provider abstraction；
- Letta：persistent memory/persona/context separation；
- SillyTavern：persona/context source、dynamic context injection；
- MCP：Host/Client/Server 与 Tool/Resource/Prompt interoperability。

Glimmer Cradle 不依赖这些框架作为架构前提；它们仅用于验证设计是否符合成熟社区实践。

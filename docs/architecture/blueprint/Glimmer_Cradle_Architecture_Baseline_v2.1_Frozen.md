# Glimmer Cradle（微光摇篮）最终目标架构 v2.1

> 状态：Frozen；目标设计，尚未整体实现。生效日期：2026-09-21。
> 范围：完整首版的领域、进程、契约、状态、安全、交付与物理结构。
> 依据：用户采纳的重新评估方案及补齐最终物理目录的授权、ADR-0020/0021/0022。
> 维护触发：边界变更须用户决策与 ADR；文件级调整按执行宪章维护目录契约。

本版替代 v2.0-r1 的目标解释。主文定义语义，[物理目录规范](./Glimmer_Cradle_Target_Physical_Layout_v2.1.md)
定义逐文件落点，[目录清单](./architecture-target-v2.1.json) 是物理路径唯一机器事实源。
三者共同构成目标；目录存在、类型检查通过均不等于业务与恢复语义已实现。

## 目录

- [1. 产品与边界](#1-产品与边界)
- [2. 模块与依赖](#2-模块与依赖)
- [3. 物理与进程分工](#3-物理与进程分工)
- [4. Platform](#4-platform)
- [5. Content](#5-content)
- [6. Conversation](#6-conversation)
- [7. Cognition](#7-cognition)
- [8. Capabilities](#8-capabilities)
- [9. Jobs 与 Embodiment](#9-jobs-与-embodiment)
- [10. Extension](#10-extension)
- [11. Protocol 与 Schema](#11-protocol-与-schema)
- [12. 状态、拓扑与恢复](#12-状态拓扑与恢复)
- [13. 完整行为链](#13-完整行为链)
- [14. 工程与成品验收](#14-工程与成品验收)
- [15. 设计依据](#15-设计依据)

## 1. 产品与边界

摇篮是可长期运行、可扩展的角色交互平台，Selrena 是默认角色资料，不是通用领域对象的名字。
Character 由 Persona、认知状态、Memory、Conversation、能力和具身投影协同形成，不建立 CharacterManager 总控对象。
产品必须同时支持文本、多模态、流式语音、跨时间工作、桌面呈现与无桌面 Host。
Local、Cloud、Hybrid 是同一实现的部署拓扑，不分叉三套领域。

主仓库的五个语义根为 `core/`、`extension-sdk/`、`apps/`、`protocol/`、`docs/`。
`tools/`、`configs/`、`.github/`、`.codex/` 和根工程文件拥有明确工程职责；运行数据与构建输出另列，不能解释成“只准五个目录”。
首要原则是产品核心不为具体第三方环境特化，而不是“凡第三方都必须扩展化”。按职责、变化原因、可替换性、分发与生命周期决定实现落点。
本项目的可选消息平台、模型、语音、具体 Renderer、MCP 桥需要独立安装、演进和撤销，因此自然采用独立 Extension 项目。
这不是由厂商身份推出的强制规则，也不代表 SDK 能预先容纳一切未来能力。新增能力应先确认稳定语义与实际消费者。
第一方维护并不赋予绕过已确定的 SDK、权限与生命周期边界的资格。默认安装组合可引用经过验证的扩展制品。
SQLite、序列化、传输库等内部依赖由模块私有 adapter 使用；Electron、操作系统合成接口由 App/platform adapter 使用。
这些实现不因来自第三方就成为 Extension；替换它们不得改变上层领域语义。当前目标不需要另建 `integrations/` 根。

## 2. 模块与依赖

| Core owner | 唯一职责 | 不拥有 |
|---|---|---|
| Platform | 生命周期、scope、时间、身份、安全机制、通信、拓扑、配置机制、可观测性 | 角色策略、模型选取、业务装配 |
| Content | 通用内容 part、资产引用、资产提交与回收 | Message、记忆判断、ASR/TTS 算法 |
| Conversation | binding、Message、Turn、交互接纳、中断、Log、History、投递有效性 | 模型规划与认知循环 |
| Cognition | Persona、state、Memory、Knowledge、Perception、Attention、Context、Inference、Planning、Loop | 平台 IO、密钥、供应商 SDK |
| Capabilities | Tool、Skill、Resource、Speech 契约、Exposure、Execution journal | 认知计划、长期工作调度 |
| Jobs | trigger、调度、租约、持久执行、取消与恢复 | 目标含义、每一次普通 async 调用 |
| Embodiment | 身体状态、表达、动作、视线、口型与渲染能力契约 | Unity、Live2D 或其他具体渲染参数 |

静态依赖：Platform 不依赖其他 Core；Content 可依赖 Platform；Conversation、Capabilities、Jobs、Embodiment
可消费 Platform/Content 的公开 API，但彼此不互相引用内部实现。Cognition 可消费这些模块的公开模型或消费方定义的 port。
跨语言调用必须经过 wire mapper，不能用重新手写跨进程 DTO 代替 Contract Spine。
Core 不导入 Apps、SDK、Protocol 生成类或扩展包。协议映射、跨模块接线位于 Apps；领域私有持久化 adapter 可归领域包。
SDK 的公开 DTO 由映射隔离，不打包 Core 私有实现；扩展只依赖 SDK 与明确导出的协议 SDK，不 deep import Core。

Conversation 定义 `TurnProcessorPort`，App 将其绑定到 Cognition 的公开入口。
因此运行时 Conversation 可请求认知处理，静态图不出现 Conversation → Cognition → Conversation 环。
Jobs 的 handler、Cognition 的 capability/inference/resource port 同样由 App 装配；禁止 service locator 隐藏循环。
公开 API 由包 exports / Python `__init__.py` 明确限定，内部跨文件重构不扩大公开表面。

## 3. 物理与进程分工

| 进程/项目 | 职责与语言 | 状态写入 |
|---|---|---|
| `apps/host` | Node/TS；本地与 headless 共用装配、网关、监督、权限 broker、控制面 | 所承载的 Platform、Content、Capabilities、Jobs owner |
| `apps/cognition-worker` | Python；装配 Cognition 与 Conversation 的 Python 持久 owner，承接 RPC | Conversation Log/History、Cognition 各状态；按各自 owner 隔离 |
| `apps/extension-host` | Node/TS；扩展加载、贡献注册、撤销、代理和受管子进程 | 扩展命名空间，经 broker 使用独立状态 |
| `apps/desktop` | Electron/React；桌面主进程、preload、受控 UI、原生合成 | 窗口偏好与 UI projection；不持有另一套领域 writer |
| 外部 Renderer Extension | 可含 C#/Unity 与受管子进程；映射具身语义 | 本地短寿命渲染状态，无交互事实主库 |

Host 既可由桌面监督启动，也可独立运行。Desktop 连接本地或远端 Host；Web 控制面由 Host 提供，UI 使用 React。
两个 UI 不复制领域判断；各自保留必要的交互和视图组件。`apps/server` 不再是第二份业务 Host。
Domain owner 与进程承载不同：Conversation 的 Python Log 保持 ADR-0022 的单写者设计，不因处于 Cognition Worker 进程而归 Cognition。
TS Conversation 拥有 binding/interaction/delivery 客户端协调；Python Conversation 拥有 Log/History/持久 Turn 状态。
同名概念跨语言只在公开 wire 投影重复表示，不能存在两个独立状态机或 writer。

Embodiment 的权威语义收束到 Host 中的 TS 包。既有 C# 的稳定语义必须通过行为等价测试迁移；Unity 专有部分迁外部扩展。
桌面原生合成原语留在 Desktop 的 native 工程，不能混入角色逻辑。C# SDK、Unity 程序集、包投影和真实构建门不得遗漏。
Python 推理/语音依赖由扩展自己的 worker 与锁文件管理，不进入 Cognition 领域依赖。

## 4. Platform

生命周期监督支持 startup、ready/degraded、失败、取消、drain、停止与资源释放。注册、端口监听与握手成功均不足以证明业务 ready。
scope 至少表达 Host、用户、角色、Conversation、Turn 和 Invocation 的关联；分配与释放有唯一 owner。
Clock 区分墙钟与单调时间，Identity 生成稳定标识，不能从显示名重建历史标识。
通信区分 Command、Event、Stream；有 deadline、取消、关联 ID、bounded queue、背压、最大帧与版本协商。
进程传输的认证、重连和序列控制归 Platform；领域事件重放策略归领域 owner。

安全机制包括身份、授权上下文、能力约束、密钥引用、审计及 authority fencing；领域策略由各 owner 决定。
配置机制只做解析/校验/合并和变更通知；各领域拥有自己的 schema、默认值和迁移。
Observability 贯穿 trace、指标、健康与脱敏日志；不得记录原始 token、密钥或默认收集完整私人对话。
配额、日志轮换、错误归类、DLQ 留存与告警都有清理路径；不能无限增长内存和磁盘。

## 5. Content

通用 part 覆盖 text/image/audio/video/file、来源及媒体元数据；AssetRef 是受控引用，不把任意本机路径交给外部扩展或 UI。
上传先进入 staging，校验大小、类型、hash 与权限后原子提交；返回 committed 引用之后才允许写入 Conversation。
资产 owner 持有 manifest、内容哈希、访问控制及引用关系。Log/Memory/Knowledge 等持久引用共同构成保留集合。
孤儿 staging 定时清理；committed blob 的 GC 需宽限期、引用快照和备份协调，不能仅看缓存是否命中。
导入旧 URI 时记录迁移映射，失败保留可恢复原件；不能在日志写入成功后再静默丢失媒体。

## 6. Conversation

Binding 把外部 provider 的不透明地址映射到稳定 Conversation/thread/participant；Core 不包含平台枚举。
外部地址更新、重连与显示名修改不得重建会话 ID。Ingress 必须校验来源、权限、顺序与去重键。
InteractionController 负责接纳、排队、打断和请求 TurnProcessor；认知内容由 Cognition 决定。
Turn 的持久状态与转换由 Python Conversation 拥有，Host 的交互协调消费其确认结果，不自行推定持久提交。

Log 是交互事实唯一 durable source，保留顺序、因果、稳定 ID、版本、提交位置和修正事实；History/working set 为可重建投影。
Append ACK 表示持久提交边界，内存接纳不能冒充落盘。批处理允许明确 flush barrier，停机必须 drain。
投影按 checkpoint 幂等前进，落后应报告，损坏可重建；不能删除 canonical Log 以适配新 schema。
保留 ADR-0022 既有 Moment/position 与历史格式迁移要求，路径迁移不重算 ID。

Delivery 持有输出 generation/epoch、目的地、发送去重与回执映射；区分生成、排队、发送、送达、播放、已听范围。
中断先使旧 generation 失效并取消下游；即使晚到帧仍到达，也不能继续展示/播放。重连只恢复仍有效输出。
不能把模型生成完整音频写成用户已听完；日志记录实际播放进度、截断与失败。外部送达未知保留未知，不能伪造 success。

## 7. Cognition

| 子域 | 状态与策略 |
|---|---|
| Persona | 版本化稳定角色资料，修改需明确来源/权限与审计；模型不能任意改写身份 |
| State | 情绪、动机、关系态势等认知状态，注明持久/暂存、衰减、过期与恢复规则 |
| Memory | 被接受的经历、偏好和知识性记忆，保留来源、置信度、纠错与删除传播 |
| Knowledge | 外部资料登记、采集、转换、索引、检索、权限、版本及失效 |
| Perception/Attention | observation 归一、去重、显著性、注意租约与待处理刺激 |
| Context | Step 输入的筛选、可信级别、预算、压缩与可追溯来源 |
| Inference | 通用模型请求/事件、能力选择与故障策略；供应商 payload 留扩展 |
| Planning | 长期目标、承诺、计划版本、状态及完成条件；通过 port 请求 Jobs |
| Loop | 原生模型/工具迭代、Step、停止条件、取消、恢复 checkpoint |

Knowledge source 持有 sourceId、revision、内容 hash、访问主体、采集时间和 freshness。
转换与索引记录 parser/chunk/embedding 版本；资源更新、权限撤销、删除必须使派生索引与缓存失效。
Resource 是“如何读取”，Content 是“读取到的字节”，Knowledge 是“如何组织和检索资料”，Memory 是“接受的经验”，不得混成数据库总管。
模型参数里的 prior 不是可检索知识源，不能声明其来源可精确追溯或删除。

Context 分别判断 instruction authority、数据可信度和相关性；网页、扩展输出和记忆文本不能自行提升到系统指令。
预算包括模型输入、工具定义、检索内容、历史摘要、预留输出和下一步 tool result。预算耗尽有明确压缩或终止策略。
Loop 直接消费模型原生 ToolCall/ToolResult，不先把所有输入分类为 `skill_request`，也不把 Skill 定义为 Tool 的父类。
每个 Step 可选择继续推理、调用能力、输出或停止；步数、时间、费用与输出配额有上限。
Run/checkpoint 独立于 Turn 和 Job。崩溃恢复从已确认事实与执行结果续接，不重复未知副作用。
Inference 同时支持文本/多模态模型及 realtime 会话；本地与云供应商仍经统一权限、预算和取消约束。
领域只通过 port 读取时钟、资产、资源、模型、能力与调度；不得直接操作 HTTP、文件路径或设备。

## 8. Capabilities

ToolRegistry 管理可执行动作；SkillCatalog 管理方法知识；ResourceRegistry 管理可读资源。
各自有 schema、scope、版本、撤销与 readiness，不建立万能 Registry。
Exposure 生成每个 Step 可见能力集合，过滤权限、会话/用户 scope、目标位置、ready/degraded、预算和协议能力。
模型选中工具不代表授权；Execution 在执行时重新验证，避免快照后权限变化。
Speech 定义 ASR/TTS、音频格式、时序、取消与实时音频桥的能力面，不强塞成普通离散 Tool。

Execution pipeline：准备 → 授权 → 路由 → 派发 → 确认结果 → 发布事实。
Journal 持有稳定 invocationId、attempt、幂等键、请求摘要、授权决策、目标、结果和外部副作用状态。
至少区分 prepared、authorized、dispatched、succeeded、failed、unknown；派发后崩溃不能直接按 failed 重试。
外部系统支持幂等键/查询时先对账；无此能力时 unknown 留给明确恢复策略或人工决策。
结果与待发布 outbox 在同一持久提交中记录；Conversation 按 invocation/result identity 幂等接纳。
Execution journal 拥有执行事实，Conversation Log 拥有交互事实，不能双向回写冒充同一 canonical record。

## 9. Jobs 与 Embodiment

Jobs 持有持久 trigger、schedule、due time、lease/fencing、attempt、backoff、取消、dead letter 与 retention。
认知计划/记忆巩固等通过注册 handler 运行；Jobs 不理解目标的情感意义或 memory 内容。
任务触发和业务状态变更跨存储时使用 outbox/幂等接纳，不能以两次普通写入假定原子性。
单机重启、重复触发、租约到期、时钟偏移与 worker 失联均需验证。长时间任务不是无限期占用当前 Turn。

Embodiment 持有稳定的表达、动作、姿态、视线和口型语义，状态是有序、有有效期的受控投影。
Cognition state 经策略映射产生具身意图，不直接发送 Unity 参数。Renderer 报告支持项、就绪、实际播放与失败。
无 Renderer 时能力降级，不影响文本交互的可用性；有音频未播放时不能假装口型同步完成。
具体帧循环、资源载入、渲染模型和厂商参数只在 Renderer Extension。Desktop 原生透明窗口/合成机制不拥有人格。

## 10. Extension

Extension 是安装、身份、加载、权限、兼容与生命周期单位；Contribution 是注册的 channel/model/speech/tool/resource/renderer 等能力。
Provider/Adapter 是扩展内部实现角色。一个扩展可注册多种相关贡献，不强制“一目录一个 provider”的空层次。
扩展清单含稳定 ID、版本、SDK/Host 兼容范围、入口、贡献、权限请求、受管进程与制品完整性信息。
加载前校验来源和包路径，禁止路径穿越；原子安装、失败回滚和卸载清理有事务记录。

权限由 Host broker 执行，涵盖网络、文件、设备、secret 引用与服务调用。Secret 只按授权作用域提供，日志必须脱敏。
Node 子进程不是安全沙箱：对任意同用户代码不能承诺强 OS 隔离。支持级别必须声明；强隔离需真实 OS/container 约束并验证拒绝路径。
注册不等于 ready，扩展退出需撤销贡献、取消 pending 调用、释放流和资源，保留已派发副作用的 unknown 状态。
受管 Python/C#/Unity 子进程仍归该 Extension 生命周期；重启预算受限，不能让扩展偷偷成为第二 Host。
第一方渠道和模型默认组合由 catalog 锁定制品摘要；主仓库只维护 SDK、模板、契约测试和安装组合，不维护厂商接入实现。
MCP 桥转换 tool/resource/prompt，prompt 可映射方法资料；MCP 名称与原始 SDK 类型不渗入 Core。

## 11. Protocol 与 Schema

`protocol/proto` 是跨语言/跨进程 wire 唯一源；TS、Python、C# generated 由同一生成流程产出。
保持 protobuf package、field number、稳定 ID 的兼容策略；弃用字段 reserved，不能为目录漂亮而重用编号。
service 契约涵盖健康、能力协商、Conversation、Cognition、Capabilities、Content、Embodiment、Jobs 和 Extension 通信。
目标 proto 路径与现行 wire identity 不要求同步改名；迁移需 producer/consumer/生成器/制品一次切换。

Document Schema 各归 owner：角色/知识/认知配置归 Cognition，资产归 Content，manifest 归 SDK，App 装配归 App。
Protocol 的 document catalog 只登记 schema 路径、ID 和版本，不复制 schema 正文。通用 envelope 的 schema 才由 Protocol 拥有。
JSON Schema 与进程 DTO 不能代替领域实体。各 App mapper 验证输入、转换类型、隔离协议升级。
生成产物路径、工具版本、兼容基线和 roundtrip fixture 必须在目录规范列出；禁止手写另一套 generated DTO。
迁移前继续以 `contracts/` 为唯一现行事实源，不能提前放入第二套可消费的 `protocol/`。

## 12. 状态、拓扑与恢复

| 状态 | writer/owner | 恢复与删除原则 |
|---|---|---|
| Authority/lease | Platform，经 Host 协调 | epoch/fencing 防止旧主写入；转移有确认与撤销 |
| Asset manifest/blob | Content | 先提交再引用；GC 与备份引用闭包一致 |
| Conversation Log | Conversation/Python | 有序持久提交；迁移不丢 ID 与因果关系 |
| History/delivery projection | Conversation | checkpoint 重建；外部发送状态不可猜测 |
| Persona/State/Memory/Knowledge/Planning/checkpoint | Cognition | 分域版本、来源、retention 与删除传播 |
| Execution journal/outbox | Capabilities | 去重、对账、unknown；先持久结果再投递 |
| Job state/lease | Jobs | 持久触发、fencing、幂等 handler 与恢复 |
| Embodiment live projection | Embodiment | 过期丢弃；从最新意图重新投影 |
| Extension private state | 对应 Extension | broker 命名空间、配额与卸载保留策略 |
| UI preference/connection | Desktop/Host UI | 不成为领域事实源；秘密不进入 UI 存储 |

每个 aggregate 同时一个 authority；云与本地不能共享目录并各自写主日志。
离线 journal 记录待接纳 proposal 与因果位置，不默认等价已提交事件。回连时显式验证 epoch、去重和冲突。
允许分支时保存 branch/causal relation，不能按墙钟排序伪装单一事实序列。
断网聊天取决于本地模型、凭据、数据与能力是否 ready，不能把 Hybrid 当无限离线保证。

备份先建立各 owner 的一致切点，包含 Log、Execution/Jobs、资产引用闭包、schema 与配置版本；密钥另行保护。
恢复验证 checksum、schema、authority epoch 和 outbox；先恢复唯一 writer 再重建投影。
用户删除需定义审计最小保留与隐私清除范围，并传播至索引、缓存和备份保留策略。不可再生数据先验证恢复路径。
升级采用版本化迁移、旧样本回归与回滚条件；不能靠删除数据库完成升级。

## 13. 完整行为链

| 链路 | 顺序与完成条件 |
|---|---|
| 文本/媒体输入 | Extension 或 Desktop → Host 鉴权/Content commit → Conversation 接纳/Log → App TurnProcessor → Cognition Loop → Delivery → 真实回执 |
| 工具调用 | Loop → Exposure → Execution 授权/journal → Extension → durable result/outbox → Loop/Log 幂等接纳 |
| 知识更新 | Resource revision → Knowledge ingest/hash/transform/index → 权限过滤检索 → Context provenance；删除使派生物失效 |
| 长期承诺 | Planning 目标版本 → Job request/outbox → Jobs lease/handler → Cognition 评估完成条件 → 通知/下一次调度 |
| 流水线语音 | Audio ingress → Speech ASR → Conversation/Loop → Speech TTS → Delivery 有效 generation → 播放回执/口型 |
| Realtime 语音 | 受控 realtime inference 会话 → 工具授权与交互事实旁路记录 → bounded audio stream → 中断取消/已听截断 |
| 具身 | Cognition state/交互结果 → Embodiment intent → Renderer Extension → readiness/执行反馈 → 受控投影 |
| 崩溃恢复 | authority fencing → owner stores/journal → projection/checkpoint → unknown 对账 → 恢复可安全操作 |

Realtime 的“旁路记录”是独立于音频低延迟路径的必需持久记录，不是可丢弃遥测；提交失败需显式降级或终止。
每条链路都传播 trace、scope、deadline、cancellation、版本和错误；不能用吞错满足表面连通。

## 14. 工程与成品验收

物理清单列全手写文件与父目录，包含源码、入口、配置、测试、fixture、锁文件、脚本、CI、模板、文档与授权说明。
外部扩展工程和动态输出另有独立空间；生成内容按有 producer 的规则登记，不将未知文件用省略号隐藏。
源码清单不规定永远不能拆文件：新增/删除/改名须同一切片更新清单、生成树和基线摘要，语义边界改变另走用户决策/ADR。
不为凑文件数量创建空壳。完成每个文件必须有其真实职责和消费者；模板只用于新建外部项目。

最终门至少包含：

1. 逐文件相符、无旧 owner/长期兼容壳、exports/依赖无违规或环；最终成品清单与安装后 inventory 匹配。
2. 公开协议生成/兼容/多语言 roundtrip；外部 SDK 使用与模板独立安装、构建、打包、加载、卸载。
3. 文本、媒体、两种语音、工具、资源、知识、目标/Jobs、具身完整链路；失败与降级不伪装 ready。
4. 重复消息、中断晚帧、背压、断连、权限撤销、扩展崩溃与卸载 pending；不重复外部副作用。
5. Conversation 重放、Memory/Knowledge 来源纠正、索引删除、Job 恢复、authority handover、离线回连冲突。
6. 旧数据样本迁移、资产引用闭包、冷备恢复、安装升级中断/回滚、磁盘配额与长时间运行资源上限。
7. 根 typecheck/build、Python 测试、原生/C#/Unity 专项构建、React UI 与可访问性、Linux/Windows 打包烟测。
8. 固定候选独立风险审查；Current/Implementation/Reference 反映实物；Roadmap 不含未关闭的必需交付项。

架构版本 v2.1 与产品 SemVer 独立。完整首版候选前自有开发版本按共同约定收束为 `0.1.0`，历史发布事实不重写。
文件与标识符命名由 [命名规范](../../guides/development/命名规范.md) 唯一维护；Runtime 仅用于生命周期或平台正式术语。
精确依赖版本以各锁文件为准；不得从本设计中的文件名推断第三方 API 或编译器版本已验证。

## 15. 设计依据

以下用于解释取舍，不把其他项目的目录当成本项目强制规范：

- [VS Code 源码组织](https://github.com/microsoft/vscode/wiki/Source-Code-Organization)：区分底层能力、产品装配及贡献。
- [VS Code Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)：扩展生命周期与运行承载分离。
- [Extension Runtime Security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security)：进程隔离的安全承诺需要明确界限。
- [Home Assistant components](https://developers.home-assistant.io/docs/architecture_components/)：外部平台转换为内部稳定语义。
- [LiveKit models](https://docs.livekit.io/agents/models/)：模型/语音可插拔能力面。
- [LlamaIndex ingestion](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/ingestion/pipeline.py)：来源、变更和派生索引生命周期。
- [LangGraph loop](https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/pregel/_loop.py)：循环恢复与持久 checkpoint 的分工。
- [Protobuf](https://protobuf.dev/programming-guides/proto3/)：wire 演进与字段兼容。
- [Composition Root](https://blog.ploeh.dk/2011/07/28/CompositionRoot/)：进程入口集中装配依赖。

本设计采用依赖倒置、消费方 port、单一事实源、CQRS 投影、outbox、幂等、fencing、显式版本与受控扩展契约。
这些机制的先进性来自可验证的故障语义；文件名和目录层数本身不证明系统长期可靠。

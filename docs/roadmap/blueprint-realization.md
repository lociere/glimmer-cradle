# Blueprint Realization Roadmap

> 范围：记录 Glimmer Cradle 从项目原型到架构蓝图完全落地的全阶段路线，说明每个阶段的成果面、边界、依赖、风险、验收门和归档位置。
>
> 事实依据：[Glimmer Cradle 架构蓝图](../architecture/blueprint/微光摇篮架构蓝图.md)、[Current Architecture](../architecture/current/README.md)、[Implementation Map](../architecture/implementation/README.md)、[Roadmap Now](./now.md)、[Backlog](./backlog.md)、历史阶段 ADR 与旧版[蓝图落地流程](../history/legacy-roadmap/蓝图落地流程.md)。
>
> 约束：本页是“蓝图落地母路线”，不是当前承诺列表。当前唯一活跃推进面以 [now.md](./now.md) 为准；承诺里程碑以 [milestones/](./milestones/) 为准；候选项以 [backlog.md](./backlog.md) 为准。

## 目录

| 章节 | 内容 |
| --- | --- |
| [1. 文档定位](#1-文档定位) | 本页与 blueprint、current、implementation、now、milestone、backlog 的关系。 |
| [2. 阶段状态语言](#2-阶段状态语言) | 统一解释 done、recent-done、planned、candidate 等状态。 |
| [3. 落地原则](#3-落地原则) | 阶段划分、契约优先、边界稳定和归档原则。 |
| [4. 全阶段总览](#4-全阶段总览) | 从 Phase 0 到 Phase 15 的完整路线图。 |
| [5. 已归档主干阶段](#5-已归档主干阶段) | 已完成并沉淀到当前架构事实源的基础阶段。 |
| [6. 近期完成阶段](#6-近期完成阶段) | 桌面身体、Skill Plane 与 Extension 收口阶段。 |
| [7. 当前与未来阶段](#7-当前与未来阶段) | 当前主体可用性阶段、后续发布闭环阶段，以及低延迟多模态、本地能力、生态和最终蓝图验收候选。 |
| [8. 当前推进面关系](#8-当前推进面关系) | 本页如何约束 now、milestones 与 backlog。 |
| [9. 阶段晋升规则](#9-阶段晋升规则) | 候选阶段如何成为承诺里程碑。 |
| [10. 阶段完成定义](#10-阶段完成定义) | 一个阶段可以声明完成时必须满足的条件。 |
| [11. 维护与归档规则](#11-维护与归档规则) | 本页与 History、ADR、Guide、Reference 的同步规则。 |

## 1. 文档定位

Glimmer Cradle 需要同时维护三种不同层次的路线信息：

| 文档 | 负责的问题 | 不负责的问题 |
| --- | --- | --- |
| [Glimmer Cradle 架构蓝图](../architecture/blueprint/微光摇篮架构蓝图.md) | “Glimmer Cradle 最终应该是什么”，包括企划平台、当前默认角色、人格边界、器官关系、Extension 定位和长期不变量。 | 不记录阶段排期、当前进度和短期任务。 |
| [Current Architecture](../architecture/current/README.md) | “当前系统实际是什么”，包括模块边界、运行方式和跨进程关系。 | 不承诺未来功能，也不保存历史过程。 |
| [Implementation Map](../architecture/implementation/README.md) | “当前代码怎样实现这些架构”，包括入口、装配、链路和技术地图。 | 不写愿景，也不替代源码事实。 |
| 本页 | “蓝图如何分阶段落地”，从项目 0 到完整蓝图验收的全阶段母路线。 | 不替代当前活跃任务、不承诺候选阶段一定启动。 |
| [now.md](./now.md) | 当前唯一活跃推进面。 | 不保存完整历史路线。 |
| [milestones/](./milestones/) | 已承诺里程碑的目标、范围、验收门和证据。 | 不保存宽泛愿景。 |
| [backlog.md](./backlog.md) | 尚未承诺的候选任务池。 | 不代表当前排期。 |

本页的核心价值是把“理想蓝图”拆成可验收、可归档、可迁移事实的阶段，避免未来开发只剩零散任务，也避免把愿景、现状、实现细节和排期混写在一个文档里。

## 2. 阶段状态语言

| 状态 | 含义 | 可以出现的位置 |
| --- | --- | --- |
| `done` | 阶段成果已经进入当前系统，事实已经迁入 `architecture/`、`reference/` 或 `guides/`。 | 本页、已归档 milestone、history。 |
| `recent-done` | 开发期范围已完成，但仍可能有发布矩阵、安装验证、跨设备验证等后续项。 | 本页、对应 milestone。 |
| `in-progress` | 当前唯一活跃推进面，必须能在 [now.md](./now.md) 找到同一目标。 | `now.md`、本页。 |
| `planned` | 已决定进入近期路线，但尚未开始。必须有明确里程碑文档或准备晋升里程碑。 | `milestones/`、本页。 |
| `candidate` | 与蓝图一致、具备长期价值，但尚未承诺。只能作为候选存在，不代表排期。 | 本页、`backlog.md`。 |
| `blocked` | 阶段目标合理，但被缺失依赖、外部约束或架构前置条件阻塞。 | `now.md`、milestone、本页。 |
| `superseded` | 阶段被新的架构方案替代，历史保留但不再推进。 | history、ADR。 |

使用状态时必须避免两类混乱：

- `candidate` 不能写成 `planned`。候选只是方向，不是承诺。
- `done` 不能只靠“写了代码”。必须有事实源迁移、验证证据和旧文档归档。

## 3. 落地原则

### 3.1 一个阶段只解决一个主矛盾

阶段划分不按“功能菜单”切分，而按架构主矛盾切分。例如：

- Phase 2 的主矛盾是“谁拥有长期记忆和数据持久化”。
- Phase 5 的主矛盾是“认知循环如何从聊天调用变成持续生命循环”。
- Phase 8 的主矛盾是“当前角色如何拥有桌面身体、Skill 能力平面和 Extension 生态边界”。

一个阶段可以包含多个包和多个模块，但必须只有一个可说明的架构成果。

### 3.2 先契约，后编排，再体验

跨语言、跨进程、跨包的变更必须按顺序推进：

1. 先确定协议、Schema、配置键、事件类型和权限边界。
2. 再落地 Kernel、Cognition、Renderer、Extension Host、Provider 或平台层编排。
3. 最后调整 UI、开发指南、排障手册和示例。

这个顺序保证体验变化不会反向污染核心边界。

### 3.3 器官、能力、表面、投影必须分层

蓝图落地时禁止把以下概念混成一个模块：

| 概念 | 责任 | 不应该承担 |
| --- | --- | --- |
| Cognition | 当前角色的内在状态、记忆、反思、觉醒和人格连续性。 | 平台 IO、窗口控制、插件生命周期。 |
| Kernel | 进程编排、协议路由、能力网关、状态投影和安全边界。 | 人格判断、长期记忆语义、UI 业务细节。 |
| Renderer | 受控投影、交互表面和桌面体验呈现。 | 直接访问 Kernel 内部对象或持久化核心语义。 |
| Extension | 可替换能力、内容包、集成面和外部工具适配。 | 成为第二套 Kernel、第二套 Cognition 或隐式权限系统。 |
| Agent 配置 | 开发协作入口、读取顺序和工具适配。 | 复制项目事实或替代 `docs/`。 |

### 3.4 完成后迁移事实，过程进入 History

每个阶段完成后必须做三件事：

1. 当前事实迁入 `architecture/`、`reference/`、`guides/`。
2. 阶段过程、设计取舍和旧方案迁入 `history/` 或 ADR。
3. Roadmap 只保留状态、成果、验收和下一步关系。

Roadmap 不是事实仓库；它只描述路线和承诺。

### 3.5 蓝图可以长期稳定，阶段可以重排

蓝图定义长期不变量。阶段路线定义落地顺序。未来如果技术条件、用户体验或项目重点变化，可以重排 Phase 11 以后阶段，但必须满足：

- 不破坏蓝图中的人格边界和器官分层。
- 不绕过协议、权限、数据和可观测性验收门。
- 不把候选阶段伪装成已承诺计划。

## 4. 全阶段总览

| 阶段 | 状态 | 主成果 | 事实归属 | 历史证据 / 路线入口 |
| --- | --- | --- | --- | --- |
| Phase 0：原型与工程骨架 | `done` | 项目从概念进入可运行工程，形成 Electron / TypeScript / Python 多包雏形。 | `architecture/current/`、`implementation/` | 历史代码与旧版架构文档。 |
| Phase 1：经历之流与快照 | `done` | 建立 Experience Stream、Snapshot 与可回放经历记录。 | `architecture/current/`、`reference/data-layout.md` | 旧版[记忆与日志架构](../history/legacy-current-architecture/08-记忆与日志架构.md)。 |
| Phase 2：Cognition 本地持久化与记忆收归 | `done` | 记忆所有权收归 Cognition，清理分散持久化。 | `architecture/current/`、`reference/data-layout.md` | [阶段2 ADR](../history/architecture-decisions/阶段2-数据持久化设计.md)。 |
| Phase 3：Observability 基础 | `done` | 建立 logs、metrics、traces 与 DLQ 排障基础。 | `reference/observability.md`、`guides/operations/日志、Trace与DLQ排障.md` | [阶段3 ADR](../history/architecture-decisions/阶段3-遥测设计.md)。 |
| Phase 4：认知活动调度 | `done` | 将认知资源档位收归 Cognition，并与 UI、Affect、Attention、Maintenance 分层。 | `architecture/current/`、`reference/protocol.md` | 原始探索见[阶段4 ADR](../history/architecture-decisions/阶段4-觉醒态设计.md)，当前决策见 [ADR-0002](../architecture/decisions/ADR-0002-AttentionLease与CognitiveActivity分层.md)。 |
| Phase 5：认知循环主干 | `done` | 落地 CycleController、GlobalWorkspace、Context Assembly、Volition 主干。 | `architecture/current/`、`implementation/` | [阶段5 ADR](../history/architecture-decisions/阶段5-认知循环设计.md)。 |
| Phase P：Protocol 契约层重构 | `done` | 跨语言契约集中到 `protocol/src/schemas/`，生成物成为唯一镜像。 | `reference/protocol.md` | [阶段P ADR](../history/architecture-decisions/阶段P-Protocol契约层重构.md)。 |
| Phase P.9：契约层与包管理自洽化 | `done` | TypeScript workspace、Python 包、生成链与路径引用收敛。 | `guides/开发手册.md`、`implementation/` | [阶段P9 ADR](../history/architecture-decisions/阶段P9-契约层与包管理自洽化重构.md)。 |
| Phase 6：反思、记忆图谱与叙事日记 | `done` | 建立 Reflection、Memory Graph 与 Narrative Journal 主线。 | `architecture/current/`、`reference/data-layout.md` | [阶段6 ADR](../history/architecture-decisions/阶段6-反思与记忆图谱设计.md)。 |
| Phase 7：自主输出通路 | `done` | ActionCommand、自主输出、旧 ChatUseCase 退出主路径。 | `architecture/current/`、`implementation/` | [阶段7 ADR](../history/architecture-decisions/阶段7-自主输出通路设计.md)。 |
| Phase 8：桌面身体、Skill Plane 与 Extension 收口 | `recent-done` | Renderer / Shell / Extension / Skill Plane 形成开发期闭环。 | `architecture/current/`、`implementation/`、`reference/extension-sdk.md` | [M08](./milestones/M08-SkillPlane、Extension与桌面体验收口.md)、[阶段8 ADR](../history/architecture-decisions/阶段8-渲染层架构分析与重构.md)。 |
| Phase 9：主体可用性、跨场景记忆与体验收口 | `in-progress` | 让开发期闭环先成为可用主体体验：跨场景经历可召回、记忆/知识边界清晰、真实 Skill 可执行、UI 可解释。 | [Cognition 当前视图](../architecture/current/07-子系统当前视图/Cognition.md)、[Extension 与 Skill Plane 当前视图](../architecture/current/07-子系统当前视图/Extension与SkillPlane.md)、[extension-sdk](../reference/extension-sdk.md) | [M09](./milestones/M09-主体可用性、跨场景记忆与体验收口.md)。 |
| Phase 10：发布形态、安装投影与数据迁移闭环 | `planned` | 让主体体验收口后的开发期闭环进入可安装、可迁移、可恢复的用户形态。 | [packaging-layout](../reference/packaging-layout.md)、[客户端打包](../guides/release/客户端打包.md) | [M10](./milestones/M10-发布形态、安装投影与数据迁移闭环.md)。 |
| Phase 11：低延迟多模态交互 | `candidate` | 文本、语音、视觉和实时感知进入统一交互节奏。 | 未来协议、Provider、Renderer 与 Cognition 文档 | [Backlog](./backlog.md)。 |
| Phase 12：Native 与本地能力加速 | `candidate` | C++ / Native / 本地模型 / 向量与音视频能力成为受控能力层。 | 未来 native reference 与 implementation map | [Backlog](./backlog.md)。 |
| Phase 13：Extension 内容生态成熟化 | `candidate` | Extension 从开发扩展点走向可分发、可治理、可组合的生态。 | 未来 SDK、权限、发布与示例文档 | [Backlog](./backlog.md)。 |
| Phase 14：自我演化与长期记忆质量 | `candidate` | LLM Reflection、记忆重排、叙事日记和自我评估质量提升。 | 未来 cognition、memory、evaluation 文档 | [Backlog](./backlog.md)。 |
| Phase 15：蓝图完成验收与发布稳定化 | `candidate` | 对照蓝图完成全系统验收，消除影子架构与文档债。 | 全部事实源 | 本页未来晋升。 |

## 5. 已归档主干阶段

### 5.1 Phase 0：原型与工程骨架

| 项 | 内容 |
| --- | --- |
| 状态 | `done` |
| 主问题 | Glimmer Cradle 能否从概念进入可运行工程，并证明多进程、多语言、多表面协作是可行方向。 |
| 核心成果 | 建立 Electron 桌面应用、TypeScript workspace、Python Cognition 雏形、基础配置与运行脚本。 |
| 非范围 | 不要求稳定协议、不要求完整认知循环、不要求 Extension 生态。 |
| 当前事实归属 | [Current Architecture](../architecture/current/README.md)、[Implementation Map](../architecture/implementation/README.md)。 |
| 完成门 | 项目可以启动；主要包边界可识别；基础开发命令可运行；后续阶段有可扩展工程骨架。 |

Phase 0 的价值不是“设计已经正确”，而是为后续所有架构阶段提供可迭代实体。它允许早期代码粗糙，但不允许后续阶段继续依赖原型式隐式边界。

### 5.2 Phase 1：经历之流与快照

| 项 | 内容 |
| --- | --- |
| 状态 | `done` |
| 主问题 | 当前角色如何拥有可追溯的经历，而不是只响应即时聊天。 |
| 核心成果 | 建立 Experience Stream、Snapshot、事件记录和可回放的经历材料。 |
| 非范围 | 不解决完整长期记忆语义，不承担人格判断，不提供完整 observability。 |
| 当前事实归属 | [data-layout](../reference/data-layout.md)、[Current Architecture](../architecture/current/README.md)。 |
| 历史证据 | 旧版[记忆与日志架构](../history/legacy-current-architecture/08-记忆与日志架构.md)。 |
| 完成门 | 关键经历能被记录、查询、回放；后续记忆、反思、叙事可以基于同一事件事实构建。 |

这一阶段建立“经历先于记忆”的顺序：系统先记录发生了什么，再由 Cognition 决定如何理解和沉淀。

### 5.3 Phase 2：Cognition 本地持久化与记忆收归

| 项 | 内容 |
| --- | --- |
| 状态 | `done` |
| 主问题 | 记忆和认知状态的所有权必须归属 Cognition，而不是散落在 UI、Kernel 或临时文件中。 |
| 核心成果 | Cognition 成为长期记忆、短期状态和认知持久化的 owner；Kernel 只编排和投影。 |
| 非范围 | 不引入复杂反思图谱，不解决多模态存储，不承担发布期迁移策略。 |
| 当前事实归属 | [data-layout](../reference/data-layout.md)、[Implementation Map](../architecture/implementation/README.md)。 |
| 历史证据 | [阶段2-数据持久化设计](../history/architecture-decisions/阶段2-数据持久化设计.md)。 |
| 完成门 | Cognition 数据路径清晰；跨进程访问通过协议；没有新的 UI / Kernel 侧隐式记忆 owner。 |

Phase 2 是蓝图中“当前角色是一个连续主体”的基础。如果记忆 owner 不清晰，后续任何人格、反思和自我叙事都会变成界面状态拼接。

### 5.4 Phase 3：Observability 基础

| 项 | 内容 |
| --- | --- |
| 状态 | `done` |
| 主问题 | 多进程、多语言系统必须能解释失败、延迟、丢信和状态漂移。 |
| 核心成果 | 建立日志、指标、追踪、事件 ID、DLQ 与排障入口。 |
| 非范围 | 不追求完整 APM 平台，不把 observability 做成业务语义存储。 |
| 当前事实归属 | [observability](../reference/observability.md)、[日志、Trace与DLQ排障](../guides/operations/日志、Trace与DLQ排障.md)。 |
| 历史证据 | [阶段3-遥测设计](../history/architecture-decisions/阶段3-遥测设计.md)。 |
| 完成门 | 关键链路可关联；失败可以定位到进程、协议、provider 或数据层；DLQ 有处理路径。 |

Phase 3 的完成门必须持续维护。后续任何阶段只要新增跨进程链路，都必须补齐观测点。

### 5.5 Phase 4：认知活动调度

| 项 | 内容 |
| --- | --- |
| 状态 | `done` |
| 主问题 | 认知资源档位应该由 Cognition 管理，并与 Renderer 显示、情感激活、外部焦点和后台维护分开。 |
| 核心成果 | `CognitiveActivityState` 与资源策略进入 Cognition，Renderer 只消费投影；活动迁移不写 Experience。 |
| 非范围 | 不实现完整情绪模型，不让 UI、Extension 或 Kernel 直接驱动 Cognition Activity。 |
| 当前事实归属 | [Current Architecture](../architecture/current/README.md)、[protocol](../reference/protocol.md)。 |
| 历史证据 | [阶段4-觉醒态设计](../history/architecture-decisions/阶段4-觉醒态设计.md)。 |
| 完成门 | 状态变化有 metric/log/span 和受控投影；UI 不能制造活动状态；Maintenance 不挂在认知循环中。 |

Phase 4 的早期“觉醒态”概念已经收口为资源调度语义。Affect activation 表达情绪强度，Cognitive Activity 表达认知预算，Maintenance Scheduler 表达后台整理；三者不再共用一个枚举。

### 5.6 Phase 5：认知循环主干

| 项 | 内容 |
| --- | --- |
| 状态 | `done` |
| 主问题 | 当前角色不能只是被动聊天函数；她需要持续组织经历、上下文、意图和输出。 |
| 核心成果 | CycleController、GlobalWorkspace、Context Assembly、Volition 成为认知主干。 |
| 非范围 | 不要求所有反思都由 LLM 完成，不要求所有输出都变成自主输出。 |
| 当前事实归属 | [Current Architecture](../architecture/current/README.md)、[Implementation Map](../architecture/implementation/README.md)。 |
| 历史证据 | [阶段5-认知循环设计](../history/architecture-decisions/阶段5-认知循环设计.md)。 |
| 完成门 | 输入、经历、上下文、意图和输出之间有清晰链路；Chat 不再是唯一系统中心。 |

Phase 5 是当前角色从“应用”走向“主体”的关键阶段。后续阶段必须围绕认知主干扩展，而不是在旁边再建第二套决策系统。

### 5.7 Phase P：Protocol 契约层重构

| 项 | 内容 |
| --- | --- |
| 状态 | `done` |
| 主问题 | 跨语言、跨进程结构必须有唯一权威定义，禁止手写镜像和漂移。 |
| 核心成果 | `protocol/src/schemas/` 成为权威 Schema；生成物同步到 TypeScript 与 Python 消费端。 |
| 非范围 | 不改变业务语义本身，不把生成物当作人工维护文件。 |
| 当前事实归属 | [protocol reference](../reference/protocol.md)、[开发手册](../guides/开发手册.md)。 |
| 历史证据 | [阶段P-Protocol契约层重构](../history/architecture-decisions/阶段P-Protocol契约层重构.md)。 |
| 完成门 | 修改协议后运行 `pnpm sync:contracts`；生成物可复现；跨语言字段一致。 |

Protocol 阶段是后续所有能力平面、Extension、Provider 和 Renderer 投影的地基。它必须先于大规模接口扩展。

### 5.8 Phase P.9：契约层与包管理自洽化

| 项 | 内容 |
| --- | --- |
| 状态 | `done` |
| 主问题 | TypeScript workspace、Python 包、生成链和路径引用必须自洽，否则协议正确也无法稳定开发。 |
| 核心成果 | 包管理、生成命令、开发命令、路径约定和同步流程收敛。 |
| 非范围 | 不解决所有运行时功能，不替代发布打包策略。 |
| 当前事实归属 | [开发手册](../guides/开发手册.md)、[Implementation Map](../architecture/implementation/README.md)。 |
| 历史证据 | [阶段P9-契约层与包管理自洽化重构](../history/architecture-decisions/阶段P9-契约层与包管理自洽化重构.md)。 |
| 完成门 | 新开发者可以按文档安装、生成、检查和构建；协议同步不依赖个人机器隐式状态。 |

P.9 的意义是把“架构正确”转化为“团队可维护”。没有这一层，文档和协议会在实际开发中持续腐化。

### 5.9 Phase 6：反思、记忆图谱与叙事日记

| 项 | 内容 |
| --- | --- |
| 状态 | `done` |
| 主问题 | 当前角色需要从经历中形成反思、关系和自我叙事，而不是只保存事件列表。 |
| 核心成果 | Reflection、Memory Graph、Narrative Journal 主线进入 Cognition。 |
| 非范围 | 不承诺所有反思都达到生产级 LLM 质量；真 LLM Reflection、记忆重排和更生动日记属于后续候选增强。 |
| 当前事实归属 | [Current Architecture](../architecture/current/README.md)、[data-layout](../reference/data-layout.md)。 |
| 历史证据 | [阶段6-反思与记忆图谱设计](../history/architecture-decisions/阶段6-反思与记忆图谱设计.md)。 |
| 完成门 | 经历能进入反思材料；记忆关系可追踪；叙事日记有稳定写入与查询路径。 |

Phase 6 完成的是结构主线，不等于记忆质量最终形态。质量提升应放到 Phase 14 或独立候选里程碑。

### 5.10 Phase 7：自主输出通路

| 项 | 内容 |
| --- | --- |
| 状态 | `done` |
| 主问题 | 当前角色的输出不能只来自用户请求；自主意图需要进入可审计、可投影、可取消的输出通路。 |
| 核心成果 | ActionCommand、自主输出通路、ChatUseCase 旧主路径退出。 |
| 非范围 | 不代表任何 Extension 或外部动作都可以自动执行；权限、能力和投影仍由 Kernel 约束。 |
| 当前事实归属 | [Current Architecture](../architecture/current/README.md)、[Implementation Map](../architecture/implementation/README.md)。 |
| 历史证据 | [阶段7-自主输出通路设计](../history/architecture-decisions/阶段7-自主输出通路设计.md)。 |
| 完成门 | 自主输出有来源、有状态、有取消/失败路径；Renderer 只呈现受控投影。 |

Phase 7 把“意图”接入系统动作，但仍必须维持安全边界。任何主动行为都不能绕过 Kernel 的能力网关。

## 6. 近期完成阶段

### 6.1 Phase 8：桌面身体、Skill Plane 与 Extension 收口

| 项 | 内容 |
| --- | --- |
| 状态 | `recent-done` |
| 主问题 | 当前角色需要一个可感知、可互动、可扩展的桌面身体，而不是只有内部认知循环。 |
| 核心成果 | Renderer / Shell / Extension Host / Skill Plane / Extension SDK 形成开发期闭环；Extension 的定位从“插件杂项”收敛为受控能力与内容生态。 |
| 非范围 | 不把 Extension 变成第二套 Kernel；不承诺发布安装矩阵已经完成；不把所有平台适配都放进本阶段。 |
| 当前事实归属 | [Current Architecture](../architecture/current/README.md)、[Implementation Map](../architecture/implementation/README.md)、[extension-sdk](../reference/extension-sdk.md)、[开发手册](../guides/开发手册.md)。 |
| 历史证据 | [M08](./milestones/M08-SkillPlane、Extension与桌面体验收口.md)、[阶段8-渲染层架构分析与重构](../history/architecture-decisions/阶段8-渲染层架构分析与重构.md)。 |
| 完成门 | Extension 通过声明式清单、能力边界、Skill Plane 网关和 Renderer 投影接入；桌面体验可以展示当前角色的身体、状态和受控交互；相关文档完成迁移。 |

Phase 8 的架构意义是补齐“身体”和“可扩展能力层”：

- Renderer 是当前角色身体的可见表面，不是认知 owner。
- Shell 负责桌面窗口、托盘、全局快捷键等平台身体部件，不承载人格语义。
- Extension Host 负责扩展生命周期、贡献点和隔离执行，不直接穿透 Kernel 内部对象。
- Skill Plane 负责把能力调用变成可路由、可观测、可拒绝、可审计的动作，不让扩展绕过协议。

Phase 8 之后，Glimmer Cradle 具备开发期意义上的完整交互闭环。但“开发期闭环”不等于当前角色已经具备足够的主体可用性。跨场景经历、真实 Skill 执行、记忆/知识边界和 UI 体验收口应进入 Phase 9；发布安装、跨机器桌面矩阵、用户数据迁移和安装资源投影应进入 Phase 10，而不是反向扩大 Phase 8 的完成定义。

## 7. 当前与未来阶段

Phase 9 是当前唯一活跃推进面。Phase 10 已计划但尚未开始；Phase 11 之后仍是蓝图级候选路线，它们与 Glimmer Cradle 长期方向一致，但除非进入 [now.md](./now.md) 或 [milestones/](./milestones/)，否则不是当前承诺。

### 7.1 Phase 9：主体可用性、跨场景记忆与体验收口

| 项 | 内容 |
| --- | --- |
| 状态 | `in-progress` |
| 主问题 | 开发期可运行不等于当前角色已经具备可用主体体验。 |
| 当前成果 | Conversation/Experience/Memory 边界、作用域受控外部场景接入、真实 Core Skill 执行、Skill 确认与审计、Control Center/Presence 可用性收口。 |
| 关键依赖 | Phase 8 的桌面与 Extension 闭环；Cognition Experience/Memory/Knowledge 主线；Kernel Ingress、Skill Plane、Policy、Gateway 和 UI 投影。 |
| 非范围 | 不提前做正式安装包、升级/回滚矩阵和发布路径投影闭环；不把 Extension 或工具结果直接写入 Cognition 私有事实源。 |
| 验收门 | 本地对话可解释地召回外部场景发生的事情；至少一个真实 Core Skill 端到端可执行；UI 能解释 readiness、Extension 健康、场景注意力、记忆来源、Skill 确认和失败恢复。 |

Phase 9 优先解决“开发期闭环是否已经是可用主体体验”的差距。当前承诺见 [M09](./milestones/M09-主体可用性、跨场景记忆与体验收口.md) 和 [now.md](./now.md)。

### 7.2 Phase 10：发布形态、安装投影与数据迁移闭环

| 项 | 内容 |
| --- | --- |
| 状态 | `planned` |
| 主问题 | 主体体验收口后，开发期可运行仍不等于用户可安装、可升级、可迁移、可恢复。 |
| 当前成果 | 打包资源投影、安装路径策略、`userData` / `data` 映射、配置与 secrets 边界、迁移/备份/恢复流程、桌面实机矩阵、发布验证手册。 |
| 关键依赖 | Phase 9 的主体可用性、真实 Skill 和 UI 体验收口；现有配置、数据和资源路径文档；构建脚本稳定性。 |
| 非范围 | 不补做 Phase 9 的跨场景记忆、真实 Skill handler 或 UI 可用性收口；不为了发布便利破坏数据 owner 和权限边界。 |
| 验收门 | 安装包可构建；新装、升级、卸载、回滚路径有验证；用户数据不被覆盖；日志与 DLQ 可定位发布期问题。 |

Phase 10 优先解决“从仓库运行”到“用户桌面运行”的差距。承诺见 [M10](./milestones/M10-发布形态、安装投影与数据迁移闭环.md)。

### 7.3 Phase 11：低延迟多模态交互

| 项 | 内容 |
| --- | --- |
| 状态 | `candidate` |
| 主问题 | 当前角色的交互节奏需要从文本回合走向低延迟、多模态、可中断的共处体验。 |
| 候选成果 | 文本流、语音输入、TTS 输出、视觉/屏幕感知、实时取消、延迟预算、Provider 能力声明、多模态事件协议。 |
| 关键依赖 | Protocol 稳定；Observability 能追踪延迟；Renderer 能呈现进行中状态；Cognition 能区分感知、理解、输出和动作。 |
| 非范围 | 不把所有多模态输入直接写入长期记忆；不绕过 consent 和权限；不让 Provider 细节泄漏到 Renderer。 |
| 候选验收门 | 关键交互链路有延迟指标；用户可取消或打断；多模态事件可追踪；失败不会污染认知状态。 |

Phase 11 的核心不是“接入更多模型”，而是建立低延迟交互节奏和跨模态协议。

### 7.4 Phase 12：Native 与本地能力加速

| 项 | 内容 |
| --- | --- |
| 状态 | `candidate` |
| 主问题 | 部分本地能力需要更低延迟、更强系统集成或更稳定资源控制。 |
| 候选成果 | Native bridge、C++/Rust/Node-API 能力边界、本地模型管理、向量检索加速、音视频处理、系统能力安全包装。 |
| 关键依赖 | Skill Plane 权限模型；Extension Host 隔离策略；发布打包对 native artifact 的支持。 |
| 非范围 | Native 层不拥有业务语义，不直接读取 Cognition 私有数据，不绕过协议与观测。 |
| 候选验收门 | Native 能力可声明、可加载、可禁用、可观测；崩溃不拖垮主进程；打包产物可复现。 |

Phase 12 应把 Native 看成“受控能力加速层”，不是新的核心架构中心。

### 7.5 Phase 13：Extension 内容生态成熟化

| 项 | 内容 |
| --- | --- |
| 状态 | `candidate` |
| 主问题 | Extension 需要从开发扩展点成长为可分发、可治理、可组合的内容生态。 |
| 候选成果 | Extension manifest 稳定版、贡献点目录、权限审计、profile、示例包、开发者指南、兼容策略、版本升级策略、分发与禁用机制。 |
| 关键依赖 | Phase 8 的 Extension Host 与 Skill Plane；Phase 10 的发布资源策略。 |
| 非范围 | Extension 不成为系统事实源；不复制项目文档；不允许扩展绕过 Kernel 能力网关。 |
| 候选验收门 | 第三方/项目内扩展能按 SDK 开发、测试、打包、安装、禁用；权限和事件链路可解释。 |

Phase 13 的目标是让 Extension 成为“当前角色可成长的外部器官和内容生态”，但它必须始终受主体边界约束。

### 7.6 Phase 14：自我演化与长期记忆质量

| 项 | 内容 |
| --- | --- |
| 状态 | `candidate` |
| 主问题 | 结构化记忆已经存在后，需要提升反思质量、记忆召回质量和自我叙事连续性。 |
| 候选成果 | 真 LLM Reflection、记忆 LLM rerank、情绪与 thought frame 增强、vivid Narrative Journal、自我评估指标、记忆压缩与遗忘策略。 |
| 关键依赖 | Phase 6 的记忆主线；Protocol 与 Observability；Provider 策略；数据迁移与备份能力。 |
| 非范围 | 不把模型输出无条件写入人格核心；不删除可追溯经历；不把“更像人”作为无边界目标。 |
| 候选验收门 | 反思可解释、可回滚、可引用来源；记忆召回质量可评估；叙事日记不破坏事实与想象边界。 |

Phase 14 需要格外谨慎。它直接影响当前角色“是谁”和“如何记得自己”，必须以可追溯、可评估、可回滚为前提。

### 7.7 Phase 15：蓝图完成验收与发布稳定化

| 项 | 内容 |
| --- | --- |
| 状态 | `candidate` |
| 主问题 | 当主要能力都落地后，需要对照蓝图做系统性收口，消除影子架构和文档债。 |
| 候选成果 | 蓝图逐项验收、架构边界审计、协议漂移检查、文档事实源审计、E2E 启停/安装/权限/数据/扩展验证、弃用路径清理。 |
| 关键依赖 | Phase 9-14 的核心成果；完整观测和发布验证。 |
| 非范围 | 不新增大型功能；不以“最后阶段”为名重写全部架构。 |
| 候选验收门 | 蓝图中的主体、器官、能力、身体、生态和安全边界都有当前事实源与验证证据；旧路线和旧文档均已归档或删除。 |

Phase 15 是“蓝图完成”的验收阶段，不是新功能阶段。它的主要产物是稳定性、可维护性和事实一致性。

## 8. 当前推进面关系

本页与当前路线的关系如下：

| 路线层 | 当前含义 | 本页的使用方式 |
| --- | --- | --- |
| `now.md` | 当前唯一活跃推进面。 | 如果某个 Phase 变成 `in-progress`，必须同步在 `now.md` 声明。 |
| `milestones/` | 已承诺阶段或里程碑。 | Phase 晋升后必须有独立 milestone 文件，写清范围、非范围、验收门和证据。 |
| `backlog.md` | 候选增强和未承诺任务池。 | Phase 11-14 的子项可以先进入 Backlog，再择机晋升。 |
| 本页 | 蓝图全阶段母路线。 | 维持阶段连续性和架构意图，不替代执行列表。 |

如果 `now.md`、milestone 和本页出现冲突，按以下顺序处理：

1. 以真实代码和已验证事实为准。
2. 当前事实迁入 `architecture/`、`reference/`、`guides/`。
3. 本页更新阶段状态和关系。
4. 旧 milestone 或旧路线归档到 `history/`。

## 9. 阶段晋升规则

一个 `candidate` 阶段可以晋升为 `planned` 或 `in-progress`，必须满足以下条件：

1. 有明确主矛盾：能用一句话说明该阶段解决哪个架构问题。
2. 有清晰范围和非范围：避免阶段无限膨胀。
3. 有依赖清单：协议、数据、Provider、Extension、Renderer、发布或观测依赖必须列出。
4. 有验收门：不能只写“完成实现”，必须包含文档、验证和迁移。
5. 有事实源计划：完成后哪些内容进入 `architecture/`、`reference/`、`guides/`，哪些进入 `history/`。
6. 与蓝图不冲突：不能破坏 Cognition / Kernel / Renderer / Extension 的责任边界。

晋升动作应该创建或更新：

- [now.md](./now.md)：如果成为当前唯一活跃推进面。
- `docs/roadmap/milestones/<Mx-名称>.md`：如果成为承诺里程碑。
- [backlog.md](./backlog.md)：如果仍只是候选子项。

## 10. 阶段完成定义

阶段完成不能只看代码合并。每个阶段至少满足：

| 类别 | 完成要求 |
| --- | --- |
| 架构 | 责任边界清晰，没有新增影子架构；蓝图关系可解释。 |
| 协议 | 跨语言/跨进程结构在 `protocol/src/schemas/` 或对应权威位置定义；生成物可复现。 |
| 实现 | 入口、装配、状态流、错误流和生命周期路径清晰。 |
| 数据 | owner、路径、迁移、备份或清理策略明确；不会隐式覆盖用户数据。 |
| 可观测性 | 日志、指标、trace、DLQ 或等价排障证据覆盖关键失败路径。 |
| 验证 | 至少完成与风险匹配的 typecheck、build、unit、integration、manual 或 desktop matrix 验证。 |
| 文档 | `architecture/`、`reference/`、`guides/` 更新；旧文档归档或删除；agent Skill / references 如受影响则同步。 |
| 路线 | `now.md`、milestone、backlog 和本页状态一致。 |

当阶段只完成开发期范围、但发布/安装/跨机器矩阵尚未完成时，应标记为 `recent-done` 或在 milestone 中明确“后移项”，不得写成无条件完成。

## 11. 维护与归档规则

### 11.1 何时更新本页

以下情况必须更新本页：

- 蓝图中的长期不变量发生变化。
- 某个 Phase 的状态变化。
- Backlog 候选项被提升为 milestone。
- 当前推进面从一个 Phase 切换到另一个 Phase。
- 某阶段被取消、替代或拆分。
- 旧历史材料被迁移、删除或合并，影响证据链接。

### 11.2 何时不更新本页

以下情况通常不更新本页：

- 单个 bug 修复。
- 不改变阶段边界的局部重构。
- 文案微调。
- 未影响蓝图路线的测试补充。

这些内容应该进入对应代码、Guide、Reference、milestone 或 PR 描述。

### 11.3 归档规则

阶段完成后按以下方式归档：

1. 设计决策进入 `docs/architecture/decisions/` 或 `docs/history/architecture-decisions/`。
2. 旧路线、旧 current、旧实现说明进入 `docs/history/`。
3. 当前事实进入 `docs/architecture/current/`、`docs/architecture/implementation/`、`docs/reference/`、`docs/guides/`。
4. 本页只保留阶段状态、成果摘要、事实归属和证据链接。

归档的目标不是保存所有旧文字，而是保证未来能回答三个问题：

- 当时为什么这么设计？
- 现在事实在哪里？
- 如果继续推进，下一阶段应该守住什么边界？

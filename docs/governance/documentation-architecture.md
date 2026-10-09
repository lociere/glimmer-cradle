# 文档架构与物理布局

> 范围：全仓 docs 的信息架构、职责、路径生命周期与目录清单；不定义产品运行时边界。
> 事实依据：ADR-0024、现有文档职责与下列官方资料。
> 维护触发：新增文档类型、权威归属、目录、生成规则或项目工作流。

## 目录

- [设计依据](#设计依据)
- [信息职责](#信息职责)
- [物理结构](#物理结构)
- [架构文档的覆盖](#架构文档的覆盖)
- [工作项生命周期](#工作项生命周期)
- [本次迁移](#本次迁移)
- [维护与验证](#维护与验证)

## 设计依据

资料核对日期为 2026-10-09。以下是本项目的适配决策，并非宣称存在一个强制统一的行业目录标准。

| 官方实践 | 采用方式 | 适用边界 |
|---|---|---|
| [Diátaxis](https://diataxis.fr/) 区分教程、操作、参考、解释 | 按读者意图区分 Guides、Reference 和 Architecture；onboarding 提供学习入口 | 不将全部工程治理强塞进四个目录；没有完整教学路径时不建立空 tutorials |
| [GitLab topic types](https://docs.gitlab.com/development/documentation/topic_types/) | 一个主题回答一个明确问题，导航页与正文职责分开 | 允许正文链接相关主题，不复制另一页的准确字段 |
| [GitLab 文档工作流](https://docs.gitlab.com/development/documentation/workflow/) | 文档随实现更新，变更在同一候选检查 | 本项目 Git/发布权限沿用用户授权 |
| [arc42](https://docs.arc42.org/) | 以目标/约束、上下文、构件、运行、部署、质量、风险、决策和术语审查覆盖 | 用作内容检查表，不机械复制十二份空模板 |
| [ADR](https://adr.github.io/) | 记录背景、决定、后果与替代关系 | ADR 不重复蓝图正文、不作为阶段状态表 |
| [Kubernetes 页面类型](https://kubernetes.io/docs/contribute/style/page-content-types/) | Concept、Task、Reference 使用不同写法，操作页有前置条件和步骤 | docs 检查只能证明其覆盖的结构与链接，不能证明运行时行为 |

## 信息职责

| 目录 | 唯一拥有 | 不应混入 |
|---|---|---|
| architecture/target | 已接受的目标语义、完整物理契约及摘要锁 | 当前执行状态、会话日志 |
| architecture/current | 当前结构、部署、运行关系、质量约束与术语 | 尚未实施的迁移动作 |
| architecture/implementation | 真实代码、入口、状态机与调试链路 | 目标中的不存在 API |
| architecture/decisions | 长期取舍、上下文、替代关系 | 每次测试流水 |
| reference | 协议、配置、数据、SDK、命令等精确查表 | 长篇操作步骤 |
| guides | 前置条件、操作、失败恢复、验证和同步 | 再次定义规范或项目状态 |
| governance | 文档与架构变更规则、工作流设计 | 产品业务规则、活跃切片状态 |
| roadmap | 承诺、依赖、待办、风险、切片与证据索引 | 已被替代的长期过程正文 |
| history | 完成的里程碑、被冻结的原始记录与旧设计 | 当前执行指令 |

文档的语义权威来自职责与明确替代关系；Markdown 链接位置不授予更高权限。
Blueprint 在本文中作为“目标蓝图”的概念使用，物理路径统一为 `architecture/target/`。
产品基线保持 v2.1，文档治理修订由 ADR-0024 记录，不虚构产品 v2.2。

## 物理结构

下方是从 `architecture/target/files.json` 的 docs 条目生成的精确文件树。
历史材料也登记；源文件不得用通配符代替。新增页面同时更新权威清单和入口，空目录不登记。

<!-- docs-layout:start -->

```text
docs/
├── README.md
├── architecture/
│   ├── README.md
│   ├── current/
│   │   ├── 00-阅读说明.md
│   │   ├── 01-目标、约束与质量属性.md
│   │   ├── 02-系统上下文.md
│   │   ├── 03-运行拓扑与进程边界.md
│   │   ├── 04-构件、分层与依赖.md
│   │   ├── 05-关键运行时链路.md
│   │   ├── 06-跨切面机制.md
│   │   ├── 07-子系统当前视图/
│   │   │   ├── Cognition.md
│   │   │   ├── Data与Observability.md
│   │   │   ├── Desktop与Avatar.md
│   │   │   ├── Engines与Native.md
│   │   │   ├── Extension与SkillPlane.md
│   │   │   ├── Kernel与Runtime.md
│   │   │   └── README.md
│   │   ├── 08-部署与交付形态.md
│   │   ├── 09-术语表.md
│   │   ├── 10-当前物理拓扑.md
│   │   └── README.md
│   ├── decisions/
│   │   ├── ADR-0000-模板.md
│   │   ├── ADR-0001-企划平台与角色Profile分层.md
│   │   ├── ADR-0002-AttentionLease与CognitiveActivity分层.md
│   │   ├── ADR-0003-CharacterPackage与MemorySubstrate分层.md
│   │   ├── ADR-0004-Extension开放生态运行边界.md
│   │   ├── ADR-0005-Character-Avatar-Surface-Host分层.md
│   │   ├── ADR-0006-Desktop物理归属与Electron进程分层.md
│   │   ├── ADR-0007-UnityAvatarHost程序集边界与SDK投影.md
│   │   ├── ADR-0008-ExperienceLedger与版本化Memory.md
│   │   ├── ADR-0009-本地监督树与动态端点治理.md
│   │   ├── ADR-0010-产品组合与扩展仓库边界.md
│   │   ├── ADR-0011-Extension发布与开放生态边界.md
│   │   ├── ADR-0012-场景Adapter与平台受管资源分层.md
│   │   ├── ADR-0013-契约脊柱与跨进程服务架构.md
│   │   ├── ADR-0014-仓库物理分层与器官模块边界.md
│   │   ├── ADR-0015-工程自动化平面与交付生命周期分层.md
│   │   ├── ADR-0016-仓库工具工作区与产品监督边界.md
│   │   ├── ADR-0017-产品前端统一采用React组件驱动架构.md
│   │   ├── ADR-0018-Personal Server宿主与服务状态分域.md
│   │   ├── ADR-0019-采用Architecture-Baseline-v2冻结基线.md
│   │   ├── ADR-0020-Content资产单写者与恢复边界.md
│   │   ├── ADR-0021-架构基线规范修订与命名收束.md
│   │   ├── ADR-0022-ConversationLog与Experience投影边界.md
│   │   ├── ADR-0023-最终目标蓝图与物理目录契约.md
│   │   ├── ADR-0024-文档职责与重构执行体系整合.md
│   │   └── README.md
│   ├── implementation/
│   │   ├── Cognition认知核实现.md
│   │   ├── Conversation实现.md
│   │   ├── Desktop与Avatar实现.md
│   │   ├── Engines与Native实现.md
│   │   ├── Extension与SkillPlane实现.md
│   │   ├── Kernel与Runtime实现.md
│   │   ├── Platform原语实现.md
│   │   ├── Protocol契约层实现.md
│   │   ├── README.md
│   │   ├── 工程生命周期实现.md
│   │   └── 数据、记忆与可观测性实现.md
│   └── target/
│       ├── README.md
│       ├── baseline.lock.json
│       ├── baseline.md
│       ├── files.json
│       └── physical-layout.md
├── governance/
│   ├── README.md
│   ├── agent-workflow-design.md
│   ├── architecture-change-policy.md
│   ├── documentation-architecture.md
│   └── documentation.md
├── guides/
│   ├── README.md
│   ├── development/
│   │   ├── AI辅助前端开发.md
│   │   ├── Schema与跨进程契约变更.md
│   │   ├── architecture-refactoring.md
│   │   ├── 前端开发与UI验收.md
│   │   ├── 功能开发与缺陷修复.md
│   │   ├── 命名规范.md
│   │   ├── 文档维护.md
│   │   ├── 架构性改动.md
│   │   └── 测试与验收.md
│   ├── onboarding/
│   │   └── 本地开发环境.md
│   ├── operations/
│   │   ├── 性能诊断.md
│   │   ├── 数据迁移与恢复.md
│   │   └── 日志、Trace与DLQ排障.md
│   ├── release/
│   │   ├── Personal Server部署.md
│   │   └── 客户端打包.md
│   ├── subsystems/
│   │   ├── Cognition开发.md
│   │   ├── Kernel开发.md
│   │   ├── 扩展开发.md
│   │   ├── 桌面与Avatar开发.md
│   │   └── 音频引擎开发.md
│   └── 开发手册.md
├── history/
│   ├── README.md
│   ├── architecture-decisions/
│   │   ├── README.md
│   │   ├── 阶段2-数据持久化设计.md
│   │   ├── 阶段3-遥测设计.md
│   │   ├── 阶段4-觉醒态设计.md
│   │   ├── 阶段5-认知循环设计.md
│   │   ├── 阶段6-反思与记忆图谱设计.md
│   │   ├── 阶段7-自主输出通路设计.md
│   │   ├── 阶段8-渲染层架构分析与重构.md
│   │   ├── 阶段P-Protocol契约层重构.md
│   │   └── 阶段P9-契约层与包管理自洽化重构.md
│   ├── architecture-v1/
│   │   ├── 2026-09-19-roadmap-now.md
│   │   ├── README.md
│   │   ├── blueprint-realization.md
│   │   ├── 微光摇篮架构蓝图.md
│   │   └── 目标物理拓扑.md
│   ├── architecture-v2.0/
│   │   ├── Architecture_Baseline_v2.0_执行宪章.md
│   │   ├── Glimmer_Cradle_Architecture_Baseline_v2.0_Frozen.md
│   │   ├── Glimmer_Cradle_Codex_Refactor_Prompt_v2.0.md
│   │   └── README.md
│   ├── architecture-v2/
│   │   ├── 2026-10-09-execution-log.md
│   │   └── README.md
│   ├── incidents/
│   │   ├── 2026-05-08-Electron启动环境变量污染.md
│   │   ├── 2026-05-08-KernelJS导入不一致.md
│   │   └── README.md
│   ├── legacy-current-architecture/
│   │   ├── 00-架构总览.md
│   │   ├── 01-协议层.md
│   │   ├── 02-基础设施层.md
│   │   ├── 03-领域层.md
│   │   ├── 04-应用层.md
│   │   ├── 05-插件层.md
│   │   ├── 06-依赖规则与检查清单.md
│   │   ├── 07-Cognition认知核.md
│   │   ├── 08-记忆与日志架构.md
│   │   ├── 09-日志字段表.md
│   │   └── README.md
│   ├── legacy-extensions/
│   │   ├── AgentSkill与MCP指南.md
│   │   ├── README.md
│   │   ├── 扩展API参考.md
│   │   └── 扩展开发指南.md
│   ├── legacy-guides/
│   │   ├── Cognition开发指南.md
│   │   ├── Data目录指南.md
│   │   ├── Kernel开发指南.md
│   │   ├── Python环境指南.md
│   │   ├── UI色彩参考.md
│   │   ├── UI设计指南.md
│   │   ├── ui-references/
│   │   │   └── README.md
│   │   ├── 客户端安装形态.md
│   │   ├── 客户端打包指南.md
│   │   ├── 开发总则.md
│   │   ├── 开发流程.md
│   │   ├── 桌面渲染开发指南.md
│   │   └── 音频引擎指南.md
│   ├── legacy-roadmap/
│   │   ├── 后续增强.md
│   │   ├── 当前推进.md
│   │   └── 蓝图落地流程.md
│   └── milestones/
│       ├── M08-SkillPlane、Extension与桌面体验收口.md
│       ├── M09-主体可用性、跨场景记忆与体验收口.md
│       ├── M10-发布形态、安装投影与数据迁移闭环.md
│       ├── M12-契约脊柱与跨进程服务架构重建.md
│       ├── M13-工程自动化脊柱与交付生命周期闭环.md
│       ├── README.md
│       └── manifests/
│           ├── M12-目标物理清单.md
│           ├── M13-目标物理清单.md
│           └── README.md
├── reference/
│   ├── README.md
│   ├── configuration.md
│   ├── data-layout.md
│   ├── engineering-lifecycle.md
│   ├── extension-sdk.md
│   ├── observability.md
│   ├── packaging-layout.md
│   ├── product-compositions.md
│   ├── protocol.md
│   └── ui-design-tokens.md
└── roadmap/
    ├── README.md
    ├── backlog.md
    ├── initiatives/
    │   ├── architecture-v2/
    │   │   ├── README.md
    │   │   ├── acceptance.md
    │   │   ├── evidence/
    │   │   │   ├── 2026-10-09-docs-integration.md
    │   │   │   └── README.md
    │   │   ├── execution.json
    │   │   ├── migration-map.md
    │   │   ├── plan.md
    │   │   ├── requirements.md
    │   │   ├── risks.md
    │   │   ├── slices/
    │   │   │   ├── A00-reconcile.md
    │   │   │   └── TEMPLATE.md
    │   │   └── status.md
    │   └── m11-delivery/
    │       ├── M11-Personal Server UI设计简报.md
    │       ├── README.md
    │       ├── physical-layout.md
    │       └── reference-assets/
    │           └── m11-ui/
    │               ├── accent-a-qingyao.svg
    │               ├── accent-b-paraiba.svg
    │               ├── accent-c-peacock.svg
    │               └── m11-accepted-overview-dark-light-narrow.png
    └── now.md
```

<!-- docs-layout:end -->

目录结构表达维护职责；文件名表达主题。新的流程、治理和任务文件使用稳定 kebab-case。
已存在的中文专业指南和 ADR 保持可识别的名称，不为纯风格重命名全部文件。
大版本原文归 History，活跃入口保持稳定；历史记录的日期属于证据身份，不用于制造最新版分叉。

## 架构文档的覆盖

| arc42 关注面 | 本仓库落点 |
|---|---|
| 目标、约束、上下文 | Target baseline §1–3；Current 01–03 |
| 构件与依赖 | Target §2–11；Current 04；Implementation 各 owner |
| 运行场景 | Target §13；Current 05；Implementation 实际链路 |
| 部署与跨切面 | Target §12/14；Current 06/08；Reference 数据/制品 |
| 决策、质量、术语 | ADR；Current 01/09；重构验收矩阵 |
| 风险与技术债 | 对应 initiative 的 risks.md；产品当前限制链接对应实现页 |

完整覆盖不意味着文档声明自动为真。Source/Schema/构建与真实环境证据分别支撑对应层次。

## 工作项生命周期

一个长期工作只有一个 `roadmap/initiatives/<id>/` 目录：
入口说明范围；计划定义依赖与验收；execution.json 保存机器可核验的阶段/任务状态；
status.md 是生成视图；slices 保存可执行任务契约；evidence 保存固定输入的验证结果；
migration-map 只记录现有到目标动作；risks 记录未关闭风险及关闭条件。

`roadmap/now.md` 只选定当前主线并链接状态，不抄阶段状态。
已完成切片的稳定事实同步 Current/Implementation/Reference；证据归档到 History 时更新索引，
但任务 ID 与接受结论保持可追溯。未完成的外部环境验收仍保留为风险或任务，不能一起标记完成。
状态生成与验证按[执行指南](../guides/development/architecture-refactoring.md)操作。

## 本次迁移

| 原位置 | 当前位置及处理 |
|---|---|
| architecture/blueprint 的版本化主文/树/JSON/lock | architecture/target 下 baseline、physical-layout、files、baseline.lock |
| Blueprint 中的执行宪章 | governance/architecture-change-policy.md |
| Blueprint 中的 Codex Prompt | architecture-v2 initiative 的 requirements.md；通用步骤进入 Guide |
| Current 11 迁移地图 | architecture-v2 initiative 的 migration-map.md |
| roadmap 单文件执行记录 | 原文逐字节保留在 history/architecture-v2；有效状态进入 execution.json |
| roadmap 中已完成 M08/09/10/12/13 | history/milestones，未验范围仍由活跃风险跟踪 |
| 未完成 M11、物理清单与设计资产 | roadmap/initiatives/m11-delivery，保持验收状态 |
| 根文档维护规范、智能体工作流设计 | governance，Skill 引用新入口 |

旧路径引用已随移动重算。历史整份执行快照保留原始链接文本与语境，由归档索引说明原位置和来源 Git；
它不参与活跃链接门，也不能被当作当前指令。

## 维护与验证

运行 `pnpm check:docs --write` 重建文档树及执行状态视图，再运行 `pnpm check:docs`。
该检查验证活跃链接/入口、文档清单与实物、任务依赖/状态及生成视图；不检查远端网页和历史正文，
不把测试报告文字当成真实测试结果。新增路径后还要重建目标树和受控摘要，见架构变更宪章。

# 知识与文档架构

本页拥有资料分类、单一维护位置、状态、读取时机与维护责任；写作质量见[文档规范](documentation.md)，
实际编辑/迁移见[文档维护](../how-to/文档维护.md)。文档和 Skill 都供人及 Codex 使用。

## 从需求到结构

首次接手者需要得到一个安全、可观察的成果；实现者需要真实入口/owner/consumer；设计者需要概念、质量要求和边界；
调试者需要运行因果与失败/退出；作者需要精确 SDK/Schema；交付者需要制品身份/环境/恢复；接手者需要当前授权与原状态。
同一使用者会切换任务，不能只按语言、团队目录或“给人/给 AI”分类。

采用任务导航＋主题正文＋交叉引用：学习成果独立到 tutorials；可执行操作集中到 how-to，取消旧 guides 的阶段/子系统多级分类，
避免读者先猜阶段再找命令；精确查询保留 reference。架构目标、采用决策、跨组件视图和组件解释有不同权威/更新频率，
保留 architecture 的语义边界；将 Current 的六篇组件说明并入 Implementation，消除两份同主题详情。
认知主链与 Memory/Knowledge、Planning 长细节分开，使其他认知任务无需加载持久化/Jobs 全部内容。

治理、任务状态和历史因权限、维护周期及证据时效而独立，不能强塞进教程/参考四类型。
这些是本项目适配，比较及来源链见[设计决定](agent-workflow/design-decisions.md)，实际旧→新见[迁移记录](agent-workflow/migration.md)。

## 设计依据

Diátaxis 用于判断学习/应用和行动/理解；Docs as Code 用于同仓 diff、审查与自动检查；
GitLab/Django/Kubernetes 的实际实现支持任务主题、链接和版本/源的区别，不能证明本目录树是通行标准。
C4/arc42 仅辅助检查系统视图、组件职责与代表运行场景，不作为目录模板，不宣称符合整个方法或标准。
各依据属于平台机制、推荐、开放规范、案例、项目适配或实验的哪一类，见设计决定与[研究](agent-workflow/research.md)。

## 内容归属与读取

| 内容或问题 | 权威维护位置 | 何时读取、由谁维护 |
|---|---|---|
| 产品目标、长期职责与不变量 | architecture/target、accepted ADR | 边界判断；产品/架构决定 owner |
| 当前系统上下文、跨组件依赖/运行/部署 | architecture/current | 理解相应关系；实际实现 owner |
| 组件目的、概念、入口、装配、生命周期、失败/恢复 | architecture/implementation | 修改/追踪该组件；组件 owner，按任务组织而非固定六节模板 |
| 协议/Schema/配置/数据/SDK/token/命名/制品精确语义 | reference；实际定义仍由 Schema/源码/manifest 拥有 | 查询或变更；相应定义 owner |
| 学习第一个受控成果 | tutorials 的具体教程 | 首次学习；拥有 fixture/构建与反馈的工程 owner |
| 开发、构造、启动、调试、测试、交付、恢复的完整操作 | how-to 的具体指南 | 执行该任务；拥有命令、副作用与恢复的工程 owner |
| 仓库共同约束、安全与授权 | 根 AGENTS.md | 宿主指令；协作 owner，不复制详细操作 |
| 专项执行判断、反例、工具选择 | .agents/skills 的专项正文和条件性资源 | 匹配任务；能力维护者结合领域 owner |
| 文档/协作职责、质量与方法选择 | governance | 维护体系时；资料/能力 owner |
| 当前计划、授权、进度和恢复点 | 对应 roadmap initiative 或临时任务记录 | 继续对应任务；唯一整合 owner |
| 决策原语境、被替代设计、研究与验证证据 | ADR/history、对应 research/evaluation | 追溯或复验；保留原候选/来源/许可/限制 |
| 确定性工具、模板、生成物 | 实际 tools/product/contract owner | 执行相应操作；不在 Skill 复制脚本或模板 |

归属落实到一条事实或一个流程。例如字段定义在 Contract Spine，协议参考解释语义，变更指南提供生成/兼容操作，
contracts Skill 提醒真实跨语言消费与失效模式。允许有用途的短摘要与最小例子，不分别维护多份完整字段/默认值/副作用表。
共享验收、证据复用和独立审查由[测试与验收](../how-to/测试与验收.md)拥有；持久接手由[长任务与恢复](../how-to/长任务与恢复.md)拥有。

## 权威与状态

用户最新决定与授权优先，产品规范顺序见[变更宪章](architecture-change-policy.md)。
规范目标说“应达到什么”；当前源码/Schema/consumer 说“实现了什么”；运行证据说明“哪个候选/环境验证过什么”。
三者冲突时修正所属说法或明确偏差，不能以目标目录、历史 PASS、声明字段或文件存在替代接入/ready。

可调整的目录/Skill 数量、加载与协作流程不属于产品不变量。架构 v2 的临时步骤和完成门只用于该 initiative；
execution.json 唯一拥有其进度，status.md 是生成视图。本轮重组不接受或推进产品任务。
历史保留过去语境和原证据，只切换失效的导航链接；日期不是当前事实正确性的证明。

## 任务流程与能力组合

[docs 入口](../README.md)按成果导航，已知 owner 可以跳过；专项 Skill 只加载会改变判断的必要资料。
组件主题可含解释和方法，指南可含必要概念，Skill 可含必要项目事实，不机械按“事实/方法”切开。
内容应直接回答问题或引向可操作下一站，避免 docs→Skill→同一 docs 的无效往返。
完整覆盖和正反请求在[覆盖矩阵](agent-workflow/coverage.md)，不要求普通任务读全图、研究或历史。

## 维护与追溯

实现变化同步唯一正文及误导性的直接摘要；职责迁移切消费者后删旧入口，不保留无期限壳。
资料重组同时处理精确文件清单、生成树与受影响摘要；[文档维护](../how-to/文档维护.md)给实际命令和失败分支。
上游变化或重复失败触发有证据的最小修正，来源/适配/验证记录不默认进入任务上下文。
ADR-0024 保存先前布局决定的历史；本轮选择和旧内容处理以[协作设计](agent-workflow-design.md)及迁移记录解释，不改写其原接受语义。

## 文件清单视图

以下从目标 files.json 的 docs 条目生成，用于核对物理文件，不证明能力或事实正确性；普通读者用任务导航。

<!-- docs-layout:start -->

```text
docs/
├── README.md
├── architecture/
│   ├── README.md
│   ├── current/
│   │   ├── 01-目标、约束与质量属性.md
│   │   ├── 02-系统上下文.md
│   │   ├── 03-运行拓扑与进程边界.md
│   │   ├── 04-构件、分层与依赖.md
│   │   ├── 05-关键运行时链路.md
│   │   ├── 06-跨切面机制.md
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
│   │   ├── CognitionMemory与Knowledge实现.md
│   │   ├── CognitionPlanning实现.md
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
│   ├── agent-workflow/
│   │   ├── coverage.md
│   │   ├── design-decisions.md
│   │   ├── evaluation.md
│   │   ├── migration.md
│   │   └── research.md
│   ├── architecture-change-policy.md
│   ├── documentation-architecture.md
│   └── documentation.md
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
├── how-to/
│   ├── Cognition开发.md
│   ├── Kernel开发.md
│   ├── Personal Server部署.md
│   ├── README.md
│   ├── Schema与跨进程契约变更.md
│   ├── 前端开发与UI验收.md
│   ├── 功能开发与缺陷修复.md
│   ├── 审查权限与外部边界.md
│   ├── 客户端打包.md
│   ├── 性能诊断.md
│   ├── 执行架构切片.md
│   ├── 扩展开发.md
│   ├── 数据迁移与恢复.md
│   ├── 文档维护.md
│   ├── 日志、Trace与DLQ排障.md
│   ├── 本地开发环境.md
│   ├── 架构性改动.md
│   ├── 桌面与Avatar开发.md
│   ├── 测试与验收.md
│   ├── 长任务与恢复.md
│   └── 音频引擎开发.md
├── reference/
│   ├── README.md
│   ├── configuration.md
│   ├── data-layout.md
│   ├── engineering-lifecycle.md
│   ├── extension-sdk.md
│   ├── naming.md
│   ├── observability.md
│   ├── packaging-layout.md
│   ├── product-compositions.md
│   ├── protocol.md
│   └── ui-design-tokens.md
├── roadmap/
│   ├── README.md
│   ├── backlog.md
│   ├── initiatives/
│   │   ├── architecture-v2/
│   │   │   ├── README.md
│   │   │   ├── acceptance.md
│   │   │   ├── evidence/
│   │   │   │   ├── 2026-10-09-P02A.md
│   │   │   │   ├── 2026-10-09-P07A.md
│   │   │   │   ├── 2026-10-09-P07B.md
│   │   │   │   ├── 2026-10-09-docs-integration.md
│   │   │   │   ├── 2026-10-09-execution-order.md
│   │   │   │   └── README.md
│   │   │   ├── execution-order.md
│   │   │   ├── execution.json
│   │   │   ├── migration-map.md
│   │   │   ├── plan.md
│   │   │   ├── requirements.md
│   │   │   ├── risks.md
│   │   │   ├── slices/
│   │   │   │   ├── A00-reconcile.md
│   │   │   │   └── TEMPLATE.md
│   │   │   └── status.md
│   │   └── m11-delivery/
│   │       ├── M11-Personal Server UI设计简报.md
│   │       ├── README.md
│   │       ├── physical-layout.md
│   │       └── reference-assets/
│   │           └── m11-ui/
│   │               ├── accent-a-qingyao.svg
│   │               ├── accent-b-paraiba.svg
│   │               ├── accent-c-peacock.svg
│   │               └── m11-accepted-overview-dark-light-narrow.png
│   └── now.md
└── tutorials/
    └── 首次受控验证.md
```

<!-- docs-layout:end -->

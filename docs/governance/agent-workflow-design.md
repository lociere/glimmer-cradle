# 文档与开发协作能力设计

本页拥有协作能力边界、组合、加载和维护责任；知识归属见[文档架构](documentation-architecture.md)。
本轮从读者和任务重新推导，先形成需求模型，再比较组织方式，最后映射物理文件；旧候选不享有默认保留权。
产品目标、v2.1、Contract Spine、安全与授权保持；没有推进产品迁移或重设计产品架构。

## 需求与候选比较

读者在学习、理解系统、精确查询、实施、排障、交付/恢复及接手任务之间切换。
开发能力同时覆盖需求/质量要求、领域术语、逻辑/运行/物理结构、构造/生成/集成、构建/启动/调试/验收。
按模块、活动、信任/语言/进程边界和失败/降级/取消/恢复/退出交叉检查，完整表见[覆盖矩阵](agent-workflow/coverage.md)。

| 组织选择 | 解决什么、代价是什么 | 决定 |
|---|---|---|
| 只按组件存放一切 | 单点 owner 好找；同一组件的学习、查表和操作混在长页，跨域操作被重复 | 用于组件解释，不作为全部信息布局 |
| 全部按 Diátaxis 四种目的重排 | 易区分读者目的；若连目标/ADR/进度都强塞四类，会隐藏规范与证据生命周期 | 用于判断写法，教程/操作按目的组织；架构/治理/状态/历史按职责保留 |
| 任务导航＋单一正文 owner＋按需专项能力 | 允许从用户成果或已知模块直接进入；要维护少量跨引用和任务覆盖 | 采用；必须用实际请求和内容核验，不能只验目录 |
| 单一全能 Skill | 发现成本低；专业描述失焦，条件性方法进入无关工作 | 放弃，不再保留 generic glimmer-cradle 入口 |
| 按每个目录、语言或开发阶段拆 Skill | 许多描述重叠，同一内聚任务要反复路由，难处理跨进程链 | 放弃；以独立任务、关键判断和工具/失败模式拆分 |

选择的依据链、官方要求与项目判断的界限见[设计决定](agent-workflow/design-decisions.md)，
实际原文/资源调查见[研究](agent-workflow/research.md)，逐项旧→新处理见[迁移记录](agent-workflow/migration.md)。

## 能力边界与按需加载

采用九个专项 Skill。数量是本轮项目适配，尚不由小样本实验证明为最优；可按反馈合并/收窄。
根 AGENTS 负责共同边界，docs 任务入口负责导航；普通开发不要求加载一个无专业方法的通用 Skill。

| Skill | 触发、方法与成果 | 不应触发/组合边界 |
|---|---|---|
| [ui](../../.agents/skills/glimmer-ui/SKILL.md) | 流程/状态、视觉/token、React 异步/清理、a11y、响应式、浏览器成果 | 后端；新营销方向不覆盖已确认 app 简报 |
| [services](../../.agents/skills/glimmer-services/SKILL.md) | 服务/数据 owner、事务/并发/Jobs、配置、readiness、恢复 | 独立集成任务转 integrations；认知策略转 cognition |
| [cognition](../../.agents/skills/glimmer-cognition/SKILL.md) | 身份、上下文来源/预算、记忆/知识证据、规划/模型评估 | 平台 IO 在 Worker/adapter；不处理开发 agent 设置 |
| [desktop](../../.agents/skills/glimmer-desktop/SKILL.md) | Electron/IPC、进程/窗口、Unity/C#/Native/Live2D、音频设备与首帧 | 浏览器 fixture 不能代替 OS/设备验收 |
| [contracts](../../.agents/skills/glimmer-contracts/SKILL.md) | wire/Document/公开 SDK 变更、生成、兼容、真实语言 consumer | 仅调试现有接口不必改协议；不手写 DTO |
| [integrations](../../.agents/skills/glimmer-integrations/SKILL.md) | SDK consumer、安装/身份/贡献、MCP/渠道映射、权限/撤销/unknown | 服务事务才组合 services，公开形状才组合 contracts |
| [delivery](../../.agents/skills/glimmer-delivery/SKILL.md) | CI run/SHA/log、固定制品、来源/builder 信任、安装/回滚 | 普通编译不触发；无推送/发布/生产授权推断 |
| [investigation](../../.agents/skills/glimmer-investigation/SKILL.md) | 不明根因、竞态/性能、已确认缺陷变体；有界因果实验 | 已知局部修正不用完整调查；无种子不扫库 |
| [documentation](../../.agents/skills/glimmer-documentation/SKILL.md) | 读者成果、事实/状态核验、写作/导航/正文迁移、独立使用 | 普通问答或 Word/PDF 制品；局部拼写无需重建全图 |

宿主先发现名称/描述；任务匹配后才读正文。正文指向直接事实与条件性细节，不要求读全部资源。
仅五份专项 reference：UI 外部能力、服务持久化、模型评估、Avatar、音频；共享安全/验收/恢复在完整指南一处维护。
所有九个入口配 UI metadata 是本项目的工具可发现性选择，平台只要求 SKILL.md；默认允许隐式调用。
本地平铺/不收 symlink 的检查是仓库交付约定，不是 Codex 不支持嵌套或 symlink 的主张。

## 实际文件组织

下树列出协作范围的全部 Skill 和主要资料职责；[生成文档树](documentation-architecture.md#文件清单视图)列出每个 docs 文件。
清单权威仍为 files.json，不手工维护第二个完整 manifest。

```text
AGENTS.md
.agents/skills/
  glimmer-ui/                  SKILL.md, agents/openai.yaml, references/external-capabilities.md
  glimmer-services/            SKILL.md, agents/openai.yaml, references/persistence.md
  glimmer-cognition/           SKILL.md, agents/openai.yaml, references/model-evaluation.md
  glimmer-desktop/             SKILL.md, agents/openai.yaml, references/avatar.md, references/audio.md
  glimmer-contracts/           SKILL.md, agents/openai.yaml
  glimmer-integrations/        SKILL.md, agents/openai.yaml
  glimmer-delivery/            SKILL.md, agents/openai.yaml
  glimmer-investigation/       SKILL.md, agents/openai.yaml
  glimmer-documentation/       SKILL.md, agents/openai.yaml
docs/
  README.md                   用户任务入口，合并开发手册与通用路由
  tutorials/首次受控验证.md    得到第一个可观察结果
  how-to/                     开发、调试、验收、权限、交付与恢复的完整操作
  reference/                  精确语义与定义来源，包含 naming.md
  architecture/
    target/                   规范目标、精确物理清单、摘要
    decisions/                决策及原语境
    current/                  跨组件系统/运行/部署视图
    implementation/           单一组件说明；Cognition 主链与 Memory/Planning 条件性细节
  governance/
    agent-workflow-design.md  能力边界/组合/维护
    documentation-architecture.md, documentation.md
    agent-workflow/           design-decisions.md, migration.md, coverage.md, research.md, evaluation.md
  roadmap/, history/          当前任务状态与历史证据分开
tools/repo-checks/src/
  docs/                       Markdown AST、文件/章节链接、可达性与生成树检查
  skills/                     入口、元数据、引用、唯一源与 Git 可见性检查
```

## 代表任务与执行深度

修表单→ui＋feature/controller＋既有 UI 指南→定向反例与真实浏览器；不重新设计营销视觉。
修 Jobs 恢复→services/persistence＋Jobs owner＋恢复指南→临时真实库/原 attempt/unknown/ACK；不切生产库。
改 Avatar 字段→contracts＋desktop/avatar＋IDL/mapper→生成/跨语言 roundtrip，实机门单列。
修文档当前 owner→documentation＋所属代码/consumer→正确正文和请求路径，不读整套研究。
继续 v2→原 initiative 的 execution.json/任务书→对应切片门，不能从本设计推导产品进度。
完整正反请求、跨链与应避免加载见[请求路径](agent-workflow/coverage.md#代表请求的读取路径)。

固定门仅保留在唯一源、数据保护、权限、跨代资源与高风险接受等有正确性理由的地方。
计划、方案数量、分工、审查和测试范围与风险/未知项相称，用户已有授权持续有效。
超时不能证明副作用或进程已终止；按[恢复](../how-to/长任务与恢复.md)查原身份/回执再继续。

## 维护、复验与回退

模块 owner 变更实现时维护所属正文、指南和直接 consumer；能力维护者处理方法/描述重叠及场景回归。
新增模块用覆盖矩阵的模块/活动/链路/生命周期维度检查，优先补现有方法，独立任务确有需要才加 Skill。
重复失败或文档漂移先修代码/工具/事实源，有复现实例再调整最小规则；不把每次失败加成永久门。
上游重要机制或被采用方法变化时固定新来源、检查许可/行为/依赖并重跑受影响场景，不设置定时任务。

检查命令与接受规则归[文档维护](../how-to/文档维护.md)和[测试与验收](../how-to/测试与验收.md)。
实际结果、失败/修正和环境限制归 evaluation；旧候选结果不追溯增强。
回退同时恢复正文/消费者/精确清单/生成树/摘要，保留已存在用户 dirty，不恢复两套长期兼容入口。

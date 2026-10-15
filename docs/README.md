# Glimmer Cradle 文档中心

Glimmer Cradle 是承载角色的多进程平台，Selrena（月见）是默认角色。当前产品为 Desktop 与 Personal Server；
Host 和分域模块的局部实现与默认产品切换分别判断。目标、当前接线和已取得的运行证据不是同一状态。

按要取得的成果选择入口；已知 owner 时直接进入所属资料与源码，不要求先读完整地图或通用 Skill。

| 要完成什么 | 入口与实际 owner | 按需组合的项目 Skill |
|---|---|---|
| 第一次验证代码和一个界面 | [首次受控验证](tutorials/首次受控验证.md)；缺工具先[准备环境](how-to/本地开发环境.md) | 沿教程即可 |
| 理解目标、术语、系统关系和取舍 | [目标](architecture/target/README.md)、[系统上下文](architecture/current/02-系统上下文.md)、[当前系统](architecture/current/README.md)、[ADR](architecture/decisions/README.md) | 无需默认加载专项 |
| 澄清需求、建模、实现功能或修 bug | [功能开发与缺陷修复](how-to/功能开发与缺陷修复.md)、[实现地图](architecture/implementation/README.md) | 按下面的实际领域选择 |
| 改 Host/Platform、配置、生命周期 | [Platform](architecture/implementation/Platform原语实现.md)、[Kernel/Runtime](architecture/implementation/Kernel与Runtime实现.md)；`apps/host` 与产品 Kernel consumer 分别核验 | [services](../.agents/skills/glimmer-services/SKILL.md) |
| 改 Conversation、Content、Jobs、Capabilities 或持久数据 | [实现地图](architecture/implementation/README.md)、[数据布局](reference/data-layout.md)；对应 Core owner 与 App composition | services；改数据再读其 persistence reference |
| 改 persona、Context、Inference、Memory/Knowledge、Planning | [Cognition 操作](how-to/Cognition开发.md)、[认知实现](architecture/implementation/Cognition认知核实现.md)；Core 策略与 Worker IO 分开 | [cognition](../.agents/skills/glimmer-cognition/SKILL.md) |
| 改 Web/Renderer、用户流程、视觉与交互 | [UI 操作与验收](how-to/前端开发与UI验收.md)、现有 brief/token/组件 | [ui](../.agents/skills/glimmer-ui/SKILL.md)；外部专业能力按表面组合 |
| 改 Electron、Presence、窗口、Avatar/Unity/Native 或音频 | [桌面](how-to/桌面与Avatar开发.md)、[音频](how-to/音频引擎开发.md)和实际平台 owner | [desktop](../.agents/skills/glimmer-desktop/SKILL.md) |
| 改 Service、Document Schema 或公开 SDK 兼容 | [契约操作](how-to/Schema与跨进程契约变更.md)、[协议](reference/protocol.md)；当前 `contracts` 与 `packages/extension-sdk` | [contracts](../.agents/skills/glimmer-contracts/SKILL.md) |
| 改 Extension、MCP、渠道 Adapter 或产品 Skill Plane | [扩展操作](how-to/扩展开发.md)、[SDK](reference/extension-sdk.md)、[扩展实现](architecture/implementation/Extension与SkillPlane实现.md) | [integrations](../.agents/skills/glimmer-integrations/SKILL.md)；关联仓库仅按已有授权写入 |
| 查不明故障、竞态、性能或已确认缺陷的同类 | [日志/Trace/DLQ](how-to/日志、Trace与DLQ排障.md)、[性能](how-to/性能诊断.md)、实际 trace/复现 | [investigation](../.agents/skills/glimmer-investigation/SKILL.md)＋相关领域 |
| 修 CI、验证固定制品、打包、安装/回滚 | [工程任务](reference/engineering-lifecycle.md)、[制品](reference/packaging-layout.md)、[客户端打包](how-to/客户端打包.md)、[Server 部署](how-to/Personal%20Server部署.md) | [delivery](../.agents/skills/glimmer-delivery/SKILL.md)；普通编译直接用 package scripts |
| 核验安全边界或恢复用户数据 | [权限与外部边界](how-to/审查权限与外部边界.md)、[数据迁移与恢复](how-to/数据迁移与恢复.md) | 相应领域；无须为普通任务展开全仓安全审查 |
| 查询配置、Schema、数据、SDK、命名或 UI token | [技术参考](reference/README.md)及其实际定义 | 无需完整操作流程 |
| 写文档、核验事实或重组知识 | [文档维护](how-to/文档维护.md)、所属正文与源码；结构不清再查[文档架构](governance/documentation-architecture.md) | [documentation](../.agents/skills/glimmer-documentation/SKILL.md)；局部拼写直接修 |
| 明确要求继续架构 v2 | [架构项目](roadmap/initiatives/architecture-v2/README.md) 的机器状态和原任务书 | 相关领域＋[切片操作](how-to/执行架构切片.md)；不从历史恢复 |
| 长任务接手或副作用结果未知 | [长任务与恢复](how-to/长任务与恢复.md)、当前任务记录/回执 | 沿原 owner/身份恢复 |
| 查承诺、旧设计或旧证据 | [路线图](roadmap/README.md)、[历史](history/README.md) | 保留原候选与适用条件 |

## 资料的适用边界

目标要求以 [v2.1](architecture/target/baseline.md) 和采用 ADR 为准；当前说法用实际源码、Schema、manifest、consumer 核验。
测试、替身、设备、安装与生产证据分别判断。目录、声明或旧 PASS 不证明当前产品已经接入或 ready。
操作指南同时提供必要解释与完整步骤；Skill 提供专项执行判断，两者都供人和 Codex 使用。
共同边界在 [AGENTS.md](../AGENTS.md)，共享[测试验收](how-to/测试与验收.md)不另复制到每个 Skill。

维护本体系时再读[覆盖矩阵与请求路径](governance/agent-workflow/coverage.md)、[设计与实际文件树](governance/agent-workflow-design.md)、
[来源研究](governance/agent-workflow/research.md)、[验证记录](governance/agent-workflow/evaluation.md)及[治理索引](governance/README.md)。这些不是普通任务的必读包。

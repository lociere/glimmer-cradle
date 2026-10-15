# 本轮内容迁移记录

2026-10-15 从完整开始快照逐项映射；当前清单仍只由 files.json 维护。本页只记录这次迁移。
主仓唯一写入 owner 为本会话；此前候选与用户 dirty 分开保存，未整体恢复 Git 或旧快照。
产品、目标 v2.1、原执行状态和不可再生数据不因资料迁移而改变。依据与候选比较见[设计决定](design-decisions.md)，验证见[evaluation](evaluation.md)。

## 旧文件的实际处理

| 开始时路径 | 处理/当前位置 | 具体用途与理由 |
|---|---|---|
| `.agents/skills/glimmer-cognition/SKILL.md` | 重写/更新（路径保留） | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-cognition/agents/openai.yaml` | 保留 | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-cognition/references/model-evaluation.md` | 保留 | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-contracts/SKILL.md` | 重写/更新（路径保留） | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-contracts/agents/openai.yaml` | 保留 | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-cradle/SKILL.md` | 合并/删除旧入口 → `docs/README.md` | 用户成果/owner 路由只在任务首页维护，无通用 Skill 的额外加载 |
| `.agents/skills/glimmer-cradle/agents/openai.yaml` | 删除 | 通用 Skill 退役，UI 元数据无独立消费者 |
| `.agents/skills/glimmer-desktop/SKILL.md` | 重写/更新（路径保留） | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-desktop/agents/openai.yaml` | 保留 | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-desktop/references/audio.md` | 重写/更新（路径保留） | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-desktop/references/avatar.md` | 重写/更新（路径保留） | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-documentation/SKILL.md` | 重写/更新（路径保留） | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-documentation/agents/openai.yaml` | 保留 | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-investigation/SKILL.md` | 重写/更新（路径保留） | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-investigation/agents/openai.yaml` | 保留 | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-services/SKILL.md` | 重写/更新（路径保留） | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-services/agents/openai.yaml` | 重写/更新（路径保留） | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-services/references/extensions.md` | 重写/删除旧卡 → `.agents/skills/glimmer-integrations/SKILL.md` | 集成有独立 SDK/安装/权限/撤销任务和专业方法，提升可发现性 |
| `.agents/skills/glimmer-services/references/persistence.md` | 重写/更新（路径保留） | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-services/references/security.md` | 迁移到 `docs/how-to/审查权限与外部边界.md` | 多个领域共用权限方法，人/Codex 直接使用完整指南，Skill 不再拥有第二份 |
| `.agents/skills/glimmer-ui/SKILL.md` | 重写/更新（路径保留） | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-ui/agents/openai.yaml` | 保留 | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `.agents/skills/glimmer-ui/references/external-capabilities.md` | 保留 | 保留独立任务方法和条件资源；收窄重叠、更新实际知识/共享指南路由 |
| `docs/governance/agent-workflow/coverage.md` | 重写/更新（路径保留） | 覆盖、研究、历史/本轮验证只在维护时读取，保留原实验限制 |
| `docs/governance/agent-workflow/evaluation.md` | 重写/更新（路径保留） | 覆盖、研究、历史/本轮验证只在维护时读取，保留原实验限制 |
| `docs/governance/agent-workflow/research.md` | 重写/更新（路径保留） | 覆盖、研究、历史/本轮验证只在维护时读取，保留原实验限制 |
| `docs/guides/development/长任务与恢复.md` | 迁移到 `docs/how-to/长任务与恢复.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/onboarding/首次受控验证.md` | 迁移到 `docs/tutorials/首次受控验证.md` | 有已运行 fixture 与界面反馈的连续学习路径，与环境准备/操作指南分开 |
| `AGENTS.md` | 重写/更新（路径保留） | 保留共同产品/安全/工具边界；导航与协作约定可调整，不注入全套专业方法 |
| `docs/README.md` | 重写/更新（路径保留） | 有实际读者/任务导航用途；合并旧手册及通用路由，知识不分人/AI |
| `docs/architecture/README.md` | 重写/更新（路径保留） | 有实际读者/任务导航用途；合并旧手册及通用路由，知识不分人/AI |
| `docs/architecture/current/01-目标、约束与质量属性.md` | 重写/更新（路径保留） | 跨组件系统/依赖/运行/部署关系有独立受众，引用唯一组件详细说明 |
| `docs/architecture/current/02-系统上下文.md` | 重写/更新（路径保留） | 跨组件系统/依赖/运行/部署关系有独立受众，引用唯一组件详细说明 |
| `docs/architecture/current/03-运行拓扑与进程边界.md` | 重写/更新（路径保留） | 跨组件系统/依赖/运行/部署关系有独立受众，引用唯一组件详细说明 |
| `docs/architecture/current/04-构件、分层与依赖.md` | 保留 | 跨组件系统/依赖/运行/部署关系有独立受众，引用唯一组件详细说明 |
| `docs/architecture/current/05-关键运行时链路.md` | 保留 | 跨组件系统/依赖/运行/部署关系有独立受众，引用唯一组件详细说明 |
| `docs/architecture/current/06-跨切面机制.md` | 保留 | 跨组件系统/依赖/运行/部署关系有独立受众，引用唯一组件详细说明 |
| `docs/architecture/current/07-子系统当前视图/Cognition.md` | 合并/删除旧页 → `docs/architecture/implementation/Cognition认知核实现.md` | 同一组件概念/当前实现只维护一份；保留语义与失败边界，核正时态/真实 owner |
| `docs/architecture/current/07-子系统当前视图/Data与Observability.md` | 合并/删除旧页 → `docs/architecture/implementation/数据、记忆与可观测性实现.md` | 同一组件概念/当前实现只维护一份；保留语义与失败边界，核正时态/真实 owner |
| `docs/architecture/current/07-子系统当前视图/Desktop与Avatar.md` | 合并/删除旧页 → `docs/architecture/implementation/Desktop与Avatar实现.md` | 同一组件概念/当前实现只维护一份；保留语义与失败边界，核正时态/真实 owner |
| `docs/architecture/current/07-子系统当前视图/Engines与Native.md` | 合并/删除旧页 → `docs/architecture/implementation/Engines与Native实现.md` | 同一组件概念/当前实现只维护一份；保留语义与失败边界，核正时态/真实 owner |
| `docs/architecture/current/07-子系统当前视图/Extension与SkillPlane.md` | 合并/删除旧页 → `docs/architecture/implementation/Extension与SkillPlane实现.md` | 同一组件概念/当前实现只维护一份；保留语义与失败边界，核正时态/真实 owner |
| `docs/architecture/current/07-子系统当前视图/Kernel与Runtime.md` | 合并/删除旧页 → `docs/architecture/implementation/Kernel与Runtime实现.md` | 同一组件概念/当前实现只维护一份；保留语义与失败边界，核正时态/真实 owner |
| `docs/architecture/current/07-子系统当前视图/README.md` | 合并/删除旧页 → `docs/architecture/implementation/README.md` | 同一组件概念/当前实现只维护一份；保留语义与失败边界，核正时态/真实 owner |
| `docs/architecture/current/08-部署与交付形态.md` | 重写/更新（路径保留） | 跨组件系统/依赖/运行/部署关系有独立受众，引用唯一组件详细说明 |
| `docs/architecture/current/09-术语表.md` | 保留 | 跨组件系统/依赖/运行/部署关系有独立受众，引用唯一组件详细说明 |
| `docs/architecture/current/10-当前物理拓扑.md` | 重写/更新（路径保留） | 跨组件系统/依赖/运行/部署关系有独立受众，引用唯一组件详细说明 |
| `docs/architecture/current/README.md` | 重写/更新（路径保留） | 跨组件系统/依赖/运行/部署关系有独立受众，引用唯一组件详细说明 |
| `docs/architecture/decisions/ADR-0000-模板.md` | 保留 | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0001-企划平台与角色Profile分层.md` | 保留 | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0002-AttentionLease与CognitiveActivity分层.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0003-CharacterPackage与MemorySubstrate分层.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0004-Extension开放生态运行边界.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0005-Character-Avatar-Surface-Host分层.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0006-Desktop物理归属与Electron进程分层.md` | 保留 | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0007-UnityAvatarHost程序集边界与SDK投影.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0008-ExperienceLedger与版本化Memory.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0009-本地监督树与动态端点治理.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0010-产品组合与扩展仓库边界.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0011-Extension发布与开放生态边界.md` | 保留 | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0012-场景Adapter与平台受管资源分层.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0013-契约脊柱与跨进程服务架构.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0014-仓库物理分层与器官模块边界.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0015-工程自动化平面与交付生命周期分层.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0016-仓库工具工作区与产品监督边界.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0017-产品前端统一采用React组件驱动架构.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0018-Personal Server宿主与服务状态分域.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0019-采用Architecture-Baseline-v2冻结基线.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0020-Content资产单写者与恢复边界.md` | 保留 | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0021-架构基线规范修订与命名收束.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0022-ConversationLog与Experience投影边界.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0023-最终目标蓝图与物理目录契约.md` | 保留 | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/ADR-0024-文档职责与重构执行体系整合.md` | 保留 | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/decisions/README.md` | 重写/更新（路径保留） | 采用决定及原语境是长期取舍证据；正文语义不因重新分类而追改 |
| `docs/architecture/implementation/Cognition认知核实现.md` | 重写/更新（路径保留） | 主认知链仍有独立用途；长 Memory/Knowledge 与 Planning 按需拆分，原执行状态引用此有用主文 |
| `docs/architecture/implementation/Conversation实现.md` | 保留 | 组件职责/真实接线/状态/失败需要同主题解释；整合 Current 独有内容并核对源码 |
| `docs/architecture/implementation/Desktop与Avatar实现.md` | 重写/更新（路径保留） | 组件职责/真实接线/状态/失败需要同主题解释；整合 Current 独有内容并核对源码 |
| `docs/architecture/implementation/Engines与Native实现.md` | 重写/更新（路径保留） | 组件职责/真实接线/状态/失败需要同主题解释；整合 Current 独有内容并核对源码 |
| `docs/architecture/implementation/Extension与SkillPlane实现.md` | 重写/更新（路径保留） | 组件职责/真实接线/状态/失败需要同主题解释；整合 Current 独有内容并核对源码 |
| `docs/architecture/implementation/Kernel与Runtime实现.md` | 重写/更新（路径保留） | 组件职责/真实接线/状态/失败需要同主题解释；整合 Current 独有内容并核对源码 |
| `docs/architecture/implementation/Platform原语实现.md` | 重写/更新（路径保留） | 组件职责/真实接线/状态/失败需要同主题解释；整合 Current 独有内容并核对源码 |
| `docs/architecture/implementation/Protocol契约层实现.md` | 保留 | 组件职责/真实接线/状态/失败需要同主题解释；整合 Current 独有内容并核对源码 |
| `docs/architecture/implementation/README.md` | 重写/更新（路径保留） | 组件职责/真实接线/状态/失败需要同主题解释；整合 Current 独有内容并核对源码 |
| `docs/architecture/implementation/工程生命周期实现.md` | 重写/更新（路径保留） | 组件职责/真实接线/状态/失败需要同主题解释；整合 Current 独有内容并核对源码 |
| `docs/architecture/implementation/数据、记忆与可观测性实现.md` | 重写/更新（路径保留） | 组件职责/真实接线/状态/失败需要同主题解释；整合 Current 独有内容并核对源码 |
| `docs/architecture/target/README.md` | 保留 | 产品目标/精确清单/生成树/摘要职责独立；仅同步协作资源，不改产品语义 |
| `docs/architecture/target/baseline.lock.json` | 重写/更新（路径保留） | 产品目标/精确清单/生成树/摘要职责独立；仅同步协作资源，不改产品语义 |
| `docs/architecture/target/baseline.md` | 重写/更新（路径保留） | 产品目标/精确清单/生成树/摘要职责独立；仅同步协作资源，不改产品语义 |
| `docs/architecture/target/files.json` | 重写/更新（路径保留） | 产品目标/精确清单/生成树/摘要职责独立；仅同步协作资源，不改产品语义 |
| `docs/architecture/target/physical-layout.md` | 重写/更新（路径保留） | 产品目标/精确清单/生成树/摘要职责独立；仅同步协作资源，不改产品语义 |
| `docs/governance/README.md` | 重写/更新（路径保留） | 信息归属/质量/授权分别有维护职责；从需求重写，取消旧目录/数量预设 |
| `docs/governance/agent-workflow-design.md` | 重写/更新（路径保留） | 信息归属/质量/授权分别有维护职责；从需求重写，取消旧目录/数量预设 |
| `docs/governance/architecture-change-policy.md` | 重写/更新（路径保留） | 信息归属/质量/授权分别有维护职责；从需求重写，取消旧目录/数量预设 |
| `docs/governance/documentation-architecture.md` | 重写/更新（路径保留） | 信息归属/质量/授权分别有维护职责；从需求重写，取消旧目录/数量预设 |
| `docs/governance/documentation.md` | 重写/更新（路径保留） | 信息归属/质量/授权分别有维护职责；从需求重写，取消旧目录/数量预设 |
| `docs/guides/README.md` | 迁移到 `docs/how-to/README.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/development/AI辅助前端开发.md` | 合并/删除旧页 → `docs/how-to/前端开发与UI验收.md` | 保留实际组件/Playwright/构建/报告工具表，避免两份 UI 执行流程 |
| `docs/guides/development/Schema与跨进程契约变更.md` | 迁移到 `docs/how-to/Schema与跨进程契约变更.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/development/architecture-refactoring.md` | 迁移到 `docs/how-to/执行架构切片.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/development/前端开发与UI验收.md` | 迁移到 `docs/how-to/前端开发与UI验收.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/development/功能开发与缺陷修复.md` | 迁移到 `docs/how-to/功能开发与缺陷修复.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/development/命名规范.md` | 迁移到 `docs/reference/naming.md` | 精确术语与命名是查询参考，不应藏在开发阶段指南 |
| `docs/guides/development/文档维护.md` | 迁移到 `docs/how-to/文档维护.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/development/架构性改动.md` | 迁移到 `docs/how-to/架构性改动.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/development/测试与验收.md` | 迁移到 `docs/how-to/测试与验收.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/onboarding/本地开发环境.md` | 迁移到 `docs/how-to/本地开发环境.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/operations/性能诊断.md` | 迁移到 `docs/how-to/性能诊断.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/operations/数据迁移与恢复.md` | 迁移到 `docs/how-to/数据迁移与恢复.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/operations/日志、Trace与DLQ排障.md` | 迁移到 `docs/how-to/日志、Trace与DLQ排障.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/release/Personal Server部署.md` | 迁移到 `docs/how-to/Personal Server部署.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/release/客户端打包.md` | 迁移到 `docs/how-to/客户端打包.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/subsystems/Cognition开发.md` | 迁移到 `docs/how-to/Cognition开发.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/subsystems/Kernel开发.md` | 迁移到 `docs/how-to/Kernel开发.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/subsystems/扩展开发.md` | 迁移到 `docs/how-to/扩展开发.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/subsystems/桌面与Avatar开发.md` | 迁移到 `docs/how-to/桌面与Avatar开发.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/subsystems/音频引擎开发.md` | 迁移到 `docs/how-to/音频引擎开发.md` | 按实际操作任务扁平归入 how-to，切换导航/章节及命令引用，不再先猜开发阶段 |
| `docs/guides/开发手册.md` | 合并/删除旧入口 → `docs/README.md` | 用户成果/owner 路由只在任务首页维护，无通用 Skill 的额外加载 |
| `docs/history/README.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-decisions/README.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-decisions/阶段2-数据持久化设计.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-decisions/阶段3-遥测设计.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-decisions/阶段4-觉醒态设计.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-decisions/阶段5-认知循环设计.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-decisions/阶段6-反思与记忆图谱设计.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-decisions/阶段7-自主输出通路设计.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-decisions/阶段8-渲染层架构分析与重构.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-decisions/阶段P-Protocol契约层重构.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-decisions/阶段P9-契约层与包管理自洽化重构.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-v1/2026-09-19-roadmap-now.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-v1/README.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-v1/blueprint-realization.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-v1/微光摇篮架构蓝图.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-v1/目标物理拓扑.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-v2.0/Architecture_Baseline_v2.0_执行宪章.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-v2.0/Glimmer_Cradle_Architecture_Baseline_v2.0_Frozen.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-v2.0/Glimmer_Cradle_Codex_Refactor_Prompt_v2.0.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-v2.0/README.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-v2/2026-10-09-execution-log.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/architecture-v2/README.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/incidents/2026-05-08-Electron启动环境变量污染.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/incidents/2026-05-08-KernelJS导入不一致.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/incidents/README.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-current-architecture/00-架构总览.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-current-architecture/01-协议层.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-current-architecture/02-基础设施层.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-current-architecture/03-领域层.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-current-architecture/04-应用层.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-current-architecture/05-插件层.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-current-architecture/06-依赖规则与检查清单.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-current-architecture/07-Cognition认知核.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-current-architecture/08-记忆与日志架构.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-current-architecture/09-日志字段表.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-current-architecture/README.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-extensions/AgentSkill与MCP指南.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-extensions/README.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-extensions/扩展API参考.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-extensions/扩展开发指南.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-guides/Cognition开发指南.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-guides/Data目录指南.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-guides/Kernel开发指南.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-guides/Python环境指南.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-guides/UI色彩参考.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-guides/UI设计指南.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-guides/ui-references/README.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-guides/客户端安装形态.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-guides/客户端打包指南.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-guides/开发总则.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-guides/开发流程.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-guides/桌面渲染开发指南.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-guides/音频引擎指南.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-roadmap/后续增强.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-roadmap/当前推进.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/legacy-roadmap/蓝图落地流程.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/milestones/M08-SkillPlane、Extension与桌面体验收口.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/milestones/M09-主体可用性、跨场景记忆与体验收口.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/milestones/M10-发布形态、安装投影与数据迁移闭环.md` | 重写/更新（路径保留） | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/milestones/M12-契约脊柱与跨进程服务架构重建.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/milestones/M13-工程自动化脊柱与交付生命周期闭环.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/milestones/README.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/milestones/manifests/M12-目标物理清单.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/milestones/manifests/M13-目标物理清单.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/history/milestones/manifests/README.md` | 保留 | 原候选/历史结论有追溯价值；仅切失效导航，不把旧证据增强为当前接受 |
| `docs/reference/README.md` | 重写/更新（路径保留） | 精确语义/定义源有查询用途；不复制长操作或把目标当实现 |
| `docs/reference/configuration.md` | 重写/更新（路径保留） | 精确语义/定义源有查询用途；不复制长操作或把目标当实现 |
| `docs/reference/data-layout.md` | 重写/更新（路径保留） | 精确语义/定义源有查询用途；不复制长操作或把目标当实现 |
| `docs/reference/engineering-lifecycle.md` | 重写/更新（路径保留） | 精确语义/定义源有查询用途；不复制长操作或把目标当实现 |
| `docs/reference/extension-sdk.md` | 重写/更新（路径保留） | 精确语义/定义源有查询用途；不复制长操作或把目标当实现 |
| `docs/reference/observability.md` | 保留 | 精确语义/定义源有查询用途；不复制长操作或把目标当实现 |
| `docs/reference/packaging-layout.md` | 重写/更新（路径保留） | 精确语义/定义源有查询用途；不复制长操作或把目标当实现 |
| `docs/reference/product-compositions.md` | 重写/更新（路径保留） | 精确语义/定义源有查询用途；不复制长操作或把目标当实现 |
| `docs/reference/protocol.md` | 重写/更新（路径保留） | 精确语义/定义源有查询用途；不复制长操作或把目标当实现 |
| `docs/reference/ui-design-tokens.md` | 重写/更新（路径保留） | 精确语义/定义源有查询用途；不复制长操作或把目标当实现 |
| `docs/roadmap/README.md` | 重写/更新（路径保留） | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/backlog.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/README.md` | 重写/更新（路径保留） | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/acceptance.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/evidence/2026-10-09-P02A.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/evidence/2026-10-09-P07A.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/evidence/2026-10-09-P07B.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/evidence/2026-10-09-docs-integration.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/evidence/2026-10-09-execution-order.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/evidence/README.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/execution-order.md` | 重写/更新（路径保留） | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/execution.json` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/migration-map.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/plan.md` | 重写/更新（路径保留） | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/requirements.md` | 重写/更新（路径保留） | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/risks.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/slices/A00-reconcile.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/slices/TEMPLATE.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/architecture-v2/status.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/m11-delivery/M11-Personal Server UI设计简报.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/m11-delivery/README.md` | 重写/更新（路径保留） | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/m11-delivery/physical-layout.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/m11-delivery/reference-assets/m11-ui/accent-a-qingyao.svg` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/m11-delivery/reference-assets/m11-ui/accent-b-paraiba.svg` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/m11-delivery/reference-assets/m11-ui/accent-c-peacock.svg` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/initiatives/m11-delivery/reference-assets/m11-ui/m11-accepted-overview-dark-light-narrow.png` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |
| `docs/roadmap/now.md` | 保留 | 对应任务承诺、恢复点和进度独立；仅切资料消费者，execution.json 保持开始字节 |

## 新增资源及用途

| 路径 | 具体用途 |
|---|---|
| `.agents/skills/glimmer-integrations/agents/openai.yaml` | 独立集成任务的发现元数据；正文由旧卡重写 |
| `.agents/skills/glimmer-delivery/SKILL.md` | CI/固定制品/信任与安装恢复专业方法及发现元数据 |
| `.agents/skills/glimmer-delivery/agents/openai.yaml` | CI/固定制品/信任与安装恢复专业方法及发现元数据 |
| `docs/architecture/implementation/CognitionPlanning实现.md` | 承诺/Jobs 深细节按需读取 |
| `docs/architecture/implementation/CognitionMemory与Knowledge实现.md` | Memory/Knowledge 深细节按需读取 |
| `docs/governance/agent-workflow/design-decisions.md` | 关键依据→需求→采用/适配→验证链 |
| `docs/governance/agent-workflow/migration.md` | 一次性旧→新处理与恢复追溯 |
| `tools/repo-checks/src/docs/markdown.mjs` | 确定性 CommonMark 链接/标题提取，供 docs/skills 检查共用 |

## 更早候选、消费者与恢复

Git `b885debb` 中的 `.codex/skills/glimmer-cradle/`（18 文件）在前轮已逐篇调查并替换；本轮不恢复副本。
原 16 references 的协议/认知/桌面/UI/数据方法分别进入相应专项或完整指南；共享验证/恢复两卡已合入指南。原运行数据及限制保留在 evaluation 的对应轮次。
本轮所有活跃链接先指向接替页；组件旧正文在独立源码对照与整合后删除，旧文件保留于 Git 和开始快照。
精确路径、生成树及受影响摘要在同一候选同步，历史裸路径只作为原语境保留，不作为可执行入口。
恢复需同时还原正文/消费者/文件清单/生成视图/摘要及检查器，不能只恢复旧 Skill。
不得覆盖开始即存在的两个 Kernel 源码 dirty 和 execution.json；本轮原始快照/命令/审查记录放于临时审计目录，长期复验以本文、研究/验证记录和同一 Git diff 为准。

# 架构 v2 重构

> 范围：将 v2.1 联合目标落实为目录、行为、数据与制品一致的首版成果。
> 事实依据：目标基线、ADR-0023/0024、Git dc59181e 与历史执行证据。
> 维护触发：任务、依赖、实现、验证、风险或基线发生变化。

## 接手顺序

1. 读取项目 Skill 和本页，核对实际 Git/写入 owner。
2. 读取[状态](status.md)；机器状态唯一源为 [execution.json](execution.json)，禁止手改生成视图。
3. 读取指定[接手任务 A00](slices/A00-reconcile.md)以及该任务引用的当前源码和历史证据。
4. 使用[通用切片流程](../../../guides/development/architecture-refactoring.md)达到入口门后，才进入实施。
5. 依照[阶段计划](plan.md)和[验收矩阵](acceptance.md)推进；未通过的必要门不得记为完成。

## 职责与入口

| 文档 | 唯一职责 |
|---|---|
| [目标基线](../../../architecture/target/README.md) | 产品目标和精确目录 |
| [架构变更宪章](../../../governance/architecture-change-policy.md) | 冻结、变更与迁移纪律 |
| [requirements.md](requirements.md) | 本项目交付要求，原已接受执行要求的归位 |
| [plan.md](plan.md) | 阶段依赖、分步成果、切片策略和退出门 |
| [execution.json](execution.json) / [status.md](status.md) | 阶段与任务状态 / 自动生成可读视图 |
| [migration-map.md](migration-map.md) | Current → Target 动作、owner 和删除条件 |
| [acceptance.md](acceptance.md) | 场景、检查命令与证据要求 |
| [risks.md](risks.md) | 未解决风险、责任和关闭条件 |
| [切片模板](slices/TEMPLATE.md) | 实施前的路径、行为、证据与退出契约 |
| [证据索引](evidence/README.md) | 固定候选、验证、审查和失效条件 |
| [历史原文](../../../history/architecture-v2/README.md) | 截至 dc59181e 的完整原始执行记录 |

当前 Core/Apps 已有多阶段交叉实现，不能重新从空仓启动，也不能将历史初版完成等同 v2.1 最终完成。
第三方环境隔离按职责、可替换性和生命周期判断；切片不得建立第二 Contract Spine 或状态 writer。

本项目完成后，产品事实归 Architecture/Reference/Guides；任务正文、状态与证据整体归 History，
保留结论和索引；移动历史文件时同步目标清单，不通过忽略文件制造 final PASS。

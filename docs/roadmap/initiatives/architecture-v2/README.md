# 架构 v2 重构

> 范围：将 v2.1 联合目标落实为目录、行为、数据与制品一致的首版成果。
> 事实依据：目标基线、ADR-0023/0024、Git dc59181e 与历史执行证据。
> 维护触发：任务、依赖、实现、验证、风险或基线发生变化。

## 接手顺序

已知本项目时直接从 [execution.json](execution.json) 的 in-progress/nextTask 和 nextAction 进入
[主执行任务书](execution-order.md)对应节；首次接手再读其公共规则。
[状态](status.md)是同源展示，不必与 JSON 重复读，禁止手改生成视图。专项 Skill 只按任务选择。
普通继续、上下文恢复与候选变化按[通用切片流程](../../../how-to/执行架构切片.md#接手与选择任务)分别处理，
不因恢复重跑导航/调查/检查。依照原完成门与[验收矩阵](acceptance.md)收束，不重新设计架构或重复起草计划。

## 职责与入口

| 文档 | 唯一职责 |
|---|---|
| [目标基线](../../../architecture/target/README.md) | 产品目标和精确目录 |
| [架构变更宪章](../../../governance/architecture-change-policy.md) | 冻结、变更与迁移纪律 |
| [requirements.md](requirements.md) | 本项目交付要求，原已接受执行要求的归位 |
| [execution-order.md](execution-order.md) | 唯一主执行任务书：固定顺序、每项具体动作、命令、完成门与例外处理 |
| [plan.md](plan.md) | 阶段成果归属和退出门，不拥有具体任务顺序 |
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

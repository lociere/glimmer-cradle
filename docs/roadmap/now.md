# 当前工作

> 范围：选定当前工作入口；具体阶段和任务状态由对应项目维护。
> 事实依据：架构 v2.1 及项目 execution.json/生成状态视图。
> 本次审阅：2026-10-15。维护触发：主线、授权范围或项目入口变化。

当前产品主线是[架构 v2 重构](initiatives/architecture-v2/README.md)。
接手时读取[状态与下一任务](initiatives/architecture-v2/status.md)，再按
[主执行任务书](initiatives/architecture-v2/execution-order.md)的固定步骤执行。
阶段状态不在本页重复维护；旧执行日志中的“下一步”只有经过当前任务表重新接纳才有效。

架构实现按项目 `execution.json` 的 `nextTask`、对应任务的 `nextAction` 和既有写入 owner 恢复；
本页不手写下一任务或复制阶段进度。接手时核对机器状态与当前 Git，不沿用历史文档整合时的起点。

[M11](initiatives/m11-delivery/README.md) 保留外部 Extension 恢复、QQ 环境和生产验收，
与本地主线的依赖及未验项统一链接[风险台账](initiatives/architecture-v2/risks.md)。
候选能力见[Backlog](backlog.md)。项目主线不自动成为当前用户任务的授权；
文档/工具工作不顺带推进产品切片，推送、部署与生产数据操作分别依据对应授权。

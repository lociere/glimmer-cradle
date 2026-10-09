# 当前工作

> 范围：选定当前工作入口；具体阶段和任务状态由对应项目维护。
> 事实依据：架构 v2.1、Git dc59181e 及项目执行状态。
> 本次审阅：2026-10-09。维护触发：主线、授权范围或项目入口变化。

当前产品主线是[架构 v2 重构](initiatives/architecture-v2/README.md)。
接手时读取[状态与下一任务](initiatives/architecture-v2/status.md)，再按
[切片执行指南](../guides/development/architecture-refactoring.md)执行。
阶段状态不在本页重复维护；旧执行日志中的“下一步”只有经过当前任务表重新接纳才有效。

此次文档整合完成后，产品实现从状态表指定的 **A00 接手与差距核对** 开始：
核对 dc59181e 后 Git 变化、已送达通知原身份恢复及未完成后继调度/撤销，
形成对应文件级任务契约后再进入代码实现。

[M11](initiatives/m11-delivery/README.md) 保留外部 Extension 恢复、QQ 环境和生产验收，
与本地主线的依赖及未验项统一链接[风险台账](initiatives/architecture-v2/risks.md)。
候选能力见[Backlog](backlog.md)。本轮授权为文档与执行体系整合，未开始下一产品实现切片；
推送、部署、生产数据操作与新用户任务分别依据对应授权。

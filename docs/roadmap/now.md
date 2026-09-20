# 当前推进

> 范围：当前授权目标、下一验收门和未完成外部事项；详细证据归对应执行记录。
> 事实依据：源码、[重构执行记录](./architecture-v2-refactor.md)、相关里程碑及历史验收材料。
> 本次审阅：2026-09-20。维护触发：目标、阶段、候选或验收门变化。

## 当前主线

按 [Architecture Baseline v2.0 规范修订 1](../architecture/blueprint/README.md) 渐进重构。
阶段 2 正在进行：Platform 的 Clock、StableIdentity、Observability、Lifecycle 与 LiveEvent contracts
已落地，Kernel 仍承担产品装配、readiness、领域事件、durable replay 和 DLQ。
完整阶段状态及验证范围只在 [执行记录](./architecture-v2-refactor.md) 维护。

本轮补齐文档权威入口、命名规则、当前与目标映射、Platform 实现说明以及可重复运行的文档检查。
文档修订不会把尚未迁移的 SDK、Conversation、Cognition Loop、Apps 或 Protocol 写为已完成。

## 下一验收门

1. 阶段 2 先调查真实消费者和职责归属，再选择成熟 primitive；未实现的 Scope/Topology 等不建空目录。
2. 每个源码切片给出 public contract、consumer 切换、旧 owner 删除条件和受影响数据的保护路径。
3. 通过相关测试、架构/文档/编码检查以及根 typecheck/build；运行链路变更补充对应启动、降级与停机验证。
4. 明确候选及验证范围；阶段通过不等于整体 v2 完成。

## 保留的未完成事项

| 事项 | 当前边界与入口 |
|---|---|
| M11 跨仓 Extension 安装/升级失败恢复 | 页面本地实现与外部分发验收分开；详见 [M11](./milestones/M11-Personal%20Server控制面、区域分发与跨产品Extension闭环.md) |
| NapCat external OneBot/QQ 端到端 | 需要相应外部环境与授权，不能用本地 fixture 代替 |
| 生产更新失败恢复、备份连续性与长运行 | 历史部署证据不证明当前生产状态；环境操作依据专项授权 |
| Unity/Windows 安装制品与设备矩阵 | source build 不等同真实安装、首启、升级、卸载与实体设备通过 |
| 其他候选 | [Backlog](./backlog.md)，不自动纳入本轮承诺 |

M12/M13 的原里程碑验收保留在对应记录，不代表 v2 新目标已达成。
此前的发布版本、UI 批次、运行环境与历史验收细节见
[整理前快照](../history/architecture-v1/2026-09-19-roadmap-now.md)。本次未重新验证生产、外部 QQ 或历史发布物。

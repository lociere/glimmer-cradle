# 架构目标

当前有效目标为 Architecture Baseline v2.1。目录稳定，版本与治理修订写在正文和锁中。

| 权威资料 | 职责 |
|---|---|
| [baseline.md](baseline.md) | 领域、依赖、进程、状态、安全与完整行为要求 |
| [physical-layout.md](physical-layout.md) | 包约定、生成物、安装空间与生成的完整目标树 |
| [files.json](files.json) | 精确版本控制路径的唯一源 |
| [baseline.lock.json](baseline.lock.json) | 固定规范源摘要与目标不变量 |

目标由 [ADR-0023](../decisions/ADR-0023-最终目标蓝图与物理目录契约.md) 采用；
文档布局由 [ADR-0024](../decisions/ADR-0024-文档职责与重构执行体系整合.md) 调整。
[架构变更宪章](../../governance/architecture-change-policy.md) 管理受控变更，
[重构项目](../../roadmap/initiatives/architecture-v2/README.md) 拥有阶段、切片、映射和验收。
当前实现从 [Current](../current/README.md) 与 [Implementation](../implementation/README.md) 查询。

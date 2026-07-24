# Guides

> 范围：开发、排障、迁移、子系统修改和发布的可执行步骤；不维护字段权威表或架构正文。
> 事实依据：[开发手册](./开发手册.md)、Architecture、Reference、当前脚本和测试。
> 维护触发：流程、命令、验证方式、失败恢复、子系统入口或文档结构变化。

先读 [开发手册](./开发手册.md)。它给出所有改动的通用入口、阅读路径和完成定义。然后按任务进入专项指南：

| 任务 | 指南 |
|---|---|
| 首次配置开发环境 | [onboarding/本地开发环境.md](./onboarding/本地开发环境.md) |
| 普通功能或缺陷修复 | [development/功能开发与缺陷修复.md](./development/功能开发与缺陷修复.md) |
| Schema、IPC、跨进程契约 | [development/Schema与跨进程契约变更.md](./development/Schema与跨进程契约变更.md) |
| 架构边界、进程、分层重构 | [development/架构性改动.md](./development/架构性改动.md) |
| Git 分支、命名、术语和标识符重构 | [development/命名规范.md](./development/命名规范.md) |
| 测试、验收和交付说明 | [development/测试与验收.md](./development/测试与验收.md) |
| 文档同步和迁移 | [development/文档维护.md](./development/文档维护.md) |
| Kernel/runtime | [subsystems/Kernel开发.md](./subsystems/Kernel开发.md) |
| Cognition | [subsystems/Cognition开发.md](./subsystems/Cognition开发.md) |
| Desktop/Avatar | [subsystems/桌面与Avatar开发.md](./subsystems/桌面与Avatar开发.md) |
| Extension/Skill Plane | [subsystems/扩展开发.md](./subsystems/扩展开发.md) |
| Audio Engine | [subsystems/音频引擎开发.md](./subsystems/音频引擎开发.md) |
| 日志、trace、DLQ 排障 | [operations/日志、Trace与DLQ排障.md](./operations/日志、Trace与DLQ排障.md) |
| 性能诊断 | [operations/性能诊断.md](./operations/性能诊断.md) |
| 数据迁移与恢复 | [operations/数据迁移与恢复.md](./operations/数据迁移与恢复.md) |
| 客户端打包 | [release/客户端打包.md](./release/客户端打包.md) |
| Personal Server 构建与部署 | [release/Personal Server部署.md](./release/Personal%20Server部署.md) |

指南不是历史材料。旧的平铺指南已归档到 `docs/history/legacy-guides/`，只能作为迁移证据；当前开发必须从本目录进入。

# Glimmer Cradle 文档中心

Glimmer Cradle 使用“架构、参考、指南、路线、决策、历史”六类文档。Glimmer Cradle 是微光摇篮企划与运行平台；Selrena（月见）是当前默认角色与主线角色。先按你要完成的任务进入，不需要从头通读全部文档。

| 你要做什么 | 从这里开始 |
|---|---|
| 理解企划平台、默认角色边界、架构审美或做跨层设计 | [architecture/blueprint/](./architecture/blueprint/README.md) |
| 审查最终目标目录、制品、安装态与运行数据物理形态 | [architecture/blueprint/目标物理拓扑.md](./architecture/blueprint/目标物理拓扑.md) |
| 认识当前系统结构与边界 | [architecture/current/](./architecture/current/README.md) |
| 核对当前真实路径或 Current → Target 迁移动作 | [当前物理拓扑](./architecture/current/10-当前物理拓扑.md) / [迁移地图](./architecture/current/11-物理拓扑差距与迁移地图.md) |
| 理解真实代码如何实现某个子系统 | [architecture/implementation/](./architecture/implementation/README.md) |
| 查协议、配置、数据或 SDK 的准确字段 | [reference/](./reference/README.md) |
| 配环境、开发、调试、测试、打包 | [guides/](./guides/README.md) |
| 确认当前承诺、下一验收门、蓝图落地阶段和候选事项 | [roadmap/](./roadmap/README.md) |
| 理解某个重要取舍为什么存在 | [architecture/decisions/](./architecture/decisions/README.md) |
| 追溯已结束阶段的原始材料 | [history/](./history/README.md) |

## 文档契约

- **Blueprint** 是 Glimmer Cradle 的架构宪法并拥有唯一 Target Physical Topology；**Current** 描述当前系统结构并拥有唯一 Current Physical Topology；**Implementation** 解释真实代码如何实现架构。
- **Reference** 是字段、命令、目录和 API 的精确查表来源。
- **Guides** 是完成特定任务的可执行步骤，不重复架构事实。
- **Roadmap** 写当前承诺、候选事项、里程碑验收和蓝图落地阶段关系；历史正文仍归 `history/`。
- **Decisions** 以 ADR 保存长期有效的取舍；`history/` 只保存已退出当前事实源的材料。

当前事实必须能追溯到代码、Schema、配置或自动生成物。不同文档间应链接而非复制正文。

理想目录、当前真实树与迁移动作分别由
[目标物理拓扑](./architecture/blueprint/目标物理拓扑.md)、
[当前物理拓扑](./architecture/current/10-当前物理拓扑.md) 和
[迁移地图](./architecture/current/11-物理拓扑差距与迁移地图.md) 维护。

## 维护

修改前先阅读 [文档维护规范.md](./文档维护规范.md)。旧的架构、指南、扩展与路线图材料均已归档到 `history/legacy-*`，不再作为活跃入口或事实源。

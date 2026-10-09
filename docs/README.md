# Glimmer Cradle 文档中心

从要解决的问题进入文档。目标、当前事实、操作方法和任务进度分别维护，互相链接。

| 需要 | 唯一入口 |
|---|---|
| 接手当前重构、确定下一步 | [当前工作](roadmap/now.md) → [架构重构项目](roadmap/initiatives/architecture-v2/README.md) |
| 理解最终产品、领域边界与物理结构 | [架构目标](architecture/target/README.md) |
| 理解当前实际系统 | [当前架构](architecture/current/README.md) → [实现地图](architecture/implementation/README.md) |
| 查询协议、配置、SDK、数据与制品规则 | [技术参考](reference/README.md) |
| 搭建环境、开发、排障、验收与交付 | [操作指南](guides/README.md) |
| 理解长期取舍及其替代关系 | [ADR](architecture/decisions/README.md) |
| 维护文档、变更基线、设计协作流程 | [治理](governance/README.md) |
| 查其他承诺、候选与历史证据 | [路线图](roadmap/README.md) / [历史](history/README.md) |

## 阅读与事实契约

- `architecture/target/` 拥有当前有效的 v2.1 目标；版本在正文与锁中声明，文件路径保持稳定。
- `architecture/current/` 是当前系统视图；`implementation/` 解释代码入口。目标目录存在不能证明迁移完成。
- `reference/` 描述精确技术契约；实际 Schema、源码与生成物是对应字段的事实依据。
- `guides/` 回答如何操作；`governance/` 回答必须遵守哪些规则、为何如此组织。
- `roadmap/initiatives/<id>/` 拥有一个跨切片工作的计划、状态、映射和证据索引。
- `history/` 保留被替代设计与已结束记录，不提供当前执行指令。
- `AGENTS.md` 与项目 Skill 拥有开发智能体共同约束和操作路由，引用 docs 中的项目事实。

Codex 接手重构时读取项目 Skill、[项目入口](roadmap/initiatives/architecture-v2/README.md)和
[切片执行指南](guides/development/architecture-refactoring.md)，按任务状态表选择步骤。
规则冲突、缺少验收证据或未知数据迁移不能靠“继续”推定为通过。

完整物理目录、分类规则和来源依据见[文档架构](governance/documentation-architecture.md)；
编辑和验收标准见[文档维护规范](governance/documentation.md)。

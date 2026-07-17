# 架构决策记录

本目录来自原 `docs/architecture/stages/`。这些文档记录阶段迁移、设计取舍和历史背景；阶段完成后，最终事实应收敛到 `docs/architecture/` 与 `docs/reference/`。

## 阅读方式

| 文件 | 主题 |
|---|---|
| [阶段2-数据持久化设计.md](./阶段2-数据持久化设计.md) | 数据持久化、记忆与知识库分离 |
| [阶段3-遥测设计.md](./阶段3-遥测设计.md) | telemetry、trace/span、metrics |
| [阶段4-觉醒态设计.md](./阶段4-觉醒态设计.md) | Dormant / Dreaming / Ambient / Awake 觉醒态 |
| [阶段5-认知循环设计.md](./阶段5-认知循环设计.md) | CognitiveLoop 与全局工作区 |
| [阶段6-反思与记忆图谱设计.md](./阶段6-反思与记忆图谱设计.md) | 反思、记忆图谱、叙事日记 |
| [阶段7-自主输出通路设计.md](./阶段7-自主输出通路设计.md) | 自主输出、Deliberate / Act、旧对话轨移除 |
| [阶段8-渲染层架构分析与重构.md](./阶段8-渲染层架构分析与重构.md) | Presence Surface、Control Center、Extension 体系 |
| [阶段P-Protocol契约层重构.md](./阶段P-Protocol契约层重构.md) | Protocol schema-first 与多端 codegen |
| [阶段P9-契约层与包管理自洽化重构.md](./阶段P9-契约层与包管理自洽化重构.md) | polyglot 包管理与 codegen 入口内聚 |

## 规则

- 决策记录可以包含旧名称、旧路径和迁移过程。
- 当前开发不能以本目录覆盖 `architecture/` 或 `reference/`。
- 若某份记录中的结论已成为事实，应在 `architecture/`、`reference/` 或 ADR 中有对应收口。

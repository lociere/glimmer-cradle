# 架构目标与执行基线

本目录只维护当前有效的 v2.1 目标，不把尚未实现的目录写成当前事实。

| 文件 | 职责 |
|---|---|
| [最终蓝图](./Glimmer_Cradle_Architecture_Baseline_v2.1_Frozen.md) | 领域、进程、数据、安全、扩展边界与行为验收 |
| [完整物理目录](./Glimmer_Cradle_Target_Physical_Layout_v2.1.md) | 全部源文件、包约定、生成物、安装与运行目录 |
| [机器清单](./architecture-target-v2.1.json) | 精确目标路径的唯一源；展示树由它生成 |
| [执行要求](./Glimmer_Cradle_Codex_Refactor_Prompt_v2.1.md) | 各阶段与最终交付要求 |
| [执行宪章](./Architecture_Baseline_v2.1_执行宪章.md) | 权威顺序、清单演进和迁移纪律 |
| [基线锁](./architecture-baseline-v2.lock.json) | 固定目标摘要，由架构检查核对 |

采用依据见 [ADR-0023](../decisions/ADR-0023-最终目标蓝图与物理目录契约.md)。
命名由 [命名规范](../../guides/development/命名规范.md) 维护。
第三方来源不是 Extension 分类标准；核心环境中立，可替换的接入按生命周期自然归扩展。

- 当前实物：[Current](../current/README.md)。
- 实现入口：[Implementation](../implementation/README.md)。
- 当前与目标：[迁移地图](../current/11-物理拓扑差距与迁移地图.md)。
- 阶段证据：[执行记录](../../roadmap/architecture-v2-refactor.md)。
- 被替代目标：[v2.0 历史](../../history/architecture-v2.0/README.md)、[v1 历史](../../history/architecture-v1/README.md)。

# 架构目标与执行基线

本目录只维护当前有效的目标，不把尚未实现的目录写成当前事实。

| 文件 | 职责 |
|---|---|
| [Architecture Baseline v2.0](./Glimmer_Cradle_Architecture_Baseline_v2.0_Frozen.md) | 唯一目标边界、领域 owner、依赖及最终验收标准；当前为规范修订 1 |
| [执行要求](./Glimmer_Cradle_Codex_Refactor_Prompt_v2.0.md) | 原始阶段与验收要求 |
| [执行宪章](./Architecture_Baseline_v2.0_执行宪章.md) | 权威顺序、迁移纪律、变更控制 |
| [基线锁](./architecture-baseline-v2.lock.json) | 固定已授权正文摘要与目标集合，由架构门禁验证 |

[ADR-0019](../decisions/ADR-0019-采用Architecture-Baseline-v2冻结基线.md) 规定旧目标的替代范围，
[ADR-0021](../decisions/ADR-0021-架构基线规范修订与命名收束.md) 记录规范修订。
命名操作规则由 [命名规范](../../guides/development/命名规范.md) 唯一维护。

当前默认角色为 Selrena（月见）。角色资料和资产不成为通用层硬编码；Persona、Memory、Conversation、
Capabilities、Jobs 与 Embodiment 共同维持角色体验。五个目标根和七个 Core 模块详见基线，本文不复制目标树。

- 当前结构：[Current](../current/README.md)。
- 真实代码：[Implementation](../implementation/README.md)。
- 当前与目标差距：[迁移地图](../current/11-物理拓扑差距与迁移地图.md)。
- 阶段状态与证据：[重构执行记录](../../roadmap/architecture-v2-refactor.md)。
- 旧产品设计、旧目标树和旧母路线：[历史设计](../../history/architecture-v1/README.md)，仅供追溯。

# ADR-0019：采用 Architecture Baseline v2.0 冻结基线

- 状态：accepted
- 日期：2026-09-15

## Context

用户要求按所提供的最终冻结架构规范与执行提示词完成渐进重构。现行实现采用
`contracts / core/kernel / core/cognition / core/avatar / hosts / products / packages`，
与新基线的领域所有权、依赖及物理命名空间存在实质差异。目录迁移不能代替职责拆分。

## Decision

[Architecture Baseline v2.0 (Frozen)](../blueprint/Glimmer_Cradle_Architecture_Baseline_v2.0_Frozen.md)
是唯一目标架构基线，[执行要求](../blueprint/Glimmer_Cradle_Codex_Refactor_Prompt_v2.0.md)
规定阶段和验收方式。两份用户原文保留原内容，不将实施解释写入原文。

本决策替代旧蓝图与 ADR 中冲突的目标边界：

- ADR-0013 的 `contracts/` 目标路径由 `protocol/` 替代；保留单一 wire source、生成与兼容验证原则。
- ADR-0014 的器官目录和 roots 目标由七个 Core 模块与五个根边界替代。
- ADR-0016 的 `tools/` 根目录目标随工程 owner 迁移；私有工具不进入运行制品、薄编排原则继续有效。
- ADR-0008 的交互事实 owner 改为 Conversation Log；非交互经验保留明确领域归属，不能通过删除 Experience 数据完成迁移。
- SDK 从 Core public contracts 向外公开；Core 不得反向依赖 SDK。
- Unity/音频/模型实现按 renderer/provider adapter 隔离；现有技术、独立进程和真实能力不因目录变化删除。

其他不冲突的产品要求、数据保护、安全、readiness、发布历史和供应链约束继续有效。
现有架构文档描述的当前路径保持真实，待对应代码切换后同步更新；旧目标页中的冲突设计标记为被替代。

## Consequences

1. 各阶段先计划，再实现与验证；不能直接将旧 Kernel 整包视为 Platform。
2. 每次迁移只保留一个 canonical writer；兼容 adapter 必须有 owner、窗口及删除门。
3. `contracts` 到 `protocol` 的物理切换须原子更新生成器、consumer、安装与构建，不建立第二 wire source。
4. JSON Schema 文档契约仍有实际使用，按所属领域/扩展 owner 迁移；不因 wire 改名而删除文档校验。
5. 源码根边界收敛不授权删除既有 ignored 数据、Secret、本机工具链或用户资产；迁移前先建立恢复路径。
6. 新增约束先阻止违规增加，再随迁移删除精确 legacy exceptions；最终六条主链和全部门禁通过才称重构完成。

## Alternatives considered

- 仅改目录：不能解决 Kernel 业务、固定 planning/synthesis、SDK 反向依赖和 Conversation owner 问题。
- 全量重写：无法持续提供可构建、可回归和可恢复的候选，不符合用户执行要求。
- 维持旧目标：直接违背用户指定的新冻结基线。

## Links

- [审计与执行记录](../../roadmap/architecture-v2-refactor.md)
- [当前物理拓扑](../current/10-当前物理拓扑.md)

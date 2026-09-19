# Glimmer Cradle 架构蓝图

当前唯一目标基线为用户提供的 [Architecture Baseline v2.0 (Frozen)](./Glimmer_Cradle_Architecture_Baseline_v2.0_Frozen.md)。
[执行要求](./Glimmer_Cradle_Codex_Refactor_Prompt_v2.0.md) 与 [ADR-0019](../decisions/ADR-0019-采用Architecture-Baseline-v2冻结基线.md)
规定替代范围和渐进迁移方式；[执行宪章](./Architecture_Baseline_v2.0_执行宪章.md) 固定权威顺序、迁移纪律与变更控制，
`architecture-baseline-v2.lock.json` 由架构门禁校验。以下旧蓝图说明中与新基线冲突的目标已被替代；当前实现仍以 Current 和源码为准。

[微光摇篮架构蓝图.md](./微光摇篮架构蓝图.md) 是 Glimmer Cradle 的架构宪法：它保存数字生命体企划与运行平台的产品解释、架构审美、概念完整性、长期不变量和目标形态。当前默认主体是 Selrena（月见），但平台、协议、Kernel、Desktop 与 Extension SDK 不以单个角色命名。

它有意比当前代码更长寿，但不伪造当前实现：

- “最终目标目录和模块边界是什么”以 v2 冻结基线为唯一设计入口；
- [目标物理拓扑](./目标物理拓扑.md) 仅保留旧目标与安装/制品路径的迁移对照，不再拥有目标源码树解释权；
- “现在已经怎么做”以 [../current/](../current/README.md) 为准；
- “代码具体怎么实现”以 [../implementation/](../implementation/README.md) 为准；
- “接下来承诺做什么”以 [../../roadmap/](../../roadmap/README.md) 为准；
- 长期取舍以 ADR 为准。

契约脊柱由 [ADR-0013](../decisions/ADR-0013-契约脊柱与跨进程服务架构.md) 固定：`contracts/`、版本化 Protobuf Service、JSON Schema 文档契约和 Kernel Surface Gateway 已落到当前物理形态；当前 Service/Document 与 consumer 事实以 Current/Implementation/Reference 为准，M12 收口证据见 [里程碑](../../roadmap/milestones/M12-契约脊柱与跨进程服务架构重建.md)。

仓库根职责、Kernel/Cognition 模块化单体、Avatar/Unity Host 与 Extension Host 物理边界由 [ADR-0014](../decisions/ADR-0014-仓库物理分层与器官模块边界.md) 固定。目标 `hosts/` 和器官内部层次同样不是当前实现；M12 负责迁移和旧路径删除门。

工程自动化与交付生命周期作为平台第一等承重面的长期边界由 [ADR-0015](../decisions/ADR-0015-工程自动化平面与交付生命周期分层.md) 固定：package-local owner 拥有原子任务，root 与 workflow 只做薄编排，Release 只消费 fixed artifact，Install/Ops 由宿主级事务 owner 串行化。当前 Scripts、CI、Build、Release、Install 与 Ops 事实仍以 Current/Implementation/Reference/Guide 为准，目标闭环由 [M13](../../roadmap/milestones/M13-工程自动化脊柱与交付生命周期闭环.md) 承担。

蓝图不再被降格为简短 vision；它是所有跨层设计和重大重构的第一阅读入口。

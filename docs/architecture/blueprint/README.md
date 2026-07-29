# Glimmer Cradle 架构蓝图

[微光摇篮架构蓝图.md](./微光摇篮架构蓝图.md) 是 Glimmer Cradle 的架构宪法：它保存数字生命体企划与运行平台的产品解释、架构审美、概念完整性、长期不变量和目标形态。当前默认主体是 Selrena（月见），但平台、协议、Kernel、Desktop 与 Extension SDK 不以单个角色命名。

它有意比当前代码更长寿，但不伪造当前实现：

- “理想落地后各命名空间的精确目录和文件是什么”以
  [目标物理拓扑](./目标物理拓扑.md) 为唯一设计入口；
- “现在已经怎么做”以 [../current/](../current/README.md) 为准；
- “代码具体怎么实现”以 [../implementation/](../implementation/README.md) 为准；
- “接下来承诺做什么”以 [../../roadmap/](../../roadmap/README.md) 为准；
- 长期取舍以 ADR 为准。

契约脊柱的长期目标由 [ADR-0013](../decisions/ADR-0013-契约脊柱与跨进程服务架构.md) 固定：目标 `contracts/`、版本化 Protobuf Service、JSON Schema 文档契约和 Kernel Surface Gateway 均是 accepted 方向；当前 `protocol/` 与既有 transport 事实仍以 Current/Implementation/Reference 为准，迁移由 [M12](../../roadmap/milestones/M12-契约脊柱与跨进程服务架构重建.md) 承担。

仓库根职责、Kernel/Cognition 模块化单体、Avatar/Unity Host 与 Extension Host 物理边界由 [ADR-0014](../decisions/ADR-0014-仓库物理分层与器官模块边界.md) 固定。目标 `hosts/` 和器官内部层次同样不是当前实现；M12 负责迁移和旧路径删除门。

工程自动化与交付生命周期作为平台第一等承重面的长期边界由 [ADR-0015](../decisions/ADR-0015-工程自动化平面与交付生命周期分层.md) 固定：package-local owner 拥有原子任务，root 与 workflow 只做薄编排，Release 只消费 fixed artifact，Install/Ops 由宿主级事务 owner 串行化。当前 Scripts、CI、Build、Release、Install 与 Ops 事实仍以 Current/Implementation/Reference/Guide 为准，目标闭环由 [M13](../../roadmap/milestones/M13-工程自动化脊柱与交付生命周期闭环.md) 承担。

蓝图不再被降格为简短 vision；它是所有跨层设计和重大重构的第一阅读入口。

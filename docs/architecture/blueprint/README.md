# Glimmer Cradle 架构蓝图

[微光摇篮架构蓝图.md](./微光摇篮架构蓝图.md) 是 Glimmer Cradle 的架构宪法：它保存数字生命体企划与运行平台的产品解释、架构审美、概念完整性、长期不变量和目标形态。当前默认主体是 Selrena（月见），但平台、协议、Kernel、Desktop 与 Extension SDK 不以单个角色命名。

它有意比当前代码更长寿，但不伪造当前实现：

- “现在已经怎么做”以 [../current/](../current/README.md) 为准；
- “代码具体怎么实现”以 [../implementation/](../implementation/README.md) 为准；
- “接下来承诺做什么”以 [../../roadmap/](../../roadmap/README.md) 为准；
- 长期取舍以 ADR 为准。

契约脊柱的长期目标由 [ADR-0013](../decisions/ADR-0013-契约脊柱与跨进程服务架构.md) 固定：目标 `contracts/`、版本化 Protobuf Service、JSON Schema 文档契约和 Kernel Surface Gateway 均是 accepted 方向；当前 `protocol/` 与既有 transport 事实仍以 Current/Implementation/Reference 为准，迁移由 [M12](../../roadmap/milestones/M12-契约脊柱与跨进程服务架构重建.md) 承担。

蓝图不再被降格为简短 vision；它是所有跨层设计和重大重构的第一阅读入口。

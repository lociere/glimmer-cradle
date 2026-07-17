# 技术实现地图

> 范围：解释 Current 中的架构边界如何落到真实代码入口、组装点、状态机、协议映射、数据写入和调试链路；不保存字段全表，不写逐步教程。
> 事实依据：当前源码、Schema、配置、生成物、测试和历史实现材料。
> 维护触发：入口、composition root、目录 owner、跨进程链路、生命周期、协议/配置消费、数据写入或验证方式变化。

本目录回答“要理解或修改这条架构链路，应先看哪些代码，以及如何验证自己没有改错边界”。它比 Current 更靠近代码，但仍不是 API Reference；精确字段查 [Reference](../../reference/README.md)，实际操作查 [Guides](../../guides/README.md)。

每页必须至少包含：

1. 入口与 composition root；
2. 目录/模块 owner；
3. 入站、内部主线、出站链路；
4. 使用的 Protocol、配置、数据路径和日志；
5. 常见失败定位；
6. 验证入口。

| 页面 | 代码视角 |
|---|---|
| [Protocol 契约层实现](./Protocol契约层实现.md) | Schema、生成链、runtime helper、消费者验证 |
| [Kernel 与 Runtime 实现](./Kernel与Runtime实现.md) | Kernel root、runtime module、Ingress、capability 和状态投影 |
| [Cognition 认知核实现](./Cognition认知核实现.md) | Python 进程、Composition、CycleController、context、memory、outbound |
| [Desktop 与 Avatar 实现](./Desktop与Avatar实现.md) | Electron main/preload/renderer、Unity Avatar、Native Composition |
| [Engines 与 Native 实现](./Engines与Native实现.md) | Audio engine、resource readiness、子进程协议、native 加载 |
| [Extension 与 Skill Plane 实现](./Extension与SkillPlane实现.md) | SDK、Host、Provider、Policy、Gateway、MCP |
| [数据、记忆与可观测性实现](./数据、记忆与可观测性实现.md) | data owner、repositories、logs、trace、metrics、DLQ、migration |

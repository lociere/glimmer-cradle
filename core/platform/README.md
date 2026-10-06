# Platform Core

`@glimmer-cradle/platform` 是 private `0.1.0` workspace，只提供通用机制和消费方 Port，
不拥有 Cognition、Jobs、Renderer 或第三方协议的领域政策。
当前公开入口包含 Clock/Identity/Live Events/Observability、LifecycleCoordinator、ConfigurationValidator
与 topology authority lease/StorePort/HandoverController；具体 IO 由 App 装配。

Authority 按 aggregate 保留单调 epoch/token。Handover 先撤销入口，可信承载 owner drain 后再确认
新租约；过期接管只 fencing，不能代替业务 unknown 对账。SQLite 实现在 Host，Platform 不引入
数据库依赖；authority 持久状态不能当缓存删除或通过重复启动重新生成旧 epoch。

`pnpm test:platform` 运行实际 Node 测试；`pnpm typecheck` 包含 source 与 authority 测试的类型检查。
物理迁移、hybrid/offline、完整生命周期故障回收与产品装配仍按
[执行记录](../../docs/roadmap/architecture-v2-refactor.md) 推进，当前目录不代表所有目标模块已完成。

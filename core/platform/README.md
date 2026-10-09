# Platform Core

`@glimmer-cradle/platform` 是 private `0.1.0` workspace，只提供通用机制和消费方 Port，
不拥有 Cognition、Jobs、Renderer 或第三方协议的领域政策。
当前公开入口包含 Clock/Identity/Live Events/Observability、LifecycleCoordinator、ConfigurationValidator
与 topology authority lease/StorePort/HandoverController；具体 IO 由 App 装配。
`SystemClock` 与 `NodeStableIdentity` 的通用 Node 实现现由 Platform root 暴露，
Kernel composition 直接消费；原 Kernel time/identity adapter 已删除。
`security/principal.ts` 与 `security/permission.ts` 提供不可变主体/细粒度权限值对象；实际登记、
短寿命授权、审计与撤销由 Host PermissionBroker 拥有，不将主体 ID 或 manifest 当访问凭据。
具体接线与未完成边界见[能力实现](../../docs/architecture/implementation/Extension与SkillPlane实现.md#目标-host-resource-授权与读取)。

Authority 按 aggregate 保留单调 epoch/token。Handover 先撤销入口，可信承载 owner drain 后再确认
新租约；过期接管只 fencing，不能代替业务 unknown 对账。SQLite 实现在 Host，Platform 不引入
数据库依赖；authority 持久状态不能当缓存删除或通过重复启动重新生成旧 epoch。

LifecycleCoordinator 在调用 start 前登记资源 owner，失败启动也必须由模块 stop 释放。
开始关闭后拒绝新阶段/模块，等待已接纳的启动和 observer 回调，再按接纳逆序停止。
stop/observer 异常汇总上抛且不跳过其他释放；成功释放即移除 owner，失败释放保留供 stop 重试。
并发 stop 共用实际排空 Promise；关闭后的 coordinator 不复用，重新装配另建实例。
observer 负责产品通知/投影。LifecycleCallbackGuard 按实例跟踪活跃回调及其返回 Promise；
回调内重入所属启动/停止会明确拒绝，避免自等待，外部并发调用仍加入真实过程。
回调 settle 后的异步后续任务、另一个 coordinator 的生命周期均可正常执行。
当前尚无通用启动取消/超时，P02A 仍未接受。

`pnpm test:platform` 运行实际 Node 测试；包 `typecheck` 包含 source、authority、生命周期与公开 API 测试。
物理迁移、hybrid/offline、完整生命周期故障回收与产品装配仍按
[执行记录](../../docs/roadmap/initiatives/architecture-v2/README.md) 推进，当前目录不代表所有目标模块已完成。

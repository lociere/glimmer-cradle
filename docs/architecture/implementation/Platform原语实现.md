# Platform 原语实现

> 范围：当前契约、生命周期协调、Kernel 接线与验证，不描述尚未提取的模块。
> 事实依据：`core/platform/src/`、package exports、Kernel composition/adapters。
> 维护触发：public exports、consumer、启动/停机、时间与事件边界变化。

## 公开入口与 owner

当前 private workspace 为 `@glimmer-cradle/platform`，公开入口由
[package exports](../../../core/platform/package.json) 声明。

| 子路径 | 职责 | 消费方/实现 |
|---|---|---|
| `/time` | Clock、ScheduledTask；墙钟、单调时间、timer 边界 | Attention、Ingress、LifeClock、lifecycle；SystemClockAdapter |
| `/identity` | StableIdentity 的 newId/digest；领域决定 ID 含义 | IdentityRouter、ConversationDirectory；NodeStableIdentityAdapter |
| `/observability` | TraceContext、Logger、Span、Observability | Kernel application/runtime；KernelObservabilityAdapter |
| `/lifecycle` | RuntimeModule、LifecyclePhase、Observer、LifecycleCoordinator | Kernel runtime modules 与 LifecycleOrchestrator |
| `/events` | 泛型 LiveEventPublisher、Subscriptions、Bus、Handler | KernelEventBusPort 与 EventBus adapter |
| root 的 topology exports | AuthorityLease/StorePort、fencing 判定、HandoverController | Host `SqliteAuthorityStore` 与 `HostJobsOwner`；无数据库依赖 |

契约提取不表示具体 IO 实现已迁入 Platform。Scope、完整 Topology/hybrid、Configuration 装配和
Security 等仍按执行记录推进。

## 组合与生命周期

[Kernel composition](../../../core/kernel/src/composition/kernel-application.ts) 创建并复用 SystemClockAdapter。
链路为 `App → LifecycleOrchestrator → LifecycleCoordinator → RuntimeModule.start/stop`。
阶段由 composition 显式排序，Platform 不解析依赖图。

- 串行依次启动；并行等待全部启动结果收敛，再报告单个错误或 AggregateError。
- start 成功返回后才加入 started；耗时使用单调时钟。
- Kernel observer 生成领域事件、日志和 readiness projection；Platform 不判断业务 ready。
- 组合根负责失败后的停机，startPhase 内不会自动回滚。
- stopStarted 按成功记录逆序停止，finally 清空记录。当前 stop/observer 抛错会中断后续停止，
  不能宣称已保证任意停止失败后的完整资源回收；后续行为修订须补失败测试。

## 事件、配置与数据边界

Live-event contract 表达进程内通知，不承诺持久化、重试或 exactly-once。
[Kernel event-bus port](../../../core/kernel/src/ports/event-bus.port.ts) 保留 replay 注册和 ack；
[EventBus adapter](../../../core/kernel/src/adapters/events/event-bus.ts) 仍拥有 dispatch、DLQ、inventory 和 receipt 校验。
Conversation log、PCM/token 流不因接口提取而并入此总线。
Platform 不直接执行持久 IO；authority 状态由 Host Adapter 写入，logger/trace 与 clock 由 owner 注入，
当前没有独立 Platform 配置文件。

## Authority 与受控转移

`topology/authority-lease.ts` 固定 aggregate/owner/epoch/token/expiry/revision 和有效性判定；
合法续期只推进 expiry/revision，不替换承载身份。`authority.ts` 定义 StorePort 与可信 DrainPort，
`handover.ts` 先持久撤销，再等待实际资源 drain 并核验确认身份，最后接纳新租约。
失败保留 revoking；过期接管只 fencing，领域仍须恢复 unknown，不能宣称旧副作用未发生。

Host `adapters/platform/authority-store.ts` 在 SQLite IMMEDIATE 事务中更新序列、撤销/确认和
转移审计；重复确认返回原持久 receipt，不刷新新租约。schema 与恢复边界见
[数据目录](../../reference/data-layout.md#用户状态与记忆)。
`composition/domain-owners.ts` 的 `HostJobsOwner` 对固定 jobs aggregate 获取/接纳租约并注入
真实 Jobs epoch，后台续期和每次 Jobs 时钟访问都核验权威身份。正常 drain 期间保持续期，
完成在途封口后才释放；handover 先停止续期和旧接纳、等待同一实际 Jobs drain，确认后接纳者
从原 attempt unknown 对账。更高 epoch 撤销旧循环，旧实例不能释放新主。
authority 缺失/落后于既有 Jobs，或新租约未领先 Jobs 序列时拒绝启动，不靠重复获取 epoch
绕过恢复门。phase active 仅表示租约已持有，不表示 Jobs/整个产品 ready。
当前验证是本地临时库与真实 Worker；生产进程监督、跨机 wire/认证、离线 proposal 和恢复安装仍待完成。

## 调试与验证

1. 子路径找不到时核对 package exports 与 Platform build，不通过深路径绕过边界。
2. readiness 异常查 Kernel projection、模块证据和 provider；start 返回不等于服务 ready。
3. replay 失败查原 operation identity、inventory/ack，不通过新建 ID 掩盖失败。

验证入口：Platform `test`，Kernel `kernel-physical-layout.test.ts`、`dlq-replay-ingress.test.ts`，
根 typecheck/build 与架构门禁；真实组合验证用 Kernel `smoke:bootstrap`。
阶段结果见 [执行记录](../../roadmap/architecture-v2-refactor.md)，当前 API 以源码 exports 为准。

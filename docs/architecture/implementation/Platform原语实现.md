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

契约提取不表示具体 IO 实现已迁入 Platform。Scope、Topology、Configuration、Security 等仍按执行记录调查。

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
Platform 当前没有独立配置文件或持久 store，logger/trace 与 clock 由 owner 注入。

## 调试与验证

1. 子路径找不到时核对 package exports 与 Platform build，不通过深路径绕过边界。
2. readiness 异常查 Kernel projection、模块证据和 provider；start 返回不等于服务 ready。
3. replay 失败查原 operation identity、inventory/ack，不通过新建 ID 掩盖失败。

验证入口：Platform `test`，Kernel `kernel-physical-layout.test.ts`、`dlq-replay-ingress.test.ts`，
根 typecheck/build 与架构门禁；真实组合验证用 Kernel `smoke:bootstrap`。
阶段结果见 [执行记录](../../roadmap/architecture-v2-refactor.md)，当前 API 以源码 exports 为准。

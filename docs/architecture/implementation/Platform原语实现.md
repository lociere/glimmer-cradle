# Platform 原语实现

> 范围：当前契约、生命周期协调、Kernel 接线与验证，不描述尚未提取的模块。
> 事实依据：`core/platform/src/`、package exports、Kernel composition/adapters。
> 维护触发：public exports、consumer、启动/停机、时间与事件边界变化。

## 公开入口与 owner

当前 private workspace 为 `@glimmer-cradle/platform`，公开入口由
[package exports](../../../core/platform/package.json) 声明。

| 子路径 | 职责 | 消费方/实现 |
|---|---|---|
| `/time` | Clock、ScheduledTask；墙钟、单调时间、timer 边界 | Attention、Ingress、LifeClock、lifecycle；root `SystemClock` |
| `/identity` | StableIdentity 的 newId/digest；领域决定 ID 含义 | IdentityRouter、ConversationDirectory；root `NodeStableIdentity` |
| `/observability` | TraceContext、Logger、Span、Observability | Kernel application/runtime；KernelObservabilityAdapter |
| `/lifecycle` | RuntimeModule、LifecyclePhase、Observer、LifecycleCoordinator | Kernel runtime modules 与 LifecycleOrchestrator |
| `/events` | 泛型 LiveEventPublisher、Subscriptions、Bus、Handler | KernelEventBusPort 与 EventBus adapter |
| root 的 topology exports | AuthorityLease/StorePort、fencing 判定、HandoverController | Host `SqliteAuthorityStore` 与 `HostJobsOwner`；无数据库依赖 |
| root 的 security exports | 不可变 Principal、PermissionRequest/Grant/Decision 与身份验证 | Host PermissionBroker 登记/授权/审计/撤销；不解释 Resource 内容或 scope |
| root 的 ManagedProcessSupervisor | Node/OS 受管进程启动、真实 PID、边界释放与失败保留 | 当前四类 Kernel App adapter 与共享 Host WorkerSupervisor；通用 Node/Windows Native 实现由 Platform 拥有 |

契约提取不表示具体 IO 实现已迁入 Platform。Scope、完整 Topology/hybrid、Configuration 装配和
完整 Security 等仍按执行记录推进；短寿命授权接线见
[Host Resource 实现](Extension与SkillPlane实现.md#目标-host-resource-授权与读取)，不代表完整用户授权或 SDK 沙箱。

## 组合与生命周期

[Kernel composition](../../../core/kernel/src/composition/kernel-application.ts) 从 Platform root 创建并复用
`SystemClock` 与 `NodeStableIdentity`；其通用实现位于 `time/system-clock.ts` 与
`identity/stable-identity.ts`，原 Kernel 具体机制 consumer-zero 后删除。
链路为 `App → LifecycleOrchestrator → LifecycleCoordinator → RuntimeModule.start/stop`。
阶段由 composition 显式排序，Platform 不解析依赖图。

- 串行依次启动；并行等待全部启动结果收敛，再报告单个错误或 AggregateError。
- start 调用前登记资源 owner，成功返回后加入 started；耗时使用单调时钟。
  start 失败可能留下部分资源，因此 RuntimeModule.stop 必须能释放部分启动资源。
- Kernel observer 生成领域事件、日志和 readiness projection；Platform 不判断业务 ready。
- 组合根负责失败后的停机，startPhase 内不会自动回滚。
- stopStarted 立即关闭接纳，等待已接纳启动与 observer 收敛，再按 owner 接纳逆序停止。
  stop/observer 异常不跳过其余模块，汇总失败上抛；成功释放的 owner 移除，失败资源保留供重试。
  并发 stop 返回同一实际排空 Promise；coordinator 关闭后不能重新启动。
- App 合并并发 start/stop，在调用可同步重入的回调前安装共享 Promise，调用者等待真实结果。
  装配时已打开、尚未接纳的 Application 由 App field 持有，失败清理不丢失 owner；
  已接纳资源转交 coordinator，避免两次关闭。关闭后的 App 拒绝复用已 shutdown 的总线。
- 停机事件异常仍继续排空；未释放 owner 保留，状态 ERROR，可再次 stop 重试。
  Application 在 provider 未停止时保留其依赖，每个成功释放 provider/resource 从重试集合移除；
  全部资源释放后才发送 AppStopped 并关闭总线/diagnostics，失败中间态保持 observer 可用。
- LifecycleCallbackGuard 按实例跟踪 module/observer 活跃回调，回调内调用所属
  start/stop 会明确拒绝，避免等待当前操作自身；外部并发调用仍共享真实 Promise。
  同步回调返回立刻退出，异步回调 settle 后退出，后续异步任务与其他 coordinator 不受误拒。
  App 的事件与资源释放回调也消费同一公开机制，自等待错误不跳过其余资源释放。
  Kernel 配置生命周期预算的实际消费仍待 P02A 后续实现，当前定向证据不等于完整 D04 验收。

`lifecycle/cancellation.ts` 的公开 `waitWithCancellation` 只取消等待；预先取消也观察输入的
实际失败，结束时移除 signal listener，不把实际 callback 丢弃或声明已停止。
`communication/deadline.ts` 的公开 `Deadline` 以注入 Clock 的单调时间计算一个共享预算；
`DeadlineResult` 区分 completed（允许 undefined）和 expired，输出过期不表示 drain。
共享 Host WorkerSupervisor 已删除私有 abortable/bounded，消费这两个机制；App 拥有
启动/请求/shutdown 的预算与取消策略，Clock 注入统一用于相关 timer 和进程等待。
协议 shutdown 与实际退出等待消费同一单调预算，超时后的接收任务仍留在实际 task 集合，
后续 stop 只能在它们真正结束后报告排空。通用机制不包含角色、领域或协议判断。
Host 持有启动/请求/协议关闭 timer；取消确认后才移除，取消失败保留原 timer 供 stop 重试。
startup timer 创建失败进入失败回收，取消成功后才开放 ready；所有结果都清零 FD3 能力，
timer 异常不绕过实际 Worker 回收。

## 受管进程的实际边界

`adapters/node/process-supervisor.ts` 由公开 root 暴露；当前四类 Kernel App adapter
实际消费启动/等待/回收，旧 Kernel process helper 已删除。App 注入 logger、Clock 和
`resolveManagedProcessBridge()` 解析的当前开发/安装路径，Platform 不依赖产品目录。
Windows Native 源在 `adapters/windows/process-tree-bridge.cpp`，独立构建入口为
`core/platform/native/build.mjs`。Desktop 暂将同一产物投影为原有文件名；其 CMake/
包装入口与旧 stdin 控制协议仍由 P12B 完成产品切换后删除，不能据此声称产品路径已迁完。

Windows 目标以 suspended 创建，成功 AssignJob 后才 Resume；目标 FD0–3 保留，FD4 仅属于
Native 监督。root PID 与 helper PID 分开，根退出立即撤销业务入口，但释放 owner 还须
实际根句柄退出、成功查询 ActiveProcesses=0 的回执，以及 helper 实际退出和私有FD4排空。
helper exit可早于最后回执，Node advanced fork IPC的父端disconnect也可能不发聚合close；
完整退出通知基于helper实际exit与FD4排空，不以聚合close或私有Node计数替代事实。
Assign/Resume/Query 失败保留实际句柄，继续清理/查询；超时保留同一 Job 供 stop 重试。
控制连接/回执丢失保持未知 owner，禁止重用 PID 回收；根本未创建目标有明确失败回执。
旧 Desktop 控制入口同样检查系统调用结果，失败启动清理确认后才回报，停止须实际根退出与
Job 清空，EOF 清理也保留句柄到确认完成。两种私有机制都有独立真实/故障验证。

Cognition 在 Windows venv redirector 场景解析实际 CPython，并保留原 venv 路径初始化，
注册/失效绑定实际根 PID，未放宽认证。协议 readiness、shutdown、注册项和媒体 owner
仍在 App：关闭接纳、共享 stop、失败保留与恢复重试；Native 接纳不表示业务 ready。
POSIX 独立进程组须另行确认组空，当前可控反例不代替 Linux/mac 实机验收。
Native/Node 与实际消费者的证据、固定候选复核及未验范围见
[P02A 证据](../../roadmap/initiatives/architecture-v2/evidence/2026-10-09-P02A.md)。

共享 Host `WorkerSupervisor` 也消费同一机制，移除私有 taskkill/PID 回收；Windows 解析
实际 CPython 后严格绑定 Native root PID 与 parent PID，FD3 nonce/HMAC 和首次状态接纳
继续作为独立门。`HostDataPaths` 拥有开发注入与安装 Native 路径，见
[装配参数](../../reference/configuration.md#变更规则)。进程回收或接收方 drain 失败保留 owner，
后续 stop 可重试原过程；配置/复合 owner 在失败时保留实际库，全部排空后才关闭。
这些真实隔离证据不接受完整安装包、产品默认入口或跨平台设备门。

Windows Python 身份探测同样拥有独立 Job，不能因为是短命令而由未受管 execFile 承载。
Host 和现行 Kernel Cognition adapter 持有该探测 owner；公开 `readManagedProcessOutput`
限制输出字节/等待时间，确认整树释放及 stdout/stderr 排空后才返回。取消、超时或输出超限
只结束读取等待，App 继续通过原 Job 回收；失败保持句柄供重试，不把输出完成等同资源释放。

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
目标 Host 已通过 `HostCognitionJobsOwner` 接通真实 Worker 监督与本地持久 Jobs 生命周期，见
[Cognition 实现](./Cognition认知核实现.md#记忆经历与持久化)；当前验证使用临时库，没有替换产品默认
启动入口。`ConfiguredHostCognitionJobsOwner` 使用 Platform validator 校验唯一配置，通过
`HostDataPaths` 接目标 authority/Jobs 路径并持有数据库，恢复预检先于 Worker 外部绑定；
精确配置与持久边界分别见[配置参考](../../reference/configuration.md#目标-host-与-jobs-配置)、
[数据目录](../../reference/data-layout.md#用户状态与记忆)。跨机 wire/认证、离线 proposal 和恢复安装仍待完成。

## 调试与验证

1. 子路径找不到时核对 package exports 与 Platform build，不通过深路径绕过边界。
2. readiness 异常查 Kernel projection、模块证据和 provider；start 返回不等于服务 ready。
3. replay 失败查原 operation identity、inventory/ack，不通过新建 ID 掩盖失败。

验证入口：Platform `test`，Kernel `kernel-physical-layout.test.ts`、`dlq-replay-ingress.test.ts`，
根 typecheck/build 与架构门禁；真实组合验证用 Kernel `smoke:bootstrap`。
阶段结果见 [执行记录](../../roadmap/initiatives/architecture-v2/README.md)，当前 API 以源码 exports 为准。

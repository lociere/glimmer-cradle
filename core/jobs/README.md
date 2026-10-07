# Jobs Core

Jobs 是跨时间持久执行 owner，不解释认知目标、Memory 或外部平台语义。
App 注入数据目录、UTC 时钟、authority epoch 与 handler；Core 不读取进程环境或调用其他 Core 的业务实现。

`SqliteJobStore` 拥有独立 SQLite 库与 IMMEDIATE 写事务。触发按 scope/idempotency key 去重并校验
canonical JSON 摘要；重复提交返回原身份，冲突失败关闭。claim 持久增加 attempt/fencing token，
续期与完成校验当前 epoch、owner、token、状态和截止时间，过期租约不能复活。
authority epoch 只能单调前进；handover 的在途工作进入 unknown，旧 owner 不得继续写入。
每次 claim 单独持久保存原 epoch/owner/token、续期与结束状态；失效或切代不改写原执行身份。

`enqueueSource` 将 producer/request ID、不可变信封摘要、稳定 Job ID、业务绑定摘要和首次
due/max-attempts 与 Job/outbox 同事务接纳。ACK 丢失后重投沿用首次政策，仍核验源事实、业务内容和
retry mode；不会用当前 retry due 或新配置重算。普通 `enqueue` 的完整请求冲突规则不变。

App 注册 handler 并显式驱动 `JobScheduler.runDue`；handler 接收 AbortSignal 和 lease。
取消先持久撤销租约，再通知在途 handler，晚到结果无法覆写终态。停止 controller 时拒绝新执行并等待
在途 handler 收尾，之后才能关闭 store。handler 必须合作响应取消；Host 的超时回收不属于本包。
只有同时在请求与 handler 声明 idempotent 的工作可自动重试；其他未确认副作用进入 unknown。
租约检查不等于跨库原子提交，外部副作用接收 owner 仍须在提交点核验 fencing/幂等键。

`JobRecoveryController.reconcile` 消费 App 注入的可信结果查询 Port。证据绑定 Job/scope/attempt 与
原 epoch/owner/token；只有当前 unknown 的 revision/authority CAS 成功才接受。查询失败、无证据、
取消和身份不匹配不改变状态。applied 确认成功；failed 进入 dead letter；not-applied 必须证明接收 owner
已封口原 attempt 且未提交副作用，才在 attempt 预算内退避重试，不能把查询为空当此证据。
最小证据身份/摘要与状态同事务确认，同证据重投幂等、内容冲突拒绝，旧证据不解决新 attempt。

Job 状态转换与状态 outbox 同事务提交。`deliverOutbox` 在事务之外调用私有 App receiver；接收 owner
须将业务变化与 event_id inbox 原子提交后返回确认，Jobs 才 ACK。失败/取消/切代保留待投递事实，
接收成功但 ACK 丢失时可重投，接收方按 event_id 幂等接纳并校验内容。事件不含请求 payload；result
仍属于受控数据，receiver 的访问与投影约束由 App 实施，不直接暴露给 Renderer/Extension。
续期不发布状态事件，revision 可有间隙；消费方不能以连续 revision 判断事件丢失。
`readOutbox`/`deliverOutbox` 可按 kind 有界筛选，只确认已装配接收 owner 的事件；其他 kind
仍持久待 ACK。`hasPendingKind` 从当前 authority 下的持久 queued/running/retry_wait/unknown
查询未解决工作，供 App 如实呈现缺 handler 的降级，不用内存缓存冒充恢复事实。

事件与周期 trigger 定义、occurrence 去重及 next due 持久存储在同一库。定义不可变；同 ID 内容冲突
失败关闭，启停使用 revision CAS，禁用不取消已经生成的 Job。事件 payload 不能覆盖固定 input，
重复 occurrence 返回原身份；已确认事件在停用后重试仍返回 duplicate，不产生新 Job。
UTC once/interval 调度显式选择 all/latest backlog 政策；每次最多 materialize 1000 项，checkpoint
与入队原子提交，失败整批回滚，双进程竞争不会生成两套身份。Scheduler tick 先入队再执行 due Job。

retention 仅清理已无待 ACK outbox 的 succeeded/cancelled/dead-letter 大记录和已 ACK 事件，
保留去重 tombstone、源接纳最小快照、occurrence、最小 attempt 与证据摘要；unknown 不自动删除。
源快照不复制领域 payload，不要求源 ACK 确认来解除 body 清理；清理后重投仍返回原 tombstone。
源快照存在但 Job/tombstone 缺失则拒绝重新生成工作。schema version 4 不兼容时拒绝打开，旧候选
v1/v2/v3 库需显式迁移，不把用户旧数据库当成空库。产品数据路径由后续 Host composition 接线决定，
本切片不会创建生产数据库或迁移 Memory 库。

`listUnknown` 按已注册 kind、稳定 Job ID 与有界 cursor 扫描持久恢复集合，旧 authority 拒读。
Scheduler 可限定已装配的 kind，避免提前判死其他 owner 的工作；App 的 signal 取消后不再 claim。
真实 Memory 源 outbox、fencing/receipt、App handler/query 与持续调度已通过跨 Worker/Jobs 的临时库验证，
当前进度和生产 cutover 门见 [执行记录](../../docs/roadmap/architecture-v2-refactor.md)。
目标 Host 已接真实 Worker 监督、authority/config、Memory 状态接收及 Planning 源接纳；尚待
完整 catalog/产品入口切换、Planning 执行/完成评估及安装恢复主链。默认产品仍使用旧巩固队列，
目标 Host 不代表产品 cutover；目录存在不代表阶段 7 完成。

```powershell
pnpm --filter @glimmer-cradle/jobs test
pnpm --filter @glimmer-cradle/jobs typecheck
```

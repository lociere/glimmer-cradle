# Jobs Core

Jobs 是跨时间持久执行 owner，不解释认知目标、Memory 或外部平台语义。
App 注入数据目录、UTC 时钟、authority epoch 与 handler；Core 不读取进程环境或调用其他 Core 的业务实现。

`SqliteJobStore` 拥有独立 SQLite 库与 IMMEDIATE 写事务。触发按 scope/idempotency key 去重并校验
canonical JSON 摘要；重复提交返回原身份，冲突失败关闭。claim 持久增加 attempt/fencing token，
续期与完成校验当前 epoch、owner、token、状态和截止时间，过期租约不能复活。
authority epoch 只能单调前进；handover 的在途工作进入 unknown，旧 owner 不得继续写入。
每次 claim 单独持久保存原 epoch/owner/token、续期与结束状态；失效或切代不改写原执行身份。

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

事件与周期 trigger 定义、occurrence 去重及 next due 持久存储在同一库。定义不可变；同 ID 内容冲突
失败关闭，启停使用 revision CAS，禁用不取消已经生成的 Job。事件 payload 不能覆盖固定 input，
重复 occurrence 返回原身份；已确认事件在停用后重试仍返回 duplicate，不产生新 Job。
UTC once/interval 调度显式选择 all/latest backlog 政策；每次最多 materialize 1000 项，checkpoint
与入队原子提交，失败整批回滚，双进程竞争不会生成两套身份。Scheduler tick 先入队再执行 due Job。

retention 仅清理已无待 ACK outbox 的 succeeded/cancelled/dead-letter 大记录和已 ACK 事件，
保留去重 tombstone、occurrence、最小 attempt 与证据摘要；unknown 不自动删除。
schema version 3 不兼容时拒绝打开，旧候选 v1/v2 库需显式迁移，不把用户旧数据库当成空库。产品数据路径由后续 Host composition 接线决定，
本切片不会创建生产数据库或迁移 Memory 库。

已用独立目标 SQLite 验证结果提交/确认丢失与状态 outbox/inbox；真实 Memory 源业务→Job request
outbox、接收 owner 的生产 fencing/receipt 和跨进程恢复尚未接线。
尚待实现：Memory producer/handler、Host/Worker
broker、Jobs 配置 Document 的唯一 catalog/Schema 原子切换以及安装恢复主链。目录存在不代表阶段 7 完成。

```powershell
pnpm --filter @glimmer-cradle/jobs test
pnpm --filter @glimmer-cradle/jobs typecheck
```

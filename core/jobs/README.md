# Jobs Core

Jobs 是跨时间持久执行 owner，不解释认知目标、Memory 或外部平台语义。
App 注入数据目录、UTC 时钟、authority epoch 与 handler；Core 不读取进程环境或调用其他 Core 的业务实现。

`SqliteJobStore` 拥有独立 SQLite 库与 IMMEDIATE 写事务。触发按 scope/idempotency key 去重并校验
canonical JSON 摘要；重复提交返回原身份，冲突失败关闭。claim 持久增加 attempt/fencing token，
续期与完成校验当前 epoch、owner、token、状态和截止时间，过期租约不能复活。
authority epoch 只能单调前进；handover 的在途工作进入 unknown，旧 owner 不得继续写入。

App 注册 handler 并显式驱动 `JobScheduler.runDue`；handler 接收 AbortSignal 和 lease。
取消先持久撤销租约，再通知在途 handler，晚到结果无法覆写终态。停止 controller 时拒绝新执行并等待
在途 handler 收尾，之后才能关闭 store。handler 必须合作响应取消；Host 的超时回收不属于本包。
只有同时在请求与 handler 声明 idempotent 的工作可自动重试；其他未确认副作用进入 unknown。
租约检查不等于跨库原子提交，外部副作用接收 owner 仍须在提交点核验 fencing/幂等键。

retention 仅清理 succeeded/cancelled/dead-letter 的大记录，保留去重 tombstone；unknown 不自动删除。
schema 不兼容时拒绝打开，不把用户旧数据库当成空库。产品数据路径由后续 Host composition 接线决定，
本切片不会创建生产数据库或迁移 Memory 库。

尚待实现：持久周期/事件 trigger、跨库提交与 unknown 对账、Memory producer/handler、Host/Worker
broker、Jobs 配置 Document 的唯一 catalog/Schema 原子切换以及安装恢复主链。目录存在不代表阶段 7 完成。

```powershell
pnpm --filter @glimmer-cradle/jobs test
pnpm --filter @glimmer-cradle/jobs typecheck
```

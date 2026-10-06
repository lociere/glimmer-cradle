# Host

`@glimmer-cradle/host` 是 v2.1 Node App 装配 owner。当前已落位的实际消费面为
`composition/cognition-job-adapter.ts`：通过唯一生成 Cognition Service 投递 Memory 源请求、执行
Jobs handler，并核验原 attempt 的 Memory 持久封口/结果证据。Core Jobs 不导入 Cognition，App
不导入 Kernel 内部实现；`CognitionClient` 的端点/generation 必须由监督 owner 注入并在切代时撤销。

`pnpm build` 包含该 workspace，`pnpm test:host` 使用真实 Python Worker RPC、Memory/Log 和 Jobs
SQLite 验证源 ACK 丢失、业务响应丢失、重启对账及未到达 attempt 封口后重试。
源接纳使用 Jobs 持久快照，重启或政策变化保持首次 due/预算；完整源信封漂移仍拒绝 ACK。
源 ACK 已提交但响应丢失时，源扫描不再返回该请求，已接纳 Jobs 继续执行，不将其回滚或重建。
`composition/host.ts` 的 `HostJobsController` 持续驱动有界投递、持久 unknown 分页与到期执行，
并提供仅覆盖 Memory Jobs 的 lifecycle snapshot；重复启动共享循环，停机先取消并 drain 后撤销
当前 generation client。epoch、Store、时钟和政策必须显式注入；只有真实持久 receiver 才可确认
状态 outbox。Store 仍由装配方拥有，必须在 controller 停机返回后关闭。
`SqliteAuthorityStore` 持久维护 Platform authority 和 handover 记录；
`composition/domain-owners.ts` 的 `HostJobsOwner` 获取或接纳真实租约后注入 Jobs epoch、续期和
按权威身份拒旧执行。正常 drain 完成后才释放，handover 经旧 Jobs 封口确认后交给下一 owner；
authority 缺失/回退时拒绝用重复启动追赶已有 Jobs epoch。两个数据库仍由装配方注入并拥有。
生产进程监督、gateway、配置和 authority 路径加载、状态事件接收及产品启动迁移尚未完成；
本包当前不提供伪装成可启动 Host 的空 CLI。

完整进度与临时 owner 退出条件见 [架构迁移执行记录](../../docs/roadmap/architecture-v2-refactor.md)。

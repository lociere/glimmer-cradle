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
并提供当前 Jobs 装配的 lifecycle snapshot；重复启动共享循环，停机先取消并 drain 后撤销
当前 generation client。epoch、Store、时钟和政策必须显式注入；只有真实持久 receiver 才可确认
状态 outbox。Store 仍由装配方拥有，必须在 controller 停机返回后关闭。
`SqliteAuthorityStore` 持久维护 Platform authority 和 handover 记录；
`composition/domain-owners.ts` 的 `HostJobsOwner` 获取或接纳真实租约后注入 Jobs epoch、续期和
按权威身份拒旧执行。正常 drain 完成后才释放，handover 经旧 Jobs 封口确认后交给下一 owner；
authority 缺失/回退时拒绝用重复启动追赶已有 Jobs epoch。两个数据库仍由装配方注入并拥有。
`supervision/worker-supervisor.ts` 的 `WorkerSupervisor` 直接启动生产 Python Worker CLI（显式 external），
通过 FD3 一次性 HMAC 能力核验本代注册；首条状态真实接纳且 Worker 业务 readiness ready 后才
暴露 `createCognitionClient()` 的受监督 client。`HostCognitionJobsOwner` 组合该监督与 Jobs/可选 Knowledge owner：正常停机先撤 Knowledge IO 并 drain 管理请求、drain Jobs 并释放
authority，再协议 shutdown Worker，期限后仅回收本实例进程树并核验退出。崩溃撤销客户端、停止
Jobs/续期；重启须创建新实例/世代，数据库仍由调用方在整个 owner stop 完成后关闭。
状态接收方必需注入，Action/Log 接收方缺失时 NOT_READY；投影/inbox 幂等性由实际接收 owner 拥有。
进程路径、规范化配置 Document、deadline 与 console 路径显式注入；不存在默认第二配置源。
`ConfiguredHostCognitionJobsOwner` 是拥有资源的配置启动入口：`HostDataPaths` 显式分离安装、
配置与数据根，读取唯一 Host/Jobs/Memory Document；同一 Memory 投影同时注入 Worker 和源政策。
先验证全部配置和 authority/Jobs 恢复切点，再启动 Worker/Jobs，drain 完成后才关闭持有的两个库；
失败保留原数据，不隐式升级。Jobs/authority 采用目标 state 路径；终态保留期实际进入循环，仅
在到期且状态全部 ACK 后清理 body，保留最小源身份。精确默认值见
[配置参考](../../docs/reference/configuration.md#目标-host-与-jobs-配置)，路径与备份边界见
[数据目录](../../docs/reference/data-layout.md#用户状态与记忆)。测试中的安装根包含现行 Worker
必需的真实 SQL migration，并验证资源摘要未改变；不是完整安装制品/只读 ACL 验收。
配置启动默认接 `CognitionJobAdapter.stateReceiver(epoch)`，经生成 Service 将实际 Jobs outbox
按 `memory.consolidate` 筛选投递到 Memory 源 owner 的持久 inbox/投影；核验 receipt、拒旧主/旧代，提交后才 ACK。未注入
receiver 的手工装配仍保留待确认事实。取消/unknown 不代表 Memory 回滚或未执行，见
[协议参考](../../docs/reference/protocol.md#memory-jobs-状态投递)。
配置启动也默认接入 `PlanningJobSourceAdapter`，经实际 Worker RPC 扫描 Planning store，并在
Jobs commit 后 ACK 源；原 due 不套用 Memory debounce，预算来自唯一 Jobs Document，重启不
改写首次政策。尚无 Planning handler：待办保持 queued/attempt 0，持久待办查询使 Host 如实报告
`degraded/jobs_handler_pending`，Planning 状态事件保留未 ACK，不阻塞 Memory 状态投递。
同一 Adapter 已接原 attempt 持久对账，配置 Host 独立分页恢复 Planning unknown；封口或真实
评估回执经校验后交给 Jobs，不把 completed=false 改成目标完成，不注册未就绪 handler。
两种源接纳都不代表长期目标完成，精确边界见[协议参考](../../docs/reference/protocol.md#planning-jobs-源接纳)。
`HostResourceContributions` 可显式注入 WorkerSupervisor 的 typed CapabilityService；真实资源读取
消费 Host 短寿命授权、Core 独立 ResourceRegistry 和 Execution journal/outbox，经生成
Conversation Service 验证持久 receipt 后才返回正文。实际边界见
[能力实现](../../docs/architecture/implementation/Extension与SkillPlane实现.md#目标-host-resource-授权与读取)。
没有显式贡献/授权则拒绝，不是默认产品或完整 Extension IO sandbox。
`registerKnowledgeAccess` 与独立 typed 采集/复验 RPC 允许已登记主体读取 Host 接纳的固定来源，
须有 resource.read/knowledge.ingest 双 grant；短寿命证明不代表知识持久接纳。详情与剩余
接线见[Knowledge 采集边界](../../docs/architecture/implementation/Extension与SkillPlane实现.md#knowledge-显式资源采集边界)。
`HostKnowledgeController` 已消费生产 CognitionService 的查询/CAS 登记/停用/采集，Host 不写
Knowledge DB。配置启动显式装配同一 Resource graph 时读取唯一 HostConfig 审批，按实际
新世代重验来源 revision/digest/enabled 并新发双 grant、重新采集；未审批/失配/到期拒绝读取。
管理更新先撤销原 IO/证明，停止取消并 drain 后关闭本实例 client；字段和 UI/默认入口边界见
上述配置参考。Resource owner 的内容失效通知现已驱动有界重采集，复用仍有效的原 grant，
不自动续期/重新授权；定义替换、移除或失败保持拒绝。session.knowledge 仅投影来源状态和
最后实际接纳修订，不暴露正文/证明，也不代表全部材料此刻 current。详情见上述采集边界。
实际测试覆盖生产 Worker/SQLite 重启、通知合并、刷新中再次更新、停机迟到读取、停用与源冲突。
Tool/Skill gateway、完整配置 catalog、产品状态投影消费、Planning 执行/完成评估及产品启动迁移尚未完成；
本包当前不提供伪装成可启动 Host 的空 CLI。

完整进度与临时 owner 退出条件见 [架构迁移执行记录](../../docs/roadmap/architecture-v2-refactor.md)。

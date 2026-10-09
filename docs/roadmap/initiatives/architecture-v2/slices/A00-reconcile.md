# A00 接手输入索引

> 范围：A00 的现有输入路径；具体动作唯一归主执行任务书。
> 事实依据：dc59181e 的 Planning/Host/Worker 真实入口。
> 维护触发：输入路径或真实调用链变化。

执行时直接使用[主任务书 A00](../execution-order.md#step-a00)，状态只读 execution.json。
已知历史成果为原通知身份只读恢复与真实回执后 ACK；后继/取消及完整产品切换仍需按任务核对。

## 现有输入路径

| 精确路径 | 调查职责 |
|---|---|
| core/cognition/src/glimmer_cradle/cognition/planning/planning_controller.py | 承诺接纳、评估和持久对账 |
| core/cognition/src/glimmer_cradle/cognition/adapters/persistence/sqlite_planning_store.py | 原子状态、请求与通知 |
| core/cognition/tests/test_planning_jobs.py | Planning/Jobs 已有反例 |
| apps/host/src/gateway/conversation-routes.ts | 实际发送、权限与回执 |
| apps/host/tests/planning-reconciliation.test.ts | 生产对账接线 |
| apps/cognition-worker/src/glimmer_cradle/cognition_worker/rpc_service.py | 唯一 Worker 服务入口 |
| apps/cognition-worker/tests/test_rpc_roundtrip.py | 真实 RPC 与恢复 |
| contracts/proto/glimmer/cognition/v1/cognition_service.proto | 当前唯一 wire source |

本表定位调查入口；具体修改范围通过当前任务 mapping 固定，不预先推定全部文件均需修改。

## A00 核对证据（2026-10-09）

输入：`dc59181e` → `48a80b2f` 的差异及策略提交 `1cd2585e`。起始工作区干净，唯一写入 owner 为本会话。
后续 108 文件改动为文档/治理/检查工具整合；产品 Python 唯一差异是 rpc_service.py 的注释链接，不改变 Planning 行为。

定向读取 Controller、Store、commitment/goal、Worker RPC/job_client mapper、Host cognition-job-adapter/job-mapper/host composition/conversation-routes、Jobs Store Port 及现有 Planning/Worker/Host 测试。已确认：

- Planning SQL 是承诺、评估、通知请求的唯一 writer；Jobs SQL 是调度/attempt 的唯一 writer；Conversation/Delivery 保留实际回复和回执事实。跨库源投递先 Jobs commit 再 Planning ACK。
- 原 request 是 compact JSON `[planning.evaluate, commitment_id, plan_id, plan_version]` 的 SHA-256；Job 为 `planning:{request}`，评估 receipt 和通知 ID 从原 request 派生。历史已送达通知通过只读原身份恢复，不能再次 Resolve/Prepare 获取新发送许可。
- 当前 `commit_evaluation` 将未完成承诺 revision 加一，但只在 completed 时插入通知，没有后继 outbox；首次接纳重放读取单个 source，需在保留首次身份的同时支持多代请求。
- 没有承诺撤销入口及向 Jobs 的持久取消 outbox。现有 attempt/epoch/lease 拒绝链可复用，但须覆盖撤销和新 revision 后晚到提交。Jobs 已有 revision CAS cancel，不需要另建调度器。
- Host 源适配和 Worker mapper 都固定四项首次 identity；后继请求需要同一 IDL 的追加字段、两端 mapper 和原版本兼容验证。旧通知已确认历史不得因撤销被改写。

P07A 精确映射及命令保存于 execution.json；按原 owner 在现有文件实现，contracts 保持唯一源到 P11A。
后继到期由 Planning owner 决定并在评估事务中保存，重放不得按 Host 当前时间重算；撤销先持久封口源，再通过幂等跨库取消传播。
反例包括评估提交/后继插入之间失败、Jobs 接纳后 ACK 丢失、重启重投、模型进行中撤销、旧 revision/lease 晚到结果，以及通知已送达 ACK 丢失后的只读恢复。

验证：docs/write、docs、encoding、architecture 均 PASS（exit 0）；本步只核对事实与映射，无产品修改，因此不重跑已有产品行为测试。
首次通知身份/真实 ACK 历史证据沿用 dc59181e，输入行为代码未变；P07A 改动后重验受影响链。
G0/G5 为本步文档与准备门；自查无新增领域决策。完整产品/目录/平台验收待后续，A00 接受不代表任何产品阶段接受。

状态前进揭示 repo-checks fixture 假定实时计划永远为初始 A00：第一次执行 3/8 失败。
已将非法变体与隔离文档 fixture 固定为初始状态，保留真实当前计划的单独验证；相同 8 项全部 PASS（exit 0）。
未降低断言或放宽检查。根 typecheck/build 待最终集中验收，本次运行逻辑仅改测试输入，无共享构建/生产接口变更。

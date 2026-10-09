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

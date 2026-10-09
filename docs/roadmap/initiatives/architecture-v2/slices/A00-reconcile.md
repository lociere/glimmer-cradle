# A00：接手当前候选并固定后继调度切片

> 范围：从 dc59181e 接续迁移，调查 Planning 后继调度/撤销及产品接入差距，形成下一实现契约。
> 事实依据：最新历史原身份恢复切片、当前 Planning/Host/Worker 实现与目标清单。
> 维护触发：HEAD、持久状态、真实消费入口或后继验收变化。

## 起点与成果

这是已准备好的 discovery 任务，不是重新审计整个仓库。
唯一产品执行 owner 在接手时填写；状态从 execution.json 读取。
本任务输出 P07A 的精确切片卡与经过核对的阶段差距，不能借此宣布阶段 7 完成。

已知事实：历史通知身份只读查询已落到 dc59181e，Host 仅在真实 confirmed receipt 后 ACK。
未完成项包括后继调度/撤销、完整产品 ingress/审批/投影、旧数据切换和最终独立审查。
快照中的其他“下一步”可能已被后续切片解决，必须与实际源码核对。

## 操作

1. 运行 git status/log，核对 dc59181e 到实际 HEAD 的改动；若属于当前文档整合，只更新接手依据，不重做产品。
2. 读取[历史证据索引](../evidence/README.md)所指最新两节，读取下面现有入口与其真实调用者。
3. 用 rg 查 Planning 完成/未完成/取消/通知 ACK/后继请求生产者，核对是否已有原子后继 schedule；
   核对 Jobs lease/attempt 与 Planning revision 之间唯一映射，禁止从模型回答直接重建任务。
4. 检查 Host 定向通知历史确认与新发送的权限分支，确认取消后不会因重启复活发送。
5. 从目标 files.json 提取本次需要的文件；用模板填写具体 old→new、公开入口、writer、数据影响和删除门。
   若现有文件已经在目标位置，可登记 retain，不为重构强制搬动。
6. 将 P07A 从计划中的 discovery 细化为 implementation 卡，写准命令和反例；
   发现需要新语义决策时保留具体选项并按宪章处理。
7. 运行 docs/encoding/architecture，更新 execution.json 的 A00 证据及状态；
   依赖已接受且准备门满足后，才将 P07A 置 ready、nextTask 指向 P07A。

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

读取消费方清单时扩展到必要文件；本表是调查入口，不是预先授权的修改列表。

## 验收和停止点

- A00 自身不改产品行为或用户数据；输出后继卡、差距修正和证据。
- P07A 卡必须明确：未完成→下次调度的稳定 identity、取消/旧 revision 拒绝、
  通知 ACK 与后继安排的崩溃窗口，以及模型/发送/attempt 不重复的观察方法。
- 不能只以 grep 命中得出“没有消费者”；需查公开出口、App 装配和对应测试。
- 可运行基线为根 pnpm test:cognition、test:cognition-worker、test:host、test:jobs；
  discovery 阶段不需全量执行，后继 implementation 依据改动选择定向与全量门。
- docs/encoding/architecture PASS；新卡已登记目标清单；没有待定必需路径即可满足本任务成果。
- 遇到代码已实现本目标，改为验证缺口并记录证据，不重复实现；后继任务仍通过准备门。

未取得产品继续实施请求时停在本卡与文档整合交付，不擅自开始实现。

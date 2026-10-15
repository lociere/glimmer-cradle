# 持久化、并发与恢复

适用：Conversation、Content、Memory/Knowledge、Capabilities journal、Jobs、Host authority、配置和缓存。
先查 [数据布局](../../../../docs/reference/data-layout.md)、对应模块实现及 [迁移恢复指南](../../../../docs/how-to/数据迁移与恢复.md)，
只展开所改 owner。当前/目标目录和 schema version 从实物核对，不在本卡复制。

## 判断与实施

1. 标出不可再生事实、可重建 projection、缓存，以及与事实同库的 outbox/inbox、receipt、tombstone。
   表可重建不代表整库可删；备份须保护实际引用闭包和已提交 WAL。
2. 明确唯一 writer、事务接纳与 ACK 边界。Conversation Python Log 的提交确认、Host 协调和 UI 显示不同；
   保留稳定 ID、position、因果顺序，不能按墙钟排序重造事实。
3. 跨库/进程用真实 outbox/inbox、幂等键、revision 与 fencing；业务结果和待投递事实在各自 owner 同事务提交。
   接收成功但 ACK 丢失须可重投；旧 lease/epoch 的结果在提交处拒绝。journal、Conversation Log 和观测日志不互写冒充同一记录。
4. 已派发外部副作用后失联保持 unknown，先按原 invocation/attempt 向可信 owner 对账。
   “未查到”不是未执行证据；取消与超时也不自动证明副作用撤销。
5. Jobs 的 trigger/lease/backoff/retention 与 Cognition Planning 的目标含义分开；普通 Promise 不升为持久 Job。
   缺 handler/能力/权限如实降级，恢复不重算已接纳的政策或把 tombstone 当新工作。
6. Content 先 staging/校验/原子 committed 再持久引用；AssetRef 不是任意路径。GC 要有宽限、引用和备份协调。
   缓存键包括实际影响结果的配置/角色/模型版本，权限或来源删除使派生缓存失效。

## 迁移与直接证据

先确认停写/锁/authority、源版本及恢复材料；以源副本和新候选路径演练，保留源，成功验证后才在授权环境切换。
对 schema、ID、顺序、引用、outbox、unknown、lease 和权限分别核对；新文件存在不证明迁移正确。
跨语言 owner 移动须证明行为等价并切断旧 consumer，不以 ORM 的 down/drop 作为数据恢复策略。

临时真实库验证：旧/空/坏样本、重复迁移、并发 claim/CAS、崩溃在 commit/ACK 两侧、重开重建、
故障恢复与 retention。拒绝未知 schema，失败保留诊断候选；用户源数据保持可恢复。
只对可判定稳定性质采用 roundtrip、幂等、状态机或与旧实现比较；不要镜像 SQL 作为测试 oracle。

新增数据/配置路径同步唯一 Reference、resolver、打包和受影响恢复指南。真实数据切换仍需其环境授权，
局部迁移测试不能关闭完整安装/升级/恢复门。

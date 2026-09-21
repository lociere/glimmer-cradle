# ADR-0022：Conversation Log 与 Experience 投影边界

- 状态：accepted
- 日期：2026-09-21

## Context

现行 `ExperienceLedger` 同时保存 perception、emotion、reply、action、action result 和 silence，
`ConversationStore`、Episode、Relationship、Activity 与近期经历都从它按全局 position 投影。
Architecture Baseline v2.0 要求 Conversation Log 成为持久交互事实的 canonical source，History
只是 projection；ADR-0008 把同一账本归 Cognition Experience 的旧 owner 与该目标冲突。

直接拆成 Conversation/Experience 两份日志会产生顺序、因果和恢复双写，也无法无损判断历史 v4/v5
Moment 应落哪一份。直接把 `conversations.db` 升为事实源则会丢失 action result、silence、causation、
来源与资产引用。

## Decision

1. `core/conversation` 的 `ConversationLog` 是 durable interaction fact 的唯一 writer 和 canonical source。
   当前六类 Moment 均属于一次交互的消息、行动、结果、终态或直接相关 observation；Cognition 可以解释
   它们，但不再拥有其持久顺序。
2. 保留现有 append-only pack、全局 position、`moment_id`、causation、v4/v5 reader 与单写者 guard。
   为避免无依据的数据搬迁，阶段 4 原位使用 `data/state/cognition/experience/` 兼容路径；路径与备份布局
   的版本化迁移留阶段 14，不能通过复制或双写建立第二日志。
3. History、Conversation State 与 Working Set 由 `core/conversation` 从 Log checkpoint 幂等投影；
   `conversations.db` 可删除重建，不拥有原始事实。
4. Episode、Relationship、Activity、Recent Experience 与 Memory consolidation 是 Cognition 对 Log 的
   只读投影或解释。它们可保存自己的 checkpoint 和可重建索引，但不能反向改写 Conversation Log。
5. `interaction_id` 表达持久 Turn identity；当前 producer 继续以同一 trace 值生成它以保持历史兼容，
   但 `ConversationTurn` 与 Cognition 的 Loop/Step 状态分属不同 owner。模型可见的 tool call/result 必须
   以 Moment 或稳定引用留在 Log。
6. Extension SDK 的 Conversation 类型是公开投影，不是 Core owner。外部平台键只进入 Binding 解析，
   Log 只保存 canonical conversation/thread/actor opaque id。

本决策替代 ADR-0008 中“Cognition 以 Experience Ledger 作为角色经历唯一事实源”的 owner 表述；
版本化 Memory、evidence 校验、可重建索引和不可删除用户事实的原则继续有效。

## Consequences

- Cognition Worker 组合 Conversation writer/reader，并通过 Port 消费事实；物理进程位置不决定领域 owner。
- 旧数据无需原地改写即可继续恢复，备份仍须把 Log pack 与 Content assets 作为一个恢复集合。
- `experience.*` 配置键和旧目录名在阶段 14 前保持兼容，当前文档必须标明其真实 owner，不能据名称推回 Cognition。
- 新增 Cognition-only 内部状态不能因为方便而写入 Log；只有未来需要重建模型可见交互历史的 durable fact 才进入。

## Alternatives considered

- 双写新旧日志：部分失败会形成两个事实源，拒绝。
- 从 History DB 反推新日志：History 不含完整因果、来源与工具结果，拒绝。
- 立即重命名目录和 schema：会扩大不可再生数据迁移范围，留阶段 14 的备份、fixture 和幂等门。

## Links

- [Architecture Baseline v2.0](../blueprint/Glimmer_Cradle_Architecture_Baseline_v2.0_Frozen.md)
- [重构执行记录](../../roadmap/architecture-v2-refactor.md)
- [Conversation 实现](../implementation/Conversation实现.md)
- [ADR-0008](./ADR-0008-ExperienceLedger与版本化Memory.md)

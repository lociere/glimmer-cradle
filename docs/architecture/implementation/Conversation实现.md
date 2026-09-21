# Conversation 实现

> 范围：当前 Conversation Binding、Turn、canonical Log、Message/History projection 与 Cognition 消费边界。
> 事实依据：`core/conversation/`、Kernel composition、Cognition Worker composition、现行 v4/v5 pack 与测试。
> 维护触发：Conversation 类型、稳定 ID、Log schema/writer、History、Turn/Step 边界、数据路径或公开投影变化。

## Owner 与入口

`core/conversation` 是私有双语言领域 owner：

- TypeScript `src/index.ts` 拥有 `ConversationAddress`、`ConversationContext` 与
  `ConversationDirectory`。Kernel composition 注入 Platform `StableIdentity`，桌面和 Extension Adapter
  只提交平台中立地址；解析后不再保留外部 account/space/thread 原值。
- Python `python/glimmer_cradle/conversation/` 拥有 `ConversationTurn`、Message/WorkingSet、
  `ConversationLog`、`ConversationRecorder`、History Store/Controller 和所需 Port。
- Cognition Worker 是当前进程 composition root，不因此拥有 Conversation 状态；它注入 Clock、ID、
  Observability、兼容路径和配置，再通过 Conversation reader 组装 Context、Episode、Relationship 与 Activity。

公开 Extension SDK 当前保留结构相同的 `ConversationAddress` / `ConversationContext` 投影，退出与发布兼容
归阶段 9。跨进程 Cognition DTO 继续由 Contract Spine 拥有，Core 不手写 wire 镜像。

## Binding 与 Turn

`ConversationDirectory` 对 provider/account/space/thread/actor endpoint 做不可逆稳定摘要，生成 scene、
conversation、continuity、thread 与 actor opaque id，并根据 visibility/space kind 固定 recall/disclosure scope。
相同地址跨进程重启得到相同 Conversation；每次交互的 `interaction_id` 单独变化。

`ConversationTurn` 保存一次完整交互周期的稳定 identity 与权限上下文。Cognition `CycleTurn` 只保存一拍内的
perception、ActionPlan、intent 和 arbitration，并引用 `ConversationTurn`；模型推理 Step 在阶段 5 留在
Cognition Loop，不再把 Turn 和 Step 当同一种状态。

## Canonical Log 与 Experience

`log/ledger.py` 是唯一 writer：月度 SQLite pack 只追加 Moment，`catalog.db` 维护全局 position 和 pack 范围，
writer guard 阻止同一目录双写。`perception`、`emotion`、`reply`、`action`、`action_result` 与 `silence`
保存直接交互事实、终态或相关 durable observation；`transient` 不落盘。

为保护已有不可再生数据，当前物理路径仍是：

```text
data/state/cognition/experience/catalog.db
data/state/cognition/experience/packs/YYYY/YYYY-MM.experience.db
```

路径名和 v4/v5 的 `moment_id`、schema ref 是兼容事实，不表示 owner 仍是 Cognition。阶段 14 才能在备份、
旧样本、幂等和失败恢复门下迁移路径；当前禁止双写另一份 Log。长期取舍见
[ADR-0022](../decisions/ADR-0022-ConversationLog与Experience投影边界.md)。

Cognition 的 Episode、Relationship、Activity、Recent Experience 与 Memory consolidation 都是 Log 的
只读投影或解释。它们可以保存 checkpoint 与可重建状态，不能反向改写 Log。

## History 与恢复

`history/store.py` 只按 Log position 增量投影 user/assistant Message、Chapter、Segment 和 Conversation State。
`history/controller.py` 在读取前 flush Log 并推进 checkpoint；Working Set 只从 History Store 恢复。
`conversations.db` 是可删除重建的 projection，不是第二事实源。

当前兼容路径为 `data/state/cognition/conversations/conversations.db`；阶段 14 迁移前保持不变。权限域、
continuity 或 thread 在同一 canonical Conversation 内漂移时投影 fail closed。分页 cursor 以 Log position
为锚，actor 过滤仍允许 assistant reply 与对应用户历史成对呈现。

模型可见的 tool result 作为 `action_result` 留在 Log，并由 Episode/Recent Experience 重建上下文；
Control Center 的普通 History 只投影 user/assistant Message，不把工具 payload 冒充聊天文本。

## 验证

```powershell
pnpm run test:conversation
uv run --project core/cognition --extra dev pytest -q core/cognition/tests
pnpm check:architecture
pnpm check:encoding
pnpm typecheck
pnpm build
```

高风险变化还要覆盖单写者冲突、重启 position、旧 v4/v5 pack、catalog 重建、损坏读取、History 重建、
权限域漂移、分页 cursor、transient 不落盘、工具结果恢复和停机 flush。路径迁移必须额外执行备份恢复。

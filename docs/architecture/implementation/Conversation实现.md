# Conversation 实现

> 范围：当前 Conversation Binding、Turn、canonical Log、Message/History projection 与 Cognition 消费边界。
> 事实依据：`core/conversation/`、Kernel composition、Cognition Worker composition、现行 v4/v5 pack 与测试。
> 维护触发：Conversation 类型、稳定 ID、Log schema/writer、History、Turn/Step 边界、数据路径或公开投影变化。

## Owner 与入口

`core/conversation` 是私有双语言领域 owner：

- TypeScript `src/binding/` 拥有 `ConversationAddress`、`ConversationContext`、存储 Port 与
  `ConversationDirectory`；根入口只负责公开导出。Kernel composition 注入 Platform `StableIdentity` 和
  `SqliteBindingStore`，桌面和 Extension Adapter 只提交平台中立地址；解析后不再保留外部
  account/space/thread 原值。
- Python `src/glimmer_cradle/conversation/` 拥有持久 `ConversationTurn` 状态机、Message/WorkingSet、
  `ConversationLog`、`ConversationRecorder`、History Store/Controller 和所需 Port；`pyproject.toml`、pytest
  与 Cognition 的 workspace path dependency 均从该唯一源码根安装，不保留旧 `python/` 包入口。
- `migrations/python/001-history.sql` 与 `002-turns.sql` 是 fresh-schema 的唯一 SQL 来源并随 Python wheel
  安装；代码迁移只保留 v3→v4 的有状态数据转换。`schemas/conversation-config.schema.json` 固定 owner 配置边界，
  现行 Cognition 配置消费将在 App composition 迁移时切换。
- Cognition Worker 是当前进程 composition root，不因此拥有 Conversation 状态；它注入 Clock、ID、
  Observability、兼容路径和配置，再通过 Conversation reader 组装 Context、Episode、Relationship 与 Activity。

公开 Extension SDK 当前保留结构相同的 `ConversationAddress` / `ConversationContext` 投影，退出与发布兼容
归阶段 9。跨进程 Cognition DTO 继续由 Contract Spine 拥有，Core 不手写 wire 镜像。

## Binding 与 Turn

`ConversationDirectory` 对 provider/account/space/thread/actor endpoint 做不可逆稳定摘要，生成 scene、
conversation、continuity、thread 与 actor opaque id，并根据 visibility/space kind 固定 recall/disclosure scope。
`migrations/001-binding.sql` 建立 `data/state/conversation/bindings.db` 的持久映射，只保存 opaque identity、
provider id、权限域和创建时间，不保存外部 account/space/thread/actor 原值。相同地址跨进程重启得到相同
Conversation；每次交互的 `interaction_id` 单独变化。已绑定地址发生 space kind/visibility 权限漂移时
fail closed，不能静默改写既有作用域；Kernel Application Runtime 停止时负责关闭 store，即使其他 provider
释放失败也继续收束该资源。

`ConversationTurn` 保存一次完整交互周期的稳定 identity、权限上下文、状态与修订。`TurnController` 通过
`SqliteTurnStore` 提供幂等接纳、乐观并发和 `accepted → running → completed/interrupted/failed` 合法转换；
进程重启会把遗留 active Turn 明确收束为 `interrupted/process_restarted`。普通回复或沉默在 Log 提交后完成
Turn；能力请求保持 running，直到 ToolCall/ToolResult/Reply 持久并 flush 后完成。Cognition `CycleTurn`
只保存一拍内的 perception、ActionPlan、intent 和 arbitration，并引用持久 Turn；模型推理 Step 在阶段 5
留在 Cognition Loop，不再把 Turn 和 Step 当同一种状态。

## Interaction 与 Delivery

TypeScript `InteractionController` 以 provider event 去重键和内容摘要接纳输入；同键同内容合并为一次处理，
同键异内容拒绝，失败接纳可重试。同一 conversation/thread 的新输入先推进 generation 并取消旧 signal，
忽略取消的下游若仍返回结果，也只会形成 `interrupted/stale_generation`，不能覆盖新 Turn。Kernel
`PerceptionAppService` 是当前真实入口消费者；摘要算法由 composition 注入 `StableIdentity`，Application
层不直接依赖 Node crypto。

`DeliveryController` 与 `SqliteDeliveryStore` 持有输出 authority epoch、destination generation、状态转换、
回执去重和实际 `heard_through_ms`。Kernel 普通回复和工具合成回复共用该入口：EventBus 调用前先 durable
queue，成功后只标记 sent，异常或崩溃窗口保留 unknown 并阻止自动重放；权威回执可把 unknown 对账为
delivered/playing/completed。新 Host epoch 会先 fence 旧 epoch 的所有 active output；中断或新 generation
之后到达的旧回执不得改变状态。当前 Surface wire 尚未携带 delivery receipt，真实 UI/音频回执接线仍是
阶段 4 与阶段 11/12 的剩余工作，不能把 EventBus handler 返回当成 delivered 或 heard。

## Canonical Log 与 Experience

`adapters/persistence/log_store.py` 是唯一 SQLite writer adapter：月度 pack 只追加 Moment，`catalog.db` 维护全局 position 和 pack 范围，
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

`adapters/persistence/history_store.py` 只按 Log position 增量投影 user/assistant Message、Chapter、Segment 和 Conversation State。
`history/projection.py` 在读取前通过 commit barrier 推进 checkpoint；`history/history_reader.py` 只从投影恢复 Working Set。
`conversations.db` 是可删除重建的 projection，不是第二事实源。

当前兼容路径为 `data/state/cognition/conversations/conversations.db`；阶段 14 迁移前保持不变。History
schema v4 以 `(conversation_id, thread_id)` 区分线程；同一线程的 scene 与权限域漂移时投影 fail closed，
continuity/actor 可随交互变化。分页 cursor 以 Log position 为锚，actor 过滤仍允许 assistant reply 与
对应用户历史成对呈现。v3→v4 在事务内释放旧表重命名后保留的索引名，再复制 checkpoint、Message、
Chapter、Segment、成员和 State；迁移失败回滚，不删除旧数据。

能力请求在外部副作用前写入 `action` 并越过 flush barrier。实际工具调用以稳定 `invocation_id` 写入
`action(tool_call)`，结果以该调用为 causation 写入 `action_result`，最终 `reply` 再引用结果；相同
invocation 的 RPC 重放返回原 position，内容冲突则拒绝覆盖。由此模型可见 ToolCall/ToolResult 可从 Log
恢复，而 Kernel 当前内存 execution journal 的完整持久化仍由阶段 6 收束。

模型可见的 tool result 由 Episode/Recent Experience 重建上下文；
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
权限域漂移、多 thread 隔离、v3→v4 无损迁移、Turn 重启恢复/非法转换/重复接纳、分页 cursor、
Interaction 去重/冲突/晚到 generation、Delivery epoch/unknown/回执冲突/播放范围、transient 不落盘、
工具结果恢复和停机 flush。路径迁移必须额外执行备份恢复。

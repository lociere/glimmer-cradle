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

`ConversationTurn` 保存一次完整交互周期的稳定 identity、输入摘要、权限上下文、状态与修订。`TurnController` 通过
`SqliteTurnStore` 提供幂等接纳、乐观并发和 `accepted → running → completed/interrupted/failed` 合法转换；
进程重启会把遗留 active Turn 明确收束为 `interrupted/process_restarted`。普通回复或沉默在 Log 提交后完成
Turn；能力请求保持 running，直到原 Action/已接纳 Execution Result/Reply 持久并 flush 后完成。Cognition `LoopStep`
只保存一拍内的 perception、原生结果事实引用、reply、intent 和 arbitration，并引用持久 Turn；
短程 ActionPlan 已删除，模型推理 Step 留在 Cognition Loop，不把 Turn 和 Step 当同一种状态。

## Interaction 与 Delivery

TypeScript `InteractionController` 以 provider event 去重键和内容摘要接纳输入；同键同内容合并为一次处理，
同键异内容拒绝，失败接纳可重试。同一 conversation/thread 的新输入先推进 generation 并取消旧 signal，
忽略取消的下游若仍返回结果，也只会形成 `interrupted/stale_generation`，不能覆盖新 Turn。Kernel
`PerceptionAppService` 是当前进程内入口消费者；摘要算法由 composition 注入 `StableIdentity`，Application
层不直接依赖 Node crypto，并将同一摘要随 Perception origin 交给 Cognition/Conversation 持久 Turn。
Controller 在内存去重前可消费 `TurnSnapshotStorePort` 的持久确认：turn identity 与 payload digest 都匹配才
视为跨重启重复，同 ID 异内容失败关闭。旧 SQLite Turn schema 原位补摘要列，历史空摘要不能冒充已验证重复。
`apps/cognition-worker` 的物理进程入口已形成，但 Kernel 尚未接入 Python Conversation Turn adapter；
`conversation_mapper.py` 与 Host consumer 接线完成前，仍不能宣称跨进程确认闭环已经完成。

`DeliveryController` 与 `SqliteDeliveryStore` 持有输出 authority epoch、destination generation、状态转换、
回执去重和实际 `heard_through_ms`。Kernel 普通回复和工具合成回复共用该入口：EventBus 调用前先 durable
queue，成功后只标记 sent，异常或崩溃窗口保留 unknown 并阻止自动重放；权威回执可把 unknown 对账为
delivered/playing/completed。新 Host epoch 会先 fence 旧 epoch 的所有 active output；中断或新 generation
之后到达的旧回执不得改变状态。Surface Gateway 的 typed `DeliveryReceiptCommand` 传播 output、destination、
authority epoch、generation 和回执身份；Reply/Audio projection 携带同一 fencing metadata。Desktop renderer
在文字实际投影后回报 delivered，并以 `HTMLAudioElement` 的 started/ended/error 反馈提交播放状态；分段语音
按 segment index/count 累计单调 `heard_through_ms`，只在末段完成。Personal Server 仅在认证浏览器 WebSocket
发送成功后回报 delivered。EventBus handler 返回仍只代表 sent，不能冒充 delivered 或 heard。

Delivery 持久层维护独立版本 1 的 authority 窗口：可信 App 激活 epoch 时原子记录当前与已退出
epoch，并 fence 旧输出；已退出 epoch 不能重新激活。allocate、interrupt 与回执转换在同一
IMMEDIATE 事务复验当前 owner，旧 controller 不能凭新目的地或幂等捷径夺回写入资格。opaque
epoch 不按字符串排序推断新旧，窗口也不替代 Platform 的 authority 租约和 App 权限判断。

新实际回执建立独立版本 1 的完整事实窗口，保存完整 envelope、原 `turn_id` 和
`content_digest`，与最小 receipt 索引和输出状态同事务提交。身份/原因限 4 KiB，完整事实限
64 KiB；回执 kind、字段、目的地/epoch/generation、播放范围和持久绑定均核验。相同 receipt ID
只允许原语义精确重投，到达时间可更晚，但保留首次时间；异内容不能冒充 duplicate。已知时长
不能通过省略 duration 绕过，直接调用 Store 也不能倒退进度或篡改回执原因。

`receipt` 与 `confirmedReceipt` 从唯一持久 owner 只读返回可核验事实；后者只认可真实
delivered/playback_completed，sent、unknown、started/progress、失败或仅旧状态不是确认。
新主可对账旧主曾接纳的历史确认，supersession 不抹除历史事实，但不接纳新的迟到旧世代回执；
历史事实不授予当前外部发送权限，也不自动 ACK Planning。普通打开不建立增量窗口，旧最小
receipt 不回填完整事实；需要独立真实新回执或受控对账。未知版本、部分窗口、损坏或原绑定
冲突拒绝确认，不自动修复用户库。恢复与备份规则见[数据目录](../../reference/data-layout.md#用户状态与记忆)。

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

能力请求在外部副作用前写入 `action` 并越过 flush barrier，其 fact ID 随现行 Action call metadata
传到 Kernel。Capabilities schema 2 只保存 Conversation ID 与原 Action ID 最小引用；执行状态/结果
由该 owner 持久保存，不能由 Synthesis 再制造一份 `action(tool_call)` 或 canonical 结果。

独立 `glimmer.conversation.v1.ConversationService.AcceptExecutionResult` 由当前 Worker 同进程承载，
Adapter 消费唯一 Contract Spine 的 DTO，Core Recorder 消费 owner-local `ExecutionResultFact`。
校验 result event SHA、invocation/revision/attempt、scope、状态证据、结果 presence/大小后，从真实
原 Action 恢复线程、actor、trace、因果和隐私域；不存在或不同 conversation 的引用拒绝接纳。
同一 event ID 使用稳定 Moment ID；同身份不同内容拒绝覆盖，重投返回原 position。
只有 Log flush 真正提交后返回 accepted receipt。等待者重复取消时仍持有 flush lock，直到实际
写入线程结束；取消/失败不返回 receipt，失败恢复 pending，阻止第二个请求提前 ACK。

结果是 `experience`、`untrusted` 的外部观察，不提升为 Memory candidate 或 host-verified Knowledge。
Synthesis 只从已接纳的真实结果恢复 body/state，并将其 Moment ID 作为 Reply causation；未接纳则
等待重投，wire body/status 不能覆盖事实。规划失败、派发前拒绝与旧无 journal fixture 只是未验证
观察。真实持久结果的接纳/合成失败向原 Action 调用传播，不发布 fallback 或提交已完成 Turn；
同进程重试复用原结果，完整跨重启行动恢复仍未完成。规划/旧 fixture
不写执行事实；这个临时无 journal 分支随阶段 6/12 consumer-zero 删除。Reply 以稳定 fact key
查询，重放先校验会话/线程并越过 flush barrier，不能依赖最近 200 条窗口猜测幂等。
完整跨重启计划/调用序列恢复与 native ToolCall/ToolResult 模型入口仍待阶段 6 收束。

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

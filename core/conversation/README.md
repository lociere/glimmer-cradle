# Conversation Core

Conversation 是私有双语言领域 owner，负责稳定 Binding、Interaction 接纳与中断、持久 Turn、canonical Log、
History 投影和输出 Delivery。认知内容由 Cognition 决定；平台地址、Surface 传输和模型 Step 不进入本模块。

## 公开入口

- TypeScript 消费方只从 `@glimmer-cradle/conversation` 根入口导入 Binding、Interaction、Delivery 与 Port。
- Python 消费方只从 `glimmer_cradle.conversation` 根入口导入 Log、History、Turn 与 Port。
- `contracts/` 仍是跨进程 wire 唯一来源，本包不手写 generated DTO。
- `ConversationRecorder.accept_execution_result` 绑定已存在的原 ACTION 与 Execution result identity，
  继承其线程/隐私上下文，刷盘后才返回原 Moment/position；重复接纳不产生第二份交互事实。
- 通知表达由 Cognition 提供 `NotificationReplyFact`；Recorder 核验真实原 Perception 并 flush 稳定
  Reply，TurnController 再接纳对应已结束的内部 Turn。重启沿原 Reply 补确认，不覆盖普通 Turn，
  不把内部接纳当外部送达或源 ACK。

## 持久状态

- `bindings.db` 保存不含外部原始键的 opaque Binding。
- `delivery.db` 保存当前/已退出 authority epoch、generation、投递状态、播放范围和完整回执事实。
  实际回执与状态同事务提交，绑定原 Turn、内容摘要和目的地；历史最小 receipt ID 不自动补造确认。
  `receipt`/`confirmedReceipt` 只读查询历史接纳事实，不证明当前发送权限。
- `conversations.db` 是可重建 History 投影，同时保存绑定输入摘要的 Python Turn 状态；旧 Turn 缺少摘要时拒绝冒充可确认重复，canonical 交互事实仍在 Conversation Log。
- 迁移 SQL 位于 `migrations/`；现有数据路径迁移须按阶段 14 的备份恢复门执行。

## 验证

```powershell
pnpm --filter @glimmer-cradle/conversation test
uv run --project core/conversation --extra dev pytest -q core/conversation/tests
```

Kernel/Cognition 接线变化还需分别运行对应全量测试、根 `pnpm typecheck` 与 `pnpm build`。

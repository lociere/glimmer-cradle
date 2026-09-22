# Conversation Core

Conversation 是私有双语言领域 owner，负责稳定 Binding、Interaction 接纳与中断、持久 Turn、canonical Log、
History 投影和输出 Delivery。认知内容由 Cognition 决定；平台地址、Surface 传输和模型 Step 不进入本模块。

## 公开入口

- TypeScript 消费方只从 `@glimmer-cradle/conversation` 根入口导入 Binding、Interaction、Delivery 与 Port。
- Python 消费方只从 `glimmer_cradle.conversation` 根入口导入 Log、History、Turn 与 Port。
- `contracts/` 仍是跨进程 wire 唯一来源，本包不手写 generated DTO。

## 持久状态

- `bindings.db` 保存不含外部原始键的 opaque Binding。
- `delivery.db` 保存 authority epoch、generation、投递状态、播放范围和回执去重。
- `conversations.db` 是可重建 History 投影，同时保存 Python Turn 状态；canonical 交互事实仍在 Conversation Log。
- 迁移 SQL 位于 `migrations/`；现有数据路径迁移须按阶段 14 的备份恢复门执行。

## 验证

```powershell
pnpm --filter @glimmer-cradle/conversation test
uv run --project core/conversation --extra dev pytest -q core/conversation/tests/python
```

Kernel/Cognition 接线变化还需分别运行对应全量测试、根 `pnpm typecheck` 与 `pnpm build`。

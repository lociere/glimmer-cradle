# Cognition Core

Cognition 是环境中立的认知领域 owner，负责 Persona、State、Memory、Knowledge、Perception、
Attention、Context、Inference、Planning 与原生模型/工具 Loop。平台 IO、密钥、供应商 SDK、
能力执行和长期任务调度不进入本模块。

## 公开入口

- Python 消费方从 `glimmer_cradle.cognition`、明确子域根入口或 `ports/` 导入公开契约，不 deep import 内部实现。
- `CapabilityPort`、`ContentPort`、`ConversationPort`、`JobPort` 与 `ResourcePort` 由 Cognition 定义需求，由 App 装配实现。
- `contracts/` 仍是跨进程 wire 唯一来源；Core 不导入 generated DTO。

## 状态与恢复

- Persona、State、Memory、Knowledge、Planning 与 Loop checkpoint 分库存储，各自拥有迁移和 revision 规则。
- Conversation Log 是交互事实 owner；Cognition 只消费事实并写入受控认知投影。
- Loop 的 Run/checkpoint 独立于 Conversation Turn 和 Job；原生 ToolCall 只可调用当步曝光的能力，并使用稳定幂等键。

## 验证

```powershell
uv run --project core/cognition --extra dev pytest -q core/cognition/tests
uv run --project core/cognition --extra dev ruff check core/cognition/src core/cognition/tests
pnpm check:architecture
```

跨包装配变化还需运行根 `pnpm typecheck` 与 `pnpm build`。Cognition owner Schema 迁移完成前，
`contracts/json-schema/config/v1/` 仍是现行唯一 Schema 来源。

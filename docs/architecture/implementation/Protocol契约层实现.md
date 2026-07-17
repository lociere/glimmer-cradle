# Protocol 契约层实现

> 范围：跨语言、跨进程和公开 SDK 契约如何由 JSON Schema 定义、生成、校验和消费；不列全部字段。
> 源码依据：`protocol/src/schemas/`、`protocol/src/generated/`、`protocol/src/runtime/`、`protocol/src/config-schemas.ts`、`scripts/sync_contracts.py`、Cognition `protocol/generated/`。
> 维护触发：Schema、IPC 消息、Avatar frame、配置模型、生成脚本、runtime helper、跨语言消费者或错误码变化。

## 目录与生成链

```text
protocol/src/
├── schemas/{enums,models,ipc,config}/   # 唯一权威 Schema
├── generated/{enums,models,ipc,config}/ # TypeScript 生成投影
├── runtime/                             # validator、normalizer、reply/avatar helper
├── models/ ipc/ utils/                  # 手写 runtime helper 和便利模型
└── config-schemas.ts                    # config schema 聚合入口

core/cognition/src/glimmer_cradle/cognition/protocol/generated/
└── Python 生成投影
```

跨语言结构先改 `protocol/src/schemas/`，再运行：

```powershell
pnpm sync:contracts
```

生成物不能手改。若生成物不满足消费需求，应改 Schema、生成脚本或 runtime helper，而不是在消费者里复制字段。

## 契约分类

| 分类 | 示例 | 消费者 |
|---|---|---|
| enums | `IPCMessageType`、`ErrorCode`、`CognitiveActivityState` | Kernel、Cognition、Renderer |
| models | `PerceptionEvent`、`ActionCommand`、`TraceContext`、`SourceDescriptor` 字段 | 多语言/多进程共享模型 |
| ipc | `KernelMessageEnvelope`、`AgentPlanPayload`、`AgentSynthesisPayload` | Kernel ↔ Cognition |
| config | `AppConfig`、`SkillPlaneConfig`、`SurfaceConfig`、`CognitionConfig` | config normalizer 与生命周期 runtime |
| runtime helper | `reply-messages`、`avatar-frame`、validator | TS runtime 消费 |

公开 SDK 使用的结构也必须来自稳定契约或 SDK 自己的公开 contract，不允许 Extension 依赖 Kernel 内部类型。

## 变更顺序

1. 判断是否跨语言/跨进程/公开 SDK；如果是，先改 Schema。
2. 为新增字段写清 owner、默认值、是否必填、兼容语义和错误 code。
3. 运行 `pnpm sync:contracts`。
4. 改生产者、映射层、消费者、投影和测试。
5. 搜索旧字段、旧消息、手写镜像和无期限 fallback。
6. 更新 Reference、Implementation 和 Guide。

破坏性变更优先显式迁移并删除旧路径。短期双轨必须有 owner、删除条件和验证方式。

## 运行时校验

Protocol 的 runtime helper 负责：

- 校验入站 payload；
- normalizer 配置；
- 构造 reply/avatar 等受控消息；
- 对未知枚举、缺字段、非法组合产生可诊断错误；
- 让错误 code 能跨边界传播。

不要把远端 MCP schema、provider schema 或平台 payload 当项目 Protocol 直接传给 Cognition。外部 schema 必须先映射到 Glimmer Cradle 自己的契约。

`ActionCommand` 的 `skill_request` 和 `MomentKind.action` 由 Schema 定义后生成到 TS/Python 两端。Cognition 发出的 `skill_request` 只表达结构化行动语义：`original_goal`、`capability_kind`、`confidence`、`reason` 和可选 `planning_hint`；Kernel 侧 controller、character audience 的 ready catalog、Skill Plane policy/gateway 和 synthesis RPC 才解释执行事务。修改这些字段时必须先改 `protocol/src/schemas/models/ActionCommand.schema.json` 或 `schemas/enums/MomentKind.schema.json`，再运行 `pnpm sync:contracts`。

`ExtensionRuntimeProjection` 的 Capability Graph node 与 action intent 必须携带 `audience`。该字段由 `protocol/src/schemas/models/ExtensionRuntimeProjection.schema.json` 生成到 SDK、Kernel 和 Cognition；非 `character` 的能力不得进入人物 Skill catalog，`user` action intent 才供 Control Center 管理 UI 使用，`host`/`adapter`/`renderer`/`extension` 只服务对应 owner 边界。

## 调试入口

| 症状 | 先查 |
|---|---|
| TS/Python 字段不一致 | Schema、生成物、`pnpm sync:contracts` 输出 |
| 运行时报未知字段 | validator、producer payload、consumer 版本 |
| 配置读不出 | config schema、normalizer、默认值和实际 YAML |
| Avatar frame 不兼容 | `PresentationUpstreamFrame`/`DownstreamFrame` schema 与 runtime helper |
| Cognition payload 解析失败 | Python generated model、inbound adapter、错误 code |

## 验证

```powershell
pnpm sync:contracts
pnpm --filter @glimmer-cradle/protocol typecheck
pnpm --filter @glimmer-cradle/kernel typecheck
cd core/cognition
uv run pytest -q
```

按风险补充合法 payload、缺字段、未知枚举、非法组合、旧字段搜索、错误 code、降级路径和 producer/consumer 端到端验证。

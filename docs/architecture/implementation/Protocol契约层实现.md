# Protocol 契约层实现

> 范围：迁移期现有 runtime Protocol 与 M12 Contract Spine 如何分 owner 定义、生成、校验和消费；不列全部字段。
> 源码依据：`protocol/src/schemas/`、`protocol/src/generated/`、`protocol/src/runtime/`、`protocol/src/config-schemas.ts`、`protocol/codegen/` 与 `contracts/`。
> 维护触发：Schema、IPC 消息、Avatar frame、配置模型、生成脚本、runtime helper、跨语言消费者或错误码变化。

## 目录与生成链

```text
protocol/src/
├── schemas/{enums,models,config}/       # 未迁移边界的权威 Schema
├── generated/{enums,models,config}/     # TypeScript 生成投影
├── runtime/                             # validator、normalizer、reply/avatar helper
├── models/ ipc/ utils/                  # 手写 runtime helper 和便利模型
└── config-schemas.ts                    # config schema 聚合入口

engines/audio/src/glimmer_cradle/audio/generated/
└── Audio legacy Python 生成投影；Cognition legacy Python projection 已删除
```

对应 M12 迁移切片尚未开始的现有 runtime 跨语言结构先改 `protocol/src/schemas/`，再运行：

```powershell
pnpm sync:contracts
```

生成物不能手改。若生成物不满足消费需求，应改对应 owner 的 Schema/IDL、生成脚本或 runtime helper，而不是在消费者里复制字段。

M12 Slice 1 建立 baseline，Slice 2 已将 Kernel↔Cognition Service、Slice 5 已将 Avatar control Service 迁入 `contracts/`：

```text
contracts/
├── proto/glimmer/common/v1/{contract_probe,service_contract}.proto
├── proto/glimmer/cognition/v1/cognition_service.proto
├── proto/glimmer/kernel/v1/kernel_control_service.proto
├── proto/glimmer/avatar/v1/avatar_host.proto
├── json-schema/skill/v1/tool-parameters.schema.json
├── generated/{ts,python,csharp}/
├── compatibility/{proto-image.binpb,json-schema-baseline.json}
├── pyproject.toml                     # 安装态 Python Contracts distribution
├── toolchain.json、global.json
├── inventory.md
└── supply-chain.md
```

新 Contract Spine Service/Document 只在 `contracts/{proto,json-schema}/` 演进，生成与验证入口为：

```powershell
pnpm contracts:generate
pnpm contracts:verify
```

`contracts/` 的 Buf 生成物只属于 Adapter/Transport 边缘。Kernel 与 Cognition 分别消费版本化 TS/Python Service；Kernel Avatar adapter 与 Unity Host Adapter 直接映射 Avatar TS/C# generated DTO，通过 `AvatarHostService.Connect` 交换二进制 Protobuf，不保留 JSON formatter/parser consumer。legacy `PresentationFrames.g.cs` 已删除。Cognition generated DTO/stub 只允许出现在 `adapters/kernel/grpc_transport.py`。`protocol/codegen/gen-py.py` 现在只生成 Audio projection；Desktop、Engine、Extension 和 Personal Server 仍按各自未迁移切片使用 `@glimmer-cradle/protocol`。

Python generated DTO 通过 `glimmer-cradle-contracts` distribution 安装。Cognition 的开发
environment、Desktop 聚合 Python runtime 与 Personal Server OCI builder 都显式消费该本地
distribution；运行时不得依赖源码树 `PYTHONPATH` 偶然暴露 `contracts/generated/python`。

## 契约分类

| 分类 | 示例 | 消费者 |
|---|---|---|
| enums | `ErrorCode`、`CognitiveActivityState` | Kernel、Cognition、Renderer |
| models | `PerceptionEvent`、`ActionCommand`、`TraceContext`、`SourceDescriptor` 字段 | 多语言/多进程共享模型 |
| Protobuf Service | `CognitionService`、`KernelControlService`、`CallMetadata`、`ServiceErrorDetail` | Kernel ↔ Cognition Adapter；人工恢复以稳定 code/action/operation 投影，不解析 message |
| config | `AppConfig`、`SkillPlaneConfig`、`SurfaceConfig`、`CognitionConfig` | config normalizer 与生命周期 runtime |
| runtime helper | `reply-messages`、`avatar-frame`、validator | TS runtime 消费 |

公开 SDK 使用的结构也必须来自稳定契约或 SDK 自己的公开 contract，不允许 Extension 依赖 Kernel 内部类型。

## 变更顺序

1. 判断是否跨语言/跨进程/公开 SDK，并确认它是对应切片前的现有 runtime 契约，还是新 Contract Spine Service/Document。
2. 为新增字段写清 owner、默认值、是否必填、兼容语义和错误 code。
3. 现有 runtime 契约改 `protocol/src/schemas/` 并运行 `pnpm sync:contracts`；新契约改 `contracts/{proto,json-schema}/` 并运行 `pnpm contracts:generate` / `pnpm contracts:verify`。
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
| contracts 生成物有 diff | `pnpm contracts:generate`、`contracts/buf.gen.yaml`、本地 `protoc`/插件版本 |
| contracts compatibility 失败 | `contracts/compatibility/` baseline、`buf breaking --against`、JSON Schema baseline |
| 运行时报未知字段 | validator、producer payload、consumer 版本 |
| 配置读不出 | config schema、normalizer、默认值和实际 YAML |
| Avatar frame 不兼容 | `contracts/proto/glimmer/avatar/v1/avatar_host.proto`、Kernel/Unity Host Adapter 与二进制 Protobuf round-trip |
| Cognition payload 解析失败 | Contract Spine Python DTO、Kernel contract adapter、错误 code |

## 验证

```powershell
pnpm sync:contracts
pnpm contracts:verify
pnpm --filter @glimmer-cradle/protocol typecheck
pnpm --filter @glimmer-cradle/kernel typecheck
cd core/cognition
uv run pytest -q
```

按风险补充合法 payload、缺字段、未知枚举、非法组合、旧字段搜索、错误 code、降级路径和 producer/consumer 端到端验证。

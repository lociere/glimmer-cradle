# M12 Protocol/Contracts Inventory

> 范围：冻结 M12 Slice 1 输入 fixed state 下的旧 `protocol/`、生成链、consumer、validator/build/package 入口，以及本切片建立的 `contracts/` baseline 删除条件。
> 事实依据：`protocol/`、root/package scripts、`core/`、`products/`、`packages/extension-sdk`、`templates/extension-basic`、`docs/reference/protocol.md` 与 `docs/architecture/implementation/Protocol契约层实现.md`。
> 维护触发：旧 protocol 目录、生成链、runtime consumer、配置/SDK consumer、contracts baseline 或删除条件变化。

## 输入 fixed state

| 项 | 值 |
|---|---|
| branch | `main` |
| 起点 commit | `0b997f1f6bc1db4f682c65bb955b990c72a841ec` |
| origin/main | `bb6d5ceff82523615f164e4c7bb97c445bd63c2d` |
| 起点工作树 | clean，`main` ahead 1、behind 0 |
| M11 状态 | 暂停/延期，未完成，未关闭 |
| M12 状态 | Slice 1 active；不进入 Slice 2 |

## 旧 `protocol/` inventory

| 项 | 当前事实 | owner | 当前权威源 | 迁移切片 | 删除条件 |
|---|---|---|---|---|---|
| `protocol/src/schemas/` | JSON Schema 共 106 份：`config` 22、`engine` 2、`enums` 9、`extension` 7、`ipc` 8、`models` 58。 | Protocol owner | `protocol/src/schemas/` | Slice 1 冻结；Slice 2-9 逐边界迁移 | Slice 9 中所有 runtime consumer、生成链、配置/SDK 引用归零后删除；Slice 1 不修改、不删除。 |
| `protocol/src/generated/` | TypeScript 生成物共 112 个 `.ts`：`config` 23、`engine` 3、`enums` 10、`extension` 8、`ipc` 9、`models` 59。 | Protocol owner | `protocol/codegen/gen-ts.ts` 从旧 JSON Schema 生成 | Slice 2-9 按 consumer 迁移 | 对应消费者不再 import `@glimmer-cradle/protocol` 旧 DTO，且新 Adapter contract test 通过后按切片删除。 |
| `core/cognition/src/glimmer_cradle/cognition/protocol/generated/` | **Cognition legacy Python projection 已删除**；源码、测试、fixture、构建与打包 consumer 均归零。Kernel↔Cognition generated DTO/stub 只由 `contracts/generated/python/glimmer/` 提供，并仅在 Cognition Kernel contract Adapter 边缘消费。 | Cognition boundary adapter owner | `contracts/proto/` + `contracts/generated/python/` | Slice 2、Slice 4 已完成候选 | 删除门已满足；后续不得恢复旧目录、手写镜像或双生成主线。 |
| `proto/glimmer/avatar/v1/avatar_host.proto` | Avatar control Service 与上下行控制帧 canonical IDL；声明 `EmotionPayload`、`ThoughtPayload`、`AudioPlayPayload`、`AvatarExpressionPayload`、`AvatarMotionPayload`、`AvatarLipSyncPayload`、`AvatarParameterPayload`、`AvatarIntentPayload`、`AvatarActionStatePayload`、`AvatarPresentationPayload`、`CharacterPresentationAppearancePayload`、`CharacterPresentationLifecyclePayload`、`CharacterPresentationProjectionPayload`、`LoadScenePayload`、`UnloadScenePayload`、`AvatarHostHelloPayload`、`AvatarHostReadyPayload`、`AnimationCompletePayload`、`AvatarHostErrorPayload`、`AvatarDownstreamFrame`、`AvatarUpstreamFrame`、`AvatarHostService` 与 `Connect`。 | Avatar Contract Spine / Host Adapter owner | `contracts/generated/{ts,csharp}/glimmer/avatar/v1`；C# 物理投影为 `contracts/generated/csharp/GlimmerCradle/avatar/v1/` | Slice 5 已完成候选 | `hosts/unity-avatar-host/Assets/Scripts/GlimmerCradle/Adapters/AvatarContractAdapter.cs` 是 C# DTO↔Core 唯一映射；Kernel Avatar adapter 使用 TS projection；legacy `PresentationFrames.g.cs` 已删除且不得恢复。 |
| `protocol/src/runtime/` | TS runtime validator、normalizer、reply/avatar helper；配置校验通过 `validateConfig` 暴露给 Kernel。 | Protocol runtime helper owner | `protocol/src/runtime/` 与 `protocol/src/config-schemas.ts` | Slice 1 冻结；配置 Document 迁移另行切片 | 所有配置/运行时 validator consumer 有新的 JSON Schema Document owner 与替代入口后删除；Slice 1 不迁移配置运行时。 |

## 生成、validator、build、package 入口

| 项 | 当前事实 | owner | 当前权威源 | 迁移切片 | 删除条件 |
|---|---|---|---|---|---|
| `pnpm sync:contracts` | root script 指向 `pnpm --filter @glimmer-cradle/protocol gen:all`。 | Protocol owner | root `package.json` | Slice 9 | 所有旧 protocol consumer 归零，`contracts/` 生成链成为运行事实后删除或改名；Slice 1 保留。 |
| `protocol/package.json gen:all` | 顺序运行 `gen:ts`、`gen:py`、`gen:cs`。 | Protocol owner | `protocol/package.json` | Slice 2-9 | 对应旧语言投影消费者迁移完成后删除。 |
| `engines/audio/src/glimmer_cradle/audio/generated/` | Audio legacy Python projection；`gen:py` 使用 `engines/audio` 的 uv dev 环境，Cognition 不再承担生成工具依赖。 | Audio owner | `protocol/src/schemas/engine/` + `protocol/codegen/gen-py.py` | Slice 4 contract edge；Slice 8 前保留 | checker 同时验证真实输出存在、Audio tool owner 与 Cognition tool consumer 归零。 |
| `protocol/codegen/{gen-ts.ts,gen-py.py,gen-cs.ts}` | JSON Schema -> TypeScript/Python/C# 的旧生成器；Slice 4 后 `gen-py.py` 只读取 `schemas/engine/` 并生成 Audio projection，不再生成 Cognition projection。 | Protocol owner | `protocol/codegen/` | Slice 2-9 | 各语言旧生成物消费者归零且 Contract Spine/JSON Schema 门覆盖后，按对应切片删除；Audio Python projection 属于 Slice 8。 |
| `@bufbuild/buf` in `protocol/package.json` | 当前锁定解析为 `1.66.1`，但旧 protocol 生成链不使用 Protobuf Service baseline。 | Protocol owner | `pnpm-lock.yaml` | Slice 1 建立新 baseline | 新 `contracts/` 使用本地 Buf CLI；旧 protocol 是否保留由 Slice 9 决定。 |
| `ajv` / `ajv-formats` | 旧 JSON Schema validator runtime 位于 `@glimmer-cradle/protocol`。 | Protocol runtime helper owner | `protocol/src/runtime/validator.ts` | Document 迁移相关切片 | 配置/manifest/package/dynamic params 均有 `contracts/json-schema` owner、兼容门和 runtime adapter 后迁移。 |
| root build/package consumers | `build:all`、Kernel/Desktop/Personal Server/Extension SDK prebuild/pretypecheck/pretest 均先 build `@glimmer-cradle/protocol`。 | 对应 package owner | root 和各 package `package.json` | Slice 2-9 | 对应 package 不再消费旧 protocol runtime 或 DTO，并有替代 contract edge 后删除。 |

## 配置 consumers

| 项 | 当前事实 | owner | 当前权威源 | 迁移切片 | 删除条件 |
|---|---|---|---|---|---|
| system config schema | `protocol/src/schemas/config/*.schema.json` 定义 `AppConfig`、`AudioConfig`、`AvatarConfig`、`CognitionConfig`、`ExtensionConfig`、`SkillPlaneConfig` 等 22 份配置契约。 | Config Application / Protocol owner | `protocol/src/schemas/config/` | M12 后续 Document 切片；Slice 1 不迁移 | 新 `contracts/json-schema` Document schema、normalizer、默认模板、Guide 和 compatibility 门落地，旧 imports 归零后删除。 |
| Kernel ConfigManager | `core/kernel/src/adapters/config/config-manager.ts` import `validateConfig`、`normalizeSystemYamlNulls` 与 config types。 | Kernel Config Application owner | `@glimmer-cradle/protocol` runtime helper | 后续配置 Document 迁移切片 | Kernel config adapter 改用 `contracts/json-schema` 入口且测试通过后删除旧 runtime 依赖。 |
| Product composition | `docs/reference/product-compositions.md` 记录 `products/` 清单遵循 `protocol/src/schemas/models/ProductComposition.schema.json`。 | Product Composition owner | `protocol/src/schemas/models/ProductComposition.schema.json` | Surface/Product 相关切片 | Product composition Document owner 与 validator 迁移后删除旧 schema。 |

## SDK consumers

| 项 | 当前事实 | owner | 当前权威源 | 迁移切片 | 删除条件 |
|---|---|---|---|---|---|
| `packages/extension-sdk` | 依赖并 re-export `@glimmer-cradle/protocol` 的 manifest、permission、events、distribution、host process contracts。 | Extension SDK owner | `packages/extension-sdk/package.json` 与 `src/contracts` | Slice 6 及后续 SDK 文档契约切片 | Extension Host、Package Manager 和公开 SDK 迁移到 `contracts/` contract edge，跨仓兼容测试通过后删除旧 protocol dependency。 |
| `templates/extension-basic` | 模板 package 的 dependencies/devDependencies 声明 `@glimmer-cradle/protocol` workspace。 | Extension template owner | `templates/extension-basic/package.json` | Slice 6 | Extension SDK 发布物不再要求模板直接依赖旧 protocol 后删除。 |
| Kernel Extension Host old path | `core/kernel/src/host/process/*`、Extension runtime registry 和 installer import `@glimmer-cradle/protocol`。 | Kernel Extension supervision owner | Kernel host/process 与 application services | Slice 6 | 独立 Extension Host 进程和 contracts Adapter 通过崩溃/权限/回收门后删除旧 worker 协议。 |

## Slice 1 `contracts/` baseline inventory

| 项 | 当前事实 | owner | 当前权威源 | 迁移切片 | 删除条件 |
|---|---|---|---|---|---|
| Protobuf Service baseline | `proto/glimmer/common/v1/contract_probe.proto` 定义最小 `ContractProbeService`、`EchoProbe`、`EchoProbeRequest`、`EchoProbeResponse`、`DocumentReference` 和 `TraceMetadata`。 | Contract Spine owner | `contracts/proto/` | Slice 1 | 只在新兼容世代或审查通过的 baseline refresh 中演进；不得由 runtime consumer 手写镜像替代。 |
| Service 通用语义 | `proto/glimmer/common/v1/service_contract.proto` 定义 `CallMetadata`、`ServiceErrorCode`、`ServiceRecoveryAction`、`ServiceErrorDetail`、`CommandResult`。 | Contract Spine owner | `contracts/proto/glimmer/common/v1/` | Slice 2 | 所有 Kernel–Cognition consumer 切到版本化 Service 且旧万能信封归零；演进继续服从 compatibility baseline。 |
| Cognition v1 Service | `proto/glimmer/cognition/v1/cognition_service.proto` 定义 `CognitionService` 以及 `SubmitPerception`、`CancelPerception`、`GetPerceptionOperation`、`InitializeKnowledge`、`Plan`、`Synthesize`、`GetConversationHistory`、`Heartbeat`、`GetReadiness`、`Shutdown`；DTO/枚举为 `AddressMode`、`ResponsePolicy`、`RetentionCeiling`、`PerceptionOperationState`、`ConversationContext`、`SourceDescriptor`、`ModalitySemantic`、`ModalityItem`、`PerceptionContent`、`SubmitPerceptionRequest`、`SubmitPerceptionResponse`、`CancelPerceptionRequest`、`CancelPerceptionResponse`、`GetPerceptionOperationRequest`、`GetPerceptionOperationResponse`、`KnowledgeRetrievalConfig`、`KnowledgeEntry`、`InitializeKnowledgeRequest`、`InitializeKnowledgeResponse`、`SkillToolDescriptor`、`SkillToolSuggestion`、`PlanRequest`、`PlanResponse`、`ToolResult`、`SynthesizeRequest`、`SynthesizeResponse`、`GetConversationHistoryRequest`、`ConversationHistoryEntry`、`GetConversationHistoryResponse`、`HeartbeatRequest`、`HeartbeatResponse`、`GetReadinessRequest`、`GetReadinessResponse`、`ShutdownRequest`、`ShutdownResponse`。 | Cognition Service owner | `contracts/proto/glimmer/cognition/v1/` | Slice 2 | 仅由 Cognition Adapter 实现；不得重新引入 ZMQ、万能 envelope 或手写跨语言镜像。 |
| Kernel control v1 Service | `proto/glimmer/kernel/v1/kernel_control_service.proto` 定义 `KernelControlService` 以及 `RegisterCognition`、`PublishState`、`PublishLog`、`PublishAction`；DTO 为 `RegisterCognitionRequest`、`RegisterCognitionResponse`、`PublishStateRequest`、`PublishStateResponse`、`PublishLogRequest`、`PublishLogResponse`、`ReplyMessage`、`MediaItem`、`SkillRequest`、`PublishActionRequest`、`PublishActionResponse`。 | Kernel control Service owner | `contracts/proto/glimmer/kernel/v1/` | Slice 2 | 只允许受监督 Cognition 世代从动态回环端点调用；旧推送链与配置删除后保持单轨。 |
| Extension Host Process v1 Service | `proto/glimmer/extension/v1/extension_host_process.proto` 定义 Extension Host 独立进程 supervision contract；声明 `HandshakeRequest`、`HandshakeResponse`、`ExtensionHostProcessStage`、`ReportStateRequest`、`ReportStateResponse`、`ExtensionHostProcessService`、`Handshake` 与 `ReportState`。 | Extension Host owner / Kernel Extension supervision owner | `contracts/proto/glimmer/extension/v1/` | Slice 6 | Kernel 只消费 Host process 状态与监督结果；第三方 handler 装载只发生在 `hosts/extension-host/`，旧 Kernel Worker protocol、module loader 与兼容桥归零后关闭本切片。 |
| JSON Schema Document baseline | `json-schema/skill/v1/tool-parameters.schema.json` 定义 `$id` 为 `https://glimmer-cradle.local/contracts/skill/v1/tool-parameters.schema.json`、title 为 `SkillToolParametersDocument` 的动态 Skill tool parameters Document。 | Skill Plane Document owner | `contracts/json-schema/` | Slice 1 | Document 结构只能由 JSON Schema 演进；Protobuf 只引用 id/version/digest。 |
| Extension Host Process Document | `json-schema/extension/v1/extension-host-process.schema.json` 定义 `$id` 为 `https://glimmer-cradle.local/contracts/extension/v1/extension-host-process.schema.json`、title 为 `ExtensionHostProcessDocument` 的 Host process stage 与 fail-closed IPC 文档契约。 | Extension Host owner / Kernel Extension supervision owner | `contracts/json-schema/extension/v1/` | Slice 6 | 运行态 Host process protocol 由公开 SDK 暴露，文档契约与 Service IDL 同步演进；旧 Protocol Host message schema 已删除，不再作为 Host process 事实源。 |
| Generated DTO | `contracts/generated/{ts,python,csharp}` 由 `buf generate` 生成。 | Contract Spine Adapter edge owner | `contracts/buf.gen.yaml` | Slice 1 | 手改生成物或生成后有 diff 时门禁失败；Domain/Application/Port 不得 import。 |
| Compatibility baseline | `contracts/compatibility/proto-image.binpb` 与 `json-schema-baseline.json` 在仓库内，`buf breaking` 不依赖 BSR。 | Contract Spine owner | `contracts/compatibility/` | Slice 1 | 破坏性变更必须经有意 baseline refresh 与审查；普通生成不自动刷新。 |
| Supply chain evidence | `contracts/toolchain.json` 固定机器可校验的工具/依赖版本、许可证与摘要；`contracts/supply-chain.md` 解释来源和缓存规则。 | Contract Spine owner | `toolchain.json`、`global.json`、npm/uv/NuGet lock 与官方发布摘要 | Slice 1 | 工具版本、来源、支持平台或许可证变化时同步更新并重跑验证。 |

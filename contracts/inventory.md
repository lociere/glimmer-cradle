# M12 Contract Spine Inventory

> 范围：记录 M12 从 Slice 1 输入到 Slice 9 legacy protocol closure 的迁移账本；本文末尾“Slice 9 当前固定状态”覆盖前文历史输入表。
> 事实依据：`protocol/`、root/package scripts、`core/`、`products/`、`packages/extension-sdk`、`templates/extension-basic`、`docs/reference/protocol.md` 与 `docs/architecture/implementation/Protocol契约层实现.md`。
> 维护触发：旧 protocol 目录、生成链、runtime consumer、配置/SDK consumer、contracts baseline 或删除条件变化。

## 历史输入 fixed state（Slice 1）

| 项 | 值 |
|---|---|
| branch | `main` |
| 起点 commit | `0b997f1f6bc1db4f682c65bb955b990c72a841ec` |
| origin/main | `bb6d5ceff82523615f164e4c7bb97c445bd63c2d` |
| 起点工作树 | clean，`main` ahead 1、behind 0 |
| M11 状态 | 暂停/延期，未完成，未关闭 |
| M12 状态 | Slice 1 active；不进入 Slice 2 |

## 历史旧 `protocol/` inventory（已由 Slice 9 关闭）

| 项 | 当前事实 | owner | 当前权威源 | 迁移切片 | 删除条件 |
|---|---|---|---|---|---|
| `protocol/src/schemas/` | 迁移期仅保留尚待 Slice 9 收口的配置、枚举、Extension 与模型 Document；Audio engine command/response Schema 已删除。 | Protocol owner | `protocol/src/schemas/` | Slice 9 | 所有剩余 Document/runtime consumer 迁移后删除整个旧目录。 |
| `protocol/src/generated/` | 迁移期 TypeScript projection；Audio engine command/response projection 已删除。 | Protocol owner | `protocol/codegen/gen-ts.ts` 从旧 JSON Schema 生成 | Slice 9 | 所有剩余消费者迁移后删除。 |
| `core/cognition/src/glimmer_cradle/cognition/protocol/generated/` | **Cognition legacy Python projection 已删除**；源码、测试、fixture、构建与打包 consumer 均归零。Kernel↔Cognition generated DTO/stub 只由 `contracts/generated/python/glimmer/` 提供，并仅在 Cognition Kernel contract Adapter 边缘消费。 | Cognition boundary adapter owner | `contracts/proto/` + `contracts/generated/python/` | Slice 2、Slice 4 已完成候选 | 删除门已满足；后续不得恢复旧目录、手写镜像或双生成主线。 |
| `proto/glimmer/avatar/v1/avatar_host.proto` | Avatar control Service 与上下行控制帧 canonical IDL；声明 `EmotionPayload`、`ThoughtPayload`、`AudioPlayPayload`、`AvatarExpressionPayload`、`AvatarMotionPayload`、`AvatarLipSyncPayload`、`AvatarParameterPayload`、`AvatarIntentPayload`、`AvatarActionStatePayload`、`AvatarPresentationPayload`、`CharacterPresentationAppearancePayload`、`CharacterPresentationLifecyclePayload`、`CharacterPresentationProjectionPayload`、`LoadScenePayload`、`UnloadScenePayload`、`AvatarHostHelloPayload`、`AvatarHostReadyPayload`、`AnimationCompletePayload`、`AvatarHostErrorPayload`、`AvatarDownstreamFrame`、`AvatarUpstreamFrame`、`AvatarHostService` 与 `Connect`。 | Avatar Contract Spine / Host Adapter owner | `contracts/generated/{ts,csharp}/glimmer/avatar/v1`；C# 物理投影为 `contracts/generated/csharp/GlimmerCradle/avatar/v1/` | Slice 5 已完成候选 | `hosts/unity-avatar-host/Assets/Scripts/GlimmerCradle/Adapters/AvatarContractAdapter.cs` 是 C# DTO↔Core 唯一映射；Kernel Avatar adapter 使用 TS projection；legacy `PresentationFrames.g.cs` 已删除且不得恢复。 |
| `protocol/src/runtime/` | TS runtime validator、normalizer、reply/avatar helper；配置校验通过 `validateConfig` 暴露给 Kernel。 | Protocol runtime helper owner | `protocol/src/runtime/` 与 `protocol/src/config-schemas.ts` | Slice 1 冻结；配置 Document 迁移另行切片 | 所有配置/运行时 validator consumer 有新的 JSON Schema Document owner 与替代入口后删除；Slice 1 不迁移配置运行时。 |

## 生成、validator、build、package 入口

| 项 | 当前事实 | owner | 当前权威源 | 迁移切片 | 删除条件 |
|---|---|---|---|---|---|
| `pnpm sync:contracts` | root script 指向 `pnpm --filter @glimmer-cradle/protocol gen:all`。 | Protocol owner | root `package.json` | Slice 9 | 所有旧 protocol consumer 归零，`contracts/` 生成链成为运行事实后删除或改名；Slice 1 保留。 |
| `protocol/package.json gen:all` | 迁移期只运行 `gen:ts`；Audio Python 与 Avatar C# legacy 生成入口已删除。 | Protocol owner | `protocol/package.json` | Slice 9 | 剩余旧 TypeScript projection consumer 归零后随 package 删除。 |
| `engines/audio/src/glimmer_cradle/audio/generated/` | **Audio legacy Python projection 已删除**；不得恢复。 | Audio Contract Adapter owner | `contracts/generated/python/glimmer/engine/audio/v1/` | Slice 8 | 删除门已满足；checker 固定目录、Schema、generator 与工具依赖持续归零。 |
| `protocol/codegen/gen-ts.ts` | 只为 Slice 9 尚未迁移的旧 TypeScript Document consumer 生成投影；`gen-py.py` 与 `gen-cs.ts` 已删除。 | Protocol owner | `protocol/codegen/gen-ts.ts` | Slice 9 | 剩余旧 consumer 归零后删除。 |
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

## M12 Slice 7 Surface Gateway additions

| 项 | 当前事实 | owner | 当前权威源 | 迁移切片 | 删除条件 |
|---|---|---|---|---|---|
| `proto/glimmer/surface/v1/surface_gateway.proto` | `SurfaceGatewayService` 的 Connect、Query、Command、Stream 与有限 typed `oneof` DTO；请求绑定产品、generation、scope 和通用调用 metadata，产品 Adapter 在边缘映射 owner-local request/projection。不得恢复 `string kind + Struct {frame}` 通用逃生口。 | Kernel Surface Gateway owner | `proto/glimmer/surface/v1/surface_gateway.proto` | Slice 7 / Slice 9 修复 | Desktop/Personal Server 只经该 Service 与 Kernel Gateway；typed success/invalid/stream/reconnect 与旧 envelope 搜索门通过。 |
| `proto/glimmer/surface/v1/SurfaceGatewayServiceConnectRequest` | 产品侧连接请求；`product_id`、EndpointRegistry `generation` 和 scopes 在 Kernel 认证，浏览器不能直接提交。 | Kernel Surface Gateway owner | `proto/glimmer/surface/v1/surface_gateway.proto` | Slice 7 | Connect 认证/权限拒绝和 generation mismatch 门通过，旧握手/回退入口删除。 |
| `proto/glimmer/surface/v1/SurfaceGatewayServiceQueryRequest` | 只读 Surface Query；仅允许 configuration snapshot、conversation history、skill catalog、extension runtime projection 四类 typed request。 | Kernel Surface Gateway owner | `proto/glimmer/surface/v1/surface_gateway.proto` | Slice 7 / Slice 9 修复 | Query consumer 全部转为 generated DTO↔owner-local mapping。 |
| `proto/glimmer/surface/v1/SurfaceGatewayServiceCommandRequest` | 有副作用 Surface Command；由 Kernel 统一权限和幂等 metadata，结果不得伪装为 Event。 | Kernel Surface Gateway owner | `proto/glimmer/surface/v1/surface_gateway.proto` | Slice 7 | Command consumer 全部转为 Service Adapter，权限拒绝门通过。 |
| `proto/glimmer/surface/v1/SurfaceGatewayServiceStreamResponse` | 有序、可取消的 presentation projection stream；产品侧消费 backpressure 受 gRPC stream 控制。 | Kernel Surface Gateway owner | `proto/glimmer/surface/v1/surface_gateway.proto` | Slice 7 | Stream 断连/取消/重连门通过。 |

Surface typed RPC inventory：`Connect`、`Query`、`Command`、`Stream`。

Surface typed symbol inventory：`SurfaceGatewayServiceConnectRequest`、`SurfaceGatewayServiceConnectResponse`、`ConfigurationSnapshotQuery`、`ConversationHistoryQuery`、`SkillCatalogQuery`、`ExtensionRuntimeProjectionQuery`、`SurfaceGatewayServiceQueryRequest`、`HeartbeatCommand`、`ChatInputCommand`、`AudioInputCommand`、`AvatarPresentationCommand`、`AvatarIntentCommand`、`CoreSkillActionResponseCommand`、`CoreSkillConfirmationResponseCommand`、`ConfigurationUpdateCommand`、`ConfigurationTestCommand`、`ExtensionInstallSource`、`ExtensionInstallPrepareCommand`、`ExtensionInstallCommitCommand`、`ExtensionInstallCancelCommand`、`ExtensionUninstallCommand`、`ExtensionLifecycleCommand`、`ExtensionCommand`、`ShutdownCommand`、`SurfaceGatewayServiceCommandRequest`、`ReplyMessage`、`EmotionProjection`、`ReplyEvent`、`EmotionEvent`、`ThoughtEvent`、`AudioPlayEvent`、`AudioTranscriptEvent`、`CharacterPresentationEvent`、`AvatarStatusEvent`、`AvatarActionStateEvent`、`RuntimeResourceProjection`、`RuntimeReconcilerProjection`、`RuntimeReadinessItem`、`RuntimeReadinessEvent`、`AudioProviderProjection`、`AudioCapabilityProjection`、`AudioStatusEvent`、`ConversationNoticeEvent`、`ConversationAddressProjection`、`ConversationHistoryEntryProjection`、`ConversationHistoryResultEvent`、`ConfigurationSnapshotEvent`、`ConfigurationUpdateEvent`、`ConfigurationTestEvent`、`SkillCatalogEvent`、`ExtensionInstallPreviewEvent`、`ExtensionInstallResultEvent`、`ExtensionUninstallResultEvent`、`ExtensionLifecycleResultEvent`、`ExtensionCommandResultEvent`、`ExtensionRuntimeProjectionResultEvent`、`ExtensionRuntimeProjectionChangedEvent`、`ExtensionStatusChangedEvent`、`CoreSkillActionRequestEvent`、`CoreSkillConfirmationRequestEvent`、`ShutdownEvent`、`SurfaceEvent`、`SurfaceGatewayServiceQueryResponse`、`SurfaceGatewayServiceCommandResponse`、`SurfaceGatewayServiceStreamRequest`、`SurfaceGatewayServiceStreamResponse`、`SurfaceGatewayService`。

## M12 Slice 8 Audio Engine additions

| 项 | 当前事实 | owner | 当前权威源 | 迁移切片 | 删除条件 |
|---|---|---|---|---|---|
| `proto/glimmer/engine/audio/v1/audio_engine.proto` | `AudioEngineService` 版本化服务，声明 `AudioLane`、`MediaAccess`、`AudioMediaReference`、`AudioEngineFailure`、`HealthRequest`、`HealthResponse`、`WarmupRequest`、`WarmupResponse`、`SynthesizeRequest`、`SynthesizeResponse`、`RecognizeRequest`、`RecognizeResponse`、`ShutdownRequest`、`ShutdownResponse`，以及 `Health`、`Warmup`、`Synthesize`、`Recognize`、`Shutdown`。 | Audio Contract Adapter owner | `contracts/generated/{ts,python}/glimmer/engine/audio/v1/` | Slice 8 | Kernel 与 Python Audio 只消费该 projection；旧 command/response Schema、stdio RPC、Pydantic projection 与生成工具持续归零。 |
| `AudioMediaReference` | 大型音频 data plane 不进入普通 RPC；Kernel 为输入创建 `READ_ONLY`、为输出创建 `WRITE_ONCE` 短租约，引用固定 `lease_id`、file URI、MIME、字节数、SHA-256 与过期时间。Engine 只能访问注入的 lane lease root，Kernel 在成功、失败、超时、停机和崩溃后回收。 | Kernel Audio Adapter + Audio Host Adapter | `proto/glimmer/engine/audio/v1/audio_engine.proto` | Slice 8 | 任一 consumer 重新传任意业务路径、inline bytes，或缺少 digest/expiry/access/cleanup 门均不得关闭切片。 |

## M12 Slice 9 当前固定状态：legacy protocol closure

`protocol/` 已被授权并物理删除；root workspace、lock、Docker、release/version、Desktop runtime projection、Kernel、Extension SDK、Desktop、Personal Server 与模板不再依赖 `@glimmer-cradle/protocol`。Contract Spine 只拥有 canonical Protobuf Service/DTO 与可独立存储的 JSON Schema Document；Extension SDK 拥有公开 authoring API，Kernel 与产品保留 owner-local model/helper。删除门 fail closed：`contracts/scripts/check-inventory.mjs` 要求整个 `protocol/` 不存在，架构检查同时拒绝 package dependency 与源码 import 回流。

### 178 个迁移符号 ledger

Slice 9 从 80 个直接 consumer 文件提取 178 个唯一 import、re-export 与 type-query symbol，并按主迁移落点分为五类：

| 分类 | 主迁移落点 | symbols |
|---|---|---|
| Document → schema | `contracts/json-schema/{common,config,extension,product}/v1`；SDK/Kernel/Product 只保留 schema-derived edge type 与 validator | `ActivationProfileId`, `ActivationProfileRequirements`, `AppConfig`, `AudioConfig`, `AvatarConfig`, `CapabilityAudience`, `CapabilityScope`, `CharacterManifestConfig`, `CharacterProfileConfig`, `CognitionConfig`, `CognitionServiceConfig`, `ContributionDeclaration`, `ContributionDependency`, `ContributionPointDefinition`, `ContributionPointId`, `ContributionRequirements`, `ControlSurfaceGatewayConfig`, `DialoguePolicyConfig`, `EmbeddingConfig`, `ExtensionActivationProfile`, `ExtensionCapabilityContribution`, `ExtensionCommandContribution`, `ExtensionCommandPrecondition`, `ExtensionConfig`, `ExtensionContributions`, `ExtensionEngineConstraint`, `ExtensionHostPortId`, `ExtensionManagementSurfaceContribution`, `ExtensionManifest`, `ExtensionPackageChecksums`, `ExtensionPackageEnvelope`, `ExtensionPermission`, `ExtensionPlatform`, `ExtensionProductTarget`, `ExtensionRegistryCatalog`, `ExtensionRegistryRecord`, `ExtensionReleaseArtifact`, `ExtensionReleaseManifest`, `ExtensionSettingContribution`, `ExtensionSkillContribution`, `ExtensionSkillPolicyContribution`, `ExtensionSkillPromptContribution`, `ExtensionSkillResourceContribution`, `ExtensionSkillToolContribution`, `ExternalDependencySource`, `InferenceConfig`, `IngressGateConfig`, `KnowledgeBaseConfig`, `KnowledgeIndexConfig`, `LifecycleConfig`, `LLMConfig`, `ManagedResourceContribution`, `ManagedResourcePackage`, `ManagedResourceProcess`, `McpServerConfig`, `MemoryConfig`, `ObservabilityConfig`, `ProductComposition`, `ProductFeatureId`, `ProtocolBridgeContribution`, `ReadinessGateDeclaration`, `ReadinessProbe`, `SafetyConfig`, `SkillPlaneConfig`, `SurfaceConfig`, `VoiceConfig` |
| Service edge / controlled projection | Canonical Service adapter、Extension SDK public projection 或产品 owner-local view mapping；不保留 JSON Schema 第二事实源 | `ActionIntentSnapshot`, `ActionIntentState`, `AudioStatusPayload`, `AvatarActionStateDocument`, `CapabilityGraphEdge`, `CapabilityGraphNode`, `CapabilityNodeState`, `ChannelReplyMessage`, `ChannelReplyPayload`, `CharacterPresentationProjectionPayload`, `ConfigurationModelAlias`, `ConfigurationProviderDraft`, `ConfigurationProviderSnapshot`, `ConfigurationProviderTestDraft`, `ConfigurationRouteSnapshot`, `ConfigurationSnapshot`, `ConfigurationSnapshotRequest`, `ConfigurationSnapshotResult`, `ConfigurationTestRequest`, `ConfigurationTestResult`, `ConfigurationUpdateRequest`, `ConfigurationUpdateResult`, `ContributionPointDefinitionSnapshot`, `ConversationAddress`, `ConversationHistoryEntry`, `ConversationHistoryRequest`, `ConversationHistoryResult`, `ConversationNotice`, `DiagnosticsEntry`, `DiagnosticsSnapshot`, `ExtensionCommandRequest`, `ExtensionInstallationProjection`, `ExtensionInstallCommitRequest`, `ExtensionInstallPrepareRequest`, `ExtensionInstallPreview`, `ExtensionInstallResult`, `ExtensionLifecycleRequest`, `ExtensionLifecycleResult`, `ExtensionRuntimeProjection`, `ExtensionRuntimeProjectionRequest`, `ExtensionRuntimeProjectionResult`, `ExtensionUninstallRequest`, `ExtensionUninstallResult`, `PerceptionEvent`, `PresentationDownstreamFrame`, `PresentationRuntimeReadinessCatalogPayload`, `PresentationRuntimeReadinessSnapshot`, `PresentationRuntimeReadinessState`, `PresentationUpstreamFrame`, `ReadinessGateSnapshot`, `RecoveryRequiredProjection`, `RuntimeReadinessCatalog`, `RuntimeReadinessOwner`, `RuntimeReadinessSnapshot`, `VisualCommand` |
| Extension SDK public | `packages/extension-sdk` 的 manifest、permission、event、distribution 与 validator public API | `BuiltInContributionPoint`, `BuiltInContributionPointDefinitions`, `BuiltInContributionPointId`, `EXTENSION_ID_PATTERN`, `EXTENSION_PACKAGE_FORMAT_VERSION`, `EXTENSION_PACKAGE_MEDIA_TYPE`, `EXTENSION_PACKAGE_SCHEMA`, `EXTENSION_REGISTRY_SCHEMA`, `EXTENSION_RELEASE_SCHEMA`, `EXTENSION_VERSION_PATTERN`, `ExtensionActivationProfileAvailability`, `ExtensionActivationProfileContext`, `ExtensionActivationProfileResolution`, `ExtensionContractValidation`, `ExtensionErrorPayload`, `ExtensionEventPayloadMap`, `ExtensionLifecyclePayload`, `ExtensionManifestInput`, `ExtensionScopedEventTopic`, `ExtensionStreamBasePayload`, `ExtensionStreamCancelledPayload`, `ExtensionStreamCompletedPayload`, `ExtensionStreamStartedPayload`, `ExtensionSystemEventTopic`, `getEffectiveContributionIds`, `getExtensionContributions`, `getManagedResourceContributions`, `hasExtensionPermission`, `isSafeExtensionPackagePath`, `listExtensionActivationProfiles`, `materializeManifestForActivationProfile`, `resolveExtensionActivationProfile`, `validateExtensionManifest`, `validateExtensionPackageChecksums`, `validateExtensionPackageEnvelope`, `validateExtensionRegistryCatalog`, `validateExtensionReleaseManifest` |
| owner-local model/helper | Kernel Config/Audio/Observability/Surface/Product adapter 或产品本地 view model；不得提升为万能 Contracts helper | `ASRRecognizeRequest`, `ASRRecognizeResponse`, `AuditRecord`, `ConfigSchemaName`, `ErrorCode`, `EventOutcome`, `getPresentationFrameClass`, `isPresentationFrameKind`, `MetricKind`, `ModelInvocationRecord`, `normalizeSystemYamlNulls`, `ObservabilityEvent`, `RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE`, `RECOVERY_REQUIRED_ERROR_CODE`, `TraceContext`, `TTSSynthesizeRequest`, `TTSSynthesizeResponse`, `validateConfig`, `validateProductComposition` |
| dead delete | 仅为架构拒绝测试构造的占位 import，不进入任何 runtime/public API | `T` |

### Slice 9 canonical Document set

以下 Document 保留旧 required/default/additional-properties/fixture 语义，统一升级到 draft 2020-12，并通过有意的 `json-schema-baseline.json` refresh 固定兼容集合：

| path | title | `$id` |
|---|---|---|
| `json-schema/common/v1/capability-scope.schema.json` | `CapabilityScope` | `https://glimmer-cradle.local/contracts/common/v1/capability-scope.schema.json` |
| `json-schema/config/v1/app-config.schema.json` | `AppConfig` | `https://glimmer-cradle.local/contracts/config/v1/app-config.schema.json` |
| `json-schema/config/v1/audio-config.schema.json` | `AudioConfig` | `https://glimmer-cradle.local/contracts/config/v1/audio-config.schema.json` |
| `json-schema/config/v1/avatar-config.schema.json` | `AvatarConfig` | `https://glimmer-cradle.local/contracts/config/v1/avatar-config.schema.json` |
| `json-schema/config/v1/character-manifest-config.schema.json` | `CharacterManifestConfig` | `https://glimmer-cradle.local/contracts/config/v1/character-manifest-config.schema.json` |
| `json-schema/config/v1/character-profile-config.schema.json` | `CharacterProfileConfig` | `https://glimmer-cradle.local/contracts/config/v1/character-profile-config.schema.json` |
| `json-schema/config/v1/cognition-config.schema.json` | `CognitionConfig` | `https://glimmer-cradle.local/contracts/config/v1/cognition-config.schema.json` |
| `json-schema/config/v1/cognition-service-config.schema.json` | `CognitionServiceConfig` | `https://glimmer-cradle.local/contracts/config/v1/cognition-service-config.schema.json` |
| `json-schema/config/v1/dialogue-policy-config.schema.json` | `DialoguePolicyConfig` | `https://glimmer-cradle.local/contracts/config/v1/dialogue-policy-config.schema.json` |
| `json-schema/config/v1/embedding-config.schema.json` | `EmbeddingConfig` | `https://glimmer-cradle.local/contracts/config/v1/embedding-config.schema.json` |
| `json-schema/config/v1/extension-config.schema.json` | `ExtensionConfig` | `https://glimmer-cradle.local/contracts/config/v1/extension-config.schema.json` |
| `json-schema/config/v1/inference-config.schema.json` | `InferenceConfig` | `https://glimmer-cradle.local/contracts/config/v1/inference-config.schema.json` |
| `json-schema/config/v1/ingress-gate-config.schema.json` | `IngressGateConfig` | `https://glimmer-cradle.local/contracts/config/v1/ingress-gate-config.schema.json` |
| `json-schema/config/v1/knowledge-base-config.schema.json` | `KnowledgeBaseConfig` | `https://glimmer-cradle.local/contracts/config/v1/knowledge-base-config.schema.json` |
| `json-schema/config/v1/knowledge-index-config.schema.json` | `KnowledgeIndexConfig` | `https://glimmer-cradle.local/contracts/config/v1/knowledge-index-config.schema.json` |
| `json-schema/config/v1/lifecycle-config.schema.json` | `LifecycleConfig` | `https://glimmer-cradle.local/contracts/config/v1/lifecycle-config.schema.json` |
| `json-schema/config/v1/llm-config.schema.json` | `LLMConfig` | `https://glimmer-cradle.local/contracts/config/v1/llm-config.schema.json` |
| `json-schema/config/v1/memory-config.schema.json` | `MemoryConfig` | `https://glimmer-cradle.local/contracts/config/v1/memory-config.schema.json` |
| `json-schema/config/v1/observability-config.schema.json` | `ObservabilityConfig` | `https://glimmer-cradle.local/contracts/config/v1/observability-config.schema.json` |
| `json-schema/config/v1/safety-config.schema.json` | `SafetyConfig` | `https://glimmer-cradle.local/contracts/config/v1/safety-config.schema.json` |
| `json-schema/config/v1/skill-plane-config.schema.json` | `SkillPlaneConfig` | `https://glimmer-cradle.local/contracts/config/v1/skill-plane-config.schema.json` |
| `json-schema/config/v1/surface-config.schema.json` | `SurfaceConfig` | `https://glimmer-cradle.local/contracts/config/v1/surface-config.schema.json` |
| `json-schema/config/v1/voice-config.schema.json` | `VoiceConfig` | `https://glimmer-cradle.local/contracts/config/v1/voice-config.schema.json` |
| `json-schema/extension/v1/extension-manifest.schema.json` | `ExtensionManifest` | `https://glimmer-cradle.local/contracts/extension/v1/extension-manifest.schema.json` |
| `json-schema/extension/v1/extension-package-checksums.schema.json` | `ExtensionPackageChecksums` | `https://glimmer-cradle.local/contracts/extension/v1/extension-package-checksums.schema.json` |
| `json-schema/extension/v1/extension-package-envelope.schema.json` | `ExtensionPackageEnvelope` | `https://glimmer-cradle.local/contracts/extension/v1/extension-package-envelope.schema.json` |
| `json-schema/extension/v1/extension-permission.schema.json` | `ExtensionPermission` | `https://glimmer-cradle.local/contracts/extension/v1/extension-permission.schema.json` |
| `json-schema/extension/v1/extension-registry-catalog.schema.json` | `ExtensionRegistryCatalog` | `https://glimmer-cradle.local/contracts/extension/v1/extension-registry-catalog.schema.json` |
| `json-schema/extension/v1/extension-release-manifest.schema.json` | `ExtensionReleaseManifest` | `https://glimmer-cradle.local/contracts/extension/v1/extension-release-manifest.schema.json` |
| `json-schema/product/v1/product-composition.schema.json` | `ProductComposition` | `https://glimmer-cradle.local/contracts/product/v1/product-composition.schema.json` |

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

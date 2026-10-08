# M12 Contract Spine Inventory

Planning 通知源确认仍归 `proto/glimmer/cognition/v1/cognition_service.proto`：
`PlanningNotificationDeliveryConfirmation`、`AcknowledgePlanningNotificationRequest`、
`AcknowledgePlanningNotificationResponse` 与 `AcknowledgePlanningNotification`。回执复用 Surface
唯一 `DeliveryReceiptCommand`，可信 Host 读取实际 Delivery 已持久确认后映射；Worker 核验原
Reply/Turn/content digest/目的地，Planning 同事务保留完整确认与原 outbox，不建立第二 Delivery。

Planning 通知的内部接纳仍归 `proto/glimmer/cognition/v1/cognition_service.proto`：
`PreparePlanningNotificationRequest`、`PreparePlanningNotificationResponse` 与
`PreparePlanningNotification`。Cognition 形成表达，Conversation 实际 Reply flush 与持久 Turn
提交后才返回 accepted、原 Reply/position/content digest 和完整权限域；不代表外部 delivered/源 ACK。

Planning 完成通知的读取/来源解析同属 `proto/glimmer/cognition/v1/cognition_service.proto`：
`PlanningNotificationRequest`、`ReadPlanningNotificationsRequest`、`ReadPlanningNotificationsResponse`、
`ResolvePlanningNotificationRequest`、`ResolvePlanningNotificationResponse` 与
`ReadPlanningNotifications` / `ResolvePlanningNotification`。真实持久请求和业务事实只读，完整来源
与隐私 owner 从实际 Conversation Log 复验；读取/解析不执行通知 ACK 或第二 Delivery 状态机。

Planning 状态投递同属 `proto/glimmer/cognition/v1/cognition_service.proto`：
`PublishPlanningJobStateRequest`、`PublishPlanningJobStateResponse` 与同一 CognitionService 的
`PublishPlanningJobState`。复用 Jobs 唯一 `JobStateEvent`；真实 source/receipt 核验、持久 inbox/投影
提交后 ACK，不是另一个目标完成入口。

Planning claim 前只读接纳同属 `proto/glimmer/cognition/v1/cognition_service.proto`：
`GetPlanningJobAdmissionRequest`、`GetPlanningJobAdmissionResponse` 与同一 CognitionService 的
`GetPlanningJobAdmission`。真实 source ACK/目标/来源/当前政策决定 eligible；不创建 attempt、
评估窗口、封口或推理，不是授权证明，执行仍独立复验。

Planning 显式接纳/评估同属 `proto/glimmer/cognition/v1/cognition_service.proto`：
`AcceptPlanningCommitmentRequest`、`AcceptPlanningCommitmentResponse`、`ExecutePlanningJobRequest`、
`ExecutePlanningJobResponse`，同一 `CognitionService` 增加 `AcceptPlanningCommitment` / `ExecutePlanningJob`。
App 仅引用真实 Perception；scope、来源摘要和推理政策由 Worker 从实际 owner 绑定，不接受客户端
自报权限。执行复用 Jobs identity 与 PlanningJobResult，不建立第二份 receipt/证据或 DTO。

Planning 持久对账继续由 `proto/glimmer/cognition/v1/cognition_service.proto` 唯一拥有：
`ReconcilePlanningJobRequest`、`ReconcilePlanningJobResponse`、`PlanningJobResolution`、
`PlanningJobResult`、`PlanningEvaluationReceipt`、`PlanningEvidenceReference`；同一
`CognitionService` 增加 `ReconcilePlanningJob`。复用 `glimmer.jobs.v1.JobExecutionIdentity`，
查询者与实际提交者分别保存；否定证明在实际 Planning SQL 事务封口后返回，肯定证明引用
真实业务 receipt。`completed=false` 是已接纳评估，不等于长期目标完成；只返回证据引用，
不复制 source 正文。Proto 兼容基线未刷新；生成物仍由三语言统一生成链产生。

Knowledge 来源管理由同一 `proto/glimmer/cognition/v1/cognition_service.proto` 唯一拥有：
`KnowledgeResourceSource`、`KnowledgeResourceSourceState`、`GetKnowledgeResourceSourceRequest`、
`GetKnowledgeResourceSourceResponse`、`RegisterKnowledgeResourceSourceRequest`、
`RegisterKnowledgeResourceSourceResponse`、`CollectKnowledgeSourceRequest`、`CollectKnowledgeSourceResponse`；
`CognitionService` 增加 `GetKnowledgeResourceSource`、`RegisterKnowledgeResourceSource`、`CollectKnowledgeSource`。
可信 App 按来源 CAS 管理；可选 enabled 必须有 presence，缺省 scope 明确 global，存在时完整且无 user_id。
查询仅声明/修订/摘要，采集仅真实接纳 receipt，不公开正文或临时 proof。ServiceErrorCode 兼容新增
CONFLICT / PERMISSION_DENIED；审批 Document 为现行唯一 HostConfig.knowledge.approvals，默认空/拒绝，
绑定来源 revision/digest、固定 arguments、freshness 与绝对 expiry。Proto 基线未刷新；HostConfig
新增可选字段，经旧默认/合法非法审批自查后只更新该 JSON Schema hash 快照，门禁不变，无第二契约源。

Knowledge 显式资源采集复用同一 `proto/glimmer/capabilities/v1/capabilities.proto`：
`CollectKnowledgeResourceRequest`、`CollectKnowledgeResourceResponse`、`KnowledgeResourceAccess`、
`ValidateKnowledgeResourceRequest`、`ValidateKnowledgeResourceResponse`，同一 `CapabilityService`
增加 `CollectKnowledgeResource` / `ValidateKnowledgeResource`。Host 接纳固定来源/目标/参数/scope，
同时验证 resource.read 与 knowledge.ingest；采集证明绑定实际内容/主体/授权和有界 freshness。
不伪造 Step/Action/Execution result，不将加载正文自动登记成 Knowledge；旧字段/基线保持不变。

Architecture v2 阶段 6 原生 Step 服务：`proto/glimmer/capabilities/v1/capabilities.proto` 唯一拥有
`CapabilityReference`、`CapabilityScopeContext`、`ToolDescriptor`、`ResourceDescriptor`、
`ExposeStepRequest`、`ExposeStepResponse`、`InvokeToolRequest`、`InvokeToolResponse` 与
`CapabilityService` 的 `ExposeStep` / `InvokeTool`。Exposure 只传目录和定义引用，不授予执行权限；
ToolCall 原 ACTION 必须先刷盘，执行继续委托现行唯一 journal，结果引用真实 outbox/接纳事实。

原生方法/资源加载增加 `ReadCapabilityRequest`、`ReadCapabilityResponse`、`ResourceContent`，
RPC 外壳为 `ReadSkillRequest` / `ReadSkillResponse`、`ReadResourceRequest` / `ReadResourceResponse`，
以及同一 `CapabilityService` 的 `ReadSkill` / `ReadResource`；`SkillDescriptor.input_schema` 只携
参数 Schema。加载不注册假 Tool，正文/内容不授予权限；资源定义版本与实际 UTF-8 内容 SHA-256
分开。响应关联真实加载 ACTION 与已接纳结果，不能用 wire 正文冒充 Log 接纳事实。

Architecture v2 阶段 6 方法知识：`proto/glimmer/capabilities/v1/capabilities.proto` 唯一拥有
`SkillReference`、`SkillDescriptor`、`SkillMaterial`。Cognition `PlanRequest` 添加独立方法目录/
正文，`PlanResponse` 添加所选引用；不把 Skill 变成 Tool 或执行结果。保留原字段和兼容基线。

Architecture v2 阶段 6 结果投递：`proto/glimmer/capabilities/v1/capabilities.proto` 独占
`ExecutionResultState`、`ExecutionSideEffects`、`ExecutionResultEvent`；
`proto/glimmer/conversation/v1/conversation.proto` 新增 `ConversationService`、`AcceptExecutionResult`、
`AcceptExecutionResultRequest`、`AcceptExecutionResultResponse`。Worker 单写者承载独立 Service，
Conversation 验证原 ACTION 交互引用、幂等接纳并 flush 后确认。执行结果 DTO 不携带原始输入或
授权详情，引用真实交互而非复制拓扑。兼容新增，不刷新 baseline；阶段 11 一次性迁移 canonical 根。

Architecture v2 阶段 5/7 Planning 源投递：`proto/glimmer/cognition/v1/cognition_service.proto`
新增 `PlanningJobSourceRequest`、`ReadPlanningJobRequestsRequest`、`ReadPlanningJobRequestsResponse`、
`AcknowledgePlanningJobRequestRequest`、`AcknowledgePlanningJobRequestResponse` 与
`ReadPlanningJobRequests`、`AcknowledgePlanningJobRequest`。Worker 暴露真实 Planning 源 outbox，
Host 按原版本/scope/due 接纳到 Jobs，再确认源；不携带计划正文，不声明完成条件成立。
兼容新增，不刷新既有 Proto/JSON Schema baseline；执行/状态接收后续仍用唯一 Spine。

Architecture v2 阶段 7 状态投递：`proto/glimmer/jobs/v1/jobs.proto` 新增 `JobStatus`、`JobStateEvent`；
`proto/glimmer/cognition/v1/cognition_service.proto` 新增 `PublishMemoryJobState`、
`PublishMemoryJobStateRequest`、`PublishMemoryJobStateResponse`。Host 使用生成 DTO 投递不可变 outbox，
Worker 校验原事实、当前 generation/投递 epoch 与实际 Memory receipt，源 owner 的 inbox/投影同事务提交
后确认；legacy 拒绝双消费。仅兼容新增 IDL，不刷新既有 Proto/JSON Schema baseline。

v2.1 新增唯一 Document：`json-schema/config/v1/jobs-config.schema.json`、
`https://glimmer-cradle.local/contracts/config/v1/jobs-config.schema.json`、`JobsConfig`（Jobs owner）；
`json-schema/config/v1/host-config.schema.json`、
`https://glimmer-cradle.local/contracts/config/v1/host-config.schema.json`、`HostConfig`（Host owner）。
Host validator 消费；既有配置与 wire 不变。阶段 11 原子迁入目标 owner Schema 并登记 catalog，
迁移前禁止复制 Schema 或创建第二生成链。

当前新增用户技能 Document：`json-schema/skill/v1/user-skill-metadata.schema.json`，
`https://glimmer-cradle.dev/schemas/skill/v1/user-skill-metadata.schema.json`，`UserSkillMetadata`。
Contract Spine 拥有 frontmatter validator，Kernel UserSkillSource 消费；无旧格式迁移或并行 owner。

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
| `proto/glimmer/surface/v1/SurfaceGatewayServiceCommandRequest` | 有副作用 Surface Command；由 Kernel 统一权限和幂等 metadata，Delivery 回执携带 authority epoch、generation 与真实已听范围，结果不得伪装为 Event。 | Kernel Surface Gateway owner | `proto/glimmer/surface/v1/surface_gateway.proto` | Slice 7 / Conversation Delivery | Command consumer 全部转为 Service Adapter，权限拒绝、陈旧 generation 拒绝与播放回执门通过。 |
| `proto/glimmer/surface/v1/SurfaceGatewayServiceStreamResponse` | 有序、可取消的 presentation projection stream；产品侧消费 backpressure 受 gRPC stream 控制。 | Kernel Surface Gateway owner | `proto/glimmer/surface/v1/surface_gateway.proto` | Slice 7 | Stream 断连/取消/重连门通过。 |

Surface typed RPC inventory：`Connect`、`Query`、`Command`、`Stream`。

Surface typed symbol inventory：`SurfaceGatewayServiceConnectRequest`、`SurfaceGatewayServiceConnectResponse`、`ConfigurationSnapshotQuery`、`ConversationHistoryQuery`、`SkillCatalogQuery`、`ExtensionRuntimeProjectionQuery`、`SurfaceGatewayServiceQueryRequest`、`HeartbeatCommand`、`ChatInputCommand`、`AudioInputCommand`、`AvatarPresentationCommand`、`AvatarIntentCommand`、`CoreSkillActionResponseCommand`、`CoreSkillConfirmationResponseCommand`、`ConfigurationUpdateCommand`、`ConfigurationTestCommand`、`ExtensionInstallSource`、`ExtensionInstallPrepareCommand`、`ExtensionInstallCommitCommand`、`ExtensionInstallCancelCommand`、`ExtensionUninstallCommand`、`ExtensionLifecycleCommand`、`ExtensionCommand`、`DeliveryReceiptCommand`、`ShutdownCommand`、`SurfaceGatewayServiceCommandRequest`、`ReplyMessage`、`EmotionProjection`、`ReplyEvent`、`EmotionEvent`、`ThoughtEvent`、`AudioPlayEvent`、`AudioTranscriptEvent`、`CharacterPresentationEvent`、`AvatarStatusEvent`、`AvatarActionStateEvent`、`RuntimeResourceProjection`、`RuntimeReconcilerProjection`、`RuntimeReadinessItem`、`RuntimeReadinessEvent`、`AudioProviderProjection`、`AudioCapabilityProjection`、`AudioStatusEvent`、`ConversationNoticeEvent`、`ConversationAddressProjection`、`ConversationHistoryEntryProjection`、`ConversationHistoryResultEvent`、`ConfigurationSnapshotEvent`、`ConfigurationUpdateEvent`、`ConfigurationTestEvent`、`SkillCatalogEvent`、`ExtensionInstallPreviewEvent`、`ExtensionInstallResultEvent`、`ExtensionUninstallResultEvent`、`ExtensionLifecycleResultEvent`、`ExtensionCommandResultEvent`、`ExtensionRuntimeProjectionResultEvent`、`ExtensionRuntimeProjectionChangedEvent`、`ExtensionStatusChangedEvent`、`CoreSkillActionRequestEvent`、`CoreSkillConfirmationRequestEvent`、`ShutdownEvent`、`SurfaceEvent`、`SurfaceGatewayServiceQueryResponse`、`SurfaceGatewayServiceCommandResponse`、`SurfaceGatewayServiceStreamRequest`、`SurfaceGatewayServiceStreamResponse`、`SurfaceGatewayService`。

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
| Document → schema | `contracts/json-schema/{common,config,extension,product}/v1`；Kernel/Product 只保留所需 schema-derived edge type 与 validator；SDK 只为 Extension Document 暴露 authoring/validation edge | `ActivationProfileId`, `ActivationProfileRequirements`, `AppConfig`, `AudioConfig`, `AvatarConfig`, `CapabilityAudience`, `CapabilityScope`, `CharacterManifestConfig`, `CharacterProfileConfig`, `CognitionConfig`, `CognitionServiceConfig`, `ContributionDeclaration`, `ContributionDependency`, `ContributionPointDefinition`, `ContributionPointId`, `ContributionRequirements`, `ControlSurfaceGatewayConfig`, `DialoguePolicyConfig`, `EmbeddingConfig`, `ExtensionActivationProfile`, `ExtensionCapabilityContribution`, `ExtensionCommandContribution`, `ExtensionCommandPrecondition`, `ExtensionConfig`, `ExtensionContributions`, `ExtensionEngineConstraint`, `ExtensionHostPortId`, `ExtensionManagementSurfaceContribution`, `ExtensionManifest`, `ExtensionPackageChecksums`, `ExtensionPackageEnvelope`, `ExtensionPermission`, `ExtensionPlatform`, `ExtensionProductTarget`, `ExtensionRegistryCatalog`, `ExtensionRegistryRecord`, `ExtensionReleaseArtifact`, `ExtensionReleaseManifest`, `ExtensionSettingContribution`, `ExtensionSkillContribution`, `ExtensionSkillPolicyContribution`, `ExtensionSkillPromptContribution`, `ExtensionSkillResourceContribution`, `ExtensionSkillToolContribution`, `ExternalDependencySource`, `InferenceConfig`, `IngressGateConfig`, `KnowledgeBaseConfig`, `KnowledgeIndexConfig`, `LifecycleConfig`, `LLMConfig`, `ManagedResourceContribution`, `ManagedResourcePackage`, `ManagedResourceProcess`, `McpServerConfig`, `MemoryConfig`, `ObservabilityConfig`, `ProductComposition`, `ProductFeatureId`, `ProtocolBridgeContribution`, `ReadinessGateDeclaration`, `ReadinessProbe`, `SafetyConfig`, `SkillPlaneConfig`, `SurfaceConfig`, `VoiceConfig` |
| Service edge / controlled projection | Canonical Service Adapter 或 Kernel/Product owner-local mapping；不再由 SDK 聚合 Surface、配置、安装与系统 runtime 类型，也不保留 JSON Schema 第二事实源 | `AudioStatusPayload`, `AvatarActionStateDocument`, `CharacterPresentationProjectionPayload`, `ConfigurationModelAlias`, `ConfigurationProviderDraft`, `ConfigurationProviderSnapshot`, `ConfigurationProviderTestDraft`, `ConfigurationRouteSnapshot`, `ConfigurationSnapshot`, `ConfigurationSnapshotRequest`, `ConfigurationSnapshotResult`, `ConfigurationTestRequest`, `ConfigurationTestResult`, `ConfigurationUpdateRequest`, `ConfigurationUpdateResult`, `ConversationHistoryEntry`, `ConversationHistoryRequest`, `ConversationHistoryResult`, `ExtensionCommandRequest`, `ExtensionInstallationProjection`, `ExtensionInstallCommitRequest`, `ExtensionInstallPrepareRequest`, `ExtensionInstallPreview`, `ExtensionInstallResult`, `ExtensionLifecycleRequest`, `ExtensionLifecycleResult`, `ExtensionRuntimeProjection`, `ExtensionRuntimeProjectionRequest`, `ExtensionRuntimeProjectionResult`, `ExtensionUninstallRequest`, `ExtensionUninstallResult`, `PresentationDownstreamFrame`, `PresentationRuntimeReadinessCatalogPayload`, `PresentationRuntimeReadinessSnapshot`, `PresentationRuntimeReadinessState`, `PresentationUpstreamFrame`, `RecoveryRequiredProjection`, `RuntimeReadinessCatalog`, `RuntimeReadinessOwner`, `RuntimeReadinessSnapshot` |
| Extension SDK public | `packages/extension-sdk` 的 manifest、permission、contribution、event、distribution、validator 与 Host Port lifecycle/readiness public API；boundary test 递归覆盖 barrel/re-export 与 production import | `ActionCommand`, `ActionIntentSnapshot`, `ActionIntentState`, `BuiltInContributionPoint`, `BuiltInContributionPointDefinitions`, `BuiltInContributionPointId`, `CapabilityGraphEdge`, `CapabilityGraphNode`, `CapabilityNodeState`, `ChannelReplyPayload`, `ContributionPointDefinitionSnapshot`, `DiagnosticsEntry`, `DiagnosticsSnapshot`, `EXTENSION_ID_PATTERN`, `EXTENSION_PACKAGE_FORMAT_VERSION`, `EXTENSION_PACKAGE_MEDIA_TYPE`, `EXTENSION_PACKAGE_SCHEMA`, `EXTENSION_REGISTRY_SCHEMA`, `EXTENSION_RELEASE_SCHEMA`, `EXTENSION_VERSION_PATTERN`, `ExtensionActivationProfileAvailability`, `ExtensionActivationProfileContext`, `ExtensionActivationProfileResolution`, `ExtensionContractValidation`, `ExtensionErrorPayload`, `ExtensionEventPayloadMap`, `ExtensionLifecyclePayload`, `ExtensionManifestInput`, `ExtensionScopedEventTopic`, `ExtensionStreamBasePayload`, `ExtensionStreamCancelledPayload`, `ExtensionStreamCompletedPayload`, `ExtensionStreamStartedPayload`, `ExtensionSystemEventTopic`, `ReadinessGateSnapshot`, `getEffectiveContributionIds`, `getExtensionContributions`, `getManagedResourceContributions`, `hasExtensionPermission`, `isSafeExtensionPackagePath`, `listExtensionActivationProfiles`, `materializeManifestForActivationProfile`, `resolveExtensionActivationProfile`, `validateExtensionManifest`, `validateExtensionPackageChecksums`, `validateExtensionPackageEnvelope`, `validateExtensionRegistryCatalog`, `validateExtensionReleaseManifest` |
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
| Content v1 | `proto/glimmer/content/v1/content.proto` 定义 `AssetRef`、`FileContent`、`ContentPart`；只传稳定引用与内容类别，不传媒体字节或本机路径。 | Content Contract Spine owner | `contracts/generated/{ts,python,csharp}/glimmer/content/v1/` | Architecture v2 阶段 3 | 新 Cognition 感知链消费 `parts`；旧 `items` 只在兼容窗口读取，阶段 14 旧样本与消费方归零后删除。 |
| Cognition v1 Service | `proto/glimmer/cognition/v1/cognition_service.proto` 定义 `CognitionService` 以及 `SubmitPerception`、`CancelPerception`、`GetPerceptionOperation`、`InitializeKnowledge`、`Plan`、`Synthesize`、`GetConversationHistory`、`Heartbeat`、`GetReadiness`、`Shutdown`；DTO/枚举为 `AddressMode`、`ResponsePolicy`、`RetentionCeiling`、`PerceptionOperationState`、`ConversationContext`、`SourceDescriptor`、`ModalitySemantic`、`ModalityItem`、`PerceptionPart`、`PerceptionContent`、`SubmitPerceptionRequest`、`SubmitPerceptionResponse`、`CancelPerceptionRequest`、`CancelPerceptionResponse`、`GetPerceptionOperationRequest`、`GetPerceptionOperationResponse`、`KnowledgeRetrievalConfig`、`KnowledgeEntry`、`InitializeKnowledgeRequest`、`InitializeKnowledgeResponse`、`SkillToolDescriptor`、`SkillToolSuggestion`、`PlanRequest`、`PlanResponse`、`ToolResult`、`SynthesizeRequest`、`SynthesizeResponse`、`GetConversationHistoryRequest`、`ConversationHistoryEntry`、`GetConversationHistoryResponse`、`HeartbeatRequest`、`HeartbeatResponse`、`GetReadinessRequest`、`GetReadinessResponse`、`ShutdownRequest`、`ShutdownResponse`。另有 `ExecuteMemoryJob` / `ReconcileMemoryJob`，消息为 `ExecuteMemoryJobRequest`、`ExecuteMemoryJobResponse`、`ReconcileMemoryJobRequest`、`ReconcileMemoryJobResponse`、`MemoryJobResult` 与 `MemoryJobResolution`。 | Cognition Service owner | `contracts/proto/glimmer/cognition/v1/` | Slice 2、Architecture v2 阶段 3/7 | 仅由 Worker Adapter 实现；`ReconcileMemoryJob` 会持久封口原 attempt，非只读查询；新增 `parts = 6`，旧 `items = 5` 限期读取；不得重新引入 ZMQ、万能 envelope 或手写跨语言镜像。 |
| Jobs 原执行身份 | `proto/glimmer/jobs/v1/jobs.proto` 的 `JobExecutionIdentity` | Jobs/接收 owner 的 App adapter | `contracts/generated/{ts,python}/glimmer/jobs/v1/` 与 C# `Jobs.cs` | Architecture v2 阶段 7 | job/scope/原 attempt/epoch/token/owner/deadline；当前 generation 与原执行 epoch 不是同一身份。整数限制为正数且不超过 JS safe integer；空查询不能冒充未提交证明。 |
| Memory 源请求投递 | Cognition Service 的 `ReadMemoryJobRequests` / `AcknowledgeMemoryJobRequest`，`MemoryJobSourceRequest`、`ReadMemoryJobRequestsRequest`、`ReadMemoryJobRequestsResponse`、`AcknowledgeMemoryJobRequestRequest`、`AcknowledgeMemoryJobRequestResponse` | Cognition Memory / Worker / Host App adapter | `contracts/proto/glimmer/cognition/v1/cognition_service.proto` | Architecture v2 阶段 7 | 仅外部 Jobs 模式开放；源身份与摘要不带 Moment 正文，先持久 Jobs enqueue 再源 ACK；接纳不表示 Memory 完成，旧队列模式拒绝双消费。 |
| Kernel control v1 Service | `proto/glimmer/kernel/v1/kernel_control_service.proto` 定义 `KernelControlService` 以及 `RegisterCognition`、`PublishState`、`PublishLog`、`PublishAction`；DTO 为 `RegisterCognitionRequest`、`RegisterCognitionResponse`、`PublishStateRequest`、`PublishStateResponse`、`PublishLogRequest`、`PublishLogResponse`、`ReplyMessage`、`MediaItem`、`SkillRequest`、`PublishActionRequest`、`PublishActionResponse`。 | Kernel control Service owner | `contracts/proto/glimmer/kernel/v1/` | Slice 2 | 只允许受监督 Cognition 世代从动态回环端点调用；旧推送链与配置删除后保持单轨。 |
| Extension Host Process v1 Service | `proto/glimmer/extension/v1/extension_host_process.proto` 定义 Extension Host 独立进程 supervision contract；声明 `HandshakeRequest`、`HandshakeResponse`、`ExtensionHostProcessStage`、`ReportStateRequest`、`ReportStateResponse`、`ExtensionHostProcessService`、`Handshake` 与 `ReportState`。 | Extension Host owner / Kernel Extension supervision owner | `contracts/proto/glimmer/extension/v1/` | Slice 6 | Kernel 只消费 Host process 状态与监督结果；第三方 handler 装载只发生在 `hosts/extension-host/`，旧 Kernel Worker protocol、module loader 与兼容桥归零后关闭本切片。 |
| JSON Schema Document baseline | `json-schema/skill/v1/tool-parameters.schema.json` 定义 `$id` 为 `https://glimmer-cradle.local/contracts/skill/v1/tool-parameters.schema.json`、title 为 `SkillToolParametersDocument` 的动态 Skill tool parameters Document。 | Skill Plane Document owner | `contracts/json-schema/` | Slice 1 | Document 结构只能由 JSON Schema 演进；Protobuf 只引用 id/version/digest。 |
| Extension Host Process Document | `json-schema/extension/v1/extension-host-process.schema.json` 定义 `$id` 为 `https://glimmer-cradle.local/contracts/extension/v1/extension-host-process.schema.json`、title 为 `ExtensionHostProcessDocument` 的 Host process stage 与 fail-closed IPC 文档契约。 | Extension Host owner / Kernel Extension supervision owner | `contracts/json-schema/extension/v1/` | Slice 6 | 运行态 Host process protocol 由公开 SDK 暴露，文档契约与 Service IDL 同步演进；旧 Protocol Host message schema 已删除，不再作为 Host process 事实源。 |
| Generated DTO | `contracts/generated/{ts,python,csharp}` 由 `buf generate` 生成。 | Contract Spine Adapter edge owner | `contracts/buf.gen.yaml` | Slice 1 | 手改生成物或生成后有 diff 时门禁失败；Domain/Application/Port 不得 import。 |
| Compatibility baseline | `contracts/compatibility/proto-image.binpb` 与 `json-schema-baseline.json` 在仓库内，`buf breaking` 不依赖 BSR。 | Contract Spine owner | `contracts/compatibility/` | Slice 1 | 破坏性变更必须经有意 baseline refresh 与审查；普通生成不自动刷新。 |
| Supply chain evidence | `contracts/toolchain.json` 固定机器可校验的工具/依赖版本、许可证与摘要；`contracts/supply-chain.md` 解释来源和缓存规则。 | Contract Spine owner | `toolchain.json`、`global.json`、npm/uv/NuGet lock 与官方发布摘要 | Slice 1 | 工具版本、来源、支持平台或许可证变化时同步更新并重跑验证。 |

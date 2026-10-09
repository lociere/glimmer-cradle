# Contract Spine Reference

> 范围：跨语言、跨进程与公开 SDK 契约的 owner、路径、兼容规则、媒体引用和变更流程。
> 事实依据：`contracts/{proto,json-schema,compatibility,generated}/`、`packages/extension-sdk/` 与当前 Adapter/consumer。
> 维护触发：Service、Document、公开 SDK、codegen、兼容基线或跨边界 consumer 变化。

## 权威来源

| 语义 | Canonical owner | 消费规则 |
|---|---|---|
| 跨进程 Command、Query、Stream、typed Event | `contracts/proto/glimmer/<domain>/v1/` | Buf 生成 TS/Python/C# DTO；只进入 Adapter/Transport 边缘。 |
| 可独立存储、编辑、校验的 Document | `contracts/json-schema/<domain>/v1/` | AJV/owner validator 校验 serialized shape；Protobuf 只引用 id/version/digest。 |
| Extension 公开 API | `packages/extension-sdk/` | SDK 暴露稳定 public projection、权限、manifest/package validator 与 Host edge mapping。 |
| 领域/Application/UI 状态 | 对应 owner-local model/view mapping | 不进入 Contract Spine，不反向定义 Service/Document。 |

`contracts/` 是唯一 Contract Spine；旧 `protocol/` 已物理删除，不存在 package、workspace、生成链、validator、compatibility shell 或 runtime consumer。`@glimmer-cradle/contracts` 可以打包 canonical JSON Schema 与最小 AJV edge primitives，但不拥有领域默认加载、normalizer、reply/avatar/yaml 等万能业务 helper。

## 当前契约族

| 契约族 | 路径/公开边缘 | 关键不变量 |
|---|---|---|
| Common / Kernel / Cognition | `contracts/proto/glimmer/{common,kernel,cognition}/v1/` | deadline、cancellation、typed error、trace/causation/correlation、generation 与幂等。 |
| Skill 方法目录与材料 | `contracts/proto/glimmer/capabilities/v1/capabilities.proto` 与 Cognition `Plan` | 独立 `SkillReference` / `SkillDescriptor` / `SkillMaterial`；目录不含正文，选择绑定定义 revision；正文最多两份、合计 64 KiB UTF-8，不是 Tool 或执行结果、不授予权限。现行 Plan 消费不表示原生 Step Exposure ready。 |
| Execution / Conversation 结果接纳 | `contracts/proto/glimmer/capabilities/v1/capabilities.proto` 与 `contracts/proto/glimmer/conversation/v1/conversation.proto` | 独立 `ConversationService.AcceptExecutionResult`；结果引用原 Action，成功结果包含 Value presence（null 也有效），失败/unknown 不携带成功结果；Log 真正刷盘后返回原 Moment/position，producer 验证 identity 与 durable receipt 后 ACK。 |
| Memory / Jobs App 接线 | `contracts/proto/glimmer/cognition/v1/cognition_service.proto` 与 `contracts/proto/glimmer/jobs/v1/jobs.proto` | `ReadMemoryJobRequests` / `AcknowledgeMemoryJobRequest` 只允许外部 Jobs 模式，源身份不带 Moment 正文；先持久入 Jobs 再 ACK。`ExecuteMemoryJob` / `ReconcileMemoryJob` 绑定原 attempt/epoch/token/owner/lease；对账会持久封口，空查询不是未执行证明。 |
| Planning / Jobs 源接纳 | 同一 `cognition_service.proto` | `ReadPlanningJobRequests` / `AcknowledgePlanningJobRequest` 读取真实 Planning owner 的版本引用源请求；保留原 due，Jobs 提交后才 ACK，不表示承诺完成。 |
| Content | `contracts/proto/glimmer/content/v1/content.proto` | `ContentPart` 的 Text/Image/Audio/Video/File 联合体；媒体为 `AssetRef(asset_id,media_type,size_bytes,sha256)`，不含路径与字节。Cognition `PerceptionContent.parts = 6` 为新入口，`items = 5` 是阶段 9/14 删除门约束的旧 URI 读取入口。 |
| Surface Gateway | `contracts/proto/glimmer/surface/v1/` | Desktop/Personal Server 只访问 Kernel Gateway；Query、Command、Event 使用有限 typed DTO，不接受 `string kind + Struct {frame}`；浏览器认证 WebSocket 是 Product ingress，不是内部器官协议。 |
| Avatar Host | `contracts/proto/glimmer/avatar/v1/` | `AvatarHostService.Connect` 是唯一 control consumer；二进制 DTO 直接映射，不经 JSON round-trip。 |
| Audio Engine | `contracts/proto/glimmer/engine/audio/v1/` | unary control 与媒体 data plane 分离；普通 RPC 不携带音频字节。 |
| Extension Host | `contracts/proto/glimmer/extension/v1/` 与 Extension SDK edge | Kernel 监督独立 Host；第三方 handler 不进入 Kernel。 |
| Config Documents | `contracts/json-schema/config/v1/` | Kernel config Adapter 拥有 normalizer/default loading；Renderer 不直接读取 YAML。 |
| Extension Documents | `contracts/json-schema/extension/v1/` | SDK validator 消费 canonical Schema；模板只依赖 SDK/Contracts 公开边缘。 |
| Product / Presentation / Skill Documents | `contracts/json-schema/{product,presentation,skill}/v1/` | serialized Document 唯一事实源；产品 view model 与领域模型留在 owner。 |

Surface Gateway 的 `ConversationHistoryEntryProjection` 除历史正文与来源外，还以 optional 字段传递 `trace_id`、`interaction_id`、`position`、`title`、`moment_id`、`actor_id` 和 `actor_name`。Kernel 出站与 Desktop/Personal Server 入站 Adapter 保留这些字段的缺省语义，位置 `0` 不等同于缺省；产品以 interaction/trace 身份合并瞬时与持久记录，不按消息文本猜测去重。

Surface Delivery 由 `ReplyEvent` / `AudioPlayEvent` 投影 `output_id`、`destination_id`、`authority_epoch` 与
`generation`，由 `DeliveryReceiptCommand` 回传 delivered、playback started/progress/completed、failed 或
unknown。音频分段另携带 `segment_index` / `segment_count`；产品按真实播放器反馈累计已听范围，只有末段可
提交 completed。Kernel 对 output、destination、epoch、generation、receipt id、时间和单调播放范围统一校验，
迟到 generation、回执冲突或倒退进度均失败关闭。收到 Event、完成 TTS 或成功写 EventBus 都不是播放回执。

配置、Extension manifest/package、Product composition 与其他 Document 使用 JSON Schema 2020-12，必须声明稳定 `$id`、`x-glimmer-owner`、`x-glimmer-contract-kind=Document` 和兼容策略。Schema 可以跨目录 `$ref`；validator 必须先注册完整 registry，再校验入口 Document。

Content 的 TypeScript/Python/C# DTO 只从 canonical proto 生成；`AssetRef` 的 ID 不作为访问凭据。新 Experience v5 Moment 在 `content.parts` 中写引用与语义，不内联媒体字节；旧 v4 文本 Moment 继续读取。旧 URI-only `items` 当拍消费且不可保证恢复，不生成假引用。长期恢复规则见 [ADR-0020](../architecture/decisions/ADR-0020-Content资产单写者与恢复边界.md)。

`CoreSkillConfirmationRequestEvent` 的字段 8 `title`、字段 9 `detail` 为可选展示文本，由双端 Adapter 映射到确认界面；不授予权限，也不替代目标工具策略。确认回执必须来自接收该请求的可写 Surface session，断线使未完成请求失效。用户 SKILL.md 元数据由 `contracts/json-schema/skill/v1/user-skill-metadata.schema.json` 拥有，加载及调用边界见[Extension 与 Skill Plane 实现](../architecture/implementation/Extension与SkillPlane实现.md)。

## 目标 Host Resource 接线

目标 Host WorkerSupervisor 复用既有 CapabilityService.ExposeStep/ReadResource 与生成的
ReadResourceRequest 外壳，受监督 generation/ready 后才开放；尚无实际 owner 的 Tool/Skill
返回 NOT_READY。Resource 成功的持久 capability_id 为 `resource:<definition_id>`，正文 reference
使用原 ID/revision；Worker 必须核验原 Action、durable result identity 与 content revision。
Host 结果接纳使用独立 ConversationService.AcceptExecutionResult，不投递到 CognitionService。
授权和停止边界见[实现地图](../architecture/implementation/Extension与SkillPlane实现.md#目标-host-resource-授权与读取)。

Knowledge 专用 IO 通过同一 CapabilityService.CollectKnowledgeResource/ValidateKnowledgeResource；
Host 必须先显式接纳 source_id、定义引用、固定参数、scope 与最大采集年龄，同时存在
resource.read/knowledge.ingest grant。请求不携带模型 Step/Action 或任意读取参数；global 已接纳
来源的 scope 缺省，private 来源须传精确 context，不允许空 context 或丢 scope 升为 global。
该区别依赖 message presence，不猜测默认字段。Host 从本代
受监督主体推导 principal，不接受调用方自报授权。采集响应包含 ResourceContent 及
KnowledgeResourceAccess，复验将原证明、定义、实际内容 hash/media_type 和 scope 一并发送；完整身份/
授权 revision/时间与 Host 活跃证明不符即 current=false。未接纳、世代不符、超时/撤销失败
关闭；不以证明声明 Knowledge 已持久接纳。正文不进入发现目录或审计。
旧 Kernel 服务未提供该新采集入口，不建立兼容假采集；精确生命周期和未完成接线见
[实现地图](../architecture/implementation/Extension与SkillPlane实现.md#knowledge-显式资源采集边界)。

## Knowledge 来源管理

同一 CognitionService 的 GetKnowledgeResourceSource、RegisterKnowledgeResourceSource、
CollectKnowledgeSource 属于可信 App 管理面，不公开给模型、Tool 或 Extension。管理声明
KnowledgeResourceSource 绑定 source_id、Resource reference、priority、enabled 和 scope；priority
为 1–JS max safe integer，enabled 必须有 presence。scope 缺省明确 global，存在时完整
provider/scene/conversation 且禁止 user_id（包括显式空 user_id）。三类调用均要求本代 metadata、
实际 Knowledge owner 与业务 ready；取消/停止进入实际 task drain，不在 SQL 事务内等待 RPC。

来源状态只携声明、正 source_revision 和 declaration_digest；不存在时 state 缺省，正文/proof
不进入管理查询。摘要是 SHA-256 的小写 hex，输入为无空格、Unicode 不转义的 UTF-8 JSON：
`["knowledge-resource-source.v1",source_id,resource_id,definition_revision,[provider,scene,conversation],priority,enabled]`；
global 三个 context 值均为 null，priority 是安全整数，enabled 是 JSON bool。Host 在比较
持久审批 revision/digest 后也从实际声明复算摘要，不靠 revision 单独授权。

登记 expected_source_revision 为 0 时只允许新来源；更新为当前修订，语义相同且期望当前修订
返回原修订。冲突返回 CONFLICT（gRPC ABORTED），读取当前事实后由 App 作新决策，不自动
覆盖，不宣称请求 identity 已幂等接纳。停用原子失效当前条目/向量，保存来源和采集历史。
采集期望修订为正，IO 前及 SQL 接纳均比较；disabled 或已复验为失效返回 PERMISSION_DENIED，缺字段、
非法 scope/整数或不存在来源为 INVALID_REQUEST。Resource 服务失败延续其稳定 code，不透传
正文或原始异常。Get/登记返回状态，Collect 仅返回 source/revision、entry/revision、content_digest
的实际接纳 receipt；无正文或 access ID。丢失采集 ACK 不代表未写入，新的明确采集产生新证据，
不重放旧 proof，也不靠内存 idempotency cache 假称成功。

Host 审批先由唯一 HostConfig 校验，再由同一 Resource/Broker graph 对实际注册主体发新双 grant。
管理更新先撤 IO/proof 再 CAS；失败保持拒绝，不承诺跨 Host/SQLite 分布式原子事务。审批不是
临时 grant，来源声明不是读取授权，采集材料不是 Memory。配置、重新装配和未交付 UI 边界见
[配置参考](configuration.md#目标-host-与-jobs-配置) 与
[Knowledge 实现](../architecture/implementation/Cognition认知核实现.md#knowledge-来源与持久化)。
Host-local Resource 更新订阅与刷新状态不是新 wire；重采集仍复用上述查询/采集 RPC 和原授权，
不以通知自动创建 grant、更新审批或恢复旧 Context。通知及有界监督机制归
[Knowledge 采集边界](../architecture/implementation/Extension与SkillPlane实现.md#knowledge-显式资源采集边界)。

## Memory Jobs 状态投递

Jobs 的 `JobStateEvent` 是原 outbox 事实，携带稳定 event/job/scope/goal/kind、revision、状态枚举、
attempt/epoch/token、可选结果与错误、更新时间；不携带请求 payload。event ID 是紧凑 UTF-8 JSON
`[job_id,revision]` 的 SHA-256。所有整数限制 JS safe integer；revision/epoch 为正，排队前的
attempt/token 可为零；Memory 执行状态需要非零 attempt/token。未知枚举/身份/溢出或大于 64 KiB
的事件拒绝为 INVALID_REQUEST。结果为生成 Struct 边缘，不允许非成功状态自报业务结果。

`PublishMemoryJobState` 仅在外部 Jobs 模式且 Worker 本代业务 ready 时开放。Host 附当前
`delivery_authority_epoch`，可以高于历史 backlog 的原 epoch；Worker 要求合法 generation，接收端
记已观测投递主 high-water，拒绝旧主，按原 revision 更新投影。high-water 不是新调度 authority。
同事件同内容重复 ACK，不同内容、源 scope/Job 冲突、authority 回退或无匹配持久业务 receipt 的
成功状态返回 RECOVERY_REQUIRED。inbox 与投影同事务提交后才 accepted；ACK 丢失可重投。
取消/unknown 不表示 Memory 未执行或回滚；已提交 receipt 与不确定性必须保留。数据责任见
[数据目录](data-layout.md#用户状态与记忆)，实现见
[Cognition 实现](../architecture/implementation/Cognition认知核实现.md#记忆经历与持久化)。

## Planning Jobs 源接纳

`PlanningJobSourceRequest` 携带 request/commitment/plan/goal/scope 身份、目标/计划版本与原
`due_at_ms`，不复制目标正文、完成条件或平台命令。request ID 为紧凑 UTF-8 JSON
`["planning.evaluate",commitment_id,plan_id,plan_version]` 的 SHA-256；版本为正 JS safe integer，
due 为非负 JS safe integer，单个源消息不超过 64 KiB。扫描 limit 为 1 至 1000。
两条 RPC 要求本代 generation、真实 Planning store 和 Worker 业务 ready；缺 owner、降级或
drain 时返回 NOT_READY。Planning 无旧私有执行队列，不继承 Memory 的 legacy/external 选择门。

Host 接纳到 `planning:<request_id>`，kind 为 `planning.evaluate`，source 为 `cognition.planning`；
保留源原 due，并由 Jobs 同事务固定首次重试预算。真正 Jobs commit 后以原完整请求、Job ID、
正 JS safe revision 和 duplicate 回执 ACK；源同库提交后才返回 accepted。非法身份/范围为
INVALID_REQUEST，原内容/scope/due 冲突为 RECOVERY_REQUIRED；取消或响应丢失不撤销已接纳 Job，
重投沿用首次记录。源已提交但回复丢失时，下次不再返回该请求。

当前配置 Host 已接源投递、真实执行器与逐任务接纳后调度；不适用目标等待且不消耗 attempt。
Host 按本轮等待/未 ACK 状态分别报告 `jobs_admission_pending`/`jobs_state_feedback_pending`，
状态 outbox 独立投递 Planning receiver，不交给 Memory；真实 inbox commit 后才 ACK。通知和再调度未完成。
Job accepted 不改变承诺 accepted/revision。

### Planning 显式接纳与执行

`AcceptPlanningCommitment` 接受 commitment/plan/goal ID 和正 JS safe 版本、目标正文、完成条件、
steps、实际 `source_moment_id` 与非负 JS safe due；总请求不超过 64 KiB，身份字符串不超过
4096 UTF-8 bytes。调用方不能自报 scope、source digest 或 model tier；Worker flush 后读取真实
Perception，绑定完整 Conversation context、隐私/保留分类、完整 Moment SHA-256 和当时活动政策。
响应是实际 commitment 的 status/revision/scope，重复完整版本保持原 tier 和 due，不代表执行。
缺失/不完整来源或不适用政策为 PERMISSION_DENIED；非法预算/字段为 INVALID_REQUEST；不可变版本
冲突为 CONFLICT。旧目标没有来源绑定不得自动扩权，须显式新版本；普通模型回复不会调用该入口。

`ExecutePlanningJob` 使用 Jobs 唯一 `JobExecutionIdentity` 和原 `request_id`，范围与 Reconcile 相同；
要求本代业务 ready 和实际 Planning/Conversation/Knowledge/Activity/Model owner。Core 核验实际
源 ACK、原计划与 live lease，再由生产 Evidence Adapter 收集当前受控材料和 ModelPort 评估。
接受时及模型调用前后当前 tier 都必须 cloud_allowed；sensitive、local_only/none 不送云，也不假装
本地推理可用。来源/政策拒绝为 PERMISSION_DENIED，原源/attempt/提交冲突为 RECOVERY_REQUIRED。
取消/异常先独立封口，再交还调用者；响应复用持久 `PlanningJobResult`，不另建完成事实。
来源选择、预算及 live 复验归[认知核实现](../architecture/implementation/Cognition认知核实现.md#长期承诺与-jobs-源请求)。

Host `PlanningJobAdapter` 验持久 receipt 后返回 Jobs succeeded，不把评估值改成 true；取消后用
独立非取消 signal 的有界 Reconcile 调用封口。配置 Host 默认经下面的接纳闸驱动独立 scheduler。

### Planning 逐任务调度接纳

`GetPlanningJobAdmission` 只携 `request_id`、`job_id`、`scope_id` 和本代 call，不伪造 attempt。
总请求不超过 16 KiB，request 为 SHA-256，job 必须为 `planning:<request_id>`；job/scope 非空且
不超过 4096 UTF-8 bytes。非法输入为 INVALID_REQUEST，非真实已 ACK 源/计划/范围为
RECOVERY_REQUIRED；缺 owner、业务未 ready 或 drain 为 NOT_READY，旧代为 GENERATION_MISMATCH。
调用参与 deadline/取消/drain；返回同一 request/job/scope、eligible 和 reason_code，不带目标或证据正文。
只读实际持久输入，不登记 attempt、建评估表、封口、改变承诺/时钟 high-water 或调用模型。

`planning_ready` 唯一对应 eligible=true；`planning_source_unbound`、`planning_source_unavailable`、
`planning_model_policy`、`planning_model_unavailable` 对应等待。旧无绑定版本可以安全返回等待，
无需补造证据 owner；已绑定且模型已装配的目标缺 Conversation/Knowledge/Activity 则 NOT_READY。
Host 校验响应身份及布尔/reason 组合，只 CAS 原候选 revision，等待仍前进分页并回绕。
这不是执行资格持久授予或分布式原子授权；Execute 必须用新 Adapter 再复验当前来源/政策。

### Planning Jobs 状态投递

`PublishPlanningJobState` 复用 Jobs 的 `JobStateEvent`，携本代 call 和正 JS safe
`delivery_authority_epoch`；总请求不超过 64 KiB，字符串身份不超过 4096 UTF-8 bytes。
job 为 `planning:<request_id>`，kind 为 `planning.evaluate`，event ID 为紧凑 UTF-8 JSON
`[job_id,revision]` 的 SHA-256；revision/job epoch 为正 JS safe integer，attempt/token/updated time
为非负 JS safe integer。running/retry_wait/succeeded/unknown 要求非零 attempt/token。
错误 kind/枚举/身份/整数/预算为 INVALID_REQUEST，缺 owner/未 ready/drain 为 NOT_READY，旧代为
GENERATION_MISMATCH；源未 ACK、goal/scope 冲突、旧投递主、同 event 内容漂移或错 receipt 为 RECOVERY_REQUIRED。

Worker 以实际 wire event 摘要映射消费方反馈，不以模型/外部 result 创造事实。succeeded 的 result
须逐字段匹配原持久评估 receipt（保持 completed=false）；其他状态不得携 result，但投影保留
真实已提交业务 receipt，取消/unknown 不代表回滚。projection 不改变承诺 revision/status。
投递 high-water 和已观测评估 epoch 拒绝旧主；当前主可投递旧 epoch 事实，重复/迟到事件不回退
最新 revision。新事件 inbox/投影同事务提交后返回同 event_id、accepted=true、duplicate；Jobs 才 ACK。
取消/deadline/shutdown drain 事务，响应丢失重投原事件，不自造确认；retention 不删除接收 owner 的事实。

### Planning 完成通知读取与来源解析

`ReadPlanningNotifications` / `ResolvePlanningNotification` 同属 Cognition Service，消费 Core 同事务
产生的 `PlanningNotificationRequest`；不是通知发送/ACK 接口，不增加第二 Delivery 状态机。
请求引用 notification/receipt/request/Job、承诺 revision、goal ID/version/scope、可选成对 Moment
ID/digest 和 created time，稳定 ID 与 Core 规则一致；字符串 optional 的缺失不当成空字符串绑定。
所有版本/时间保持 JS safe，原未知/未绑定目标不补造来源。请求总量不超过 64 KiB。

Read 的 limit 为 1 至 1000，optional after ID 必须是 64 位小写 SHA-256；按稳定 ID 前向分页。
单次实际至多 64 项、wire 响应至多 1 MiB，预算可使非空页少于 limit，消费者须沿最后 ID
继续直到空页，不以短页判定扫描完毕。读取不创建通知/评估窗口、改写高水位或清除请求。

Resolve 先核验真实源 ACK、不可变目标/计划、已完成 receipt 与当前承诺 revision，再从实际
Conversation Log 复验原完整来源摘要、保留资格、provider/scene/conversation/continuity/thread/
interaction、privacy class、recall/disclosure scope 与实际 owner。actor_private 的 owner 是实际
Actor，不将 actor 当平台 User 或从 scope 猜目的地。返回 available=true 只表示当前内部来源可读；
不是外部发送资格。IO 解析不调用模型，不要求 Knowledge/ModelPort 或 cloud model-tier。
可读时携原 goal text、原业务 receipt、完整 context、可选 actor 与隐私 owner；响应至多 256 KiB。

未绑定/来源不可用分别返回 `planning_notification_source_unbound` / `planning_notification_source_unavailable`，
available=false，只有原 request/reason，不返回正文、context、actor 或 receipt；可读 reason 为
`planning_notification_source_ready`。非法身份/整数/分页/预算为 INVALID_REQUEST，来源引用/业务
事实冲突或响应超预算为 RECOVERY_REQUIRED；缺持久/Conversation owner、未 ready/drain 为
NOT_READY，旧代为 GENERATION_MISMATCH。取消/deadline/shutdown 排空只读事务，待办不消费。

Worker 的共享调用边界限 CallMetadata 4 KiB，超限在 trace context/inflight 之前拒绝；错误 detail
不回显超限 metadata，避免突破 gRPC trailer 预算丢失结构化错误码。合法调用仍保持原 call。
Host 实际 client 接通上述 RPC；默认监督链观察持久待办，没有真实投递 receiver 时显示
`degraded/planning_notifications_pending`，Jobs 状态 ACK 不抹去通知或假 ready。后续 App 必须
复验真实目的地/权限，复用 Conversation output generation 与实际 delivery receipt 后才能接 ACK。

### Planning 通知内部 Reply 与 Turn 接纳

`PreparePlanningNotification` 仍由同一 Cognition Service 承载，唯一 IDL 定义
`PreparePlanningNotificationRequest` / `PreparePlanningNotificationResponse`。输入只有原完整通知引用
和 CallMetadata，不接受调用者自报的正文、context、actor、Turn 或完成结论；请求限 64 KiB。
Cognition 从真实完成评估/不可变目标形成基础通知表达，不调用模型或平台 IO。Worker 复验实际
原 Perception 的完整摘要、保留资格、上下文和隐私域，再让 Conversation 接纳稳定 Reply。

Reply 的 causation 指向原 Perception，保留实际 actor/隐私域，使用独立稳定通知 interaction；
不是伪造的新用户输入。正文限 16 KiB，完整内容限 64 KiB。只有实际 Log flush 完成后，才从
该 Reply 接纳已结束的内部 Turn（completed/revision=2）；普通已存在 Turn 不能被通知覆盖，
interrupted/failed 不复活。Reply 已提交而 Turn 插入失败/响应丢失时，原 identity 重试补确认，
不新增第二 Reply。内部 Turn 完成并不表示任何接收方已见到文字或听到声音。

响应 accepted=true 同时携原 request、持久 Turn/revision、原 Reply Moment/Log position、实际
Reply content 的排序键紧凑 UTF-8 JSON SHA-256、正文、完整 context、可选 actor 与隐私 owner；
响应限 256 KiB，position/revision 必须 JS safe。跨 await 后再次复验业务事实/实际来源，未知
引用/预算为 INVALID_REQUEST，持久绑定冲突为 RECOVERY_REQUIRED，来源不可读为
PERMISSION_DENIED，未 ready/owner 缺失/drain 为 NOT_READY，旧代为 GENERATION_MISMATCH。
取消/deadline/shutdown 等到实际 flush/commit/rollback 排空，不返回伪确认；已提交事实保留供原请求对账。

该操作是内部接纳，不是通知发布、外部权限、Delivery receipt 或源 ACK。Host client 已接真实
RPC，生产 CLI 双重启恢复同一 Reply/Turn/digest；默认监督仍显示通知 pending。App 后续必须
复验真实目的地与当前权限，再用唯一 Conversation Delivery 和实际接收回执完成源确认。

### Planning 通知真实回执源确认

`AcknowledgePlanningNotification` 在同一 Cognition Service 中接收原完整通知引用和
`PlanningNotificationDeliveryConfirmation`，后者复用 Surface 唯一 `DeliveryReceiptCommand`，
另绑定原 Turn、Reply Moment、Log position 与实际 content digest。请求限 64 KiB，只接受
`delivered` / `playback_completed`；sent、unknown、失败和播放开始均不是源确认。

可信 Host 的 `acknowledgeDeliveredPlanningNotification` 不接收调用者自报回执，而从实际
Conversation Delivery owner 查询已持久 confirmed receipt，核验原 output、Turn、摘要和
scene 目的地，再映射到 wire。已退出 owner 不能查询/确认；当前 owner 可读取前代真实历史
回执以完成对账，这不授权前代继续发送。此 RPC 仅供受管 Host→Worker 内部边界，不向 UI/
Extension 暴露；CallMetadata 代际/就绪检查不替代未来远端身份与权限认证。

Worker 只读已有真实 Reply/已完成 revision=2 的 Turn，核验完整通知引用、原因果/来源摘要、
输入摘要、Log position、全部 Turn context、正文摘要和 scene 目的地。ACK 不调用 Prepare，
不补造 Reply/Turn，不重新读取已删除源正文或重新获得发送许可。历史投递已发生且绑定仍有效
时，原来源后来不可读不抹去送达事实；新发送仍须独立验证当前来源/目的地权限。

Planning 在同一事务持久保存完整确认与首次接纳时间，保留原 outbox/业务 receipt；扫描只
返回未确认请求，越过已确认项后仍能找到后续分页。相同确认只忽略传输到达时间、保持首次
信封；同通知的回执身份、output、epoch/generation、已听范围或其他绑定漂移拒绝覆盖。
窗口版本/恢复纪律见[数据目录](./data-layout.md)。无原持久事实/业务绑定冲突为
RECOVERY_REQUIRED，非法组合/预算为 INVALID_REQUEST，缺 owner/停机为 NOT_READY，旧代
为 GENERATION_MISMATCH。取消、deadline、shutdown 排空实际 rollback；提交后响应丢失
保留原确认供同一请求重投，不再次评估或生成 Reply。

Host 的 `HostConversationRoutes` 现消费实际 Surface server stream 和同一 canonical
`DeliveryReceiptCommand`，按 provider/scene/conversation/continuity/thread/actor、隐私与
recall/disclosure owner 的完整域定向发送，不广播。可信 Host 身份适配器登记已认证接收方，
显式授予域绑定的 `conversation.receive` / `conversation.notify`；登记、每次写出和回执入口
核验当前 grant。主体/接收授权失效、撤权、断线或停机撤销实例，迟到回执不再接纳；
`character_internal` 不外送。域身份不含一次性 interaction，通知 frame trace 绑定原持久 Turn。

单 scene 只接一个实例，接收实例与在途输出各限 128，完整 wire frame 限 64 KiB。
write(false) 仍只算 sent，并等待 drain 后接纳下一项；无额外排队或自动重放。
queued/unknown、终态或旧 epoch 无真实确认时保持恢复待办，不再次发送。
回执只接纳该实例实际发送过的 output，复用 Delivery 的 epoch/generation 与完整事实验证。
当前 owner 可只读 `recordedOutput` 检查旧输出，不能借此继续前代写入。

配置 Host 可注入同一真实路由；Jobs 单 owner 有界前向扫描执行 Resolve → Prepare → 发送，
已有 confirmed receipt 再调用上述源确认 helper。各 RPC 返回后重验取消与当前 Host lease；
无接收方不创建新 Reply/Turn，短非空页继续前进直到空页回绕，首个无权限项不挡后续项。
历史确认无需新 grant/接收实例。已有实际 confirmed receipt 时自动链先调用只读
`GetPreparedPlanningNotification`，不经 Resolve/Prepare，也不重发或读取后来已不可用的原
Perception；无真实确认的新发送仍须完整来源解析/接纳和当前接收权限。

历史查询请求限 64 KiB，原 request 完整身份经 Planning work 校验；Worker 与 ACK 共用原
Reply/已完成 revision=2 Turn 的原因果/通知引用/输入/实际正文摘要、完整 context 和 origin
校验。响应的 `original` 复用内部接纳身份与原持久隐私域，`text` 留空，不能作为通知发送正文。
无 Reply 且无 Turn 时 original 缺席，不建立表/补造事实；只有一半或原事实损坏时为
RECOVERY_REQUIRED，缺 owner/停机为 NOT_READY，旧代为 GENERATION_MISMATCH，非法请求/
预算为 INVALID_REQUEST。查询参与取消/deadline/shutdown 排空，不调用模型、不源 ACK。
Host 快照扫描项并按唯一 Schema 比较完整通知引用，不只比较 notification ID；查询完成后
再次验当前 Host lease/取消，再由实际 Delivery helper 核验并提交历史确认。

真实本地 gRPC stream/command fixture 覆盖实际收发，生产 CLI fixture 覆盖配置 Host 自动
发送/回执源确认与重启去重；均不替代完整产品 UI/渠道认证验收。默认产品仍经旧 Kernel
入口，未注入接收路由或没有真实回执的通知继续如实 pending；远端认证与产品迁移门仍未完成。

### Planning 原 attempt 持久对账

`ReconcilePlanningJob` 复用 Jobs 唯一 `JobExecutionIdentity`，另携原源 `request_id`；请求总量
不超过 16 KiB，job ID 必须为 `planning:<request_id>`，身份字符串不超过 4096 UTF-8 bytes，
attempt/epoch/token/deadline 为正 JS safe integer。仅本代可信 App 可调用，缺 owner 为 NOT_READY，
非法 wire 为 INVALID_REQUEST，未 ACK 源、错绑定、scope/原 attempt 或持久 receipt 冲突为
RECOVERY_REQUIRED。该调用会封口，不是只读查询；推理未 ready/stopping 时仍可独立完成，
在途调用参与取消和 drain。取消/断连没有得到响应不能自行推断 not-applied，须重放原对账身份。

`PlanningJobResult` 保留查询身份、原请求、`cognition.planning`、接收端封口、观测时间和
确定性对账摘要。摘要按 IDL 指定的紧凑 UTF-8 JSON 计算，包含原 lease 与观测时间；摘要是
身份核对，不替代 gRPC generation/可信 App 边界或访问授权。响应不超过 64 KiB。not-applied
必须先由真实 Planning SQL 同事务 sealed，且禁止带 receipt；applied 必须带持久
`PlanningEvaluationReceipt`，其中实际提交 identity 不因新 attempt 查询而改写。
回执含承诺/revision、completed、受控证据 ID/owner/scope/revision/hash、理由和实际提交时间；
没有 source 正文。completed=false 仍是已接纳的评估，Jobs succeeded 不能替代目标完成。

Host 验原请求/承诺、查询 identity、摘要、原提交者、时间与证据组合后，交给 Jobs 唯一
reconciliation 事务；配置入口按独立有界分页恢复 Planning unknown，不复用 Memory receiver。
该恢复链不依赖模型或扩大权限，不假 ACK 状态事件；默认执行另经逐任务接纳闸。
状态接纳另经上述独立 inbox 链；通知与后继调度仍未完成。

## 生成与兼容

```powershell
pnpm contracts:generate
pnpm contracts:verify
```

`contracts:generate` 只从 canonical Proto 生成 `contracts/generated/{ts,python,csharp}/`。生成物只读，Domain/Application/Port 不得 import generated DTO、gRPC context 或 transport stub。

兼容基线位于 `contracts/compatibility/`：

- `proto-image.binpb` 是历史 `buf breaking` 参照，普通 Document 变化不得覆盖。
- `json-schema-baseline.json` 固定 Schema path、`$id`、dialect、owner、kind、compatibility 与 SHA-256。
- 有意评审 Document 变化后运行 `pnpm --filter @glimmer-cradle/contracts baseline:refresh:json-schema`。
- 只有同时有意重建 Proto 与 Document 两类基线时才运行 `baseline:refresh`。

`contracts:verify` 覆盖 inventory、Buf lint/breaking、JSON Schema dialect/fixture/compatibility、固定工具链、TS/Python/C# round-trip 与连续生成无 diff。工具链不依赖 BSR 或远程代码生成服务。

## 调用与错误语义

- Command 表达副作用请求；成功只表示方法承诺已经成立，异步流程必须返回可查询 operation。
- Query 只读取 owner 事实或 Projection，不产生业务副作用。
- Event 是已发生事实，不充当 Query 或 Command。
- Stream 必须有方向、取消、背压/流控和资源上限。
- Document 可独立保存、编辑与校验，不因为通过 RPC 传递就复制为 Protobuf 字段树。
- gRPC status 表达调用结果；领域失败使用稳定 typed detail，不解析自由文本 message。
- deadline/cancellation 必须传播并停止无用工作；不可安全重放使用稳定 recovery code/action/operation id。
- 每条边界延续 trace、causation/correlation、身份、权限、进程 generation 与 readiness 前置条件。

## Audio 媒体引用

`AudioMediaReference` 只携带受管 reference 元数据，不携带音频内容：owner、media type、size、SHA-256、expiry、access mode 与受控路径/lease id。ASR 输入为 `READ_ONLY`，TTS 输出为 `WRITE_ONCE`；Adapter 校验 root containment、权限、过期、长度与摘要。成功、typed error、timeout、主动停机和 crash 都必须回收 lane lease，引用过期后不能复用。

## Extension 与 owner-local projection

公开扩展只能依赖 `@glimmer-cradle/extension-sdk`。SDK 的 schema-derived TypeScript projection 服务于公开 edge，serialized Document 仍以 `contracts/json-schema/extension/v1/` 为准。Kernel、Desktop 与 Personal Server 各自维护领域模型或 view mapping；它们不得把 SDK public projection、generated DTO 或 UI state 复制成新的 canonical Schema。

## 变更顺序

1. 用限定 `rg` 找 canonical owner、生成物、producer、Adapter、consumer、测试和文档。
2. 修改 Proto Service、JSON Schema Document 或 Extension SDK public edge；内部类型留在 owner。
3. 明确 required/optional、默认值、unknown、错误 code、trace、权限与兼容语义。
4. 运行 `pnpm contracts:generate` / `pnpm contracts:verify`，Document baseline 只做有意 JSON-only refresh。
5. 按 producer → Adapter → consumer → view/log projection 更新，并覆盖成功与失败路径。
6. 搜索并删除旧字段、旧 import、手写镜像、compatibility bridge 与无期限 fallback。
7. 同步 Current、Implementation、Reference 和 Guide，再运行受影响 owner 与端到端门。

## 删除与验证门

- `Test-Path protocol` 必须为 false。
- runtime source、package manifest、workspace、lock、Docker/build/package 和模板不得依赖 `@glimmer-cradle/protocol`。
- `contracts/inventory.md` 的 Slice 9 ledger 必须逐 symbol 分类为 Document、Service edge、SDK public、owner-local 或 dead delete，并与冻结 inventory 对齐。
- 跨语言边界覆盖成功、缺字段、未知枚举、非法组合、typed error、deadline、cancellation、readiness 与 generation mismatch。
- 媒体另覆盖权限拒绝、过期、摘要、越界、崩溃清理和大数据不进入普通 RPC。

实现入口见 [Contract Spine 实现](../architecture/implementation/Protocol契约层实现.md)，配置字段见 [Configuration Reference](./configuration.md)，公开扩展见 [Extension SDK Reference](./extension-sdk.md)。

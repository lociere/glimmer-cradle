# Cognition Planning 实现

> 范围：长期承诺、证据评估、Jobs、通知与原 attempt 恢复；本页拥有相应当前实现细节，不表示产品迁移已接受。
> 事实依据：Core、Worker、Host/Jobs 的真实 producer/mapper/consumer 与对应测试。
> 维护触发：来源/权限、状态、持久化、接线或验证变化。

总入口与共享进程装配见 [Cognition 组件说明](Cognition认知核实现.md)，操作见 [Cognition 开发](../../how-to/Cognition开发.md)。

## 长期承诺与 Jobs 源请求

`planning/GoalVersion` 保存不可变 goal ID、scope、连续版本、语义和完成条件；`PlanVersion` 引用
该目标版本并保存不可变计划 ID/版本和 1 至 64 个语义步骤。普通模型回复与工具调用
不自动创建长期承诺。`PlanningController.accept_commitment()` 显式接受后，由
`SqlitePlanningStore` 在同一 IMMEDIATE 事务写入目标/计划版本、revision 1 的 accepted 承诺和
`planning.evaluate` 源请求；身份相同内容相同可重放，版本跳跃、scope 替换、目标版本回退、
既有内容或首次 due time 变化均拒绝，失败不留下部分版本/承诺。

源 request ID 为 compact UTF-8 JSON `["planning.evaluate", commitment_id, plan_id, plan_version]`
的 SHA-256；请求只携带原 scope、目标身份、due time 和版本引用，不把完成条件或平台指令交给 Jobs。
规范化持久信封上限 64 KiB，整数保持 JS safe 范围。`deliver_jobs()` 通过 App 注入的真实 `JobPort`
请求持久接纳，随后才在源 owner 确认；网络回复或源 ACK 丢失可按同一身份恢复，不跨远程 await
持有 SQLite 事务。同一请求不能绑定另一 Job，重复回执沿用首次接纳记录；请求 payload 被改写则拒绝 ACK。

长期表由首次显式接受原子建立，版本 1；普通 Worker 启动仍只恢复原 journal。未知版本、部分表或
孤立表失败关闭，不自动重建。历史 journal 只读、版本和源状态读写共享串行连接边界；取消等待回滚结束，
回滚失败撤销连接。数据与备份范围见[数据目录](../../reference/data-layout.md#用户状态与记忆)。

生产源接纳由 Worker `adapters/job_client.py` 的生成 DTO mapper、真实 Planning store RPC 和 Host
`PlanningJobSourceAdapter` 接通；正常生产 factory 注入实际 store，业务未 ready 或 drain 拒读写。
配置 Host 每轮有界扫描，Jobs 原子保存原 due/首次预算后 ACK；源接纳提交与响应前后中断均能
从真实 Worker/Jobs 重启恢复。独立字典 transport `JobClient` 并非此生产链路，不能据其存在
宣称通用 broker 完成。精确 wire 边界见[协议参考](../../reference/protocol.md#planning-jobs-源接纳)。

Jobs 接纳不把承诺标为 completed。默认 Host 注册真实 Planning handler 和独立 kind scheduler，
先调用逐任务只读接纳 RPC，再 CAS 原候选 revision；等待项不消耗 attempt、不改变 due/预算。
Host 分别以 `jobs_admission_pending`/`jobs_state_feedback_pending` 呈现本轮等待与待反馈 backlog，Memory
和 Planning 分 kind 投递到实际 owner。默认执行及状态接收已接真实 receipt/inbox；通知可注入
真实 Host 定向路由，下一次调度及撤销链路仍待接线，不认作完整长期承诺执行链路。

Core `PlanningController.evaluate_job` 已提供评估的业务接纳边界：先从真实源 outbox 核验持久
Job ACK、原 request/plan/goal/scope，登记原 attempt/epoch/token/owner/lease，再进入有界评估。
较新 authority/attempt 在等待模型锁之前登记并封口旧执行，不被旧模型阻塞；同 Job 已提交 receipt
跨重开/新 attempt 返回原事实，不重复评估。总在途请求最多 128，同 controller 的模型评估串行。

canonical `ports/job_port.py` 的 `PlanningEvidencePort` 只接收中立 goal ID/version、来源绑定、scope 与检索用
完成条件，不反向 import Planning。它要求 App 从实际 Conversation/Knowledge/Execution owner 收集有权限的
材料，返回 scope、修订、SHA-256 与真实文本，并复验当前访问资格；Worker 生产 Adapter 已实现，不能由模型
构造 evidence。Core 限最多 64 项、每项 16 KiB、总输入 64 KiB，拒绝跨 scope/重复引用/内容 hash
冲突，模型前后均复验。语义评估是 Planning 内部策略，不交给 Jobs 或外部证据 owner；
`ModelPlanningCompletionEvaluator` 经 ModelPort 根据接受的完成条件
做语义判断，材料只作为 untrusted/data 放入 user JSON，不进入 system 指令；没有工具/聊天回复
通路。输出限 16 KiB，严格拒绝重复键、非有限值、未知字段、非布尔 completed 和未提供的证据 ID；
completed 必须有支持条件的证据。引用检查不证明模型语义判断必然正确，真实 provider/任务质量
验收仍须后续生产评估；没有评估器不提供假成功 fallback。

`SqlitePlanningStore` 在一个 IMMEDIATE 事务中复验原输入、承诺 revision、接收端 high-water 与
lease，接纳 assessment receipt、承诺 revision + 1、completed=true 的通知引用和 applied attempt；最后 SQLite 写入再次检查
deadline。completed=false 的业务 receipt 只表示这次评估已接纳，承诺仍 accepted；Job success
不能代替它。receipt 仅保留引用/hash/评估理由，不复制证据正文。原 attempt reconcile 与提交共用
SQL 锁，空结果先持久 sealed 才证明未应用；取消等待独立封口完成，丢失提交响应恢复实际 receipt。
来源 live 复验是跨 owner 的采样，不宣称分布式原子权限事务或未来修订不会纠错；证据更正/撤销
后的语义重评与产品通知仍待后续链路。版本窗口与备份范围见上述数据目录。

原 attempt 对账现由同一 CognitionService `ReconcilePlanningJob` 接通真实 Planning store；
生产 factory 已持有该 store，不需要模型或证据 Adapter 来查询/封口。Worker 保持原查询 identity
与 receipt 实际提交 identity，Host `PlanningJobSourceAdapter.query()` 验证后交给 Jobs 唯一
reconciliation 事务；配置 Host 对 Memory/Planning unknown 分别有界分页。推理降级/stopping
不阻断独立封口，调用仍受 generation、取消和 drain 约束；否定证明不是空查询，断连也不证明
未应用。源/receipt/身份冲突不降为假成功，状态 outbox 仍保留待实际 Planning receiver 接纳。
字段、摘要和错误语义归[协议参考](../../reference/protocol.md#planning-原-attempt-持久对账)。

Worker `PlanningEvidenceAdapter` 在显式接纳时绑定真实持久 Perception 的 ID、完整 Moment 摘要和
当时 model tier；scope 来自实际 Conversation，不采信 wire 自报权限。原生 Perception 保存独立
`source_provider_id`，ACTION 验证真实父来源、provider/actor/隐私域并保留 privacy_class，
ACTION_RESULT 从原 ACTION 继承 provider。旧记录缺绑定事实不从 origin 猜测，也不自动升级资格。
证据只取同 provider/scene/conversation/continuity/thread、recall/disclosure owner 与 privacy_class
的实际 Perception/ActionResult，以及已接纳 config/受当前资源授权约束的 Knowledge。
候选 Conversation 最近 128 项，最多采用 48 项；全部材料文本合计限 24 KiB。Log 当前 recent 查询
内部仍会扫描 packs，此限制不是 SQL/存储 IO 上界。Knowledge 复验当前修订、hash、enabled；
资源还复验原 scope/principal/短寿命访问证明。配置资料不套外部 grant，但必须来自真实已接纳配置。

生产 factory 将同一实际 LLMEngine ModelPort 接入 `PlanningModelAdapter`；接受时与调用前后的
当前 tier 都必须 cloud_allowed，敏感来源不得送云。local_only/none 拒绝，不提供假本地 fallback。
即使空材料也复验政策；调用后撤权阻止提交，但不能撤回先前合法发送的数据，也不是分布式原子权限。
typed Accept/Execute RPC 与 Host `PlanningJobAdapter` 已接真实 store/controller/receipt，实际 TS Jobs
与 Python Worker 双库重启和响应丢失验证不重复评估；确定性模型 fixture 不代表真实 provider 语义质量。
`read_evaluation_work` 只读验证实际已 ACK 源/版本/范围，既不造 attempt，也不初始化评估窗口。
Worker `GetPlanningJobAdmission` 从实际来源和接受时/当前 tier 判断，模型未装配时保持等待；
未绑定旧版本拒绝扩权。Host 默认注册真实 handler 和接纳 scheduler，有界稳定 ID 分页绕过等待项，
异步检查后仅 CAS 原候选；执行另建 Adapter 复验，不缓存接纳作为授权。协议与等待 reason 见上述参考。
生产 CLI、实际 Perception/SQLite Log、同一 LLMEngine 与本地 HTTP 模型协议的测试覆盖默认调度及
completed=false/双库重启去重，仍不代表付费 provider 质量验收或产品入口切换。
Planning 状态接收已接 `PublishPlanningJobState`：复用 Jobs 唯一 `JobStateEvent`，不引入执行队列。
Worker 映射消费方 `PlanningJobFeedback`，store 在同一串行 IMMEDIATE 事务核验真实已 ACK 源、
goal/scope/request、投递 epoch 和实际评估 receipt，再保存独立版本 1 的 inbox/最新 projection。
结果比较保留 Struct 的安全整数语义，拒绝 bool 冒充数字、completed 非布尔、错引用或未知字段。
`succeeded` 必须逐字段匹配持久 receipt；取消/unknown 不抹去已提交评估，也不改写承诺状态。
旧/重复/迟到事件不回退 projection revision；旧投递主不能借 duplicate 复活，较新评估 epoch 同样
拒旧投递。queued 接收不建评估窗口、不调用模型；普通启动只核验既有状态窗口，不新增表。
配置 Host 独立投递 Planning kind，实际 inbox commit 后才 ACK，之后可按既有 retention 清理 Jobs
body；源/inbox/投影/评估 receipt 仍保留。ACK 前后丢失可双库重启恢复，状态失败不假 ready。
协议字段见上述参考，备份边界见数据目录。通知投递/回执已接可注入的真实 Host 路由，
未完成评估已持久产生下一次源请求；撤销 CAS 与原源取消 outbox 已接配置 Host。
完整产品消费与旧队列切换仍待后续任务。

完成通知的 Core 持久请求已落在既有 `planning/commitment.py`：`PlanningNotificationRequest`
引用原源 request/Job、实际 evaluation receipt、承诺 revision、不可变 goal ID/version/scope 与原
Moment ID/digest；不复制目标正文、证据或评估理由，不存目的地、人格、model-tier 或发送权限。
notification ID 为 `planning-completion.v1:<receipt_id>` 的 UTF-8 SHA-256；同 Job 的 receipt 恢复
不会再次评估或新增通知。completed=false 不生成完成通知，同事务产生后继评估源意图。

首次新的完成提交在同一 IMMEDIATE 事务创建独立版本 1 通知窗口并写入请求；最终 lease/deadline
失败、通知写失败或取消回滚连同 receipt/承诺/attempt 一起撤销。普通启动、分页读和既有 receipt
重放均不增建窗口，不给旧用户库的已完成记录自动补造通知；历史待办需要后续受控迁移。
`pending_notification_requests` 按稳定 ID 有界分页，允许越过暂不可投递的来源；读不消费请求。
`read_notification_work` 同一事务核验原请求、源 ACK、原计划与唯一 goal 版本、completed receipt、
承诺状态/revision，再返回原目标和原评估事实。伪造引用、事实漂移、非规范/未知字段或超预算
信封失败关闭，保留待办；这些 Core 只读事实不是 App 的隐私或外部发送资格。

通知读取/来源解析的生成 wire 与 Worker/Host client 已接线。Worker 复验实际 Conversation Log
的原完整来源/保留资格/context/隐私 owner；无绑定或来源不可用只返回原引用和原因，不披露
目标正文或 receipt。该 IO 采样独立于 model-tier，不调用模型或要求 Knowledge 装配；read/resolve
不改写或消费通知。Host 默认观察实际待办，无真实 receiver 时显示 `planning_notifications_pending`。
`PlanningController.notification_reply` 从同一真实完成 work 形成基础表达；Worker 的
Prepare RPC 让 Conversation 持久接纳稳定 Reply 和已结束的内部 Turn，返回原 Moment/position/
内容摘要与完整隐私域。它不调用模型或平台 IO，不在 Kernel 拼人格文本；同引用重启不重复形成
Reply/Turn，内部接纳仍不消费通知。原业务/来源在跨 await 后复验，外部发送资格不从历史 Reply 推定。
`PlanningNotificationDelivery` 接纳可信 App 从唯一 Delivery owner 查询的完整历史确认；Worker
复验原持久 Reply/Turn/位置/context/实际内容摘要，不调用 Prepare 补造事实。Planning 的
`acknowledge_notification` 同事务保存确认与首次时间，保留原请求，待办扫描越过已确认项。
重投保留首次信封，绑定漂移拒绝；部分/未知版本窗口不修复。历史 ACK 不重新获得发送权限，
也不因原来源后来不可读而伪造另一次发送。具体 wire 与边界见[协议参考](../../reference/protocol.md#planning-通知真实回执源确认)。
Host `PlanningNotificationAdapter` 现按有界前向页接实际定向 Surface 路由，完整接收域与显式
receive/notify grant 复验后才写出；背压不建立第二队列，sent 不确认，旧/未知输出不重发。
真实回执确认后默认 Jobs 链调用源确认 helper，历史确认无需新 grant；自动链现以只读
`GetPreparedPlanningNotification` 恢复原 Reply/Turn 身份，不读取后来不可用的原 Perception，
不补造事实、不返回发送正文。历史查询与 ACK 共用完整原事实验证，部分/损坏历史拒绝确认。
精确分页、预算、reason/error 与
生命周期见上述协议参考。未装配接收路由或缺接收方、撤权、取消、unknown 时保留请求；
完整产品 ingress 仍未切换，不能以 PublishAction/模型完成或空回调制造送达。
通知和评估/源状态一并保护，具体表与备份纪律归数据目录。

`SqlitePlanningStore.read_job_notification_states()` 在现有串行事务内按原 Job/scope 重建只读
通知元数据，复验完整通知/业务 receipt 与确认；不初始化状态窗口或追加推理。没有通知与尚未
ACK 的原源不制造 completed；真实确认与后来撤销两项事实同时保留。Worker 的独立投影 RPC
由唯一 IDL 生成，Host 公开 Jobs 路由在异步读取前后检查原 principal/grant/live epoch，拒绝
损坏身份、过大时钟和 self-reported 状态。此读取不调用 Prepare/发布/源 ACK，精确字段、
预算与错误语义归[Jobs 受控投影](../../reference/protocol.md#jobs-受控状态投影)。

承诺撤销以原 scope/revision CAS 更新 abandoned，封口正在评估的 attempt 并取消同一 Controller
中的模型任务；不可变计划、已有 receipt 和已送达历史保留。原源取消 outbox 在 Jobs 原 inbox
接纳/同步取消后才 ACK；尚未调度的源同样保留去重墓碑，unknown 先对账原 attempt，再封口，
晚到评估不能修改撤销 revision。历史通知从当前待办分离，原实际 Delivery 确认仍可只读对账。

通知 Prepare 只接纳内部历史，不授予发送许可。Host 实际接收/权限就绪后调用
`BeginPlanningNotificationPublication`，Planning 与撤销同一串行事务保存一次原输出的发布 owner。
撤销先提交则不允许发布；发布先提交则一次原发送已线性化，后来的撤销不伪报回滚。
同 owner 只沿原输出重试，Host Delivery 仍阻止重复/未知输出；换代只在当前实际 Delivery
证明未发送且原承诺未撤销时转交原许可，unknown 保留待对账。许可不代替 Host live lease/权限，
也不证明送达；字段与恢复限制见协议参考。

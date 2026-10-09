# Data Layout Reference

> 范围：源码资产、用户状态、模型、缓存、运行产物、日志、备份和第三方包的目录事实。
> 事实依据：`assets/`、`data/`、路径 resolver、Cognition persistence、Engine resource catalog、Desktop/Avatar/Extension 实现。
> 维护触发：目录移动、owner 变化、迁移策略、模型缓存、备份规则、ignore 规则、打包投影或 resolver 变化。

Local Data Domain 由产品或部署环境持有：正式产品通过 `GLIMMER_CRADLE_DATA_ROOT` 注入唯一数据根，源码开发未设置时回落到仓库 `data/`。业务 YAML 不声明 `data_dir` 或 `log_dir`，日志、状态、缓存、模型、包与工作材料只能由统一 resolver 派生，避免同一进程树写入多个数据根。Desktop main 通过 `products/desktop/src/main/project-paths.ts` 解析 application/data/config/installed-extensions 根，并派生 `state/`、`packages/`、`observability/` 等语义路径。Control Center、Avatar 诊断、扩展配置和体验预览都必须走这条 resolver 主线，而不是在 Electron main 任意拼接 `process.cwd()` 或源码相对路径。

## 顶层域

| 域 | 示例 | Git | 语义 |
|---|---|---|---|
| 源码 | `core/`、`products/`、`contracts/`、`engines/`、`native/` | 是 | 主产品构建输入和代码事实；扩展源码属于独立仓库 |
| 只读默认资产 | `assets/` | 是 | 随应用发布的默认资源源 |
| 用户状态 | `data/state/` | 否 | 不可随意丢弃的用户连续性 |
| 模型 | `data/models/` | 否 | 本机模型、用户导入模型、模型缓存 |
| 缓存 | `data/cache/` | 否 | 可删除、可重建的性能材料 |
| 工作材料 | `data/work/` | 否 | ASR 输入、导出中间产物、单次任务暂存 |
| 短生命周期协调 | `data/run/` | 否 | 动态端点、锁、PID 与代际信息；停机后无保留契约 |
| 可观测数据 | `data/observability/` | 否 | 应用日志、event、trace、metric、audit、模型调用观测、index 与 bundle |
| 第三方包 | `data/packages/` | 否 | 可重装的 Extension、SDK 和外部工具，不存放第一方构建产物 |
| 备份 | `data/backups/` | 否 | 迁移前快照和用户主动备份 |
| 第一方构建输出 | `build/` | 否 | components、packages、staging、reports 与 build logs，可完全重建 |
| 最终分发物 | `dist/` | 否 | Desktop、Personal Server 与公开 Package 的最终可分发输出 |

## 用户状态与记忆

Kernel composition 通过 resolver 打开 `${DataRoot}/state/conversation/delivery.db`，由 Conversation
唯一持久化输出/目的地世代与回执。可信 App 显式激活时建立独立版本 1 的
`delivery_authority_meta`（schema/current epoch）和 `delivery_retired_authorities`；退休 epoch
不允许重启重新激活。新实际回执同事务增建独立版本 1 的 `delivery_receipt_meta` 和
`delivery_receipt_facts`（原 envelope/Turn/content digest 的规范 JSON），与既有最小 receipt
索引/输出状态原子提交。完整事实限 64 KiB；普通打开不建这些窗口，不补造旧最小索引的证明。
旧库必须受控对账，未知/部分窗口、版本或绑定异常保留原材料并拒绝确认。这里只保存历史真实
接纳，不持有 Platform 租约、App 当前授权或第二份 Planning 通知状态机。
该库不是可重建缓存；备份须 drain 实际 publisher/回执处理，与 Conversation 原 Turn/Log、
Planning 通知、Jobs/authority 保持一致切点，包含完整 SQLite/WAL 快照。不可只回滚 outbox
或丢弃已退出 epoch/完整回执后重新发送。完整跨库恢复和路径迁移留阶段 14，本轮只验证临时库。

通知内部接纳不增加平行队列/数据库：稳定 Reply 与原来源/输入摘要引用仍在 canonical Log，
实际通知 Turn 仍在既有 `conversations.db` 的 `conversation_turns`。Reply flush 后才确认 Turn，
两库不声称原子提交；中间失败用原 ID/首次 Reply 补确认，不删除或改写原材料。该库的 History
表可重建，Turn 状态须保留，禁止整库删除后仅从 History 猜测完成。通知/Log/Turn/后续 Delivery
receipt 须与 Planning/Jobs/authority 一致备份，不能只恢复 Reply 正文或只清 Planning 待办。

生产 Kernel composition 通过 resolver 打开 `${DataRoot}/state/capabilities/execution.sqlite`，由
Capabilities 持久化，schema version 2、owner `0x47434558`。稳定 invocation/scope/key、请求摘要、
实际目标定义、授权、派发 owner/attempt、结果/副作用状态与未 ACK outbox 都是不可再生执行事实；
不保存原始输入正文。unknown 和 dispatched 不能解释为未执行，禁止删库/换 ID 后重跑。
第二连接打开不重置或接管旧派发；未知版本/foreign owner/部分表拒绝自动修复。备份须先 drain
实际接收方调用，再与 Conversation/Planning 等相关事实保持一致切点，包含 WAL 的一致快照。
schema 2 保存 Conversation ID/原 Action fact ID 引用；schema 1 拒绝隐式升级，阶段 14 受控迁移前
必须保存原结果及 outbox，不能为历史无引用结果猜测路由。Conversation durable receipt 已接线，
实际接受与刷盘后才 ACK；即使接收方已提交而 RPC/ACK 丢失，也按原 identity 重投，不得清理
pending outbox 或重新调用工具。备份还需包含原 Action 和已接纳结果的 Conversation Log。
目标 Host Resource 读取同样消费上述 Core Execution journal，不新增平行执行事实库；路径与
Store 由装配方显式注入并拥有，须在 Resource controller/outbox drain 完成后关闭，不与旧
Kernel 同时写同一执行库。Host grant 是本实例短寿命能力，不落入该库成为持久用户授权；
重启须重新授权，尚无 Host Resource 跨重启 outbox 后台投递/恢复装配。精确边界见
[能力实现](../architecture/implementation/Extension与SkillPlane实现.md#目标-host-resource-授权与读取)。
完整跨 owner 恢复、
外部对账与产品安装验收留阶段 14/15；本候选只操作临时测试根，未迁移用户原库。

Host `SqliteAuthorityStore` 接受显式 authority 数据库路径，schema version 1、owner 标记
`0x47434155`，保存按 aggregate 的 epoch/token、owner、expiry/revision/status 和完整 handover
准备/确认记录。未知库、其他 owner 或不兼容版本拒绝打开，不删除或重建；确认和新租约同事务提交。
该状态由 Platform 机制拥有、Host Adapter 持久化，不是 RunRoot 锁或可重建缓存。
`HostDataPaths` 已由配置启动入口使用 `${DataRoot}/state/platform/authority.sqlite`；真实生产 Worker
CLI 的局部配置装配测试使用临时 DataRoot，不代表产品默认入口或生产用户库已切换。
备份/恢复必须保持 authority、Jobs/Memory 与待确认事实的一致切点；
禁止单独丢弃/回滚 authority 后用重复启动重算序列，Host 已拒绝 authority 缺失或落后既有 Jobs 的情况。
完整跨 owner 恢复验证仍归阶段 14，不能仅凭新库初始化宣称恢复可用。

配置启动入口拥有 `${DataRoot}/state/jobs/jobs.sqlite` 的 `SqliteJobStore`，但尚未由产品默认
Host 创建生产用户库。其 schema version 4/owner 标记、Job/lease/原 attempt、
对账证据摘要、待 ACK 状态 outbox 与去重 tombstone 独立于 Memory；retention 不删除未投递事件或
unknown，清理终态后仍保留最小身份/审计。`job_source_receipts` 同事务保存 producer/request ID、
源与业务摘要、稳定 Job ID、首次 due/预算和接纳时间，不复制领域 payload；终态 body 清理不删除
源快照，重投用首次政策验证原 tombstone。旧候选 v1/v2/v3 拒绝隐式升级，不能对旧 Memory 数据库
直接应用 Jobs migration。产品入口切换、备份切点和跨库恢复仍须后续验证，参见
[迁移地图](../roadmap/initiatives/architecture-v2/migration-map.md)。

`HostDataPaths` 要求 AppRoot、ConfigRoot、DataRoot 均显式绝对路径，不读环境变量、cwd 或
创建目录；配置启动 owner 在全量配置和恢复预检后打开两库，实际 Worker/Jobs drain 完成才关闭，
失败不重建或删除原数据。配置路径与默认值见[配置参考](configuration.md#目标-host-与-jobs-配置)。
Worker console 派生为 `${DataRoot}/observability/logs/application/cognition.console.log`，属于现行
可观测路径兼容窗口；阶段 14 与日志 consumer 一同切换。测试在独立安装根放入真实 Cognition
SQL migration 并核对启动/重启前后资源摘要不变；尚未证明完整安装制品或操作系统只读 ACL。

现行 Memory 新库 schema 为 6，数据路径不变；共享异步 SQLite 连接的事务、读取隔离、取消回滚和初始化
由 `SqliteMemoryStore` 统一持有。业务结果 receipt 与修订/evidence 同事务持久化，详见
[认知核持久化实现](../architecture/implementation/Cognition认知核实现.md#记忆经历与持久化)。
原 Jobs attempt 的接收资格、authority 和封口证据也在此库持久化，结果接纳与业务 receipt 原子提交。
`memory_consolidation_dispatch` 保存受监督装配的 legacy/external 单向选择，未完成旧队列拒绝转交，
外部绑定或已有外部 attempt 拒绝回退旧队列；旧 writer 在其写事务内检查该屏障。它不持有 epoch/lease，
不代替 Jobs authority；旧队列退出时连同该迁移窗口受控删除。
旧 v3/v4/v5 库拒绝隐式升级，必须保留迁移前备份并按阶段 14 受控迁移；本切片没有改写用户库。
此接收边界不代替跨库 request outbox，也不意味着旧 `consolidation_jobs` 已迁入 Jobs。

外部 Memory 状态接收在现行 `episodes.db` 同事务持有 `memory_job_feedback_inbox`（event ID/内容摘要）
与 `memory_job_projection`（原源/Job、revision/epoch、最新状态、receipt 引用、时间和 business_outcome）。
Jobs 是状态事实源，该投影不拥有 schedule/lease；`business_outcome=committed` 必须有实际 Memory
receipt，缺少 receipt 只记 `unknown`，不能解释成未执行。较低 revision 只完成历史 inbox 接纳，
不覆盖最新投影；取消不擦除已提交结果。首次显式 external 状态 RPC 原子创建这组兼容扩展和
`projection_meta.memory_job_feedback_schema=1`；legacy 启动不添加它们。未知版本、缺失部分表或
无标记的既有表拒绝自动修复，原数据保留。`memory_job_delivery_epoch` 只保存已观测投递 high-water。
Jobs ACK/retention 后这里的最小接收事实不能随意删除；与源 outbox、Memory receipt 一同纳入阶段 14
一致备份和受控迁移。当前候选只操作临时测试数据，未改写生产用户库。

Planning `planning.sqlite` 保留既有 `planning_decision` journal。首次显式接受长期承诺才在同一
事务建立版本 1 的 `planning_long_term_meta`、`planning_goal_version`、`planning_plan_version`、
`planning_commitment` 和 `planning_job_outbox`；普通 Worker 启动不增加长期表，旧 journal 不改写。
目标/计划不可变版本、语义完成条件、承诺 revision 和源投递身份均为不可再生状态；Jobs 接纳后
仍保留首次请求、Job ID/revision 和 due time，不因 ACK 删除或重建。未知版本、部分表或孤立表拒绝
自动修复，原数据保留。备份/恢复须在 Planning drain 后与 Jobs/authority 建立一致切点，不允许
只回滚源请求重新生成承诺。配置 Host 已真实接纳源到 Jobs，源 ACK 只结束投递，不修改承诺
状态；接纳等待的 queued Job 与未 ACK 状态仍须备份，不能按“未执行”丢弃。
首次显式评估/对账已被源 ACK 接纳的 Job 时，在同一事务增建独立版本 1 的评估窗口：
`planning_evaluation_meta`（schema/authority epoch/已观测时钟 high-water）、
`planning_evaluation_attempt`（原 attempt/owner/token/lease、输入摘要、active/sealed/applied 与 receipt 引用）、
`planning_evaluation_receipt`（每 Job 唯一的业务评估、承诺 revision、证据引用/hash，不复制正文）。
普通启动只核验已有窗口，不建表；长期 schema 1 与历史 journal 不变。这是明确功能操作的增量
初始化，不隐式升级既有版本；未知/部分/孤立窗口拒绝自动修复。封口、receipt、authority 和时钟
high-water 同属不可再生状态，不能只删除 attempt 后重放模型或回滚时间复活过期 lease；其一致
备份须与整个 Planning/源 outbox/Jobs 共同保护。评估已接生产 Worker/Host Adapter 与默认接纳
scheduler；只读接纳不建评估表/attempt 或修改 high-water。未操作用户库。
首次显式状态接纳另外建立独立版本 1 的 `planning_job_feedback_meta`（schema/delivery epoch）、
`planning_job_feedback_inbox`（event ID/完整 wire digest/原源 request）和 `planning_job_projection`
（原 request/job、最新 revision/原 job epoch/status、真实 receipt 引用、updated time/business outcome）。
queued 状态不建评估表或改变承诺；普通启动只核验既有窗口，未知/部分/孤立窗口拒绝自动修复。
评估 epoch 与反馈 delivery high-water 都拒绝旧投递主；inbox/投影/源与实际评估 receipt 一并备份。
Jobs outbox ACK 后可清 body，但上述最小接收事实不能删除来“重置”投递；当前仅验证临时库。
首次新的 completed=true 评估提交再增建独立版本 1 的 `planning_notification_meta` 和
`planning_notification_outbox`（notification ID、唯一实际 receipt/source request 引用与规范 JSON）。
请求与业务 receipt/承诺/attempt 同事务接纳，通知信封上限 64 KiB；只保存不可变目标/来源绑定
引用，不复制证据正文或评估理由。completed=false、普通启动、只读分页或旧 receipt replay 不建表，
旧已完成记录不自动补发。未知/部分/孤立/结构异常窗口拒绝自动修复；没有真实投递 receiver/ACK
之前请求一直保留，不因 Jobs body retention 或业务完成删除。通知不可再生事实须随整个 Planning、
Conversation 原来源及后续实际 Delivery 接收事实建立一致备份切点，不能只回滚 outbox 重新发送。
首次显式接纳真实 Delivery 确认才增建独立版本 1 的 `planning_notification_delivery_meta` 和
`planning_notification_delivery_receipt`（原 notification ID、唯一回执 ID、完整规范 JSON、首次
acknowledged_at_ms）。原 outbox 不删除，业务评估/承诺不改写；待办扫描排除已核验确认的
请求。相同语义重投保留首次完整信封，忽略传输到达时间；绑定漂移拒绝覆盖。普通启动/读取
不增建窗口或补造历史送达，部分/未知版本/结构与事实损坏 fail closed，不自动修复。
该表是 Planning 接纳的确认记录，不替代唯一 Conversation Delivery writer/回执事实源，
不证明当前发送权限；跨库不是原子事务，实际回执先提交、源 ACK 后提交，响应丢失沿同一
完整确认重投。备份必须覆盖上述两窗口、原 Reply/Turn、完整 Delivery 和 authority 切点。
新接纳 GoalVersion 增量保存 `source_moment_id`、`source_digest` 和 `model_tier`，三字段必须完整；
digest 为真实完整 Moment 的排序键紧凑 UTF-8 JSON SHA-256。旧不可变版本缺三字段时保持原 JSON
与 active work 摘要字节语义，不改写 schema 1，也不补造权限；新绑定必须是显式新版本。
来源仍由 Conversation Log 拥有，备份必须保留实际锚点，不能仅恢复摘要后假称材料可用。
完整产品恢复仍归阶段 14。本候选只使用临时测试数据，未迁移用户库。

| 路径 | owner | 说明 |
|---|---|---|
| `data/state/cognition/experience/catalog.db` | Conversation（兼容路径） | Conversation Log 全局 position、pack 范围与单写者目录；物理迁移留阶段 14 |
| `data/state/conversation/delivery.db` | Conversation Delivery | 输出/目的地世代、当前和已退出 epoch、状态与完整回执/原 Turn/内容摘要绑定；不可单独删除重建 |
| `data/state/cognition/experience/packs/YYYY/YYYY-MM.experience.db` | Conversation（兼容路径） | 月度不可变 Moment、来源、因果与检索索引；物理迁移留阶段 14 |
| `data/state/content/assets/<asset-id>/{blob,metadata.json}` | Kernel / Content | 不可变原始媒体；随机 ID、媒体类型、字节数和 SHA-256，随 Experience 一起备份；Cognition 只读校验 |
| `data/state/cognition/memory.sqlite` | Cognition | 当前 Worker composition 的 Memory、revision、evidence、巩固结果 receipt/input 索引、relationship、intention 与 embedding；Knowledge 使用独立 owner 库 |
| `data/state/cognition/knowledge.sqlite` | Cognition Knowledge | 配置 Vault 与显式 Resource 来源/采集、原始材料/权限时效/parser/chunk provenance、不可变正文修订和派生向量；owner `0x47434B4E`、schema 2，v1 只允许先备份的显式迁移，不隐式修复或导入 |
| `data/state/cognition/planning.sqlite` | Cognition Planning | 旧决策只读 journal；长期目标/计划版本、完成条件、承诺状态与 request outbox/接纳；显式评估的 receipt、attempt fencing/封口、high-water、新完成通知引用与真实回执源确认 |
| `data/state/cognition/conversations/conversations.db` | Conversation（兼容路径） | 可重建 History 表与必须保留的持久 Turn 状态/输入摘要；不可整库当缓存删除，路径迁移留阶段 14 |
| `data/state/cognition/projections/episodes.db` | Cognition Memory | Episode 派生投影、checkpoint 与同事务源请求 outbox；存在请求时不可整体删除重建，必须备份并保留原投递身份 |
| `data/state/kernel/kernel.db` | Kernel | Kernel 基础设施库，只保存 Host/Extension 基础设施状态，不保存角色会话或认知记录 |
| `data/state/capabilities/execution.sqlite` | Capabilities Execution | invocation/授权/派发/结果与待 ACK outbox；不是可重建的诊断缓存 |
| `data/state/avatar/action-state.json` | Avatar/Desktop main | 手动动作的最后接受状态；唯一磁盘字段为 `active_action_ids: string[]`，Desktop 启动时读取，Avatar Host 上报后校正 |
| `data/state/desktop/avatar-presentation.json` | Desktop/Electron main | Avatar 模型选择、显示倍率和 Desktop Surface 呈现偏好 |
| `data/state/desktop/avatar-placement.json` | Desktop/UnityAvatarHost | Native Composition 窗口位置；由 Kernel 注入唯一状态路径 |
| `data/state/extensions/` | Extension Host/各扩展 | 扩展自己的状态域，不能写 Cognition 私有库 |
| `data/state/extensions/lociere.napcat-adapter/napcat/` | NapCat adapter | NapCat 工作目录；保存 NapCat 配置、日志、插件和 cache，程序包升级时不覆盖 |

Cognition 进程内使用的 `ConversationWorkingSet` 是从 `conversations.db` 恢复的有界缓存，不拥有历史事实。长期聊天记录由 Conversation Log 派生到 History Store，Kernel 和 Renderer 都不维护平行对话事实源。Control Center 分开展示 Conversation 消息、Log Moment、Episode、活动 Memory、revision、evidence 和角色知识；Renderer 只消费 Desktop main 生成的只读投影。

Knowledge 正文/修订不可整体删除重建，备份必须包含独立库。派生向量失效与正文修订同事务，
Resource 来源声明保存 enabled；停用原子 tombstone 当前正文/失效向量，不删除来源或采集历史。
schema 2 历史材料省略该字段时保持当时的启用语义，不回写不可变采集；新来源管理 wire 要求
显式 presence。Host 审批属于 ConfigRoot/system/host.yaml，不在 Knowledge 库复制 grant 或审批政策。
具体持久与检索规则见 [Cognition 实现](../architecture/implementation/Cognition认知核实现.md)。
既有未版本化 Knowledge/旧 Memory 知识表保持原状；新 owner 拒绝隐式迁移，不以空库或重新注入
配置代替不可再生历史恢复。实际用户库迁移、跨库备份与最终路径切换仍归重构阶段 14。

### Knowledge v1 受控迁移与恢复

仅适用于已核验 owner `0x47434B4E`、version 1 的独立 Knowledge 库，不导入旧 Memory 表。
先停止 Host/Cognition Worker 及所有该库 writer，保护现有库和备份；通过当前产品路径 resolver
取得绝对库路径，并在 `data/backups/` 选一个不存在的备份路径。可信维护代码调用：

```python
store = SqliteKnowledgeStore(database_path)
await store.migrate_v1(backup_path=backup_path)
await store.connect()
await store.close()
```

API 不在正常 connect 或 Worker 启动中执行。只接受完整 v1 表/列与 integrity check；持写锁
期间通过 SQLite backup 获取完整恢复副本，再在同事务添加两张 Resource 表和 version 2。
原配置正文、修订、tombstone、向量不改写；已有备份、同路径、foreign/未知/部分库均拒绝。
迁移 SQL/引用/提交失败回滚原库，保留备份；取消先等待线程收尾再释放 owner。失败时核验
库 header/quick_check、备份完整性与错误，不删除原库或以重新注入配置冒充恢复。

恢复须保持所有 owner 停止，先另存迁移后的库及关联 journal/WAL 材料，再将完整 v1 备份恢复
到原库路径；使用与 v1 匹配的旧候选，或重新按此流程迁移，不能让 v2 Worker 假装支持 v1。
恢复核对正文/历史修订/向量及库 owner/version，源事实正确后再启对应候选。库内 Resource
证明绑定旧 Worker 主体，重启不自动授权，仍须 Host 接纳/双 grant 和新的显式采集。

Desktop main 从 `conversations.db` 读取最近会话记录，从月度 Conversation Log packs 聚合最近 Moment，从 Episode projection 读取分段状态，从 `memory.db` 读取当前 revision、evidence 与巩固结果统计。Control Center 必须区分待巩固、巩固完成但无长期记忆、巩固失败和活动记忆，也不能把预览结果解释为实际 Prompt 召回。

`data/state/desktop/` 只能保存 Desktop/Electron main 拥有的界面偏好，例如窗口、Avatar 呈现和用户可恢复的 UI 选择。它不得保存对话历史、会话摘要、线程状态、活动上下文、经历记录、长期记忆或 Avatar 动作事实。此类连续性数据必须由 Cognition、Kernel、Avatar 或 Extension owner 写入各自状态域，再通过受控 projection 提供给 Renderer 展示。

扩展运行健康不由 Renderer 推断。扩展如需暴露内部链路状态，必须通过 SDK `runtime` Host Port 上报 Capability Graph 节点、边、action intent 和 diagnostics，由 Host 合并成 `ExtensionRuntimeProjection` 后推送给 Desktop；`extension_storage` 只保存扩展私有 K/V，不再作为 Control Center 运行事实源。第三方包、外部进程、本地服务、设备和协议连接都必须通过 contribution point definition/registry 进入 Capability Graph；静态声明只能提供 owner、依赖和 readiness gate 输入，不能代替扩展内部的协议连接、登录态、管理面板等分段健康事实。

## 角色配置与知识

| 路径 | owner | 说明 |
|---|---|---|
| `configs/characters/<character-id>/character.manifest.yaml` | Cognition config | 角色包身份、最小名称锚点、persona mode 与目录声明 |
| `configs/characters/<character-id>/profile.yaml` | Cognition config | Character Package 作者种子，不进入 RAG，不写入向量库 |
| `configs/characters/<character-id>/dialogue.yaml` | Cognition config | 对话呈现策略，不承载人格事实 |
| `configs/characters/<character-id>/safety.yaml` | Cognition config | 红线和安全边界 |
| `configs/characters/<character-id>/voice.yaml` | Character voice | 稳定声音身份和 provider 声线绑定；不含密钥与系统路由 |
| `configs/characters/<character-id>/knowledge/index.yaml` | Cognition knowledge | Knowledge Vault 索引，正文来自同目录 `*.md` |

Character Package、Conversation Log、Knowledge Vault、Memory Substrate 与 Vector Index 分工不同。Log 是持久交互事实源，Memory 保存版本化认知状态，逻辑 Episode/embedding 是派生投影；当前 `episodes.db` 同库保存不可再生的源 request ID、输入摘要与接纳身份，不能整体删除。其重建/迁移必须保持原 Episode/version 与 outbox 身份，备份要包含该库；窗口归 Cognition Memory，阶段 14 通过原身份重建、outbox 恢复和 consumer-zero 门后切换最终状态布局。任何一层都不能反向改写 `profile.yaml` 或 `dialogue.yaml`。

## 模型与官方 Engine

| 路径 | 说明 |
|---|---|
| `data/models/asr/funasr/` | FunASR/ModelScope 模型缓存 |
| `data/models/voice/` | TTS 模型、用户导入声线、训练整理副本 |
| `data/cache/audio/tts/` | TTS 合成缓存，可按文本/provider 复用 |
| `data/work/audio/asr/` | Control Center 上传或录制的 ASR 临时输入 |
| `data/work/content/staged/`、`data/work/content/uploads/` | Kernel 分块上传与落盘暂存；失败清理、30 分钟过期，不作备份 |
| `data/work/content/transient/assets/` | 当拍媒体租约；感知终态释放，异常残留按 30 分钟清理，不作备份 |
| `data/work/desktop/screenshots/` | Desktop 屏幕技能生成的 PNG；调用返回路径与尺寸，用户按需保留或清理 |
| `data/packages/skills/<name>/SKILL.md` | 用户安装的指令技能；格式和配置见[配置参考](configuration.md#用户指令技能) |
| `data/packages/managed-resources/lociere.napcat-adapter/napcat/` | 本机托管 NapCat 程序包；可重装，不保存扩展连续性状态 |
| `data/packages/extensions/<id>/<version>/` | 已安装扩展发布物；版本可并存，由 active config 精确选择 |
| `engines/audio/src/glimmer_cradle/audio/resources.json` | 官方音频资源 catalog，不是用户模型目录 |

模型准备是能力 readiness 的一部分，不是第一次业务请求的副作用。模型缓存和第三方包不进入 Git；缺失时进入资源检查、下载、degraded 或失败诊断。Audio 模型与云端连接由 Audio Engine 自检并投影 provider 状态；Avatar、Native 的 Kernel 侧文件/目录资源仍走统一 resource resolver。

Extension 受管资源的 console 输出归 `data/observability/logs/application/extensions/<extension-id>/<resource-id>/`。该目录由 Host projection 暴露给 Control Center；Renderer 不通过扫描日志判断扩展是否 ready。

## Avatar 资产与投影

| 路径 | 说明 |
|---|---|
| `assets/avatar/avatar-packages/*/avatar-package.json` | Avatar Package 事实源，声明 character/model、backend、Live2D 资源、动作、行为和 presentation |
| `hosts/unity-avatar-host/Assets/StreamingAssets/avatar-package-registry.json` | 根据 Avatar Package 同步生成的 Unity 投影，不手改 |
| `hosts/unity-avatar-host/Assets/Resources/AvatarModels/` | Unity/Cubism 导入投影，不入 Git |
| `build/components/avatar/unity-host/` | UnityAvatarHost 第一方构建投影；打包时进入应用资源，不属于用户数据 |

私人模型、贴图、`.moc3`、prefab 和 SDK 导入产物不得进入提交。正式身体是否可用由 catalog、SDK、模型 driver 和首帧 ready 决定，不由文件是否存在单独决定。

## 可观测目录

| 路径 | 内容 |
|---|---|
| `data/observability/logs/application/` | 第一方应用日志和受管进程 stdout/stderr |
| `data/observability/logs/events/` | 结构化运行时事件 JSONL |
| `data/observability/traces/` | trace/span 文件或导出 |
| `data/observability/metrics/` | metrics snapshot/export |
| `data/observability/logs/audit/` | 高风险副作用审计记录 |
| `data/observability/model-invocations/records/` | 模型调用摘要记录 |
| `data/observability/model-invocations/captures/` | full 模式下受控、脱敏的完整模型输入输出 |
| `data/observability/index/` | 诊断查询索引，例如 `observability.db` |
| `data/observability/bundles/` | 诊断 bundle 导出目录 |

可观测数据不等于用户记忆。日志可以轮转和清理；记忆和经历需要显式迁移与备份。

未列出的无 owner 容器目录不属于当前契约。大对象必须由明确 owner 归入 `state/`、`models/`、`packages/` 或 `work/`；短生命周期协调信息只能进入 `run/`，短生命周期处理材料只能进入 `work/` 或操作系统临时目录。

开发态和便携部署默认使用 `data/run/`。正式 Desktop 可将 RunRoot 映射到应用用户域；Linux Personal Server 的持久态和运行态都按 owner 对称分域：`/var/lib/glimmer-cradle/host/` 与 `/run/glimmer-cradle/host/` 由 root-owned 宿主事务 owner 持有，`/var/lib/glimmer-cradle/service/` 与 `/run/glimmer-cradle/service/` 由 UID 10001 服务持有。只有 service 配置、数据和 IPC 被投影为容器内规范 `/var/lib/glimmer-cradle/{config,data}` 与 `/run/glimmer-cradle/`；业务代码不感知宿主目录布局。宿主事务备份和部署诊断不能进入 service-owned 父目录。

## 迁移规则

1. 先识别不可再生状态：Cognition DB、用户导入模型、扩展状态、外观偏好、人工备份。
2. 迁移前写入 `data/backups/` 或用户指定备份位置。
3. 迁移必须把旧入口一次性转成当前 owner 的正式状态目录，完成后删除旧入口读取代码。
4. 完成后更新 resolver、ignore、Reference、Guide，并搜索旧路径。
5. 缓存可删除重建，但删除缓存不能代替状态迁移。

操作见 [数据迁移与恢复](../guides/operations/数据迁移与恢复.md)，部署映射见 [Packaging Layout Reference](./packaging-layout.md)。

Personal Server 将部署备份域固定为宿主 `/var/lib/glimmer-cradle/host/backups/<kind>/<UTC timestamp>/`。每个部署备份包含 `config.tar.gz`、`data.tar.gz`、`SHA256SUMS` 与事务元数据；`glimmer-cradle backup` 和 `restore` 是唯一受支持的宿主备份恢复入口，恢复不接受备份域外路径。它与应用 owner 可使用的 `data/backups/` 不是同一目录或权限域。

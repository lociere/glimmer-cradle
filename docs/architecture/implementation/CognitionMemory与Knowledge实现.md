# Cognition Memory 与 Knowledge 实现

> 范围：经历、记忆、知识来源、索引失效、巩固与 Jobs 接线；本页拥有相应当前实现细节，不表示产品迁移已接受。
> 事实依据：Core、Worker、Host/Jobs 的真实 producer/mapper/consumer 与对应测试。
> 维护触发：来源/权限、状态、持久化、接线或验证变化。

总入口与共享进程装配见 [Cognition 组件说明](Cognition认知核实现.md)，操作见 [Cognition 开发](../../how-to/Cognition开发.md)。

## 记忆、经历与持久化

| 组件 | 实现位置 | 语义 |
|---|---|---|
| Conversation Log | `core/conversation/src/glimmer_cradle/conversation/log/` | 交互事实的不可变 Moment、月度 SQLite pack、全局 position、来源与因果；Cognition 只读消费 |
| Conversation Projection | `core/conversation/src/glimmer_cradle/conversation/{messages,history}/` | Conversation owner 的可重建消息、Chapter、Segment、Conversation State 与进程 Working Set；Cognition Worker 只负责组合与消费 |
| Episode Projection | `adapters/persistence/sqlite_memory_store.py` 的 `EpisodeProjection` | 分段、封口与派生 checkpoint；同库持久源请求钉住 Episode 身份，不能整体删除重建 |
| Memory Controller | `memory/{memory,memory_controller,memory_store,provenance,correction}.py`、`adapters/persistence/sqlite_memory_store.py` | 版本化记忆、证据、时间有效修订、纠错与有预算召回 |
| Consolidation | `memory/consolidation.py`、`adapters/persistence/sqlite_memory_store.py` 的 `ConsolidationJobRepository` | 持久任务、权限域分批、结构化推理、证据校验、lease 与重试；Job adapter 待迁入 Jobs owner |
| Relationship | `adapters/persistence/sqlite_memory_store.py` 的 `RelationshipProjection` / `RelationshipRepository` | 从 Conversation Log 幂等派生互动计数、熟悉度与证据修订 |
| Knowledge | `knowledge/`、`adapters/persistence/sqlite_knowledge_store.py`、`migrations/003-knowledge.sql` | 来源受控、版本化、可失效的知识条目与独立索引 |
| Vector | `adapters/persistence/sqlite_memory_store.py` 的 `VectorRepository` | 按 provider/model/dimension 隔离的可重建 embedding 索引；默认不启用 |
| Memory Database | `adapters/persistence/sqlite_memory_store.py`、`migrations/002-memory.sql` | `data/state/cognition/memory.sqlite`；Job/checkpoint 表仍处于拆库迁移窗口 |

### Knowledge 来源与持久化

Knowledge 由独立 `KnowledgeStore` 拥有正文/修订与派生向量，不复用 Memory 的 VectorIndexStore。
当前 `knowledge.sqlite` 的 application_id 是 `0x47434B4E`，user_version 是 2；初始化判定、DDL 与
schema metadata 共用 IMMEDIATE 事务，双连接首次打开不会竞争建表。已存在的未版本化、foreign、
未知版本或部分库只拒绝打开，不隐式建表/修复/导入旧 Memory。v1 只允许停止 owner 后显式调用
`SqliteKnowledgeStore.migrate_v1(backup_path=...)`，先创建新的完整备份再原子增加 Resource 表；
普通 connect 不升级。实际用户库与跨库迁移仍归阶段 14，操作与恢复见
[数据布局](../../reference/data-layout.md#knowledge-v1-受控迁移与恢复)。

配置条目内容、priority、enabled 的实际变化才追加修订；相同输入重放不递增。配置删除/独立删除与
对应向量失效同事务，editor 删除保留条目原来源 owner，历史修订记录实际操作来源。向量接纳绑定
entry ID/revision/正文 SHA-256、模型身份和 `trim-text/whole-entry.v1` 索引单元转换版本；一条配置正文
是一条索引单元。Resource 采集另存实际 parser/chunk 版本，见下文。读写、回滚、关闭串行化，模型编码
不持有 SQL 事务；迟到向量重验来源修订，回滚失败撤销连接，重复取消先完成清理。

`KnowledgeIndex` 每次实际检索重读当前条目，编码后再次过滤更新/删除/禁用项；进程缓存只是最近
诊断快照。有效向量可在重开后复用，损坏向量或部分编码失败降级基础检索，不丢弃未索引的有效正文，
也不重写来源事实。`KnowledgeSource` 与默认 `ReplyContextBuilder` 传递当前修订/hash/转换版本；
数据仍为 untrusted/data，配置来源和索引版本不提升人格、权限、指令 authority 或 Resource freshness。

Worker ResourceClient 已实际实现 consumer-owned ResourcePort 的显式采集/活跃证明复验，使用
唯一 generated CapabilityService 和受监督 metadata；普通模型加载 snapshot 没有采集证明。
Host 双 grant/IO 接纳与有限 freshness 详见
[Knowledge 采集边界](Extension与SkillPlane实现.md#knowledge-显式资源采集边界)。生产 Worker
composition 注入本代 `cognition:<generation>` 主体及 ResourceClient；Core 不读取进程环境。

可信 App 通过 `KnowledgeIndex.register_resource_source` 显式登记 `KnowledgeResourceSource`，
绑定 source ID、Resource ID/定义 revision、完整 provider/scene/conversation scope 或明确 global、
priority、enabled。登记不是授权，模型没有此管理入口。`collect_resource(source_id)` 读取已经登记的意图，
实际调用 Port，验证真实 UTF-8/hash、双授权证明与本代主体，转换后在提交前/后复验 live 证明。
SQL 接纳同时比较来源声明 revision 和 entry revision；过时采集不能覆盖新的声明或正文。
RPC/模型 await 不持有 SQL 事务，失联/撤权没有缓存放行；已提交事实保留，撤权接纳的正文立即
tombstone，历史不回写。Tool/Step 结果、Memory 和 config Vault 都不是这个采集入口。

`knowledge_resource_source` 保存声明当前 revision；`knowledge_resource_revision` 保存每次采集
绑定的声明、完整证明、主体、permission revision、采集/到期时间、原始 bytes/hash、media type、
parser/chunk 版本，随正文不可变修订保留。text/plain 实施 `utf8-trim-text.v1`；application/json
实施拒绝重复键/非有限值的 `utf8-canonical-json.v1`；目前实际分块策略是 `whole-resource.v1`，
限 32 KiB UTF-8，不宣称已实现文件/媒体 parser 或语义分块。Source/正文更新或删除同事务失效向量。

检索只向 Worker 绑定主体提供当前 scope 可见的来源；private 不降级为 global，partial scope 拒绝。
编码前、迟到向量接纳、查询后与最终 SQL 投影都重验来源。Host 返回不 current 或无法复验时，
当前修订落 tombstone 并删除向量；恢复连通/墙钟回拨不自动复活，只有新的获准采集可建立新修订。
scope/主体不匹配只是不可见，不以别的会话查询删除来源。同步诊断快照不返回 Resource 正文。

`KnowledgeSource` 与 `ReplyContextBuilder` 传递来源/Resource/hash、主体、权限 revision、时间及
真实 parser/chunk provenance，仍为 untrusted/data，不把 proof access ID 暴露给模型。
回复 Context 把使用的 Resource 修订附在本地 `InferenceRequest.knowledge_references`；该字段
不序列化给供应商，显式携带修订的 run_native 未注入复验门会在 IO 前拒绝。Loop 在每个模型 Step 与模型完成后复验这些修订，失效终止 Run，不继续复用
旧 prompt/history，也不接纳最终 Reply。已合法发给供应商的输入无法撤回。通用 Workspace 不具有
此复验门，MemoryProvider 不缓存 Resource 正文 Attention，避免陈旧/私有材料进入无 scope 投影。

生产 CognitionService 已提供来源查询、CAS 登记/更新/停用与显式采集；wire 由 Worker mapper
转换，不进入 Core。管理查询只返回声明/来源修订/声明摘要，不返回正文或临时 proof。停用与
当前正文 tombstone/向量失效同事务，停用来源在实际 IO 前拒绝。采集请求也绑定期望来源修订，
防止审批读取后被新声明替换；RPC 要求实际 owner、当前 generation、业务 ready，并受取消/drain
监督。修订冲突不套用副作用恢复 code，不以 process-local cache 或丢失 ACK 宣称重复成功。
schema 2 历史声明/采集中的 enabled 缺省仍解释为当时唯一启用语义；语义相同登记不制造新修订，
不改写历史材料。新 wire 则必须有 enabled presence，遗漏拒绝。

HostKnowledgeController 通过这些生成 RPC 管理来源，不直接写 Knowledge SQLite；持久审批
仅由唯一 HostConfig 拥有。ConfiguredHostCognitionJobsOwner 显式装配同一 Resource 服务后，
在 Worker ready 后重验当前来源 revision/digest/enabled，为实际新世代签发双 grant/IO 接纳并
重新采集，再完成领域启动；不得恢复旧证明。管理更新先撤 IO/证明，再做来源 CAS，失败保持
拒绝；停止先撤销、取消并 drain 管理请求再关闭 client。审批字段与摘要算法见
[协议参考](../../reference/protocol.md#knowledge-来源管理) 和
[配置参考](../../reference/configuration.md#目标-host-与-jobs-配置)。没有审批默认拒绝；审批与
当前来源不符、已到期或 Resource graph 未装配时明确失败，不忽略配置或自造假 ready。

Host 已将同 graph 的 owner 内容更新接入受监督重采集，原授权仍 current 时复用它，而非自动
重新授权。实际机制与失败边界见上述采集边界。成功采集生成新 entry revision 并在同一 SQL
事务失效旧向量；旧 Context 仍引用旧 revision，模型完成后的复验会终止该 Run，即使新材料
已经接纳也不能继续旧 prompt 或产出 Reply。刷新失败时 Host 旧证明已失效，live 检索/Context
拒绝；物理 tombstone 仍由实际复验/来源变更触发，不宣称 Host 通知同步删除远端 SQLite 历史。
session.knowledge 是 Host-local 冻结投影：idle/refreshing/degraded/stopped 与每个审批来源的
waiting/accepted/refreshing/blocked/failed、last_entry_revision、稳定 error_code。accepted 只表示
最后真实 receipt，idle 只表示当前无刷新；都不是材料当前有效或完整产品 ready 的证明。它不包含
正文、hash、proof 或 grant，也不是新增跨进程 Document，Context 继续独立 live 复验。

产品权限 UI、供应商变更订阅、持久采集调度、安装态迁移与完整 Knowledge 生命周期尚未交付。
上述局部 Host 入口不替代产品默认 Kernel，不是完整产品 ready 或跨机认证/安全发行证明。

共享 Memory 连接的读写由 `SqliteMemoryStore.read()` / `transaction()` 串行化；Memory、Vector、
Relationship、关系 checkpoint 与旧巩固队列不再各自 commit。写事务使用 IMMEDIATE，BEGIN/业务写入/
commit 取消均等待回滚收尾再允许连接复用，回滚失败撤销并关闭连接；关闭本身被取消也先完成资源释放。
新库 DDL 与 schema metadata 在同一初始化事务，失败/取消不留下半初始化表。关系 checkpoint 只向前推进。
模型推理、向量编码和跨进程调用不在这些事务内；已提交但确认被取消不能推断未写入。

Memory schema 6 将修订/evidence、`memory_consolidation_receipts` 与每个 Episode/version 的
`memory_consolidation_inputs` 索引同事务提交；receipt 保存 operation、scope、输入/输出摘要、结果
Memory ID 与提交时间，不保存模型原文。noop 也形成结果 receipt。相同 operation/input/output 重复返回
原结果；输入 scope/digest 漂移、同 operation 输出冲突、重复修订同一 Memory 或无 receipt 的既有同批修订
均拒绝，不以 revision 去重伪装完整提交。

真实 `ConsolidationCoordinator` 先按 Episode/version 查询结果，再推理未确认项；重启后即使分批大小改变、
模型不可用或派生缓存刷新失败，也可从原结果修复缓存、队列与 Episode 投影，不重复推理已提交项。
旧巩固队列的 complete/fail 只接受对应 claimed attempt，完成批次中任一 attempt 失效则全部回滚。
Memory 的 Jobs 接收边界由 `memory_job_attempts` / `memory_job_authority` 持有：App 从 Contract Spine
映射原 job/scope/attempt/epoch/token/owner/deadline；登记与封口持久化，推理返回后的 IMMEDIATE 提交
重新检查身份、authority 和 lease，最终结果接纳 SQL 再检查数据库时钟。attempt applied、业务修订与 receipt
同事务提交；新 attempt/authority 和对账封口均拒绝旧提交。对账未知 attempt 先保存 sealed tombstone，
不能只查空结果就返回 not-applied；错误身份不封口真实 attempt。证据 ID 与观测时间跨重启保持稳定。

Worker 真实 composition 将同一个 `ConsolidationCoordinator` 注入受监督 `CognitionGrpcHost`，由
`ExecuteMemoryJob` / `ReconcileMemoryJob` 映射生成契约；Kernel 迁移期 transport 暴露同一 RPC。
对账是会持久封口的命令，不是无副作用的查询；generation 鉴权、readiness、取消和停机继续使用原 Service
边界。源 request outbox 已在真实 Episode 封口中写入；Host 投递 wire、Jobs handler/query、持续调度与局部配置装配已落位，产品默认入口尚未切换，旧队列仍保留
既定退出门。不自动升级用户 v3/v4/v5 库；受控迁移、备份与恢复归阶段 14。

Memory Jobs RPC 只在 `ConsolidationCoordinator(jobs=None)` 的外部 Jobs 模式开放。
实际 Worker CLI/Host/composition 已接 `memory_jobs_owner` 显式选择；默认产品入口仍为 legacy，
旧模式 RPC 返回 NOT_READY，禁止两套 owner 双消费。选择在 Log 单写者建立、Memory 连接后、维护
启动前通过 `select_consolidation_dispatch()` 原子持久绑定。未完成旧任务拒绝转交；external 绑定或
已有外部 attempt 拒绝 legacy 启动，旧 repository 的每个写事务检查该屏障。它仅为旧队列迁移窗口，
不是第二 authority，删除条件归执行记录。外部模式的维护只投影、封口和整理源请求，不直接运行模型；启用策略、salience 与
已提交结果由 Memory owner 判定，扫描源请求不会对已完成业务再次推理。
`apps/host/src/composition/cognition-job-adapter.ts` 先持久 Jobs 源 inbox/enqueue 再源 ACK；App 映射
完整源信封摘要（含首次 createdAt），Jobs 保持源 request/hash 与 Job ID 稳定，并恢复首次政策。
重投不以新配置或当前 retry due 替代首次 due/预算；事实/业务内容或 retry mode 漂移仍拒绝。
源 ACK 已提交但响应丢失后，源扫描不再返回该请求，已接纳 Job 继续执行；不以本地响应判断源回滚。
默认 Host 在 claim 前调用只读 `GetMemoryJobAdmission`，Memory owner 从已 ACK 的原源核验当前
Episode/version/digest、enabled、salience、域与模型装配；生产 composition 显式注入实际默认
模型配置检查，Core 不读取 provider 配置或网络。缺配置保持原 Job/预算/attempt0，不写失败
结果；历史同输入 receipt 沿原结果恢复而不要求新模型。接纳等待由 `jobs_admission_pending`
呈现，精确身份、理由与生命周期边界见[协议参考](../../reference/protocol.md#memory-jobs-调度接纳)。
源最小快照与终态 tombstone 的保留规则见 [数据布局](../../reference/data-layout.md)。
App 将生成 `JobExecutionIdentity` 映射到 `ExecuteMemoryJob`，由 `ReconcileMemoryJob` 获取原 attempt
证据；只接受 `cognition.memory`、完全匹配的 identity、持久封口和有效证据摘要，业务结果排除易变 duplicate
提示。本地 AbortSignal 中断 RPC 后，App 通过独立的有界对账调用封口原 attempt，不复用已取消 signal；
封口不可用或业务已先提交时不得解释为回滚。`cancelled` 是撤销请求状态，不是未产生 Memory 副作用证明，
最终生产状态事件接纳仍须呈现真实业务结果/不确定性。`CognitionClient` 不发现或自造监督身份，端点/generation 由监督 owner 注入并在切代时关闭。
该 App 边界已纳入 workspace 与根 build/typecheck/test，真实跨进程验收使用 Worker Service、Memory/Log
与 Jobs SQLite。
`apps/host/src/composition/host.ts` 的 `HostJobsController` 以一个可取消 timer 连续驱动源投递、
到期恢复、有界 unknown 分页、Memory kind 的到期执行和可注入的状态接收方。前一轮完全结束才开始
下一轮；首个 unknown 暂不可查询不阻塞后续页。重复 start 共用同一启动 Promise；停机先撤销循环
signal 与执行接纳，等待在途封口和循环后关闭当前 generation client，注入 Store 则由装配方随后关闭。
快照只描述 Memory Jobs：源 RPC 未 ready/暂不可用时 degraded，unknown 未解决时
`jobs_recovery_pending`，authority 失效或非法 source/evidence 则 failed 并撤销 client；不得借此宣称
整个产品 ready。未注入持久状态 receiver 时 outbox 保持待确认，不能假 ACK。实例持有政策副本，
源已接纳工作跨重启恢复首次政策。Host 已通过 `HostJobsOwner` 注入实际持久 authority 并接通
续期/撤销/drain 确认，具体机制见 [Platform authority](Platform原语实现.md#authority-与受控转移)。
目标 Host 的 `WorkerSupervisor` 已直接接通实际 Python CLI/factory，显式选择 external；FD3 一次性
注册能力绑定本代 nonce、端点与受管 PID/父 PID，非法探测不消耗合法能力，成功后拒绝重放。
首条状态真实接纳与生成的 GetReadiness 本代业务 ready 共同封住启动屏障；缺少 Action/Log 接收
返回 NOT_READY，不伪装业务 ACK。`HostCognitionJobsOwner` 随后启动持久 Jobs owner；正常停机
先 drain Jobs/释放 authority，再独立生命周期 client 发 Shutdown 并等待实际进程退出。超时回收
本实例进程树，接收方不响应取消则回收失败，不能宣称 drain 完成。异常退出撤销旧客户端并停止
续期；下一实例重新注册、新世代/更高 epoch 接管，状态 outbox 包括正常的接管 revision。
`ConfiguredHostCognitionJobsOwner` 已接唯一 Host/Jobs/Memory 配置和目标 state 路径，拥有两库，
配置及恢复预检先于 Worker 外部绑定；同一 Memory Document 约束 Worker 与源 debounce。
真实配置启动/重启保持源首次政策，终态保留期在循环里保护未 ACK 事实；精确规则见
[配置参考](../../reference/configuration.md#目标-host-与-jobs-配置)与[数据目录](../../reference/data-layout.md#用户状态与记忆)。
配置启动默认使用 `CognitionJobAdapter.stateReceiver(epoch)` 经生成 `PublishMemoryJobState` 投递
真实 outbox；手工装配未提供 receiver 仍保持未 ACK。Worker 映射到 Memory consumer-local feedback，
Coordinator 验证已接纳源和实际业务 receipt，Episode owner 同事务提交 inbox/最新投影后 ACK。
取消不回滚 Memory、unknown 不冒充未执行；重复/迟到事实不重复业务或回退 revision。精确语义见
[协议参考](../../reference/protocol.md#memory-jobs-状态投递)，持久与迁移责任见数据目录。
本装配仅覆盖 Worker+Jobs，仍未替换产品默认 Kernel 入口；完整配置 catalog、产品状态投影消费、
Planning 未完成评估已同事务保存后继源意图，Controller 复评间隔默认 60,000 ms；后继追加承诺
revision，首次 identity/历史 receipt 保持不变。具体持久升级和 wire 规则见[数据布局](../../reference/data-layout.md)与[协议参考](../../reference/protocol.md#planning-jobs-源接纳)。
Planning 承诺撤销传播已接持久原源与实际通知发布先后点；通知的完整产品接收入口与旧队列/旧数据切换仍待完成；
目标评估、接纳后默认调度、状态接收与可注入定向通知链见本页长期承诺章节。

`episodes.db` 的 `memory_request_outbox` 与 Episode 封口及 projection checkpoint 同事务提交，保存
稳定 request ID、Episode/version/scope/input digest、首次记录时间、接纳 Job ID 与源已解决标记，
不保存模型原文或复制 Moment 内容。摘要由源发布与接收执行共用的 `consolidation_input()` 生成，
证据不完整则拒绝提交；没有 `memory_candidate` 的 Episode 不发布请求。
`pending_job_requests()` 有界扫描未接纳且未解决项；`acknowledge_job_request()` 验证原请求完整身份，
重复同 Job 确认幂等，不同 Job 或 payload 拒绝。接纳不标记 Memory 完成；巩固/跳过结果与源解决标记
在同一投影事务更新，业务完成后迟到的接纳 ACK 仍可保存。旧 sealed 待办启动时增量补齐，不重算 Episode ID。
逻辑 Episode 仍由 Log 派生，但本物理库已含不可再生投递身份；只要存在源请求，普通 `rebuild()` 就拒绝。
该同库迁移窗口由 Cognition Memory 持有，阶段 14 在备份、原身份保持、outbox 恢复与 consumer-zero
验证后切换最终状态布局，不能把删除整个库当作索引维护。

长期交互连续性由 Conversation 拥有；Cognition 拥有 Experience、Memory、Persona 与推理语义。Kernel 可以收到投影或行动结果，但不直接写 Cognition/Conversation DB。

记忆分层规则：

1. `core/conversation` 从 `ConversationAddress` 生成 canonical `ConversationContext`；Kernel 注入 Platform identity，Cognition 不接受 Extension 自造 canonical ID。
2. Conversation History 只从 Conversation Log 投影，Working Set 只从 History 恢复；没有第二套短期记忆或 transcript 写回。
3. Conversation Log、Conversation Segment、Memory revision 与 RecentExperience 都携带 scope；过滤先于检索与 Prompt 拼装。
4. Extension 可提交规范化 perception 或 `evidenceProposal`，但不能读写 Conversation/Memory。

## 记忆闭环通电状态

现有领域/Worker 代码的主要数据关系如下；业务 ready、Memory Jobs 与默认产品切换仍按各自 consumer 和证据判断：

```text
本地对话 / 外部事件
  -> Kernel PerceptionAppService / AttentionSessionManager
  -> Cognition PerceptionProvider
  -> LoopController Appraise
  -> Conversation Log
  -> Conversation History / EpisodeProjection / Relationship projection
EpisodeProjection -> consolidation_jobs -> scope-partitioned ConsolidationCoordinator -> versioned Memory
Conversation reader -> RecentExperienceSource
Knowledge Vault / 已审批 Resource 来源 -> Knowledge store / KnowledgeIndex
History / Memory / Relationship / RecentExperience / Knowledge -> token-budgeted ContextAssembler
```

已经通电的链路：

- 本地和外部感知会进入统一 `PerceptionProvider`，由 `LoopController` 写入 PERCEPTION、EMOTION、REPLY 或 SILENCE Moment。
- `CycleContinuity` 只写本轮真实发生的 user/assistant Moment；`core/conversation` 的 `ConversationController` 从 canonical Conversation Log 增量投影并为下一轮恢复上下文。Cognition 只通过 Conversation Port 消费，不拥有日志写入与历史投影实现。
- Conversation `ConversationRecorder` 会把 Moment 写入兼容路径 `data/state/cognition/experience/packs/YYYY/YYYY-MM.experience.db`；`catalog.db` 维护全局 position 和 pack 范围。路径迁移留阶段 14，不改变当前 owner。
- `EpisodeProjection` 按 interaction、scene、conversation 与 recall/disclosure 权限域形成派生 Episode；同一个 Episode 在物理表和查询键上都不能跨域。`reply` / `silence` 立即形成 `interaction_completed` 边界，`episode_idle_seconds`、`quiescent` 与停机只补充收口开放批次。所有封口入口同事务发布源请求，失败不推进 checkpoint 或封口状态。启动时按 `seal_integrity_check` 校验投影数据库，先补投影所有已提交 Moment，再将遗留开放批次标记为 `process_interrupted`；封口后同 interaction 的迟到 Moment 会进入新 Episode，不改写已封口批次。源请求存在时禁止整体删除重建。
- `MaintenanceScheduler` 在正常运行中由终结 Moment 唤醒，并按 `schedule_interval_seconds` 对持久待办补偿扫描；`ConsolidationCoordinator` 只处理 `memory_candidate`，先写 `consolidation_jobs`，再按 scope/owner 分批 claim。停机只投影、封口和入队，不执行模型巩固。输出必须通过结构、evidence id 与目标权限域校验后才可写入 Memory。
- `KnowledgeIndex` 启动时通过 Cognition Service `InitializeKnowledge` 注入配置 Knowledge Vault；更新/删除原子失效，默认上下文只消费检索时仍匹配的修订。Knowledge 独立库不再自动导入旧 Memory，历史数据保留，迁移须通过阶段 14 的备份/恢复门。
- 工具结果由 Conversation 接纳 Capabilities 已提交 outbox 后写入 `action_result` Moment，合成只读实际结果；成功/失败/unknown 均是 Experience/untrusted，不直接提升为记忆候选。Recent Experience 不能把结果标为 host_verified，也不以候选 Moment 的 scene 改写下一条的查询权限域。
- provider 缺失、非法输出或证据越权会记录 failed consolidation run，并保留 Episode 供后续重试；没有 mock fallback。

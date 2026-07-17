# ADR-0008 Experience Ledger 与版本化 Memory

- 状态：accepted
- 日期：2026-07-13
- 决策者：Glimmer Cradle 架构维护者

## 背景

旧实现把 Experience 分散为 `.elog`、snapshot 和 replay 文件，把认知沉淀分散为 `long_term_memory`、reflection event 与 memory graph。它缺少统一来源描述、稳定 Episode 边界、版本有效期和强制证据约束，也让 Desktop、Kernel 与 Extension 容易把缓存或预览误认成 Character Memory。

摇篮需要面向长期连续身份的完整架构，而不是聊天历史的增量补丁。它必须同时支持跨场景回忆、关系演化、未来意向、Extension 证据、Skill 结果、可解释修订和受控 token 成本。

## 决策

1. Cognition 以 Experience Ledger 作为角色经历的唯一事实源。Moment 全局有序、不可变，并保存 actor、scene、interaction、causation、trace、`SourceDescriptor` 与 `retention_ceiling`。
2. Ledger 采用单写者 catalog 与月度 SQLite pack。启动、停机、心跳和 provider 故障属于 telemetry，不伪造成 Moment。
3. Episode 是从 Ledger 派生的可重建投影。它是回忆、叙事和巩固批次，不是第二事实源；封口后迟到事件进入新 Episode。
4. ConsolidationCoordinator 是从 Episode 到认知状态的唯一写入链。它只读取 `memory_candidate`，每个 Episode 最多一次结构化模型调用，并在写入前校验 schema、证据成员资格和记忆类型约束。
5. Memory 使用 item、revision、evidence、relation 四层结构，并保留 `candidate`、`active`、`disputed`、`superseded`、`redacted` 状态和时间有效期。任何写入都必须引用 Moment evidence。
6. Relationship 的互动计数和 familiarity 由事件确定性派生；语义摘要保留 revision 与 evidence。Prospective Memory 通过 Intention 和状态转换表示。
7. Conversation Store 是从 Ledger 派生的可重建查询投影，保存长期 Conversation 的消息、Chapter、Segment 和 Conversation State；进程内 Working Set 只是有界缓存。Kernel、Extension 与 Renderer 不维护平行聊天事实源。
8. Knowledge Vault、Character Package、Conversation Projection、Skill catalog 与 Memory 分属不同 owner，禁止互相冒充。
9. Extension 只能提交带 `ConversationAddress` 的规范化 perception 或 `evidenceProposal`。Kernel 解析 canonical topology 与 scope；Skill 工具结果写为带来源的 `action_result` Moment；成功不等于事实，失败不得进入 Memory。
10. 检索必须先按 scope 与 conversation/actor/scene owner 过滤，再生成候选，并按词项、embedding、时间、显著度、置信度和 token budget 裁剪。UI 预览不代表实际 Prompt 召回。
11. 开发阶段不保留被替代的数据格式、短期场景记忆、平行会话端口、旧协议或 SDK 别名。
12. `reply` 与 `silence` 是交互 Episode 的主要语义边界。封口 Episode 进入持久 `consolidation_jobs`，由常驻 `MaintenanceScheduler` 立即唤醒消费；定时扫描只补偿提示丢失和非交互批次。
13. Consolidation 在模型推理前按 recall/disclosure scope 与域 owner 分区，现有记忆候选也只来自同一域；跨域 Episode 不进入模型输入。
14. 停机只做有界的 ingress 关闭、Ledger flush、Conversation/Episode checkpoint、开放 Episode 封口和任务入队，不调用巩固模型。异常退出后依靠 SQLite WAL、checkpoint 和过期 lease 重领恢复。
15. 桌面版和单实例 Linux 由 Cognition 内维护任务消费本地 SQLite WAL；数据库与 WAL 必须同卷管理。多副本云端不得跨 Pod 共享 SQLite，应在保持 Episode/Consolidation 契约不变的前提下改用支持事务、claim/lease 与崩溃重领的服务端存储，并可由独立 Maintenance Worker 消费。

## 物理形态

```text
data/state/cognition/
├── experience/
│   ├── catalog.db
│   └── packs/YYYY/YYYY-MM.experience.db
├── memory/memory.db
├── conversations/conversations.db
└── projections/episodes.db
```

权威跨边界结构位于 `protocol/src/schemas/`；Python 内部存储模型位于 `experience/`、`conversation/` 与 `memory/`。

## 结果

- 角色经历、认知状态和工程遥测各有唯一 owner。
- 记忆可修订、可争议、可删除、可追溯，不会静默覆盖历史。
- Episode 与索引可安全重建，Ledger 和 Memory 可独立备份。
- Extension 与 Skill 能丰富角色证据和行动能力，但不能获得心智主权。
- 结构化巩固会增加一次低频模型调用，但 Episode 批次、资格过滤和 token budget 避免逐消息反思造成的成本浪费。
- 正常交互结束后即可逐步形成长期记忆；强杀、主机故障或 Pod 替换不会要求停机阶段完成模型调用。

## 被拒绝方案

- 一个 Moment 一个文件：目录和文件系统开销随寿命线性恶化，难以事务化查询。
- JSONL + snapshot 双轨：边界、索引和恢复容易漂移，Desktop 也会依赖旧格式。
- LLM 直接写长期记忆：缺少 evidence membership 与版本语义，错误输出会成为事实。
- Memory Graph 作为第二事实源：关系、事实和历史发生冲突时没有明确 owner。
- Extension Memory CRUD：破坏 Cognition 主权、隐私和来源审计。
- 关键词式记忆或 Skill 路由：无法表达开放目标和上下文，且容易污染正常对话。

## 验证

- `pnpm sync:contracts`
- `pnpm typecheck`
- `pnpm build`
- `cd core/cognition && uv run pytest -q`
- Ledger position/gap/duplicate 校验、Episode 重建、迟到事件、巩固证据拒绝、Extension evidence 与 Skill action result 回归测试

## 参考依据

- [Generative Agents](https://arxiv.org/abs/2304.03442)：完整经历记录、动态检索与随时间生成高层反思应当分层。
- [MemGPT](https://arxiv.org/abs/2310.08560)：长期交互需要分层记忆与独立控制流，不能只依赖当前上下文窗口。
- [SQLite WAL](https://www.sqlite.org/wal.html)：提交记录可在崩溃后由下一连接恢复，数据库文件与 WAL 必须作为一个持久单元管理。
- [Kubernetes Pod 生命周期](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)：优雅期有上限，期限后会强制终止，因此业务正确性不能依赖停机钩子完成长期任务。

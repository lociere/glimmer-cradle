# ADR-0003：Character Package 与 Memory Substrate 分层

- 状态：accepted
- 日期：2026-06-30

## Context

角色设定、对话策略、外部知识、经历、长期记忆和检索索引过去容易被塞进同一个“知识库”语义里。这会让人格种子进入 RAG，使运行时资料和作者设定互相污染，也会让括号动作、长段话、示例台词等表达问题变成 prompt 拼接问题而不是配置边界问题。

摇篮的长期架构需要直接采用清晰分层：作者设定、生命事实、外部资料、认知投影和索引投影各有自己的事实源。

## Decision

采用以下最终分层：

| 层 | 事实源 | 规则 |
|---|---|---|
| Character Package | `character.manifest.yaml`、`profile.yaml`、`dialogue.yaml`、`safety.yaml` | 作者写定的最小身份、安全边界、稳定人格种子和对话呈现策略；不进入 RAG，不写入向量库，不由运行时静默改写 |
| Experience Ledger | Experience Stream / Moment ledger | 角色经历过什么的生命事实源；append-only，可回放，可追踪因果 |
| Knowledge Vault | `knowledge/index.yaml`、`knowledge/*.md`、用户导入资料、Extension 知识贡献 | 外部资料和世界事实；只允许知识资料，不承载人格 |
| Memory Substrate | working memory、long-term memory、relationship、preference、reflection | 从经历和反思生成的认知投影；写入必须由 Cognition 判断 |
| Graph / Vector Index | memory graph、embedding、retrieval index | 检索和关系投影；可重建，不是原始事实源 |

Kernel 只加载和校验配置并注入冻结投影，不解释人格。Cognition 使用 `PersonaProfileCompiler`、`DialoguePolicyBuilder` 和 `PromptAssembler` 组装运行时 prompt。`KnowledgeInitPayload` 只负责 Knowledge Vault 预填。

## Consequences

- `knowledge/` 中不再允许角色身份、性格、表达风格、示例台词、情绪行为或安全边界。
- 历史的 persona 范围知识条目和编译分组字段不属于当前架构契约。
- 角色聊天呈现问题由 `dialogue.yaml` 和出站归一化共同约束，不能靠把更多 persona 条目塞进 RAG 解决。
- 记忆巩固使用独立结构化指令，不复用对外聊天格式，也不改写 profile。
- Graph/Vector 索引可以删除重建；Character Package 和 Experience Ledger 不能被索引反向改写。

## Alternatives considered

- 继续把 persona 条目放入 Knowledge Vault：拒绝。它混淆作者设定和外部知识，会让 RAG、索引和知识更新影响人格。
- 保留历史 persona 范围载荷的迁移兼容：拒绝。本次架构升级直接采用最终结构，Git 历史保留旧实现证据，运行时不保留旧主线。
- 把所有角色信息合并回一个大 persona 文件：拒绝。它会让最小身份、安全边界、稳定人格种子和输出策略继续耦合，难以校验和迭代。

## Links

- Architecture：[微光摇篮架构蓝图 §8](../blueprint/微光摇篮架构蓝图.md#8-经历记忆知识与身份)
- Reference：[Configuration Reference](../../reference/configuration.md)
- Reference：[Data Layout Reference](../../reference/data-layout.md)

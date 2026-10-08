# Cognition Core

Cognition 是环境中立的认知领域 owner，负责 Persona、State、Memory、Knowledge、Perception、
Attention、Context、Inference、Planning 与原生模型/工具 Loop。平台 IO、密钥、供应商 SDK、
能力执行和长期任务调度不进入本模块。

## 公开入口

- Python 消费方从 `glimmer_cradle.cognition`、明确子域根入口或 `ports/` 导入公开契约，不 deep import 内部实现。
- `CapabilityPort`、`ContentPort`、`ConversationPort`、`JobPort` 与 `ResourcePort` 由 Cognition 定义需求，由 App 装配实现。
- `contracts/` 仍是跨进程 wire 唯一来源；Core 不导入 generated DTO。
- ResourcePort 用 source/principal、明确 global/context scope 和 live 采集证明表示知识采集需求；
  具体 RPC 在 Worker，IO 接纳/授权在 Host。普通加载 snapshot 没有此权限，不自行保存成知识，
  接线边界见[采集实现](../../docs/architecture/implementation/Extension与SkillPlane实现.md#knowledge-显式资源采集边界)。

## 状态与恢复

- Persona、State、Memory、Knowledge、Planning 与 Loop checkpoint 分库存储，各自拥有迁移和 revision 规则。
- Knowledge schema 2 保存独立 Resource 来源/采集修订及实际 parser/chunk 版本；显式采集与
  检索消费 live ResourcePort，不自动保存 Tool 结果。原生 Step/Reply 复验已使用的修订；
  可信来源管理支持修订 CAS 与 enabled 停用，停用失效正文/向量但保留来源和历史；
  v1 的备份迁移只在 owner 停止后显式执行，见[认知核实现](../../docs/architecture/implementation/Cognition认知核实现.md#knowledge-来源与持久化)。
- Planning 已持有不可变 GoalVersion/PlanVersion、显式 accepted 承诺和同事务 Job request outbox；
  JobPort 接纳只结束源投递，不代表完成条件成立。普通回复或工具调用不自动成为长期承诺；短程 ActionPlan 已删除，旧决策只读恢复。
  生产长期 Jobs 源 wire 已接线；Core 评估现有严格模型输出、scope/live 证据复验、原 attempt 封口
  与同事务业务 receipt/承诺 revision。生产证据 Adapter、执行 wire/handler、默认接纳调度与状态
  inbox/ACK 已接线；新完成的评估同事务产生持久通知引用，重启/重放不重复产生。
  通知真实投递/回执与下一次调度仍未装配，不把业务完成或测试 Port fixture 当作外部送达，详见
  [认知核实现](../../docs/architecture/implementation/Cognition认知核实现.md#长期承诺与-jobs-源请求)。
- Conversation Log 是交互事实 owner；Cognition 只消费事实并写入受控认知投影。
- Memory schema 6 的 dispatch 绑定只用于旧巩固队列迁移屏障，不承担 Jobs authority 或新调度；
  非终态旧任务拒绝转交，外部绑定拒绝回退，旧 writer 同事务拒写。受控迁移与删除门见
  [执行记录](../../docs/roadmap/architecture-v2-refactor.md)，当前不隐式升级旧 v3/v4/v5 库。
- Loop 的 Run/checkpoint 独立于 Conversation Turn 和 Job；原生 ToolCall 只可调用当步曝光的能力，并使用稳定幂等键。

## 验证

```powershell
uv run --project core/cognition --extra dev pytest -q core/cognition/tests
uv run --project core/cognition --extra dev ruff check core/cognition/src core/cognition/tests
pnpm check:architecture
```

跨包装配变化还需运行根 `pnpm typecheck` 与 `pnpm build`。Cognition owner Schema 迁移完成前，
`contracts/json-schema/config/v1/` 仍是现行唯一 Schema 来源。

`setup.py` 只负责在 wheel 构建前清理该包的旧 `build/lib` 投影，防止已经删除的迁移模块泄漏进
安装制品；项目元数据与依赖仍由 `pyproject.toml` 唯一拥有。

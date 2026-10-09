# Capabilities Core

Capabilities 拥有 Tool、Skill、Resource、Exposure、Execution 与 Speech 的稳定语义，不执行平台 IO。
真实入口包括独立 `ToolRegistry`、`SkillCatalog`、`ResourceRegistry`，以及 scope 规则：global、source provider、scene、
conversation 分域匹配；缺上下文、非法限定范围和未知 kind 失败关闭。消费方只提供必要身份，
Core 不导入 Kernel、Conversation concrete、公开 SDK 或 generated DTO。

现行 Kernel catalog 缺省、规划过滤和调用前 scope 校验已直接消费本包公开入口，旧 `scope.ts`
owner 删除。扩展 `$self` 到 provider ID 的绑定仍在 Kernel 接入装配，不进入 Core；对应公开
Document 与 SDK 字段仍由现行唯一契约拥有，不新增 Schema 副本。

Tool 是执行动作，Skill 是 inline/reader 方法知识，Resource 是可读资源；没有 Skill 包含 Tool 的
继承或聚合关系。三个集合分别保护 owner、revision、撤销与 readiness，定义深冻结且不包含
handler/IO。Scope 按交集判断。Kernel `CapabilityCatalogAdapter` 保存现行 SDK 分组与 handler
绑定，规划消费真实 Tool 定义，Tool/Resource/方法 Gateway 在确认后重查 Core 定义与来源状态。
旧 `skill-registry.ts` 删除；旧分组计数不是 Core Skill 数量。`SkillCatalog.inlineSummaries()` 与
`inlineMaterial()` 分离目录和正文，并复验引用 revision、readiness 和 scope。User Provider 已
改为 inline 方法，不再暴露 `instructions.read` Tool；现行 Plan 经独立方法字段最多加载两份
正文，不执行 Gateway。动态 reader 与需确认的旧方法不进入该正文入口，原生 Step 仍待接线。

Execution 已有真实 SQLite journal/controller，现行生产 Kernel Tool Gateway 委托本包；稳定请求
冲突失败关闭，派发后不明结果不重试，结果/outbox 原子提交。确认后重查注册/定义/scope/策略。
平台接收方和用户确认仍由 App adapter 提供，Core 不直接调用设备。详细调用/排空语义见
[实现地图](../../docs/architecture/implementation/Extension与SkillPlane实现.md)。

结果 outbox 已经独立 Conversation Service 获得刷盘后的幂等 receipt；App 有界重投仅发布结果，不
重跑 handler。schema 2 保存 Conversation/原 ACTION 最小引用；旧 schema 1 拒绝隐式迁移。
完整来源语义切换、Step 权限/预算/位置/协议过滤、外部 fencing/对账与 Speech 尚未完成，
不能将当前切片当作完整授权或 native broker ready。
进度见[执行记录](../../docs/roadmap/initiatives/architecture-v2/README.md)。

```powershell
pnpm --filter @glimmer-cradle/capabilities test
pnpm --filter @glimmer-cradle/capabilities typecheck
```

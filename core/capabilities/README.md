# Capabilities Core

Capabilities 拥有 Tool、Skill、Resource、Exposure、Execution 与 Speech 的稳定语义，不执行平台 IO。
当前真实落位入口是 `exposure/exposure-policy.ts` 的 scope 规则：global、source provider、scene、
conversation 分域匹配；缺上下文、非法限定范围和未知 kind 失败关闭。消费方只提供必要身份，
Core 不导入 Kernel、Conversation concrete、公开 SDK 或 generated DTO。

现行 Kernel catalog 缺省、规划过滤和调用前 scope 校验已直接消费本包公开入口，旧 `scope.ts`
owner 删除。扩展 `$self` 到 provider ID 的绑定仍在 Kernel 接入装配，不进入 Core；对应公开
Document 与 SDK 字段仍由现行唯一契约拥有，不新增 Schema 副本。

Execution 已有真实 SQLite journal/controller，现行生产 Kernel Tool Gateway 委托本包；稳定请求
冲突失败关闭，派发后不明结果不重试，结果/outbox 原子提交。确认后重查注册/定义/scope/策略。
平台接收方和用户确认仍由 App adapter 提供，Core 不直接调用设备。详细调用/排空语义见
[实现地图](../../docs/architecture/implementation/Extension与SkillPlane实现.md)。

完整 Tool/Skill/Resource 分离、Step 权限/预算/readiness、外部 fencing/对账、Conversation 结果
接收确认与 Speech 尚未完成，不能将当前切片当作完整授权或 native broker ready。
进度见[执行记录](../../docs/roadmap/architecture-v2-refactor.md)。

```powershell
pnpm --filter @glimmer-cradle/capabilities test
pnpm --filter @glimmer-cradle/capabilities typecheck
```

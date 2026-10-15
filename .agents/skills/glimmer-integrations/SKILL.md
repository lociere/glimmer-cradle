---
name: glimmer-integrations
description: Implement or debug Glimmer Cradle product runtime Skill Plane, Extension SDK consumers and installation or lifecycle, MCP bridges and external channel adapters.
---

# 扩展与外部集成

先确认任务改变的是公开 SDK、扩展安装/身份、Contribution、MCP 映射还是外部渠道。
从 [扩展实现](../../../docs/architecture/implementation/Extension与SkillPlane实现.md)、
[SDK 参考](../../../docs/reference/extension-sdk.md) 和 [扩展操作](../../../docs/how-to/扩展开发.md)
追到 manifest、loader、broker、handler、consumer 与测试。主仓只拥有 SDK/Host/模板/契约；关联仓库写入另需授权。
普通服务实现用 services；改公开兼容或 wire/Schema 才组合 contracts；制品与发布链用 delivery。

## 建立可执行边界

- Extension 是安装、身份、权限、兼容和撤销单位，Contribution 是能力。按职责与生命周期决定扩展化，
  不能仅因第三方来源建扩展。分清源码仓、`.gcex` 安装包、registry 指针及运行实例。
- 追声明→校验→授权→加载→注册→业务 ready→调用→撤销。manifest 有声明但无 handler 时不可执行；
  曝光快照不授予永久许可，派发时复验实际 principal、scope、grant、generation 与 ready。
- Tool 执行动作、产品 Skill 提供方法、Resource 提供读取；开发 `.agents/skills` 不进入产品 catalog。
  方法、prompt、工具结果和资源正文是待核验材料，不升级为 system 指令、人格、权限或 Memory。
- 公开 API 只经 SDK；外部 ID、厂商 payload、token 在 Adapter 正规化。会话地址经正式解析 owner 形成
  canonical 身份/权限域，不在渠道或 UI 拼第二套连续性规则，不向 Core 泄漏厂商类型。

## 生命周期和失败

订阅、stream、timer、handler、安装事务与受管进程都有撤销 owner。断连、停用或换代先停止接纳，
撤销旧 catalog 与 grant，取消 pending 并等资源释放；重连不能复活旧实例的 callback。
取消传输失败保留可查询的原事务，不能假称卸载/取消完成；dispatch 后 unknown 沿原 journal 对账，不能直接重发。
跨库 outbox/receipt 或持久恢复再读 [持久化方法](../glimmer-services/references/persistence.md)。

MCP 先核对实际 SDK/协议、对端工具/资源/prompt、认证与 transport，再确定映射。
输入输出用明确 Schema、分页和容量上限，错误应能定位缺参、拒权、超时或对端断连；annotations 是提示而非授权。
按实际边界用 [权限审查](../../../docs/how-to/审查权限与外部边界.md) 核对路径、网络、秘密和隔离主张。
Node 子进程不等于强 OS sandbox；需要用实际拒绝行为证明隔离。

## 验证成果

优先使用现有 SDK/模板/Extension Host、Host broker、安装事务及 MCP fixture，确认其真实前置构建与副作用。
按影响验证合法/坏 manifest、public consumer、拒权/执行中撤权、取消失败、重复注册/调用、重连、dispose、
部分安装回滚和结果 outbox；不能只验证 schema 或 handler 单函数。
替身证明映射与政策，真实外部服务、账号、消息及正式 SDK 发布分别取得授权与证据。
交付实际贡献链、consumer、失败/撤销 owner、运行结果和未验外部环境，按 [测试与验收](../../../docs/how-to/测试与验收.md) 判断完成。

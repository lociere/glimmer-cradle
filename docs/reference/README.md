# Reference

> 范围：查询协议、配置、目录、日志、SDK、UI token 和打包布局的精确语义与来源。
> 事实依据：`contracts/`、`packages/extension-sdk/`、`configs/`、`data/packages/extensions/`、`products/desktop/`、`products/personal-server/`、打包脚本和当前实现。
> 维护触发：字段、配置键、路径、SDK API、日志字段、UI token、发布投影或生成规则变化。

Reference 应回答“准确叫什么、在哪里、谁拥有、怎样变更、怎样验证”，可以保留必要背景和最小例子。
完整设计原因见 [Architecture](../architecture/README.md)，完整操作见 [Guides](../how-to/README.md)，避免复制多份详细流程。

| 页面 | 权威内容 |
|---|---|
| [naming.md](naming.md) | 分支、领域/Port/Adapter 命名与标识符迁移规则 |
| [protocol.md](protocol.md) | Contract Spine Service/Document、公开 SDK、错误、媒体引用和 codegen 规则 |
| [configuration.md](configuration.md) | 系统、Cognition、Extension、密钥与运行时配置来源 |
| [data-layout.md](data-layout.md) | `data/`、资产、模型、缓存、日志、备份和 legacy 域 |
| [observability.md](observability.md) | 日志、trace、metrics、DLQ、process log 字段和排障索引 |
| [extension-sdk.md](extension-sdk.md) | Extension manifest、公开 SDK、权限、Port 与生命周期 |
| [packaging-layout.md](packaging-layout.md) | 源码、构建投影、安装目录、组件和用户数据映射 |
| [product-compositions.md](product-compositions.md) | Desktop/Personal Server 清单、启动监督、端口和认证变量 |
| [ui-design-tokens.md](ui-design-tokens.md) | Desktop 与 Personal Server 共享设计语言、当前实现边界、目标 token 框架、视觉变量与质量门 |
| [engineering-lifecycle.md](engineering-lifecycle.md) | 事务 lock/phase/exit、备份/DLQ、fixed artifact 与任务路径 |

## 写作规则

- Reference 可以列字段、路径、配置键、默认来源和 owner，但不复制长篇架构解释。
- 每个精确事实只能有一个权威页。其他文档只链接，不维护第二份表。
- 示例必须是最小片段，并标明它来自 Schema、配置、SDK 或脚本；不能凭记忆编造当前值。
- 变更 Reference 时同步搜索代码、配置、生成物和旧文档引用，确认不存在冲突陈述。

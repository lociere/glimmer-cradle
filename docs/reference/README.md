# Reference

> 范围：保存协议、配置、目录、日志、SDK、UI token 和打包布局的精确事实；不解释架构背景，不写开发步骤。
> 事实依据：`protocol/`、`configs/`、`data/packages/extensions/`、`products/desktop/`、`products/personal-server/`、打包脚本和当前实现。
> 维护触发：字段、配置键、路径、SDK API、日志字段、UI token、发布投影或生成规则变化。

Reference 是查表层。它应回答“准确叫什么、在哪里、谁拥有、怎样变更、怎样验证”。如果需要理解为什么这样设计，去 [Architecture](../architecture/README.md)；如果需要知道怎么操作，去 [Guides](../guides/README.md)。

| 页面 | 权威内容 |
|---|---|
| [protocol.md](./protocol.md) | Schema、IPC/WS、Avatar frame、错误和 codegen 规则 |
| [configuration.md](./configuration.md) | 系统、Cognition、Extension、密钥与运行时配置来源 |
| [data-layout.md](./data-layout.md) | `data/`、资产、模型、缓存、日志、备份和 legacy 域 |
| [observability.md](./observability.md) | 日志、trace、metrics、DLQ、process log 字段和排障索引 |
| [extension-sdk.md](./extension-sdk.md) | Extension manifest、公开 SDK、权限、Port 与生命周期 |
| [packaging-layout.md](./packaging-layout.md) | 源码、构建投影、安装目录、组件和用户数据映射 |
| [product-compositions.md](./product-compositions.md) | Desktop/Personal Server 清单、启动监督、端口和认证变量 |
| [ui-design-tokens.md](./ui-design-tokens.md) | Control Center/桌面表面的视觉 token、交互状态和可访问性基线 |

## 写作规则

- Reference 可以列字段、路径、配置键、默认来源和 owner，但不复制长篇架构解释。
- 每个精确事实只能有一个权威页。其他文档只链接，不维护第二份表。
- 示例必须是最小片段，并标明它来自 Schema、配置、SDK 或脚本；不能凭记忆编造当前值。
- 变更 Reference 时同步搜索代码、配置、生成物和旧文档引用，确认不存在冲突陈述。

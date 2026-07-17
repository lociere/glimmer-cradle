# Schema 与跨进程契约变更

> 适用场景：修改 IPC、WebSocket、Avatar frame、Cognition payload、config schema、公开 SDK 或任意跨语言/跨进程结构。
> 前置条件：已读 [Protocol Reference](../../reference/protocol.md) 和 [Protocol 契约层实现](../../architecture/implementation/Protocol契约层实现.md)。

## 步骤

1. 用 `rg` 定位现有 Schema、生成物、生产者、消费者、映射层、测试和文档引用。
2. 判断这是新增语义、重命名、删除、拆分还是兼容迁移；写清成功、错误、未知值和缺字段语义。
3. 修改 `protocol/src/schemas/` 中的权威 Schema，不修改生成物。
4. 运行 `pnpm sync:contracts`。
5. 先改生产者，再改映射层，再改消费者，最后改 UI/日志投影。
6. 补测试：合法 payload、非法 payload、旧字段、未知枚举、错误 code、降级路径。
7. 搜索并删除旧字段、旧事件、手写镜像和无期限兼容代码。
8. 更新 `reference/protocol.md`、对应 Implementation 和实际开发指南。

## 兼容判断

| 变更 | 推荐做法 |
|---|---|
| 新增可选展示字段 | Schema 明确默认/缺省语义，消费者处理缺失 |
| 新增必填语义 | 先让 producer 和 consumer 同步实现，再删除旧路径 |
| 重命名字段 | 优先显式迁移并删除旧字段；短期双写必须有删除条件 |
| 删除字段 | 先搜索所有消费者，再移除 Schema 和生成物 |
| 新增枚举值 | 消费者必须有 unknown/default 分支，但不能伪装支持 |
| 错误语义变化 | 更新 ErrorCode、日志、UI 文案和 DLQ 分类 |

## 常见陷阱

- 在 renderer 或 extension 里手写一个“临时类型”。
- 只改 TypeScript，不同步 Python 生成物。
- 用 optional 字段堆叠多个版本，导致消费者猜测语义。
- Avatar 连接、ready、presentation、audio、reply 共用一个模糊 frame。
- 错误 message 变化但 error code 不稳定，导致排障不可搜索。

## 验证

```powershell
pnpm sync:contracts
pnpm typecheck
pnpm build
```

按影响补充 Python 测试、Kernel 测试、UI 测试或 Avatar/Engine 实机验证。交付时说明生成物已更新、旧字段是否删除、哪些消费者已验证。

## 需要同步的文档

- 精确字段：`docs/reference/protocol.md`
- 代码链路：`docs/architecture/implementation/Protocol契约层实现.md`
- 操作影响：相关 `docs/guides/`
- 长期取舍：ADR 或 Blueprint

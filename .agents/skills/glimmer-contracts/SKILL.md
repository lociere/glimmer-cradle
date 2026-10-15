---
name: glimmer-contracts
description: Change or review Glimmer Cradle cross-language wire contracts, document schemas, public Extension SDK and generated consumers.
---

# 跨边界契约

先确认结构是跨进程 Service、可存储 Document、公开 SDK、领域 port 还是内部 view model。
权威规则见 [契约指南](../../../docs/how-to/Schema与跨进程契约变更.md)、[Protocol Reference](../../../docs/reference/protocol.md)
与 [生成实现](../../../docs/architecture/implementation/Protocol契约层实现.md)。
当前唯一源仍为 `contracts/proto/`、`contracts/json-schema/`，公开 API 为 `packages/extension-sdk`；
目标 `protocol/` 与 owner-local Document 的切换只按架构任务原子实施，不提前复制。

## 完整变更链

1. 定位源、生成器/toolchain、公开 exports、producer、App mapper、consumer、roundtrip/兼容 fixture 和打包投影。
   TS/Python/C#/Node IPC/浏览器并非每次都涉及；追踪真实 consumer，不能漏掉未在 workspace 的 Unity/外部 SDK。
2. 设计语义、权限、scope、默认/缺省、unknown、错误 code、trace、deadline/取消、顺序/幂等与版本协商。
   Proto field number/package/wire identity、JSON Schema ID、稳定 ID 和数据兼容分别判断；删除字段按规则 reserved。
3. 修改唯一权威源或公开 SDK，运行 `pnpm contracts:generate` 和 `pnpm contracts:verify`，再改映射与所有实际消费者。
   生成 DTO 不手改、不复制成“临时类型”。兼容 baseline 只有明确有意变化时评审刷新，不能为绿灯回写历史。
4. 检查 SDK export、模板/打包/fixture 与加载链，搜索旧字段/消息/入口并收束。
   迁移 bridge 如仍必要须有 owner、退出窗口和可验证删除门；内部对象不因“统一”升成公共协议。

## 直接验证

验证合法/非法/缺字段、未知枚举、默认值与边界长度；跨语言 roundtrip 检查实际序列化和精度/bytes/枚举语义，
JSON Schema 的结构验证不代替业务不变量。确保输入未通过手写镜像跳过真实 mapper/Host。

变更涉及调用/安全/生命周期时，补真实 producer→transport/mapper→consumer 及失败/撤销证据。
先读实际 `contracts/package.json` 和 toolchain：verify 会检查工具、生成物、兼容与跨语言环境；
缺 dotnet/Python/protoc 等记为环境阻断，不能仅用 TS 编译宣称跨语言通过。
不要因只是目录调整重命名已发布 wire identity，或为了修 UI 展示创造第二套系统事实。

同步相应 Reference/Guide/Implementation；结构迁移同步目标清单和旧 consumer 删除条件。
公开 SDK 和关联仓库消费的修改各在授权边界内进行，未能写入的 consumer 明确列为缺口。
交付说明源与变化语义、生成/兼容结果、实际消费语言与未验证环境；接受和审查见 [共享验证方法](../../../docs/how-to/测试与验收.md)。

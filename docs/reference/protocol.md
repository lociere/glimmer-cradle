# Contract Spine Reference

> 范围：跨语言、跨进程与公开 SDK 契约的 owner、路径、兼容规则、媒体引用和变更流程。
> 事实依据：`contracts/{proto,json-schema,compatibility,generated}/`、`packages/extension-sdk/` 与当前 Adapter/consumer。
> 维护触发：Service、Document、公开 SDK、codegen、兼容基线或跨边界 consumer 变化。

## 权威来源

| 语义 | Canonical owner | 消费规则 |
|---|---|---|
| 跨进程 Command、Query、Stream、typed Event | `contracts/proto/glimmer/<domain>/v1/` | Buf 生成 TS/Python/C# DTO；只进入 Adapter/Transport 边缘。 |
| 可独立存储、编辑、校验的 Document | `contracts/json-schema/<domain>/v1/` | AJV/owner validator 校验 serialized shape；Protobuf 只引用 id/version/digest。 |
| Extension 公开 API | `packages/extension-sdk/` | SDK 暴露稳定 public projection、权限、manifest/package validator 与 Host edge mapping。 |
| 领域/Application/UI 状态 | 对应 owner-local model/view mapping | 不进入 Contract Spine，不反向定义 Service/Document。 |

`contracts/` 是唯一 Contract Spine；旧 `protocol/` 已物理删除，不存在 package、workspace、生成链、validator、compatibility shell 或 runtime consumer。`@glimmer-cradle/contracts` 可以打包 canonical JSON Schema 与最小 AJV edge primitives，但不拥有领域默认加载、normalizer、reply/avatar/yaml 等万能业务 helper。

## 当前契约族

| 契约族 | 路径/公开边缘 | 关键不变量 |
|---|---|---|
| Common / Kernel / Cognition | `contracts/proto/glimmer/{common,kernel,cognition}/v1/` | deadline、cancellation、typed error、trace/causation/correlation、generation 与幂等。 |
| Surface Gateway | `contracts/proto/glimmer/surface/v1/` | Desktop/Personal Server 只访问 Kernel Gateway；Query、Command、Event 使用有限 typed DTO，不接受 `string kind + Struct {frame}`；浏览器认证 WebSocket 是 Product ingress，不是内部器官协议。 |
| Avatar Host | `contracts/proto/glimmer/avatar/v1/` | `AvatarHostService.Connect` 是唯一 control consumer；二进制 DTO 直接映射，不经 JSON round-trip。 |
| Audio Engine | `contracts/proto/glimmer/engine/audio/v1/` | unary control 与媒体 data plane 分离；普通 RPC 不携带音频字节。 |
| Extension Host | `contracts/proto/glimmer/extension/v1/` 与 Extension SDK edge | Kernel 监督独立 Host；第三方 handler 不进入 Kernel。 |
| Config Documents | `contracts/json-schema/config/v1/` | Kernel config Adapter 拥有 normalizer/default loading；Renderer 不直接读取 YAML。 |
| Extension Documents | `contracts/json-schema/extension/v1/` | SDK validator 消费 canonical Schema；模板只依赖 SDK/Contracts 公开边缘。 |
| Product / Presentation / Skill Documents | `contracts/json-schema/{product,presentation,skill}/v1/` | serialized Document 唯一事实源；产品 view model 与领域模型留在 owner。 |

配置、Extension manifest/package、Product composition 与其他 Document 使用 JSON Schema 2020-12，必须声明稳定 `$id`、`x-glimmer-owner`、`x-glimmer-contract-kind=Document` 和兼容策略。Schema 可以跨目录 `$ref`；validator 必须先注册完整 registry，再校验入口 Document。

## 生成与兼容

```powershell
pnpm contracts:generate
pnpm contracts:verify
```

`contracts:generate` 只从 canonical Proto 生成 `contracts/generated/{ts,python,csharp}/`。生成物只读，Domain/Application/Port 不得 import generated DTO、gRPC context 或 transport stub。

兼容基线位于 `contracts/compatibility/`：

- `proto-image.binpb` 是历史 `buf breaking` 参照，普通 Document 变化不得覆盖。
- `json-schema-baseline.json` 固定 Schema path、`$id`、dialect、owner、kind、compatibility 与 SHA-256。
- 有意评审 Document 变化后运行 `pnpm --filter @glimmer-cradle/contracts baseline:refresh:json-schema`。
- 只有同时有意重建 Proto 与 Document 两类基线时才运行 `baseline:refresh`。

`contracts:verify` 覆盖 inventory、Buf lint/breaking、JSON Schema dialect/fixture/compatibility、固定工具链、TS/Python/C# round-trip 与连续生成无 diff。工具链不依赖 BSR 或远程代码生成服务。

## 调用与错误语义

- Command 表达副作用请求；成功只表示方法承诺已经成立，异步流程必须返回可查询 operation。
- Query 只读取 owner 事实或 Projection，不产生业务副作用。
- Event 是已发生事实，不充当 Query 或 Command。
- Stream 必须有方向、取消、背压/流控和资源上限。
- Document 可独立保存、编辑与校验，不因为通过 RPC 传递就复制为 Protobuf 字段树。
- gRPC status 表达调用结果；领域失败使用稳定 typed detail，不解析自由文本 message。
- deadline/cancellation 必须传播并停止无用工作；不可安全重放使用稳定 recovery code/action/operation id。
- 每条边界延续 trace、causation/correlation、身份、权限、进程 generation 与 readiness 前置条件。

## Audio 媒体引用

`AudioMediaReference` 只携带受管 reference 元数据，不携带音频内容：owner、media type、size、SHA-256、expiry、access mode 与受控路径/lease id。ASR 输入为 `READ_ONLY`，TTS 输出为 `WRITE_ONCE`；Adapter 校验 root containment、权限、过期、长度与摘要。成功、typed error、timeout、主动停机和 crash 都必须回收 lane lease，引用过期后不能复用。

## Extension 与 owner-local projection

公开扩展只能依赖 `@glimmer-cradle/extension-sdk`。SDK 的 schema-derived TypeScript projection 服务于公开 edge，serialized Document 仍以 `contracts/json-schema/extension/v1/` 为准。Kernel、Desktop 与 Personal Server 各自维护领域模型或 view mapping；它们不得把 SDK public projection、generated DTO 或 UI state 复制成新的 canonical Schema。

## 变更顺序

1. 用限定 `rg` 找 canonical owner、生成物、producer、Adapter、consumer、测试和文档。
2. 修改 Proto Service、JSON Schema Document 或 Extension SDK public edge；内部类型留在 owner。
3. 明确 required/optional、默认值、unknown、错误 code、trace、权限与兼容语义。
4. 运行 `pnpm contracts:generate` / `pnpm contracts:verify`，Document baseline 只做有意 JSON-only refresh。
5. 按 producer → Adapter → consumer → view/log projection 更新，并覆盖成功与失败路径。
6. 搜索并删除旧字段、旧 import、手写镜像、compatibility bridge 与无期限 fallback。
7. 同步 Current、Implementation、Reference 和 Guide，再运行受影响 owner 与端到端门。

## 删除与验证门

- `Test-Path protocol` 必须为 false。
- runtime source、package manifest、workspace、lock、Docker/build/package 和模板不得依赖 `@glimmer-cradle/protocol`。
- `contracts/inventory.md` 的 Slice 9 ledger 必须逐 symbol 分类为 Document、Service edge、SDK public、owner-local 或 dead delete，并与冻结 inventory 对齐。
- 跨语言边界覆盖成功、缺字段、未知枚举、非法组合、typed error、deadline、cancellation、readiness 与 generation mismatch。
- 媒体另覆盖权限拒绝、过期、摘要、越界、崩溃清理和大数据不进入普通 RPC。

实现入口见 [Contract Spine 实现](../architecture/implementation/Protocol契约层实现.md)，配置字段见 [Configuration Reference](./configuration.md)，公开扩展见 [Extension SDK Reference](./extension-sdk.md)。

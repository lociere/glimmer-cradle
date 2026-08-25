# Contract Spine

> 范围：canonical `contracts/` Service/Document、生成链、兼容基线和验证入口。
> 事实依据：本目录下的 `proto/`、`json-schema/`、`compatibility/`、`generated/`、`scripts/` 与 `tests/`。
> 维护触发：新增或修改 Contract Spine IDL、JSON Schema Document、生成工具链、兼容基线或跨语言验证门。

`contracts/` 是唯一 Contract Spine。Kernel↔Cognition、Surface Gateway、Kernel↔UnityAvatarHost、Kernel↔Audio Engine 与 Extension Host 的跨进程 Service 使用版本化 Protobuf；配置、Extension package、产品组合与 Skill 参数等可独立编辑 Document 使用 JSON Schema。Surface presentation 主线由 typed Service DTO 拥有，不再保留无 runtime validator 的 JSON Schema 第二事实源。旧 `protocol/`、stdio RPC、ZMQ envelope 和被替代的手写 WebSocket 主线均已退出运行事实。

## 目录

| 路径 | Owner | 说明 |
|---|---|---|
| `proto/glimmer/` | Contract Spine 与各 Service owner | `common`、Kernel、Cognition、Surface、Avatar、Audio 与 Extension 的版本化 Service IDL。 |
| `proto/glimmer/avatar/v1/` | Avatar Contract owner | Avatar Host 上下行控制帧与 `AvatarHostService`；IDL 字段号和 snake_case 字段名是跨语言生成事实源。 |
| `json-schema/` | 各 Document owner | config、extension、product、presentation、skill 等 canonical JSON Schema Document。 |
| `generated/` | Contract Spine Adapter edge | Buf 生成的 TS/Python/C# DTO；只读，不进入 Domain/Application/Port。 |
| `compatibility/` | Contract Spine owner | 仓库内 Protobuf image 与 JSON Schema compatibility baseline；`buf breaking` 不依赖 BSR。 |
| `fixtures/`、`tests/` | Contract Spine owner | 有效/无效 Document fixture 与三语言最小 round-trip。 |
| `toolchain.json`、`global.json` | Contract Spine owner | Windows/Linux x64 工具 archive、launcher 摘要、许可证与 exact .NET SDK 固定。 |
| `scripts/` | Contract Spine owner | 生成、兼容、inventory、工具链和三语言 round-trip 门。 |

## 命令

```powershell
pnpm contracts:generate
pnpm contracts:verify
```

`pnpm contracts:generate` 只重新生成 `generated/`。兼容基线需要有意刷新时运行：

```powershell
pnpm --filter @glimmer-cradle/contracts baseline:refresh:json-schema
```

普通验证要求当前 canonical JSON Schema 的 path + `$id` 集合与 baseline 完全相等，并逐项核对内容摘要；新增未登记、删除、path/`$id` 变化或内容变化都会失败。Document 变更评审通过后只运行 `baseline:refresh:json-schema`；`baseline:refresh` 会同时重建 Proto image，只用于有意刷新两类兼容基线，避免无关覆盖历史 `buf breaking` 参照。

`pnpm contracts:verify` 运行 compatibility/inventory/toolchain 负例回归、inventory、Buf lint/breaking、JSON Schema dialect/fixture/compatibility、固定工具链、TS/Python/C# round-trip 与连续生成无 diff 检查。

## 离线复现

- Node 与 pnpm 依赖由根 `pnpm-lock.yaml` 固定；本机已有 store 时可用 `pnpm install --offline --frozen-lockfile` 后运行全部 Node/Buff/TS 门。
- Buf 使用本地 npm package `@bufbuild/buf@1.66.1`，TS 插件使用本地 `@bufbuild/protoc-gen-es@2.13.0`，不使用远程插件或 Buf Schema Registry。
- Python round-trip 只接受 `uv 0.11.28`，并使用 `--locked --offline --no-python-downloads`；全新环境必须先按 [supply-chain.md](./supply-chain.md) 校验官方 archive、准备 Python/依赖 cache，离线缺件时失败闭合。
- C# round-trip 只接受 `.NET SDK 8.0.423` 与 locked `Google.Protobuf 3.33.0`。全新环境按 supply-chain 清单校验 archive 后安装，或放到 ignored `contracts/.tools/dotnet/`；`DOTNET_EXE` 指向本地 SDK 时还会校验 launcher SHA-256。
- `toolchain.json` 的支持平台、archive 摘要和 launcher 摘要是机器事实源；工具缺失、版本/摘要/许可证不符均失败，不降为 warn。

## 已落地边界

- Protobuf 只拥有跨进程可调用能力；JSON Schema 只拥有 Document。
- 同一结构不得同时在 Protobuf 和 JSON Schema 中拥有权威定义。当前 proto 只引用 Document 的 id、version 和 digest，不复制 Document 字段。
- `generated/` 只属于 Adapter/Transport 边缘；Kernel/Cognition/UnityAvatarHost Adapter 是当前运行 consumer。
- Extension SDK 只公开 Extension Document 的 authoring/validation edge 与扩展作者/Host Port API；系统配置和 Surface/Product projection 使用 Kernel/Product owner-local model/view mapping，不能把 `contracts` 或 SDK 变成万能业务 helper。

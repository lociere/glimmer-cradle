# Contracts Baseline

> 范围：M12 Slice 1 已落地的 canonical `contracts/` baseline、生成链、兼容基线和验证入口。
> 事实依据：本目录下的 `proto/`、`json-schema/`、`compatibility/`、`generated/`、`scripts/` 与 `tests/`。
> 维护触发：新增或修改 Contract Spine IDL、JSON Schema Document、生成工具链、兼容基线或跨语言验证门。

`contracts/` 是长期 Contract Spine 的 canonical baseline。当前运行主线仍使用 `protocol/`、ZMQ、stdio 和手写 WebSocket；本切片不切 transport、不迁移 runtime consumer，也不删除当前 `protocol/`。

## 目录

| 路径 | Owner | 说明 |
|---|---|---|
| `proto/glimmer/common/v1/` | Contract Spine owner | Protobuf Service baseline，当前只包含最小 `ContractProbeService`。 |
| `json-schema/skill/v1/` | Skill Plane Document owner | JSON Schema Document baseline，当前只包含最小动态 tool parameters Document。 |
| `generated/` | Contract Spine Adapter edge | Buf 生成的 TS/Python/C# DTO；只读，不进入 Domain/Application/Port。 |
| `compatibility/` | Contract Spine owner | 仓库内 Protobuf image 与 JSON Schema compatibility baseline；`buf breaking` 不依赖 BSR。 |
| `fixtures/`、`tests/` | Contract Spine owner | 有效/无效 Document fixture 与三语言最小 round-trip。 |
| `scripts/` | Contract Spine owner | 生成、兼容、inventory 和 C# round-trip 门。 |

## 命令

```powershell
pnpm contracts:generate
pnpm contracts:verify
```

`pnpm contracts:generate` 只重新生成 `generated/`。兼容基线需要有意刷新时运行：

```powershell
pnpm --filter @glimmer-cradle/contracts baseline:refresh
```

`pnpm contracts:verify` 运行 inventory、Buf lint、Buf breaking、JSON Schema dialect/fixture/compatibility、TS/Python/C# round-trip 与生成物无 diff 检查。

## 离线复现

- Node 与 pnpm 依赖由根 `pnpm-lock.yaml` 固定；本机已有 store 时可用 `pnpm install --offline --frozen-lockfile` 后运行全部 Node/Buff/TS 门。
- Buf 使用本地 npm package `@bufbuild/buf@1.66.1`，TS 插件使用本地 `@bufbuild/protoc-gen-es@2.13.0`，不使用远程插件或 Buf Schema Registry。
- Python round-trip 使用 `contracts/tests/python/pyproject.toml` 固定的 `protobuf==6.33.0`；全新环境先执行一次在线 `uv run --project contracts/tests/python python --version` 建立 uv cache，之后可在缓存存在时离线运行。
- C# round-trip 使用 `.NET SDK 8.0.423` 与 `Google.Protobuf` NuGet 包。全新环境先安装/缓存 `.NET SDK 8.0.423` 和 NuGet 包；本机没有全局 SDK 时可把 SDK 放在未入库的 `contracts/.tools/dotnet/` 并设置 `DOTNET_EXE`，之后 `contracts/.gitignore` 会排除本地工具缓存。

## Slice 1 边界

- Protobuf 只拥有跨进程可调用能力；JSON Schema 只拥有 Document。
- 同一结构不得同时在 Protobuf 和 JSON Schema 中拥有权威定义。当前 proto 只引用 Document 的 id、version 和 digest，不复制 Document 字段。
- `generated/` 只属于 Adapter/Transport 边缘；本切片没有任何 runtime consumer import 新生成物。
- Slice 2 之前不得把 Kernel、Cognition、Engine、Avatar、Extension 或 Surface 主线切到 `contracts/`。

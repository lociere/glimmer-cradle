# Contracts Supply Chain Evidence

> 范围：M12 Slice 1 `contracts/` baseline 的生成、lint、breaking、JSON Schema validator、三语言 round-trip 所需外部依赖。
> 事实依据：`contracts/package.json`、root `pnpm-lock.yaml`、`contracts/tests/python/pyproject.toml`、`contracts/tests/csharp/GlimmerCradle.Contracts.Roundtrip.csproj`、本地工具版本输出。
> 维护触发：生成器、runtime、validator、SDK、NuGet/Python/npm 依赖、缓存方式或许可证变化。

| 依赖 | 固定版本 | 用途 | 来源 | 许可证 | 摘要/锁定证据 | 获取与缓存方式 |
|---|---:|---|---|---|---|---|
| `@bufbuild/buf` | `1.66.1` | Buf lint、generate、breaking、本地 Protobuf image | npm registry package | Apache-2.0 | root `pnpm-lock.yaml` integrity；`pnpm --filter @glimmer-cradle/contracts exec buf --version` | `pnpm install --frozen-lockfile`；已有 store 时可 `--offline`。 |
| `protoc` | `33.0.0` | Python/C# builtin generator 所需本地 Protobuf compiler | npm registry package | BSD-3-Clause | root `pnpm-lock.yaml` integrity；`pnpm --filter @glimmer-cradle/contracts exec protoc --version` | `pnpm install --frozen-lockfile`；已有 store 时可 `--offline`。 |
| `@bufbuild/protoc-gen-es` | `2.13.0` | TypeScript Protobuf 生成插件 | npm registry package | Apache-2.0 | root `pnpm-lock.yaml` integrity | 同上；作为 local plugin 运行，不使用远程插件。 |
| `@bufbuild/protobuf` | `2.13.0` | TypeScript serialization runtime | npm registry package | Apache-2.0 | root `pnpm-lock.yaml` integrity | 同上。 |
| `ajv` | `8.20.0` | JSON Schema draft 2020-12 dialect、fixture 和 compatibility 检查 | npm registry package | MIT | root `pnpm-lock.yaml` integrity | 同上。 |
| `protobuf` Python package | `6.33.0` | Python serialization round-trip runtime | PyPI | BSD-3-Clause | `contracts/tests/python/pyproject.toml` 与 uv cache | 全新环境先在线 `uv run --project contracts/tests/python python --version` 建 cache；之后可复用 uv cache。 |
| `.NET SDK` | `8.0.423` | C# compile/run round-trip | Microsoft .NET distribution | MIT | 本机 `contracts/.tools/dotnet/dotnet.exe` SHA256 `E94C17675054A5DEC941971293F08C417756A9A4F78EFB4B7F88E312272A07C2`；安装包来源 `https://builds.dotnet.microsoft.com/dotnet/Sdk/8.0.423/dotnet-sdk-8.0.423-win-x64.zip` | 全新环境安装官方 SDK；无全局 SDK 时放入未入库 `contracts/.tools/dotnet/`。 |
| `Google.Protobuf` NuGet package | `3.33.0` | C# serialization runtime | NuGet | BSD-3-Clause | `contracts/tests/csharp/packages.lock.json` | `dotnet restore --locked-mode`；NuGet global cache 可离线复用。 |

供应链规则：

- canonical `.proto` 与 JSON Schema 全量在仓库内。
- `buf breaking` 使用 `contracts/compatibility/proto-image.binpb`，不访问 Buf Schema Registry。
- `buf generate` 只使用本地 builtin 或本地 npm plugin，不使用 remote plugin。
- NuGet、npm、PyPI 只用于取得固定版本依赖；它们不是 Contract Spine 的权威事实源。

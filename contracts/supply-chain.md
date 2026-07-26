# Contracts Supply Chain Evidence

> 范围：M12 Slice 1 `contracts/` baseline 的生成、lint、breaking、JSON Schema validator、三语言 round-trip 所需外部依赖。
> 事实依据：`contracts/toolchain.json`、`contracts/global.json`、`contracts/package.json`、root `pnpm-lock.yaml`、Python `uv.lock`、C# `packages.lock.json`、依赖包 metadata 与官方发布摘要。
> 维护触发：生成器、runtime、validator、SDK、NuGet/Python/npm 依赖、缓存方式或许可证变化。

`contracts/toolchain.json` 是机器可校验的版本、许可证、官方 archive 摘要与解压后 launcher 摘要清单；`check:toolchain` 同时核对 package metadata、lock integrity、`global.json` 与实际工具版本，缺失、版本错误、摘要错误或许可证漂移均失败。

| 依赖 | 固定版本 | 关系与用途 | 来源 | 许可证 | 锁定证据 |
|---|---:|---|---|---|---|
| `@bufbuild/buf` | `1.66.1` | 直接：Buf lint/generate/breaking/image | [buf](https://github.com/bufbuild/buf) | Apache-2.0 | `pnpm-lock.yaml` integrity 与本地 package metadata |
| `@bufbuild/buf-win32-x64` / `@bufbuild/buf-linux-x64` | `1.66.1` | 必要平台包：Windows/Linux x64 Buf executable | [buf](https://github.com/bufbuild/buf) | Apache-2.0 | 各平台 `pnpm-lock.yaml` integrity 与当前平台 package metadata |
| `@bufbuild/protoc-gen-es` | `2.13.0` | 直接：TS generator | [protobuf-es](https://github.com/bufbuild/protobuf-es) | Apache-2.0 | `pnpm-lock.yaml` integrity 与 package metadata |
| `@bufbuild/protoplugin` | `2.13.0` | 必要传递：`protoc-gen-es` plugin runtime | [protobuf-es](https://github.com/bufbuild/protobuf-es) | Apache-2.0 | `pnpm-lock.yaml` integrity 与 package metadata |
| `@bufbuild/protobuf` | `2.13.0` | 直接且为 generator peer：TS serialization runtime | [protobuf-es](https://github.com/bufbuild/protobuf-es) | (Apache-2.0 AND BSD-3-Clause) | `pnpm-lock.yaml` integrity 与 package metadata |
| `protoc` | `33.0.0` | 直接：Python/C# builtin generator 的 npm-distributed compiler | [protobuf-npm](https://github.com/timostamm/protobuf-npm) | Apache-2.0 | `pnpm-lock.yaml` integrity 与 package metadata |
| `ajv` | `8.20.0` | 直接：JSON Schema draft 2020-12 validator | [Ajv](https://github.com/ajv-validator/ajv) | MIT | `pnpm-lock.yaml` integrity 与 package metadata |
| `uv` | `0.11.28` | Python project/lock runner | [uv](https://github.com/astral-sh/uv) | MIT OR Apache-2.0 | 官方 release archive SHA-256、解压 launcher SHA-256 与运行时 exact-version guard |
| Python `protobuf` | `6.33.0` | Python round-trip runtime | [protobuf](https://github.com/protocolbuffers/protobuf) | BSD-3-Clause | `pyproject.toml` exact pin；`uv.lock` 中 sdist/wheel SHA-256 |
| `.NET SDK` | `8.0.423` | C# build/run | [dotnet/sdk](https://github.com/dotnet/sdk) | MIT | `global.json` 禁止 roll-forward；Microsoft release metadata archive SHA-512；解压 launcher SHA-256；运行时 exact-version guard |
| `Google.Protobuf` | `3.33.0` | C# round-trip runtime | [protobuf](https://github.com/protocolbuffers/protobuf) | BSD-3-Clause | `packages.lock.json` resolved version 与 NuGet content hash |

## 工具 archive 与本地缓存

当前支持的 contracts 验证平台是 Windows x64 与 Linux x64。全新环境只能按以下规则准备 `uv` 和 .NET SDK：

1. 从 `toolchain.json` 对应平台的 HTTPS URL 取得固定 archive。
2. 解压前按清单校验 archive：uv 使用官方 release `.sha256`；.NET 使用 Microsoft `8.0/releases.json` 的 SHA-512。摘要不符立即停止。
3. 解压到未入库的 `contracts/.tools/uv/`、`contracts/.tools/dotnet/`，或安装到受管全局位置；不得把 archive、SDK、venv 或 cache 入库。
4. 使用本地缓存或 `UV_EXE` / `DOTNET_EXE` 时，脚本同时校验 exact version 与从已验证 archive 推导的 launcher SHA-256。全局命令至少必须通过 exact-version guard；`.NET SDK` 还受 `global.json` 的 `rollForward=disable` 约束。

launcher SHA-256 是从“先通过官方 archive 摘要验证、再解压”的对应文件计算所得，不冒充官方发布的 inner-file 摘要。官方来源为 [uv 0.11.28 release](https://github.com/astral-sh/uv/releases/tag/0.11.28)、[uv CLI locked/offline 规则](https://docs.astral.sh/uv/reference/cli/)、[.NET 8 release metadata](https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/8.0/releases.json)。

Python round-trip 固定执行 `uv run --locked --offline --no-python-downloads`；缺少 Python 或 wheel/sdist cache 时必须失败，不允许在线补取或改成 warn。

供应链规则：

- canonical `.proto` 与 JSON Schema 全量在仓库内。
- `buf breaking` 使用 `contracts/compatibility/proto-image.binpb`，不访问 Buf Schema Registry。
- `buf generate` 只使用本地 builtin 或本地 npm plugin，不使用 remote plugin。
- NuGet、npm、PyPI 只用于取得固定且有 lock 摘要的依赖；它们不是 Contract Spine 的权威事实源。

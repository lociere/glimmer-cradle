# M12 Slice 1 Protocol/Contracts Inventory

> 范围：冻结 M12 Slice 1 输入 fixed state 下的旧 `protocol/`、生成链、consumer、validator/build/package 入口，以及本切片建立的 `contracts/` baseline 删除条件。
> 事实依据：`protocol/`、root/package scripts、`core/`、`products/`、`packages/extension-sdk`、`templates/extension-basic`、`docs/reference/protocol.md` 与 `docs/architecture/implementation/Protocol契约层实现.md`。
> 维护触发：旧 protocol 目录、生成链、runtime consumer、配置/SDK consumer、contracts baseline 或删除条件变化。

## 输入 fixed state

| 项 | 值 |
|---|---|
| branch | `main` |
| 起点 commit | `0b997f1f6bc1db4f682c65bb955b990c72a841ec` |
| origin/main | `bb6d5ceff82523615f164e4c7bb97c445bd63c2d` |
| 起点工作树 | clean，`main` ahead 1、behind 0 |
| M11 状态 | 暂停/延期，未完成，未关闭 |
| M12 状态 | Slice 1 active；不进入 Slice 2 |

## 旧 `protocol/` inventory

| 项 | 当前事实 | owner | 当前权威源 | 迁移切片 | 删除条件 |
|---|---|---|---|---|---|
| `protocol/src/schemas/` | JSON Schema 共 106 份：`config` 22、`engine` 2、`enums` 9、`extension` 7、`ipc` 8、`models` 58。 | Protocol owner | `protocol/src/schemas/` | Slice 1 冻结；Slice 2-9 逐边界迁移 | Slice 9 中所有 runtime consumer、生成链、配置/SDK 引用归零后删除；Slice 1 不修改、不删除。 |
| `protocol/src/generated/` | TypeScript 生成物共 112 个 `.ts`：`config` 23、`engine` 3、`enums` 10、`extension` 8、`ipc` 9、`models` 59。 | Protocol owner | `protocol/codegen/gen-ts.ts` 从旧 JSON Schema 生成 | Slice 2-9 按 consumer 迁移 | 对应消费者不再 import `@glimmer-cradle/protocol` 旧 DTO，且新 Adapter contract test 通过后按切片删除。 |
| `core/cognition/src/glimmer_cradle/cognition/protocol/generated/` | Python 生成物共 109 个 `.py`：`config` 23、`enums` 10、`extension` 8、`ipc` 9、`models` 59；存在 `__pycache__` 本地缓存。 | Cognition boundary adapter owner | `protocol/codegen/gen-py.py` 从旧 JSON Schema 生成 | Slice 2、Slice 4 | Cognition transport Adapter 切到 generated contract edge，心智内部无 `protocol/generated/` 领域依赖后删除。 |
| `core/avatar/unity-host/Assets/Scripts/Avatar/Contracts/PresentationFrames.g.cs` | Unity C# Presentation frame 生成物，只读；由 `protocol/codegen/gen-cs.ts` 生成。 | Avatar Host boundary adapter owner | `PresentationDownstreamFrame` / `PresentationUpstreamFrame` JSON Schema | Slice 5 | Core Avatar 与 UnityAvatarHost 分离、Host Adapter mapping 与 Unity build 通过，旧六 asmdef/旧目录/复制源码扫描归零后删除旧生成入口。 |
| `protocol/src/runtime/` | TS runtime validator、normalizer、reply/avatar helper；配置校验通过 `validateConfig` 暴露给 Kernel。 | Protocol runtime helper owner | `protocol/src/runtime/` 与 `protocol/src/config-schemas.ts` | Slice 1 冻结；配置 Document 迁移另行切片 | 所有配置/运行时 validator consumer 有新的 JSON Schema Document owner 与替代入口后删除；Slice 1 不迁移配置运行时。 |

## 生成、validator、build、package 入口

| 项 | 当前事实 | owner | 当前权威源 | 迁移切片 | 删除条件 |
|---|---|---|---|---|---|
| `pnpm sync:contracts` | root script 指向 `pnpm --filter @glimmer-cradle/protocol gen:all`。 | Protocol owner | root `package.json` | Slice 9 | 所有旧 protocol consumer 归零，`contracts/` 生成链成为运行事实后删除或改名；Slice 1 保留。 |
| `protocol/package.json gen:all` | 顺序运行 `gen:ts`、`gen:py`、`gen:cs`。 | Protocol owner | `protocol/package.json` | Slice 2-9 | 对应旧语言投影消费者迁移完成后删除。 |
| `protocol/codegen/{gen-ts.ts,gen-py.py,gen-cs.ts}` | JSON Schema -> TypeScript/Python/C# 的旧生成器。 | Protocol owner | `protocol/codegen/` | Slice 2-9 | 所有旧生成物消费者归零，且新 Buf/JSON Schema 门覆盖后删除。 |
| `@bufbuild/buf` in `protocol/package.json` | 当前锁定解析为 `1.66.1`，但旧 protocol 生成链不使用 Protobuf Service baseline。 | Protocol owner | `pnpm-lock.yaml` | Slice 1 建立新 baseline | 新 `contracts/` 使用本地 Buf CLI；旧 protocol 是否保留由 Slice 9 决定。 |
| `ajv` / `ajv-formats` | 旧 JSON Schema validator runtime 位于 `@glimmer-cradle/protocol`。 | Protocol runtime helper owner | `protocol/src/runtime/validator.ts` | Document 迁移相关切片 | 配置/manifest/package/dynamic params 均有 `contracts/json-schema` owner、兼容门和 runtime adapter 后迁移。 |
| root build/package consumers | `build:all`、Kernel/Desktop/Personal Server/Extension SDK prebuild/pretypecheck/pretest 均先 build `@glimmer-cradle/protocol`。 | 对应 package owner | root 和各 package `package.json` | Slice 2-9 | 对应 package 不再消费旧 protocol runtime 或 DTO，并有替代 contract edge 后删除。 |

## 配置 consumers

| 项 | 当前事实 | owner | 当前权威源 | 迁移切片 | 删除条件 |
|---|---|---|---|---|---|
| system config schema | `protocol/src/schemas/config/*.schema.json` 定义 `AppConfig`、`AudioConfig`、`AvatarConfig`、`CognitionConfig`、`ExtensionConfig`、`SkillPlaneConfig` 等 22 份配置契约。 | Config Application / Protocol owner | `protocol/src/schemas/config/` | M12 后续 Document 切片；Slice 1 不迁移 | 新 `contracts/json-schema` Document schema、normalizer、默认模板、Guide 和 compatibility 门落地，旧 imports 归零后删除。 |
| Kernel ConfigManager | `core/kernel/src/foundation/config/config-manager.ts` import `validateConfig`、`normalizeSystemYamlNulls` 与 config types。 | Kernel Config Application owner | `@glimmer-cradle/protocol` runtime helper | 后续配置 Document 迁移切片 | Kernel config adapter 改用 `contracts/json-schema` 入口且测试通过后删除旧 runtime 依赖。 |
| Product composition | `docs/reference/product-compositions.md` 记录 `products/` 清单遵循 `protocol/src/schemas/models/ProductComposition.schema.json`。 | Product Composition owner | `protocol/src/schemas/models/ProductComposition.schema.json` | Surface/Product 相关切片 | Product composition Document owner 与 validator 迁移后删除旧 schema。 |

## SDK consumers

| 项 | 当前事实 | owner | 当前权威源 | 迁移切片 | 删除条件 |
|---|---|---|---|---|---|
| `packages/extension-sdk` | 依赖并 re-export `@glimmer-cradle/protocol` 的 manifest、permission、events、distribution、host process contracts。 | Extension SDK owner | `packages/extension-sdk/package.json` 与 `src/contracts` | Slice 6 及后续 SDK 文档契约切片 | Extension Host、Package Manager 和公开 SDK 迁移到 `contracts/` contract edge，跨仓兼容测试通过后删除旧 protocol dependency。 |
| `templates/extension-basic` | 模板 package 的 dependencies/devDependencies 声明 `@glimmer-cradle/protocol` workspace。 | Extension template owner | `templates/extension-basic/package.json` | Slice 6 | Extension SDK 发布物不再要求模板直接依赖旧 protocol 后删除。 |
| Kernel Extension Host old path | `core/kernel/src/host/process/*`、Extension runtime registry 和 installer import `@glimmer-cradle/protocol`。 | Kernel Extension supervision owner | Kernel host/process 与 application services | Slice 6 | 独立 Extension Host 进程和 contracts Adapter 通过崩溃/权限/回收门后删除旧 worker 协议。 |

## Slice 1 `contracts/` baseline inventory

| 项 | 当前事实 | owner | 当前权威源 | 迁移切片 | 删除条件 |
|---|---|---|---|---|---|
| Protobuf Service baseline | `contracts/proto/glimmer/common/v1/contract_probe.proto` 定义最小 `ContractProbeService`、`ContractProbeRequest`、`ContractProbeResponse`、`DocumentReference` 和 `TraceMetadata`。 | Contract Spine owner | `contracts/proto/` | Slice 1 | 只在新兼容世代或审查通过的 baseline refresh 中演进；不得由 runtime consumer 手写镜像替代。 |
| JSON Schema Document baseline | `contracts/json-schema/skill/v1/tool-parameters.schema.json` 定义动态 Skill tool parameters Document。 | Skill Plane Document owner | `contracts/json-schema/` | Slice 1 | Document 结构只能由 JSON Schema 演进；Protobuf 只引用 id/version/digest。 |
| Generated DTO | `contracts/generated/{ts,python,csharp}` 由 `buf generate` 生成。 | Contract Spine Adapter edge owner | `contracts/buf.gen.yaml` | Slice 1 | 手改生成物或生成后有 diff 时门禁失败；Domain/Application/Port 不得 import。 |
| Compatibility baseline | `contracts/compatibility/proto-image.binpb` 与 `json-schema-baseline.json` 在仓库内，`buf breaking` 不依赖 BSR。 | Contract Spine owner | `contracts/compatibility/` | Slice 1 | 破坏性变更必须经有意 baseline refresh 与审查；普通生成不自动刷新。 |
| Supply chain evidence | `contracts/supply-chain.md` 记录版本、来源、许可证、摘要与缓存/获取方式。 | Contract Spine owner | `pnpm-lock.yaml`、NuGet/package caches、工具版本输出 | Slice 1 | 工具版本或来源变化时同步更新并重跑验证。 |

# Contract Spine 实现

> 范围：Contract Spine 如何定义、生成、校验并由 Service Adapter、Document validator 和 Extension SDK 消费。
> 源码依据：`contracts/`、`packages/extension-sdk/`、各 owner 的 Adapter 与 composition root。
> 维护触发：IDL、Document、生成链、兼容基线、公开 SDK 或跨边界 consumer 变化。

## 物理结构

```text
contracts/
├── proto/glimmer/{common,kernel,cognition,surface,avatar,engine/audio,extension}/v1/
├── json-schema/{common,config,extension,presentation,product,skill}/v1/
├── generated/{ts,python,csharp}/
├── compatibility/{proto-image.binpb,json-schema-baseline.json}
├── scripts/
├── tests/
├── inventory.md
└── supply-chain.md
```

`protocol/` 已删除。Root workspace、package scripts、lock、Docker/build/package、产品、模板与运行时均不再消费该 package，也不保留重命名后的万能 helper 目录。

## Service 生成链

`contracts/buf.gen.yaml` 从 `contracts/proto/` 生成 TS/Python/C# DTO 与 service stub。生成输出只在边缘消费：

- Kernel Cognition Adapter ↔ Python Cognition `adapters/kernel/grpc_transport.py`；
- Kernel Surface Adapter ↔ Desktop/Personal Server gateway client；
- Kernel Avatar Adapter ↔ Unity Host `Adapters` assembly；
- Kernel Audio Adapter ↔ Python Audio `grpc_host.py`；
- Kernel Extension supervision ↔ 独立 Extension Host Adapter。

Domain/Application/Port 使用 owner-local model；Adapter 显式映射 generated DTO。Avatar C# Adapter 直接读写二进制 generated DTO，不做 JSON formatter/parser round-trip。Python Contracts 通过 `glimmer-cradle-contracts` distribution 进入 Cognition、Audio、Desktop runtime 与 Personal Server OCI build，不依赖源码树 `PYTHONPATH`。

## Document registry 与校验

Canonical JSON Schema 位于 `contracts/json-schema/`。`@glimmer-cradle/contracts` 通过 package export 暴露 Schema 文件；Kernel config、Extension SDK manifest/package、Personal Server Product composition validator 各自注册所需 Schema 和外部 `$ref`，再用 AJV 2020-12 校验。

职责保持分离：

- Contracts 拥有 serialized Document schema、compatibility metadata 与最小 registry/validation primitive；
- Kernel Config 拥有 YAML normalizer、默认加载、secret/path 与应用语义；
- Extension SDK 拥有公开 manifest/package API、权限与 validator entry；
- Product 拥有 composition/view mapping；
- reply、Avatar、observability 与 UI helper 留在直接 owner，不进入 Contracts。

schema-derived TypeScript projection 只服务对应 owner edge，不是第二 canonical source；Schema 变更必须同时更新 validator fixture、projection mapping 和 consumer tests。

## 兼容基线

```powershell
pnpm contracts:generate
pnpm contracts:verify
pnpm --filter @glimmer-cradle/contracts baseline:refresh:json-schema
```

Proto image 是跨版本 breaking 参照，不能因 Document 迁移重建。JSON-only refresh 只更新 Schema path/id/metadata/digest baseline；通用 `baseline:refresh` 同时重建两类基线，必须限于明确评审两者都变化的场景。

## 运行链

Kernel composition root 为受管 service 分配动态回环 endpoint 与进程级 capability token，启动对应 Host/Engine 后等待真实 readiness。调用携带 deadline、cancellation、trace、causation/correlation 与 generation；typed failure 通过稳定 code/detail 返回。进程退出、超时或主动 stop 会撤销 endpoint/token、取消 in-flight operation 并回收 lease/进程树。

Surface 的浏览器 WebSocket 只属于 Personal Server 产品 ingress；它代理到内部 `SurfaceGatewayService`，不是器官间手写协议。Audio 的音频字节通过 `AudioMediaReference` lease data plane，普通 gRPC 只携带 control DTO。Avatar 使用 `AvatarHostService.Connect` 双向 stream，旧 WebSocket control consumer 不存在。

## 调试入口

| 症状 | 先查 |
|---|---|
| TS/Python/C# 字段不一致 | canonical `.proto`、`pnpm contracts:generate`、generated-clean gate |
| Document 校验失败 | canonical Schema `$id`/`$ref`、registry 注册顺序、owner normalizer 与 fixture |
| compatibility 失败 | `contracts/compatibility/`、是否误刷新 Proto image、JSON Schema baseline diff |
| gRPC unknown/typed error | producer model → Adapter mapping → generated DTO → consumer mapping |
| Avatar frame 不兼容 | Avatar IDL、Kernel/Unity Adapter、binary round-trip 与 unknown payload fail-close |
| Audio 引用失效 | lease owner/access/expiry/root/size/SHA-256 与 crash cleanup |
| Extension public type 漂移 | Extension SDK export、canonical Document Schema、Kernel/Product owner-local mapping |

## 验证

```powershell
pnpm contracts:verify
pnpm --filter @glimmer-cradle/extension-sdk typecheck
pnpm --filter @glimmer-cradle/kernel typecheck
pnpm typecheck
pnpm build
```

按变更补充 Cognition/Audio Python tests、C# Core/Adapter tests、Unity Host/Player、Surface 产品测试、Extension Host lifecycle、安装/打包和旧引用扫描。`scripts/check-architecture.mjs` 与 `contracts/scripts/check-inventory.mjs` 对 `protocol/` 目录和 package dependency fail-close。

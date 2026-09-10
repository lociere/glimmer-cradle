# Extension SDK Reference

> 范围：Extension 的公开 SDK、manifest、权限、contribution、Host Port、Skill Plane 关系和生命周期规则。
> 事实依据：`packages/extension-sdk/`、`hosts/extension-host/`、`templates/extension-basic/`、独立 `glimmer-cradle-extensions` 仓库、`data/packages/extensions/<extension-id>/<version>/`、Kernel Extension supervision、Skill Plane 实现。
> 维护触发：SDK export、manifest schema、contribution point、Port、permission、activation、disposable 或 Skill Plane 映射变化。

Extension 是可安装、可禁用、可授权、可升级和可回收的生态能力单元。它通过公开 SDK 与 Host Port 接入当前角色的能力边界，不 import Kernel 内部对象，不直接访问 Cognition 私有状态。

## 关键目录

| 目录 | 职责 |
|---|---|
| `packages/extension-sdk/` | `@glimmer-cradle/extension-sdk` 公开 API |
| `templates/extension-basic/` | 新扩展基础模板、manifest、配置 schema 示例 |
| `glimmer-cradle-extensions/extensions/<extension-id>/` | 微光摇篮第一方可选扩展源码；不收纳第三方 Adapter |
| `glimmer-cradle-extensions/registry/catalog.json` | 默认审核与发现目录；与第一方源码共仓，但不保存扩展源码、制品或 SBOM |
| `glimmer-cradle-napcat-adapter/` | 独立第三方 Adapter 示例；依赖 NapCat/QQ，不属于第一方扩展集合 |
| `data/packages/extensions/<extension-id>/<version>/` | Extension Host 唯一运行期发现目录，只保存已构建发布投影 |
| `data/packages/managed-resources/<extension-id>/` | 扩展声明并由 Host 管理的第三方程序包 |
| `core/kernel/src/application/extension-supervision/ 与 core/kernel/src/adapters/extension-host/` | Extension Host、激活、权限、Port 实现 |
| `hosts/extension-host/` | 第三方扩展入口加载、SDK Context bridge、handler registry 和 disposable lifecycle |
| `core/kernel/src/application/skill-plane/` | Skill Plane catalog、policy、gateway、provider |

需要序列化和版本化的 Extension Manifest、包、Release 与 Registry Document 由 `contracts/json-schema/extension/v1/` 定义，`@glimmer-cradle/extension-sdk` 提供 schema-derived public edge 与 validator。Extension Host process 的 Service/Document 契约位于 `contracts/proto/glimmer/extension/v1/` 与 `contracts/json-schema/extension/v1/`；SDK 的 `host/process-protocol.ts` 是当前 Node IPC transport mapping owner，stage 对齐 Contract Spine generated enum，Host 只 re-export。SDK public API 只包含扩展作者和 Host Port 的 manifest、package、permissions、contribution、events 与有限 lifecycle/readiness 类型；Audio/Embedding/Memory/SkillPlane config、Surface presentation、Control Center、安装态和系统 runtime projection 均不公开。Kernel 拥有安装验证、权限裁决、生命周期、进程监督、catalog/projection 和内部 Port；产品只保留自身 view mapping。`src/contracts/public-boundary.test.ts` 递归检查 barrel/re-export 图和 production named import，禁止这些非 owner 类型回流。

独立扩展发布物把 `@glimmer-cradle/extension-sdk` 声明为语义化版本 peer dependency；Extension Host 产品组装会在发行物内提供与当前主程序匹配的 SDK module root，这属于产品携带的扩展执行环境，不是扩展安装包对 Kernel 源码的依赖。扩展安装包不得复制 Kernel/Contracts 源码或依赖主仓库相对路径。

公开工具链由同版本的 `@glimmer-cradle/contracts` 与 `@glimmer-cradle/extension-sdk` 两个 npm 包组成。Contract 包只发布生成后的 TypeScript Service/DTO 与 canonical JSON Schema；SDK 把它作为精确运行依赖并提供作者可用的 schema-derived validator、类型与 Host Port。扩展作者只声明 SDK peer，不直接声明 Contract 包，也不得恢复已删除的 `@glimmer-cradle/protocol`。`pnpm verify:extension-sdk-release` 会构建两个包、检查 allowlist、排除测试/compatibility 内容，并从生成的 tarball 在干净 consumer 中安装和加载公开 validator。

主仓使用 `extension-sdk-v<semver>` 精确 tag 触发 `.github/workflows/release-extension-sdk.yml`。workflow 固定两个 npm tarball 与 `SHA256SUMS`，重验后按 Contract → SDK 顺序发布；发布 job 绑定 `npm` Environment，并要求已拥有 `@glimmer-cradle` scope 的 `NPM_TOKEN`。依赖该版本的扩展 Release workflow 必须从同一 SDK tag 重新 pack Contract/SDK，并把本地 tarball SHA-1 与 npm `dist.shasum` 逐包比较后才允许构建扩展制品，由此同时证明公开可取得性和 tag/npm 内容一致。发布与 Git tag 都是显式外部操作，不由本地构建或产品 `v<semver>` Release 自动触发。

## 包导出

`@glimmer-cradle/extension-sdk` 通过 `exports` 暴露稳定入口。每个入口都同时声明 `types`、`require`、`import` 和 `default`，确保 Kernel 构建、Vitest、扩展模板和第三方扩展在 CJS/ESM 工具链下解析一致。

当前公开入口：

| 入口 | 内容 |
|---|---|
| `@glimmer-cradle/extension-sdk` | SDK 汇总入口 |
| `@glimmer-cradle/extension-sdk/contracts` | 协议相关扩展侧类型 |
| `@glimmer-cradle/extension-sdk/host` | Host Port 与 ExtensionContext 类型 |
| `@glimmer-cradle/extension-sdk/events` | Extension 事件类型 |
| `@glimmer-cradle/extension-sdk/manifest` | manifest schema 与类型 |
| `@glimmer-cradle/extension-sdk/lifecycle` | `defineExtension`、`BaseExtension` |
| `@glimmer-cradle/extension-sdk/utilities` | 通用工具 |
| `@glimmer-cradle/extension-sdk/utilities/websocket` | WebSocket bridge |
| `@glimmer-cradle/extension-sdk/permissions` | 权限枚举与检查 |
| `@glimmer-cradle/extension-sdk/distribution` | `.gcex` 构建、Release Manifest、Registry 契约、校验与安全解包 |

## manifest 字段

| 字段 | 语义 | 注意 |
|---|---|---|
| `id` | 全局稳定扩展 ID | 必须使用 `publisher.extension` 命名空间；publisher 必须与第一段一致，不随展示名或仓库名变化 |
| `version` | 扩展发布版本 | 必须使用 SemVer；安装目录名、manifest 和 `active.yaml` 必须完全一致 |
| `name` / `description` | 展示与能力描述 | 不夸大能力，供用户和 planner 理解边界 |
| `activationEvents` | 激活时机 | 不用于权限判断 |
| `requires` | 需要宿主提供的 Port | 不是授权 |
| `permissions` | 访问敏感能力或注册能力的授权 | 调用前仍需 Policy |
| `activationProfiles` | 按产品、平台和 feature 声明可选运行形态及其增量权限 | Host 选择后再裁剪 contribution；不得用第三方配置字段代替 |
| `contributionPoints` | 扩展自带的 contribution point definition | 只有安装并注册了 definition 的 point 才能解释、授权和执行 |
| `contributes` | 按 contribution point id 分组的开放贡献表 | `contributes.<pointId>[]` 是唯一贡献声明主线；官方能力也用 `glimmer.*` point 表达 |
| `configuration` | 扩展配置 schema 或声明 | 普通配置不含密钥 |

Contribution declaration 可以携带 `audience`，枚举为 `character`、`user`、`host`、`renderer`、`extension`、`adapter`。它是能力隔离字段，不是 UI 标签：

- `character`：人物可请求，允许进入 Skill Plane/agent_plan。
- `user`：Control Center 或管理 UI 的用户手动动作。
- `host`：Kernel/Host lifecycle、readiness、supervision 使用。
- `renderer`：Renderer 展示/投影使用，不可执行。
- `extension`：扩展内部链路使用。
- `adapter`：平台 Adapter ingress/output 或协议桥链路使用。

默认值保守分层：`glimmer.skill` 默认 `character`，且其 tool/resource/prompt 级 `audience` 可覆盖为非 character；`glimmer.command` 与 `glimmer.managementSurface` 默认 `user`；`glimmer.managedResource` 与 `glimmer.capability` 默认 `host`；`glimmer.protocolBridge` 在 Host runtime projection 中默认 `adapter`，复杂扩展应在 manifest 中显式声明。未显式成为 `character` 的运行期 `registerSubAgent()` 不会注册为人物 Skill。

开放性来自 Contribution Point Registry，而不是不断增加 manifest 顶层字段。当前 SDK 预注册的官方 point 包括 `glimmer.command`、`glimmer.setting`、`glimmer.skill`、`glimmer.capability`、`glimmer.managedResource`、`glimmer.protocolBridge`、`glimmer.managementSurface`、`glimmer.diagnostic`、`glimmer.provider`、`glimmer.view` 和 `glimmer.automation`。它们只是内建 definition，不是扩展平台的固定边界。

未知 contribution point 会被 Host 索引并投影为 `unsupported`，用于诊断和包完整性检查；在缺少对应 definition/provider 和授权前，不会执行、不进入 Cognition、不会获得权限。

第三方包、外部进程、本地服务和协议桥通过 `glimmer.managedResource` / `glimmer.protocolBridge` 声明。带 `package.installDir` 的资源会先检查本地目录；缺失且声明了 `githubRelease`/`downloadUrl` 来源时，由宿主级 dependency installer 下载到数据根缓存并解压到数据根包目录。`readinessGates` 声明 startup、liveness、readiness、management 等检查点；检查通过只能证明对应节点状态，不能代表整个扩展 ready。

扩展运行事实由 Host 生产 `ExtensionRuntimeProjection`，公开结构由 Extension SDK `contracts` 入口稳定暴露；它是 Service edge projection，不再维护等价 JSON Schema。投影包含 lifecycle、contribution point definitions、Capability Graph、action intents 和 diagnostics。Renderer/Control Center 只消费该投影，不读取扩展 DB、日志、本地端点或 manifest 固定字段来推断 ready。

`@glimmer-cradle/extension-sdk/host` 的 Host process protocol 只描述 Kernel supervision 与 `hosts/extension-host` 的 IPC。阶段必须区分 `process_alive`、`connected`、`handshake`、`resource_prepared`、`ready`、`degraded`、`failed`、`stopping` 和 `stopped`；前一阶段不能冒充后一阶段。Kernel 依据产品、平台和 feature 解析 `activationProfiles`，将裁剪后的 manifest 用于权限与 contribution 注册，并只把通用 `activationProfile` 标识传入 `ExtensionContext`；Host/SDK 不解释任何第三方 profile 名称或配置字段。扩展声明并获批 `SECRET_READ_SELF` 后，Kernel 可从 `configs/secrets/extensions/<extension-id>.yaml` 读取当前扩展自己的字符串键值 Secret，并允许该扩展通过 `ctx.ports.secrets.get(key)` 按需读取单个值；缺少权限时请求会被拒绝。第三方 handler、订阅、timer 和配置校验都在 Host process 内，Kernel 只接收受控 Port RPC 并执行权限/Policy/catalog/projection。

路径约定：

- manifest/config 中优先写可迁移的相对路径，例如 `data/packages/managed-resources/<extension-id>/<resource-id>`；
- Host 进入执行边界前会解析成绝对路径；
- `data/...` 默认指向 `<app-root>/data`，打包后可通过 `GLIMMER_CRADLE_DATA_ROOT` 切到用户数据目录；
- 需要固定本机安装位置时可以写绝对路径，但这会降低扩展可迁移性。

Control Center 的扩展页请求 Host runtime projection，提供安装、卸载、激活/停用、热启动/热关闭、配置编辑和本地诊断入口。安装目录允许多个版本并存，`configs/extensions/active.yaml` 必须以 `{ id, version, profile }` 精确选择版本与 activation profile，并且只有 Kernel `ExtensionManager` 可以原子改写它；Desktop 和 Personal Server 只提交用户意图。扩展在 `contributes.glimmer.setting` 声明的普通配置会从 Capability Graph 派生为通用表单控件；高级 YAML 只作为结构化声明不足时的兜底入口。

## 发布包与安装来源

`.gcex` 是 ZIP 容器，但扩展生态只把以下结构视为有效发布包：

```text
publisher.extension-1.0.0-any.gcex
├── extension/
│   ├── extension-manifest.yaml
│   └── dist/...
└── META-INF/
    ├── gcex.json
    ├── checksums.json
    └── sbom.spdx.json
```

- `extension/` 是唯一安装 payload；包配置必须显式列出进入 payload 的路径。
- `checksums.json` 覆盖全部安装 payload 和 SBOM，安装前与提交安装前各验证一次；包信封和完整性清单本身由严格 Schema 与归档校验约束。
- `sbom.spdx.json` 是每个 `.gcex` 自带的 SPDX 2.3 组件清单，不依赖 Registry。通过第三方仓库、Release Manifest 或本地包安装时同样存在。
- `META-INF` 不进入扩展执行目录；它只服务供应链校验、审计和诊断。
- `.gcex` 是唯一必需发布物。`buildGcexPackage()` 默认只生成一个自包含包，本地安装、离线分发和只有一个适用制品的仓库 Release 不需要包外 JSON。
- `release-manifest.json` 是可选的作者侧发布索引，只用于聚合多平台制品、表达 channel、在下载前绑定外层归档大小与 SHA-256，或关联可选签名/构建证明。由于它摘要整个 `.gcex`，不能嵌入被摘要的归档自身；只有显式调用 `buildExtensionReleaseManifest()` 才会生成。

安装来源有四种，但都进入同一个 Kernel Package Manager：

| 来源 | 用途 | 信任语义 |
|---|---|---|
| Registry | 发现经审核扩展和稳定/测试通道 | 提供 listing/publisher 审核信号，不替代包校验 |
| Release Manifest URL | 已知发布者的精确发布 | 校验清单与 `.gcex` 摘要，不声明官方审核 |
| Repository Release | GitHub/GitLab/Gitea 精确 tag | 优先解析 Release Manifest；缺失时按 `<id>-<version>-<platform>.gcex` 选择当前平台唯一制品；禁止跟随浮动分支 |
| Local `.gcex` | 离线、开发和企业分发 | Desktop 通过系统文件选择器交给 main；Personal Server 只接受认证后的受限字节上传，浏览器换取 opaque `upload_id` 后再进入同一安装事务，不接受浏览器指定服务器路径 |

安装分为 `prepare -> preview -> commit`：Kernel 下载到事务目录，逐跳拒绝非 HTTPS 或超过上限的重定向；SDK 在解压过程中限制文件数和膨胀体积，再验证路径、manifest、平台、摘要和 SBOM。安装预览的权限集合是顶层权限与当前产品/平台所有兼容 activation profile 增量权限的并集，不兼容 profile 的权限不会扩散到当前产品；这保证以后切换兼容 profile 时不会取得未经安装确认的能力。用户确认的权限集合必须与该预览完全一致，Kernel 才重新验证并原子安装到 `data/packages/extensions/<id>/<version>/`。权限集合不一致时仍可取消或重新确认；权限确认通过后的 commit 无论成功或失败都是终结操作，会清理事务缓存与 staging。扩展目录落位和安装元数据写入属于同一提交结果，任一步失败都回滚新版本；正在运行或被 active config 选中的版本不能卸载。

Personal Server 的浏览器本地包是这条事务的受控前置步骤，而不是第二条安装主线：`POST /api/v1/extensions/local-package` 只接受同源、已认证请求，限制 `.gcex` 扩展名与 256 MiB 大小上限，把字节流写入 Product Host owned 临时目录，并返回绑定当前 principal/session、30 分钟时效、单次消费的 opaque `upload_id`。后续 `extension_install_prepare` 只能提交 `uploaded_package.upload_id`；Host 在当前会话内把它解析为受控 file source 后再转给 Kernel Package Manager。prepare 完成、失败、取消、断线或超时都会清理上传文件与索引；commit/cancel 对所有 transaction_id 都要求属于当前登录会话，Host 断线会主动取消已预览未提交事务，Kernel Package Manager 启动和定时 sweep 仍会清理 stale transaction 目录。

默认 Registry 位于 `glimmer-cradle-extensions/registry/catalog.json`。它与第一方扩展源码共用仓库和 CI，但只保存扩展身份、仓库、归属、审核/安全状态和作者侧发布来源指针，不复制扩展 manifest、权限、贡献点、源码、`.gcex`、Release Manifest、SBOM、签名或构建证明。社区可以运营兼容 Registry，也可以完全不进入目录而直接发布；是否被目录收录与是否符合安装协议是两件事。

最小与高级发布形态分别为：

```text
# 普通或通用扩展
publisher.extension-1.2.0-any.gcex

# 多平台或需要发布级摘要绑定
publisher.extension-1.2.0-windows-x64.gcex
publisher.extension-1.2.0-linux-x64.gcex
release-manifest.json            # 可选，由作者的 Release 托管
release.sigstore.json            # 可选，由作者的 Release 托管
```

## Port 与权限

`requires` 表示扩展希望 Host 注入某类 Port，例如 `agents`、`commands`、`storage`、`evidenceProposal`、`perception`、`sceneAttention`、`events` 或 `runtime`。`permissions` 表示允许访问的敏感能力，例如注册 Agent/Skill、命令、外部平台、文件、网络、通知或运行投影上报。缺少权限时，即使 Port 存在也应拒绝对应操作。

| Port | 语义 | 主要权限 | 边界 |
|---|---|---|---|
| `evidenceProposal` | 提交带来源的证据候选 | `EVIDENCE_PROPOSAL_WRITE` | Kernel 转成 `ambient + observe_only + memory_candidate` 感知，不直写 Memory |
| `perception` | 提交带 `ConversationAddress` 的清洗后感知 proposal | `PERCEPTION_WRITE` | canonical topology 由 Kernel 生成，进入 Cognition 后才成为经历 |
| `sceneAttention` | 申请注意力租约或查询当前焦点 | 无单独写权限，受 Host 边界约束 | 不代表控制角色或 Avatar |
| `runtime` | 上报 Capability Graph 增量和诊断投影 | `RUNTIME_PROJECTION_WRITE` | Host 合并为 `ExtensionRuntimeProjection`；扩展不能直接写 Renderer view model |

`ctx.config` 与 `ctx.ports.secrets` 是两条独立边界：前者要求 `CONFIG_READ_SELF`，允许结构化普通配置；后者要求 `SECRET_READ_SELF`，只接受当前扩展 Secret 文件中的字符串值并按 key 读取。Secret 不进入 manifest、普通配置、运行投影、日志或控制表面读取响应，扩展不得把它复制到 storage 或 diagnostics。

Extension handler 返回值必须可 JSON 序列化；错误抛出清晰 message，由 Host 统一记录 trace、extension id、skill/tool id 和权限决策。

`sceneAttention.requestAttentionLease()` 申请一个注意力租约，请求字段包括 `sceneId`、`channelId`、`actorId`、`strength`、`reason` 和 `durationMs`；返回的 `Disposable` 用于释放该租约。它不等同于扩展控制当前角色或 Avatar。Adapter 可以用它表达“某个外部上下文正在被关注”，例如把群聊注意力细分到发送者；后续是否回复、是否外显表情，仍由 Cognition 和 Kernel Surface 决定。按照 [ADR-0002](../architecture/decisions/ADR-0002-AttentionLease与CognitiveActivity分层.md)，Kernel 内部由 `AttentionLeaseStore` 持有 Attention Lease 并生成 Attention Projection。

认知相关 SDK 能力只提交 proposal：`perception.inject()` 和 `evidenceProposal.submit()` 都要求 `ConversationAddress`。Extension 只决定外部平台的 account/space/thread/endpoint 与 visibility，Kernel 生成 canonical `ConversationContext`、不可逆 actor id、trust、privacy 和 cognitive effect。`perception.content` 不允许提交 `actor_id` / `actor_name`；`evidenceProposal` 只接受 `address`、`content`、`sourceEventId` 与 `schemaRef`。证据候选先成为 Moment，再经 Conversation/Episode、结构化巩固和证据校验决定是否成为版本化 Memory。公开 SDK 不提供第二套会话连续性入口或 Memory CRUD。

## Skill Plane 映射

扩展可以通过 `contributes.glimmer.skill` 声明 Skill Plane 能力目录，也可以在激活后通过 Host Port 绑定运行时 handler。只有 skill audience 以及对应 tool/resource/prompt audience 都是 `character` 的项会进入人物 Skill catalog；character skill 下显式标为 `user`、`host`、`adapter`、`renderer` 或 `extension` 的子项不会进入 catalog，也不能通过 Gateway 读取或渲染。非 character 的管理命令、Host lifecycle、Adapter bridge、Renderer 投影和扩展内部能力只留在 runtime projection 或对应 Port，不会进入 agent_plan。静态声明没有 handler 时，目录项应标记为 `contract_only`，不可执行。Skill catalog 从 Contribution Registry 与 Capability Graph 派生；可执行调用必须经过：

```text
SkillCatalog
  -> SkillPolicyEngine
  -> SkillInvocationGateway
  -> Extension provider handler
```

Extension 不直接被 Cognition 调用；Cognition 只看到经 Kernel 规范化后的 catalog 和工具结果。

Skill 及其 tool/resource/prompt 可以声明 `scope`：`global` 对所有匹配产品上下文可见，`source_provider` 只对指定能力来源可见，`scene` 与 `conversation` 分别绑定 canonical 场景或会话。扩展可用 `$self` 表示自己的 provider ID，Host 注册时会解析成稳定 Extension ID。`requirements` 同时限制产品、平台和 feature；顶层 Extension Manifest 决定包能否安装/加载，贡献级 requirements 决定某项能力能否注册。规划和调用都必须携带当前 `ConversationContext`，Gateway 会再次校验 scope，不能靠直接调用越权。

## 生命周期

- 扩展入口只负责声明和组装。
- 所有订阅、计时器、网络连接、文件句柄、平台连接和注册项必须注册 disposable。
- 停用或 Kernel 停机时，Host 必须按 disposable 释放资源并撤销 catalog。
- 激活失败应进入扩展级 degraded/failed，不影响无关生命周期单元。
- 旧 handler 或旧 catalog 项不得在重启后复用。

## 禁止项

- import `core/kernel/src/**` 或 Cognition 私有模块。
- 把平台原始 payload 直接交给 Cognition。
- 在未声明权限时读写配置、文件、记忆、命令或外部平台。
- 在普通配置、manifest、日志或示例中写密钥。
- 用 Extension 承载官方本体能力，如 Audio Engine、Avatar、Cognition。
- 未经显式 Avatar contribution/permission 直接控制 Live2D、Unity 参数、动作或模型加载。

开发步骤见 [扩展开发](../guides/subsystems/扩展开发.md)，Skill Plane 实现见 [Extension 与 Skill Plane 实现](../architecture/implementation/Extension与SkillPlane实现.md)。

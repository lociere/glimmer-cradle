# Glimmer Cradle v2.1 最终物理目录与文件契约

> 范围：完整首版的主仓库文件、外部扩展模板、生成物、安装及运行数据空间。
> 依据：[最终蓝图](./Glimmer_Cradle_Architecture_Baseline_v2.1_Frozen.md)、[ADR-0023](../decisions/ADR-0023-最终目标蓝图与物理目录契约.md)。
> 状态：冻结目标，非当前源码树。维护触发：目标文件、包边界、制品或路径策略变化。

本规范与主蓝图共同定义最终实物。机器清单中的每一个源文件和推导出的父目录均在下方展开，
不以 `src/...`、`tests/...` 或“其他配置”代替。生成器的输出、平台二进制和用户内容按独立空间登记；
它们的实际文件名由固定输入的构建 inventory 或运行 manifest 枚举，不能预先假定所有哈希和平台版本。

## 目录

- [1. 清单的含义](#1-清单的含义)
- [2. 包与源码组织](#2-包与源码组织)
- [3. 文件职责与依赖](#3-文件职责与依赖)
- [4. 配置、Schema 与数据](#4-配置schema-与数据)
- [5. 外部项目与交付](#5-外部项目与交付)
- [6. 对齐与变更操作](#6-对齐与变更操作)
- [7. 完整目标树及其他空间](#7-完整目标树及其他空间)

## 1. 清单的含义

唯一精确路径源是 [architecture-target-v2.1.json](./architecture-target-v2.1.json)。本页第 7 节为其生成视图。

| 集合 | 含义 | 完成判断 |
|---|---|---|
| repositoryFiles | 所有必须交付的版本控制文件，含测试、fixture、配置、工程元数据和历史文档 | Git 可见集合与清单相等，且各条为实际普通文件 |
| generatedAreas | 编译、协议生成及制品的非手写输出 | producer 根据锁定输入生成完整 inventory；无手改或丢失输出 |
| externalProjects | 独立扩展项目的完整起始模板与生命周期边界 | 外部项目独立构建、打包、加载、卸载；自己的 inventory 精确列出实际实现 |
| physicalSpaces | 安装、运行数据和本地工具空间 | 按部署条件验证具体入口、实际 inventory、权限和恢复 |
| forbiddenFinalRoots/Paths | 迁移完成后应删除的旧 owner 或无职责根 | 最终源码没有这些路径；不对用户数据执行自动删除 |

所有 repositoryFiles 都是最终必需项，不是“任选其中一些”的菜单。生成内容可以按平台或启用能力有条件存在，条件另列。
父目录由文件路径推导，禁止为了目录表好看添加无职责空目录或 `.gitkeep` 占位。Python `__init__.py` 等语义必需空文件不属于空壳。
根 `core/`、`apps/` 是分组，不各建 package.json；真正的叶子 package 才有编译、入口与测试。
`docs/history/` 文件保留历史事实而非活跃规则，最终仍可存在；不能因为清单保留历史文件就按其旧目标继续实现。

目录检查只承诺覆盖版本控制与 Git 可见的源码集合。忽略的开发缓存、真实秘密和数据由独立空间管理。
正式发布 source inventory 必须从受控候选生成，不能把 `.gitignore` 中的未登记产品源码带入制品以绕开清单。

## 2. 包与源码组织

| 叶子边界 | 语言/公开入口 | 依赖/进程关系 |
|---|---|---|
| core/platform | TS `src/index.ts` | 无其他业务 Core 依赖；Node 实现只在 adapters/node |
| core/content | TS `src/index.ts`；Python `glimmer_cradle.content` | TS 资产 owner；Python 只提供纯内容/引用模型，无第二资产 writer |
| core/conversation | TS `src/index.ts`；Python `glimmer_cradle.conversation` | TS 接纳/绑定/投递；Python 持久 Log/Turn/History，worker 装配 |
| core/cognition | Python `glimmer_cradle.cognition` | 纯认知入口和私有持久化 adapter；无厂商 SDK/设备/HTTP 调用 |
| core/capabilities、jobs、embodiment | 各自 TS `src/index.ts` | Host 装配；跨 owner 调用经消费方 port/App adapter |
| apps/host | TS `src/main.ts`、CLI；React UI | Node composition root，本地和 headless 共用；不创建第二 server 业务包 |
| apps/desktop | Electron `src/main/main.ts`、preload、React renderer | 连接 Host；原生合成 C++ 归该 App |
| apps/cognition-worker | Python `glimmer_cradle.cognition_worker.__main__` | 唯一 Python 进程入口，装配 Conversation 和 Cognition owner |
| apps/extension-host | TS `src/main.ts` | 扩展加载、贡献和受管进程生命周期 |
| extension-sdk | TS `src/index.ts`、Python SDK、.NET/Unity SDK | 对外能力契约、manifest 和包工具；不导出 Core 私有实现 |
| protocol | proto、文档 catalog、三语言生成目标 | wire 的唯一源；App/SDK mapper 消费生成类型 |
| tools/* | Node `.mjs` CLI | 仓库工具，不是运行产品依赖，不归 Core |

Python 使用 `src/glimmer_cradle/<owner>/`。`glimmer_cradle` 为共享 namespace package，不在每个独立发行包重复提供顶层 `__init__.py`；
各 owner 包内显式 `__init__.py` 和 `py.typed`。根 uv workspace/uv.lock 统一主仓库锁，模板自己的 worker 锁供独立项目使用。
TS 使用 kebab-case 文件；Python 使用 snake_case；React 组件和 C# 使用各自语言惯例，不为视觉统一改写已发布 wire 字段。
领域内按 feature 组织。只有存在实际 IO 或协议适配的地方才建 adapters，不给每个 feature 机械套四层空文件夹。

### 叶子包必须落实的配置内容

| 文件 | 完成时必须包含的内容 |
|---|---|
| package.json | 稳定 name、private/发布范围、`0.1.0` 开发版本、显式 exports/files、生产依赖、build/typecheck/test 命令 |
| tsconfig.json / tsconfig.build.json | 严格类型、目标环境、源/测试范围、输出路径；公开包不得发布 test fixture |
| vitest.config.ts | 对应叶子的真实测试发现与 Node/browser 环境；不排除恢复/失败测试来通过 |
| pyproject.toml | build-system、包发现、Python 约束、workspace source/依赖、dev 测试工具、pytest 配置；App 定义脚本入口 |
| README.md | owner、public API、允许依赖、状态与生命周期、构建/测试/恢复入口；文档 README 仍按 docs 规范 |
| migrations/* | 版本、有序执行、前置 schema、幂等/事务与失败恢复；不是空编号文件 |
| schemas/* | 唯一 `$id`、版本、字段验证、额外字段策略和兼容约束 |
| tests/fixtures/* | 脱敏且固定的真实边界/旧版本样本，说明用于验证的兼容与故障语义 |

包 export 不得是 `./*` 暴露全内部目录；Apps 的 index 只作为装配测试入口，不允许 Core 反向导入。
根 package.json 只保留稳定 façade，由叶子命令拥有动作；pnpm workspace 使用明确叶子边界，不递归纳入 Unity Library 或新扩展工作树。
根 global.json 固定 .NET 工具链；.NET package lock、uv.lock、pnpm-lock.yaml 和 Unity packages-lock.json 分别固定实际依赖解析。
构建可输出到叶子 dist/build，打包再进入根 dist；叶子产物也必须纳入 build inventory，不能只登记根目录。
依赖、平台支持和编译器精确版本由锁文件确定，本规范不以文件名替代版本验证。

## 3. 文件职责与依赖

| 路径族 | 文件所承载的职责 |
|---|---|
| core/*/src/<feature> | 对应 feature 的模型、策略、控制器与消费方 port；每个文件名表达具体责任 |
| core/*/src/adapters/storage 或 Python adapters/persistence | 私有存储实现；不导出连接对象、不跨 owner 查询内部表 |
| apps/host/src/composition | 领域 owner 装配、TurnProcessor 与 Job handler 接线；不搬入认知策略 |
| apps/*/adapters/protocol | producer/consumer wire mapper 与 RPC client；不持有第二领域状态机 |
| apps/host/src/broker | 受控网络、文件、设备、密钥和进程授权；实际拒绝路径必须测试 |
| apps/desktop/src/preload | 最小受控 IPC，禁止透传任意 Node API 到 renderer |
| extension-sdk/src/contributions | 各能力公开接口；channel/model/speech 等是能力面，不能夹带具体平台字段 |
| extension-sdk/templates | 完整外部项目模板；示例能力用于验证生命周期，不是主产品的内置供应商实现 |
| protocol/document-catalog.json | owner-local schema 的 ID/版本/路径索引；不复制 schema 正文 |
| tools/repo-checks | docs/编码/依赖/路径/基线检查；迁移结束后旧路径规则须改为最终规则 |

第三方库并不全归 Extension：存储库可位于私有 adapter，OS/窗口 API 可位于 App adapter。
判断标准是特化影响能否被局部隔离，以及是否需要独立安装、撤销和演进；不可由维护方姓名或 npm 来源决定。
同一平台特化不得同时在 Extension 和 Core 各有一份；普通基础依赖也不得为符合扩展口号而被无意义套壳。

### 测试归属

测试树明确列出了提交失败、重放、权限、中断晚帧、unknown、来源删除、fencing、安装回滚等入口。
文件级契约不限制未来增加反例；新测试同一切片加入清单即可。
跨进程集成由 App tests 验证，领域 tests 检查领域不变量，SDK tests 检查真实外部消费，发布 tests 检查固定制品。
不能用同名测试文件存在或测试用例数量推定覆盖充分。C#、native、Unity 的专项测试由各自工具链运行。

## 4. 配置、Schema 与数据

`configs/system` 是部署示例，字段 schema 归相应 owner；`configs/topology` 选择装配位置，不产生三套业务。
`configs/characters/selrena` 保存默认角色资料，通用层只引用 characterId/profile，不硬编码 Selrena。
角色知识文档是源资料，Knowledge 登记其 revision、hash、权限与派生索引；不能把这些文件直接当系统高优先级指令。
`configs/extensions/catalog.lock.json` 固定扩展身份、版本、来源、摘要与兼容；不在核心配置写供应商特有参数。
扩展自身配置由扩展 schema 校验，平台只保存 namespaced 配置和 secret reference。

运行路径由 App 的 data-paths adapter 解析到独立 `<dataRoot>`，不硬编码源码仓库相对路径。
发行物的 defaults/configs 是只读初始模板；有效用户配置进入 dataRoot/config，并有修订和迁移记录，不能让默认值和用户副本同时成为 writer。
密钥继续只由授权秘密目录或环境变量提供，运行配置仅存 secret reference；不在角色或扩展 JSON 内复制密钥。
数据空间中的 SQLite 文件名是目标持久容器，精确表结构归 owner migrations；不能让多个 owner 共用可写连接。
Conversation Log 分包文件格式迁移必须保留旧 ID、position 和顺序。既有格式到目标容器的转换必须先备份验证，不按目录表直接搬数据。
SQLite 的 WAL/SHM 是受数据库控制的伴随文件，不单独复制来假装一致备份；备份采用 owner barrier/SQLite backup 等一致操作。
运行 endpoint/process 文件是暂态注册，不是 authority 事实；重启需重新协商 epoch 和 capability readiness。

旧 `assets/avatar` 中 schema 归 Embodiment，具体模型/渲染素材归角色资产或 Renderer Extension 的受控资源包。
仓库清单只保留可分发来源文件；大模型权重、授权素材和编译引擎必须由带 hash/许可约束的获取流程提供。
安装事务 host 状态与领域 state 分开；旧 ADR-0018 的 host/service 分域原则仍适用，具体目标路径以本页为准。

## 5. 外部项目与交付

主仓库没有按平台平铺的接入实现。模板各自完整列出 package.json、锁、manifest、src、tests、配置与必要 worker/Unity 工程。
模板是起始项目，不强制所有 Model/Speech 扩展使用 Python，也不强制所有 Renderer 使用 Unity。
选择其他技术时，扩展项目自己的清单替换相应可选 worker/renderer 工程，并验证相同公开契约；不得留下无作用子进程。
固定能力不受特定厂商支持项绑架：扩展报告自己的 capability/readiness，平台显式展示不支持与降级。

Unity `.meta` 文件和 Assets 下目录 `.meta` 均登记为版本控制文件，避免资源 GUID 重建。
第三方 Unity 包由 Packages 锁及受控投影获取；Library/Temp 不提交，Runtime/Generated 的 SDK 投影由生成 inventory 列出。
C# SDK 与 Unity UPM 包是两种交付载体，不要求 Unity 直接消费不兼容的 .NET 目标框架。
迁移时先验证既有 C# 语义到 TS 的行为等价，再把具体 Renderer 转换留在扩展；不能删除整条 C# 链路后才发现能力损失。

安装/发布的完整 inventory 至少逐项包含 path、size、sha256、owner、来源包、平台条件；不得仅列 zip 文件名。
该 inventory 还须逐文件展开 defaults/configs 和 owner schemas，并核对本清单中的源文件映射；Extension Host 与 Cognition Worker 的可执行入口必须随 Host 安装。
安装器验证 inventory 后才激活 release；运行写入一律进入 dataRoot，制品目录只读。
桌面、headless Host、SDK 与扩展制品有各自依赖闭包与入口。默认安装可捆绑扩展制品，但其注册、授权、卸载仍走同一契约。
二进制平台后缀、hash chunk 和依赖文件必须由生成 inventory 展开，本页的动态模式不是最终制品验收的省略许可。

## 6. 对齐与变更操作

适用：后续重构切片与最终成品核对。前置：已确定 owner、目标文件和有效授权；不把目标文件缺失当作立即创建空壳的任务。

1. 在 JSON 的 repositoryFiles 中维护精确路径及 owner；有生成文件时同时维护 producer/inventory/生命周期。
2. 运行 `pnpm check:target-layout --write`，只重建本页标记区，保留解释正文。
3. 更新基线锁及校验器中的冻结摘要；改变语义边界时先完成对应 ADR/明确决策。
4. 运行 `pnpm check:target-layout`、`pnpm check:docs`、`pnpm check:encoding`、`pnpm check:architecture`；工具变化追加定向测试和根 typecheck/build。
5. 最终阶段运行 `pnpm check:target-layout:final`；缺项与多项均须处理。此门不会删除旧目录，也不跳过必须的行为/数据/制品验收。

失败时先区分：清单错误、展示树漂移、迁移尚未完成、实际源码遗留，不能扩大白名单或自动建空文件通过。
同步范围：蓝图、清单/树、锁、执行记录、迁移地图；实际实现变更才更新 Current/Implementation/Reference。
目录文件级修改有合理原因时同一切片更新即可；不把所有文件名变化都升级成重新征求架构批准。

## 7. 完整目标树及其他空间

<!-- target-layout:start -->

精确登记 1097 个版本控制文件、333 个父目录。以下是目标，不是当前实物。

```text
glimmer-cradle/
├── .codex/
│   └── skills/
│       └── glimmer-cradle/
│           ├── SKILL.md
│           ├── agents/
│           │   └── openai.yaml
│           └── references/
│               ├── architecture/
│               │   ├── Runtime与生命周期.md
│               │   ├── 协议与跨边界契约.md
│               │   ├── 可观测性与诊断.md
│               │   ├── 数据、配置与路径.md
│               │   └── 架构边界与决策.md
│               ├── common/
│               │   └── 文档、注释与编码.md
│               ├── subsystems/
│               │   ├── AI前端开发.md
│               │   ├── Cognition.md
│               │   ├── Desktop与Avatar.md
│               │   ├── Extensions与SkillPlane.md
│               │   └── Frontend与UI.md
│               └── workflow/
│                   ├── 上下文与工具.md
│                   ├── 会话与任务编排.md
│                   ├── 审查与风险评估.md
│                   ├── 开发工作流.md
│                   └── 测试与交付.md
├── .dockerignore
├── .editorconfig
├── .gitattributes
├── .github/
│   └── workflows/
│       ├── pr.yml
│       ├── release-desktop.yml
│       ├── release-extension-sdk.yml
│       ├── release-personal-server.yml
│       ├── verify-extension-distribution.yml
│       ├── verify-final-architecture.yml
│       └── verify-native-renderer.yml
├── .gitignore
├── .nvmrc
├── .python-version
├── AGENTS.md
├── LICENSE
├── README.md
├── apps/
│   ├── cognition-worker/
│   │   ├── README.md
│   │   ├── pyproject.toml
│   │   ├── schemas/
│   │   │   └── worker-config.schema.json
│   │   ├── src/
│   │   │   └── glimmer_cradle/
│   │   │       └── cognition_worker/
│   │   │           ├── __init__.py
│   │   │           ├── __main__.py
│   │   │           ├── adapters/
│   │   │           │   ├── __init__.py
│   │   │           │   ├── capability_client.py
│   │   │           │   ├── cognition_mapper.py
│   │   │           │   ├── content_client.py
│   │   │           │   ├── conversation_mapper.py
│   │   │           │   ├── job_client.py
│   │   │           │   ├── model_client.py
│   │   │           │   └── resource_client.py
│   │   │           ├── composition.py
│   │   │           ├── py.typed
│   │   │           ├── readiness.py
│   │   │           ├── service.py
│   │   │           └── shutdown.py
│   │   └── tests/
│   │       ├── conftest.py
│   │       ├── fixtures/
│   │       │   └── worker-config.json
│   │       ├── test_process_recovery.py
│   │       ├── test_public_api.py
│   │       ├── test_rpc_roundtrip.py
│   │       └── test_shutdown_flush.py
│   ├── desktop/
│   │   ├── README.md
│   │   ├── electron-builder.yaml
│   │   ├── index.html
│   │   ├── native/
│   │   │   ├── CMakeLists.txt
│   │   │   ├── include/
│   │   │   │   └── platform_native.h
│   │   │   ├── package.manifest.json
│   │   │   ├── src/
│   │   │   │   ├── composition_host_stub.cpp
│   │   │   │   └── composition_host_windows.cpp
│   │   │   └── tests/
│   │   │       ├── architecture-boundaries.test.mjs
│   │   │       └── composition_contract_test.cpp
│   │   ├── package.json
│   │   ├── playwright.config.ts
│   │   ├── resources/
│   │   │   ├── icon.ico
│   │   │   ├── icon.png
│   │   │   └── icon.svg
│   │   ├── schemas/
│   │   │   ├── desktop-config.schema.json
│   │   │   └── surfaces.schema.json
│   │   ├── scripts/
│   │   │   ├── build-native.mjs
│   │   │   ├── build.mjs
│   │   │   ├── package-release.mjs
│   │   │   └── sync-assets.mjs
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── main/
│   │   │   │   ├── app-paths.ts
│   │   │   │   ├── composition.ts
│   │   │   │   ├── host-supervisor.ts
│   │   │   │   ├── main.ts
│   │   │   │   ├── native-composition.ts
│   │   │   │   ├── tray-controller.ts
│   │   │   │   ├── update-controller.ts
│   │   │   │   └── window-controller.ts
│   │   │   ├── preload/
│   │   │   │   ├── desktop-api.ts
│   │   │   │   └── index.ts
│   │   │   ├── renderer/
│   │   │   │   ├── App.tsx
│   │   │   │   ├── api/
│   │   │   │   │   ├── desktop-client.ts
│   │   │   │   │   └── host-client.ts
│   │   │   │   ├── components/
│   │   │   │   │   ├── AudioControls.tsx
│   │   │   │   │   ├── Composer.tsx
│   │   │   │   │   ├── ConnectionStatus.tsx
│   │   │   │   │   ├── ContentPart.tsx
│   │   │   │   │   ├── ErrorBoundary.tsx
│   │   │   │   │   └── MessageList.tsx
│   │   │   │   ├── main.tsx
│   │   │   │   ├── pages/
│   │   │   │   │   ├── CharacterPage.tsx
│   │   │   │   │   ├── ConversationPage.tsx
│   │   │   │   │   ├── DiagnosticsPage.tsx
│   │   │   │   │   ├── ExtensionsPage.tsx
│   │   │   │   │   ├── KnowledgePage.tsx
│   │   │   │   │   └── SettingsPage.tsx
│   │   │   │   ├── state/
│   │   │   │   │   ├── connection-store.ts
│   │   │   │   │   └── projection-store.ts
│   │   │   │   ├── styles.css
│   │   │   │   └── surfaces/
│   │   │   │       ├── ControlCenterSurface.tsx
│   │   │   │       └── PresenceSurface.tsx
│   │   │   └── shared/
│   │   │       └── ipc-contract.ts
│   │   ├── tests/
│   │   │   ├── fixtures/
│   │   │   │   └── desktop-config.yaml
│   │   │   ├── host-supervision.test.ts
│   │   │   ├── preload-permissions.test.ts
│   │   │   ├── projection-reconnect.test.ts
│   │   │   ├── public-api.test.ts
│   │   │   ├── ui/
│   │   │   │   ├── accessibility.spec.ts
│   │   │   │   └── conversation.spec.ts
│   │   │   └── window-lifecycle.test.ts
│   │   ├── tsconfig.build.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   └── vitest.config.ts
│   ├── extension-host/
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── broker-client.ts
│   │   │   ├── composition.ts
│   │   │   ├── contribution-registry.ts
│   │   │   ├── index.ts
│   │   │   ├── loader.ts
│   │   │   ├── main.ts
│   │   │   ├── managed-process.ts
│   │   │   ├── pending-calls.ts
│   │   │   ├── protocol-mapper.ts
│   │   │   └── shutdown.ts
│   │   ├── tests/
│   │   │   ├── fixtures/
│   │   │   │   └── extension/
│   │   │   │       ├── extension-manifest.yaml
│   │   │   │       ├── package.json
│   │   │   │       └── src/
│   │   │   │           └── index.ts
│   │   │   ├── load-unload.test.ts
│   │   │   ├── process-crash.test.ts
│   │   │   ├── public-api.test.ts
│   │   │   └── revoke-pending.test.ts
│   │   ├── tsconfig.build.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   └── host/
│       ├── README.md
│       ├── deployment/
│       │   ├── .env.example
│       │   ├── Caddyfile
│       │   ├── Dockerfile
│       │   ├── bootstrap-host.sh
│       │   ├── compose.source.yaml
│       │   ├── compose.yaml
│       │   ├── container/
│       │   │   ├── entrypoint.mjs
│       │   │   ├── ops-bridge-core.mjs
│       │   │   ├── ops-bridge-handoff.mjs
│       │   │   ├── ops-bridge.mjs
│       │   │   └── supervisor.mjs
│       │   ├── deploy.sh
│       │   ├── install-release.sh
│       │   ├── install-remote.sh
│       │   ├── install.sh
│       │   ├── lib/
│       │   │   └── host-transaction.sh
│       │   └── tests/
│       │       ├── fixtures/
│       │       │   ├── docker
│       │       │   └── sudo
│       │       ├── install-rollback.test.mjs
│       │       └── test-host-transaction.sh
│       ├── index.html
│       ├── migrations/
│       │   └── 001-authority.sql
│       ├── package.json
│       ├── schemas/
│       │   ├── extension-catalog.schema.json
│       │   ├── host-config.schema.json
│       │   └── topology.schema.json
│       ├── scripts/
│       │   ├── build.mjs
│       │   ├── check-version.mjs
│       │   ├── package-release.mjs
│       │   └── smoke.mjs
│       ├── src/
│       │   ├── adapters/
│       │   │   ├── platform/
│       │   │   │   ├── authority-store.ts
│       │   │   │   ├── backup-coordinator.ts
│       │   │   │   ├── data-paths.ts
│       │   │   │   └── migration-coordinator.ts
│       │   │   └── protocol/
│       │   │       ├── capability-mapper.ts
│       │   │       ├── cognition-client.ts
│       │   │       ├── content-mapper.ts
│       │   │       ├── conversation-mapper.ts
│       │   │       ├── embodiment-mapper.ts
│       │   │       ├── extension-client.ts
│       │   │       └── job-mapper.ts
│       │   ├── broker/
│       │   │   ├── devices.ts
│       │   │   ├── files.ts
│       │   │   ├── network.ts
│       │   │   ├── permissions.ts
│       │   │   ├── process.ts
│       │   │   └── secrets.ts
│       │   ├── cli.ts
│       │   ├── composition/
│       │   │   ├── cognition-job-adapter.ts
│       │   │   ├── domain-owners.ts
│       │   │   ├── extension-contributions.ts
│       │   │   ├── host.ts
│       │   │   └── turn-processor-adapter.ts
│       │   ├── extensions/
│       │   │   ├── extension-catalog.ts
│       │   │   ├── extension-installer.ts
│       │   │   └── extension-state.ts
│       │   ├── gateway/
│       │   │   ├── authentication.ts
│       │   │   ├── content-routes.ts
│       │   │   ├── control-routes.ts
│       │   │   ├── conversation-routes.ts
│       │   │   ├── http-server.ts
│       │   │   └── websocket-server.ts
│       │   ├── index.ts
│       │   ├── main.ts
│       │   ├── supervision/
│       │   │   ├── readiness.ts
│       │   │   ├── shutdown.ts
│       │   │   └── worker-supervisor.ts
│       │   └── ui/
│       │       ├── App.tsx
│       │       ├── components/
│       │       │   ├── ConnectionStatus.tsx
│       │       │   └── ErrorBoundary.tsx
│       │       ├── host-client.ts
│       │       ├── main.tsx
│       │       ├── pages/
│       │       │   ├── ConversationsPage.tsx
│       │       │   ├── DiagnosticsPage.tsx
│       │       │   ├── ExtensionsPage.tsx
│       │       │   ├── JobsPage.tsx
│       │       │   └── OverviewPage.tsx
│       │       └── styles.css
│       ├── tests/
│       │   ├── authority-handover.test.ts
│       │   ├── backup-restore.test.ts
│       │   ├── broker-denial.test.ts
│       │   ├── extension-install-rollback.test.ts
│       │   ├── fixtures/
│       │   │   └── host-config.yaml
│       │   ├── host-startup.test.ts
│       │   ├── public-api.test.ts
│       │   ├── turn-processor.test.ts
│       │   └── ui-navigation.test.tsx
│       ├── tsconfig.build.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── vitest.config.ts
├── configs/
│   ├── README.md
│   ├── characters/
│   │   └── selrena/
│   │       ├── assets/
│   │       │   └── README.md
│   │       ├── character.manifest.yaml
│   │       ├── dialogue.yaml
│   │       ├── inference.yaml
│   │       ├── knowledge/
│   │       │   ├── food-daily.md
│   │       │   ├── index.yaml
│   │       │   ├── time-awareness.md
│   │       │   └── weather-seasons.md
│   │       ├── migrations/
│   │       │   └── README.md
│   │       ├── profile.yaml
│   │       ├── providers.yaml
│   │       ├── safety.yaml
│   │       └── voice.yaml
│   ├── extensions/
│   │   ├── active.yaml
│   │   └── catalog.lock.json
│   ├── secrets/
│   │   └── secrets.example.yaml
│   ├── system/
│   │   ├── avatar.yaml
│   │   ├── capabilities.yaml
│   │   ├── cognition.yaml
│   │   ├── host.yaml
│   │   ├── jobs.yaml
│   │   ├── observability.yaml
│   │   ├── platform.yaml
│   │   └── surfaces.yaml
│   └── topology/
│       ├── cloud.yaml
│       ├── hybrid.yaml
│       └── local.yaml
├── core/
│   ├── capabilities/
│   │   ├── README.md
│   │   ├── migrations/
│   │   │   └── 001-execution-journal.sql
│   │   ├── package.json
│   │   ├── schemas/
│   │   │   ├── capabilities-config.schema.json
│   │   │   └── skill.schema.json
│   │   ├── src/
│   │   │   ├── adapters/
│   │   │   │   └── storage/
│   │   │   │       └── sqlite-execution-journal.ts
│   │   │   ├── execution/
│   │   │   │   ├── execution-controller.ts
│   │   │   │   ├── execution-journal.ts
│   │   │   │   ├── execution-policy.ts
│   │   │   │   ├── execution-router.ts
│   │   │   │   ├── execution-target.ts
│   │   │   │   ├── executor-port.ts
│   │   │   │   ├── invocation.ts
│   │   │   │   ├── reconciliation.ts
│   │   │   │   └── result-outbox.ts
│   │   │   ├── exposure/
│   │   │   │   ├── exposure-controller.ts
│   │   │   │   ├── exposure-policy.ts
│   │   │   │   └── step-surface.ts
│   │   │   ├── index.ts
│   │   │   ├── resources/
│   │   │   │   ├── resource-registry.ts
│   │   │   │   ├── resource-revision.ts
│   │   │   │   └── resource.ts
│   │   │   ├── skills/
│   │   │   │   ├── skill-catalog.ts
│   │   │   │   └── skill.ts
│   │   │   ├── speech/
│   │   │   │   ├── audio-stream.ts
│   │   │   │   ├── recognition.ts
│   │   │   │   ├── speech-provider.ts
│   │   │   │   └── synthesis.ts
│   │   │   └── tools/
│   │   │       ├── tool-call.ts
│   │   │       ├── tool-registry.ts
│   │   │       ├── tool-result.ts
│   │   │       └── tool.ts
│   │   ├── tests/
│   │   │   ├── execution-unknown-recovery.test.ts
│   │   │   ├── exposure-permissions.test.ts
│   │   │   ├── fixtures/
│   │   │   │   ├── invocations.json
│   │   │   │   └── skill.json
│   │   │   ├── public-api.test.ts
│   │   │   ├── registry-unload.test.ts
│   │   │   ├── result-outbox-idempotency.test.ts
│   │   │   ├── revoked-before-dispatch.test.ts
│   │   │   └── speech-cancellation.test.ts
│   │   ├── tsconfig.build.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   ├── cognition/
│   │   ├── README.md
│   │   ├── migrations/
│   │   │   ├── 001-state.sql
│   │   │   ├── 002-memory.sql
│   │   │   ├── 003-knowledge.sql
│   │   │   ├── 004-planning.sql
│   │   │   └── 005-checkpoints.sql
│   │   ├── pyproject.toml
│   │   ├── schemas/
│   │   │   ├── character-manifest.schema.json
│   │   │   ├── cognition-config.schema.json
│   │   │   ├── inference-policy.schema.json
│   │   │   ├── knowledge-source.schema.json
│   │   │   ├── memory-policy.schema.json
│   │   │   └── persona.schema.json
│   │   ├── src/
│   │   │   └── glimmer_cradle/
│   │   │       └── cognition/
│   │   │           ├── __init__.py
│   │   │           ├── adapters/
│   │   │           │   └── persistence/
│   │   │           │       ├── __init__.py
│   │   │           │       ├── checkpoint_store.py
│   │   │           │       ├── knowledge_store.py
│   │   │           │       ├── memory_store.py
│   │   │           │       ├── planning_store.py
│   │   │           │       └── state_store.py
│   │   │           ├── attention/
│   │   │           │   ├── __init__.py
│   │   │           │   ├── attention.py
│   │   │           │   ├── attention_controller.py
│   │   │           │   └── lease.py
│   │   │           ├── context/
│   │   │           │   ├── __init__.py
│   │   │           │   ├── assembler.py
│   │   │           │   ├── budget.py
│   │   │           │   ├── compaction.py
│   │   │           │   ├── source.py
│   │   │           │   └── trust.py
│   │   │           ├── inference/
│   │   │           │   ├── __init__.py
│   │   │           │   ├── event.py
│   │   │           │   ├── inference_controller.py
│   │   │           │   ├── model.py
│   │   │           │   ├── model_port.py
│   │   │           │   ├── realtime.py
│   │   │           │   └── request.py
│   │   │           ├── knowledge/
│   │   │           │   ├── __init__.py
│   │   │           │   ├── freshness.py
│   │   │           │   ├── index.py
│   │   │           │   ├── ingestion.py
│   │   │           │   ├── invalidation.py
│   │   │           │   ├── knowledge_store.py
│   │   │           │   ├── retrieval.py
│   │   │           │   ├── revision.py
│   │   │           │   ├── source.py
│   │   │           │   └── transformation.py
│   │   │           ├── loop/
│   │   │           │   ├── __init__.py
│   │   │           │   ├── checkpoint.py
│   │   │           │   ├── loop_controller.py
│   │   │           │   ├── recovery.py
│   │   │           │   ├── run.py
│   │   │           │   ├── step.py
│   │   │           │   └── stop_policy.py
│   │   │           ├── memory/
│   │   │           │   ├── __init__.py
│   │   │           │   ├── consolidation.py
│   │   │           │   ├── correction.py
│   │   │           │   ├── memory.py
│   │   │           │   ├── memory_controller.py
│   │   │           │   ├── memory_store.py
│   │   │           │   └── provenance.py
│   │   │           ├── perception/
│   │   │           │   ├── __init__.py
│   │   │           │   ├── observation.py
│   │   │           │   ├── observation_normalizer.py
│   │   │           │   └── observation_queue.py
│   │   │           ├── persona/
│   │   │           │   ├── __init__.py
│   │   │           │   ├── compiler.py
│   │   │           │   ├── mutation_policy.py
│   │   │           │   ├── profile.py
│   │   │           │   └── revision.py
│   │   │           ├── planning/
│   │   │           │   ├── __init__.py
│   │   │           │   ├── commitment.py
│   │   │           │   ├── goal.py
│   │   │           │   ├── plan.py
│   │   │           │   ├── planning_controller.py
│   │   │           │   └── planning_store.py
│   │   │           ├── ports/
│   │   │           │   ├── __init__.py
│   │   │           │   ├── capability_port.py
│   │   │           │   ├── clock_port.py
│   │   │           │   ├── content_port.py
│   │   │           │   ├── conversation_port.py
│   │   │           │   ├── job_port.py
│   │   │           │   └── resource_port.py
│   │   │           ├── py.typed
│   │   │           └── state/
│   │   │               ├── __init__.py
│   │   │               ├── cognitive_state.py
│   │   │               ├── decay.py
│   │   │               ├── state_controller.py
│   │   │               └── state_store.py
│   │   └── tests/
│   │       ├── conftest.py
│   │       ├── fixtures/
│   │       │   ├── checkpoint.json
│   │       │   ├── knowledge-source.json
│   │       │   ├── model-events.json
│   │       │   └── persona.yaml
│   │       ├── test_context_budget.py
│   │       ├── test_context_trust.py
│   │       ├── test_knowledge_authorization.py
│   │       ├── test_knowledge_deletion.py
│   │       ├── test_knowledge_revision.py
│   │       ├── test_loop_checkpoint.py
│   │       ├── test_loop_native_tools.py
│   │       ├── test_memory_correction.py
│   │       ├── test_persona_mutation.py
│   │       ├── test_planning_jobs.py
│   │       ├── test_public_api.py
│   │       ├── test_realtime_cancellation.py
│   │       └── test_state_decay.py
│   ├── content/
│   │   ├── README.md
│   │   ├── migrations/
│   │   │   └── 001-asset-index.sql
│   │   ├── package.json
│   │   ├── pyproject.toml
│   │   ├── schemas/
│   │   │   └── asset-manifest.schema.json
│   │   ├── src/
│   │   │   ├── adapters/
│   │   │   │   └── storage/
│   │   │   │       ├── file-asset-store.ts
│   │   │   │       └── sqlite-asset-index.ts
│   │   │   ├── assets/
│   │   │   │   ├── asset-controller.ts
│   │   │   │   ├── asset-manifest.ts
│   │   │   │   ├── asset-ref.ts
│   │   │   │   ├── asset-store-port.ts
│   │   │   │   ├── garbage-collector.ts
│   │   │   │   ├── retention.ts
│   │   │   │   └── upload.ts
│   │   │   ├── glimmer_cradle/
│   │   │   │   └── content/
│   │   │   │       ├── __init__.py
│   │   │   │       ├── asset_ref.py
│   │   │   │       ├── parts.py
│   │   │   │       └── py.typed
│   │   │   ├── index.ts
│   │   │   └── parts/
│   │   │       ├── audio.ts
│   │   │       ├── content-part.ts
│   │   │       ├── file.ts
│   │   │       ├── image.ts
│   │   │       ├── provenance.ts
│   │   │       ├── text.ts
│   │   │       └── video.ts
│   │   ├── tests/
│   │   │   ├── asset-authorization.test.ts
│   │   │   ├── asset-commit-recovery.test.ts
│   │   │   ├── asset-reference-gc.test.ts
│   │   │   ├── conftest.py
│   │   │   ├── fixtures/
│   │   │   │   ├── asset-manifest.json
│   │   │   │   └── content-parts.json
│   │   │   ├── public-api.test.ts
│   │   │   ├── test_content_parts.py
│   │   │   └── test_public_api.py
│   │   ├── tsconfig.build.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   ├── conversation/
│   │   ├── README.md
│   │   ├── migrations/
│   │   │   ├── 001-binding.sql
│   │   │   ├── 002-delivery.sql
│   │   │   └── python/
│   │   │       ├── 001-history.sql
│   │   │       └── 002-turns.sql
│   │   ├── package.json
│   │   ├── pyproject.toml
│   │   ├── schemas/
│   │   │   └── conversation-config.schema.json
│   │   ├── src/
│   │   │   ├── adapters/
│   │   │   │   └── storage/
│   │   │   │       ├── sqlite-binding-store.ts
│   │   │   │       └── sqlite-delivery-store.ts
│   │   │   ├── binding/
│   │   │   │   ├── binding-resolver.ts
│   │   │   │   ├── binding-store-port.ts
│   │   │   │   └── binding.ts
│   │   │   ├── delivery/
│   │   │   │   ├── delivery-controller.ts
│   │   │   │   ├── delivery-store-port.ts
│   │   │   │   ├── output-generation.ts
│   │   │   │   ├── playout.ts
│   │   │   │   └── receipt.ts
│   │   │   ├── glimmer_cradle/
│   │   │   │   └── conversation/
│   │   │   │       ├── __init__.py
│   │   │   │       ├── adapters/
│   │   │   │       │   └── persistence/
│   │   │   │       │       ├── __init__.py
│   │   │   │       │       ├── history_store.py
│   │   │   │       │       ├── log_store.py
│   │   │   │       │       ├── turn_store.py
│   │   │   │       │       └── writer_guard.py
│   │   │   │       ├── history/
│   │   │   │       │   ├── __init__.py
│   │   │   │       │   ├── checkpoint.py
│   │   │   │       │   ├── history_reader.py
│   │   │   │       │   ├── projection.py
│   │   │   │       │   └── working_set.py
│   │   │   │       ├── log/
│   │   │   │       │   ├── __init__.py
│   │   │   │       │   ├── commit_barrier.py
│   │   │   │       │   ├── position.py
│   │   │   │       │   ├── reader.py
│   │   │   │       │   ├── record.py
│   │   │   │       │   └── writer.py
│   │   │   │       ├── messages/
│   │   │   │       │   ├── __init__.py
│   │   │   │       │   ├── message.py
│   │   │   │       │   └── participant.py
│   │   │   │       ├── py.typed
│   │   │   │       └── turns/
│   │   │   │           ├── __init__.py
│   │   │   │           ├── turn.py
│   │   │   │           ├── turn_controller.py
│   │   │   │           └── turn_store.py
│   │   │   ├── index.ts
│   │   │   ├── interaction/
│   │   │   │   ├── input-deduplicator.ts
│   │   │   │   ├── input.ts
│   │   │   │   ├── interaction-controller.ts
│   │   │   │   └── interruption.ts
│   │   │   ├── messages/
│   │   │   │   ├── message.ts
│   │   │   │   └── participant.ts
│   │   │   └── turns/
│   │   │       ├── turn-processor-port.ts
│   │   │       ├── turn-snapshot.ts
│   │   │       └── turn-store-port.ts
│   │   ├── tests/
│   │   │   ├── conftest.py
│   │   │   ├── delivery-unknown.test.ts
│   │   │   ├── fixtures/
│   │   │   │   ├── conversation-events.json
│   │   │   │   ├── legacy-log-v4.json
│   │   │   │   ├── legacy-log-v5.json
│   │   │   │   └── playout-events.json
│   │   │   ├── ingress-deduplication.test.ts
│   │   │   ├── interruption-late-output.test.ts
│   │   │   ├── public-api.test.ts
│   │   │   ├── test_history_rebuild.py
│   │   │   ├── test_log_durability.py
│   │   │   ├── test_public_api.py
│   │   │   ├── test_turn_recovery.py
│   │   │   └── test_writer_fencing.py
│   │   ├── tsconfig.build.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   ├── embodiment/
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── schemas/
│   │   │   ├── avatar-actions.schema.json
│   │   │   ├── avatar-behavior.schema.json
│   │   │   ├── avatar-packages.schema.json
│   │   │   ├── embodiment-config.schema.json
│   │   │   └── emotion-map.schema.json
│   │   ├── src/
│   │   │   ├── expression/
│   │   │   │   ├── expression-intent.ts
│   │   │   │   └── expression-policy.ts
│   │   │   ├── gaze/
│   │   │   │   └── gaze.ts
│   │   │   ├── gesture/
│   │   │   │   └── gesture.ts
│   │   │   ├── index.ts
│   │   │   ├── lip-sync/
│   │   │   │   ├── lip-sync.ts
│   │   │   │   └── playout-clock.ts
│   │   │   ├── motion/
│   │   │   │   ├── motion-controller.ts
│   │   │   │   └── motion.ts
│   │   │   ├── pose/
│   │   │   │   └── pose.ts
│   │   │   ├── rendering/
│   │   │   │   ├── renderer-capabilities.ts
│   │   │   │   ├── renderer-feedback.ts
│   │   │   │   └── renderer-port.ts
│   │   │   └── state/
│   │   │       ├── embodiment-controller.ts
│   │   │       └── embodiment-state.ts
│   │   ├── tests/
│   │   │   ├── fixtures/
│   │   │   │   └── legacy-avatar-behavior.json
│   │   │   ├── intent-projection.test.ts
│   │   │   ├── legacy-behavior-equivalence.test.ts
│   │   │   ├── playout-sync.test.ts
│   │   │   ├── public-api.test.ts
│   │   │   └── stale-intent.test.ts
│   │   ├── tsconfig.build.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   ├── jobs/
│   │   ├── README.md
│   │   ├── migrations/
│   │   │   └── 001-jobs.sql
│   │   ├── package.json
│   │   ├── schemas/
│   │   │   └── jobs-config.schema.json
│   │   ├── src/
│   │   │   ├── adapters/
│   │   │   │   └── storage/
│   │   │   │       └── sqlite-job-store.ts
│   │   │   ├── execution/
│   │   │   │   ├── cancellation.ts
│   │   │   │   ├── job-controller.ts
│   │   │   │   ├── job-handler-port.ts
│   │   │   │   └── job.ts
│   │   │   ├── index.ts
│   │   │   ├── ports/
│   │   │   │   ├── clock-port.ts
│   │   │   │   └── job-store-port.ts
│   │   │   ├── recovery/
│   │   │   │   ├── recovery-controller.ts
│   │   │   │   ├── retention.ts
│   │   │   │   └── retry-policy.ts
│   │   │   ├── scheduling/
│   │   │   │   ├── lease.ts
│   │   │   │   ├── schedule.ts
│   │   │   │   └── scheduler.ts
│   │   │   └── triggers/
│   │   │       ├── trigger-controller.ts
│   │   │       └── trigger.ts
│   │   ├── tests/
│   │   │   ├── cancellation-retention.test.ts
│   │   │   ├── duplicate-trigger.test.ts
│   │   │   ├── fixtures/
│   │   │   │   └── job.json
│   │   │   ├── lease-fencing.test.ts
│   │   │   ├── public-api.test.ts
│   │   │   └── restart-recovery.test.ts
│   │   ├── tsconfig.build.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   └── platform/
│       ├── README.md
│       ├── package.json
│       ├── schemas/
│       │   └── platform-config.schema.json
│       ├── src/
│       │   ├── adapters/
│       │   │   └── node/
│       │   │       ├── file-config-loader.ts
│       │   │       ├── process-supervisor.ts
│       │   │       └── structured-logger.ts
│       │   ├── communication/
│       │   │   ├── backpressure.ts
│       │   │   ├── command.ts
│       │   │   ├── deadline.ts
│       │   │   ├── envelope.ts
│       │   │   ├── event.ts
│       │   │   └── stream.ts
│       │   ├── configuration/
│       │   │   ├── config-loader.ts
│       │   │   ├── config-revision.ts
│       │   │   └── schema.ts
│       │   ├── identity/
│       │   │   ├── identity.ts
│       │   │   └── stable-identity.ts
│       │   ├── index.ts
│       │   ├── lifecycle/
│       │   │   ├── cancellation.ts
│       │   │   ├── disposal.ts
│       │   │   ├── readiness.ts
│       │   │   ├── runtime-module.ts
│       │   │   └── supervisor.ts
│       │   ├── observability/
│       │   │   ├── health.ts
│       │   │   ├── logger.ts
│       │   │   ├── metrics.ts
│       │   │   ├── redaction.ts
│       │   │   └── trace.ts
│       │   ├── scope/
│       │   │   ├── scope-registry.ts
│       │   │   └── scope.ts
│       │   ├── security/
│       │   │   ├── audit-event.ts
│       │   │   ├── authorization.ts
│       │   │   ├── permission.ts
│       │   │   ├── principal.ts
│       │   │   └── secret-reference.ts
│       │   ├── time/
│       │   │   ├── clock.ts
│       │   │   └── system-clock.ts
│       │   └── topology/
│       │       ├── authority.ts
│       │       ├── fencing-token.ts
│       │       ├── handover.ts
│       │       ├── lease.ts
│       │       ├── node.ts
│       │       └── offline-proposal.ts
│       ├── tests/
│       │   ├── authority-fencing.test.ts
│       │   ├── config-reload.test.ts
│       │   ├── fixtures/
│       │   │   └── platform-config.json
│       │   ├── lifecycle-drain.test.ts
│       │   ├── log-redaction.test.ts
│       │   ├── public-api.test.ts
│       │   └── stream-backpressure.test.ts
│       ├── tsconfig.build.json
│       ├── tsconfig.json
│       └── vitest.config.ts
├── data/
│   └── README.md
├── docs/
│   ├── README.md
│   ├── architecture/
│   │   ├── README.md
│   │   ├── blueprint/
│   │   │   ├── Architecture_Baseline_v2.1_执行宪章.md
│   │   │   ├── Glimmer_Cradle_Architecture_Baseline_v2.1_Frozen.md
│   │   │   ├── Glimmer_Cradle_Codex_Refactor_Prompt_v2.1.md
│   │   │   ├── Glimmer_Cradle_Target_Physical_Layout_v2.1.md
│   │   │   ├── README.md
│   │   │   ├── architecture-baseline-v2.lock.json
│   │   │   └── architecture-target-v2.1.json
│   │   ├── current/
│   │   │   ├── 00-阅读说明.md
│   │   │   ├── 01-目标、约束与质量属性.md
│   │   │   ├── 02-系统上下文.md
│   │   │   ├── 03-运行拓扑与进程边界.md
│   │   │   ├── 04-构件、分层与依赖.md
│   │   │   ├── 05-关键运行时链路.md
│   │   │   ├── 06-跨切面机制.md
│   │   │   ├── 07-子系统当前视图/
│   │   │   │   ├── Cognition.md
│   │   │   │   ├── Data与Observability.md
│   │   │   │   ├── Desktop与Avatar.md
│   │   │   │   ├── Engines与Native.md
│   │   │   │   ├── Extension与SkillPlane.md
│   │   │   │   ├── Kernel与Runtime.md
│   │   │   │   └── README.md
│   │   │   ├── 08-部署与交付形态.md
│   │   │   ├── 09-术语表.md
│   │   │   ├── 10-当前物理拓扑.md
│   │   │   ├── 11-物理拓扑差距与迁移地图.md
│   │   │   └── README.md
│   │   ├── decisions/
│   │   │   ├── ADR-0000-模板.md
│   │   │   ├── ADR-0001-企划平台与角色Profile分层.md
│   │   │   ├── ADR-0002-AttentionLease与CognitiveActivity分层.md
│   │   │   ├── ADR-0003-CharacterPackage与MemorySubstrate分层.md
│   │   │   ├── ADR-0004-Extension开放生态运行边界.md
│   │   │   ├── ADR-0005-Character-Avatar-Surface-Host分层.md
│   │   │   ├── ADR-0006-Desktop物理归属与Electron进程分层.md
│   │   │   ├── ADR-0007-UnityAvatarHost程序集边界与SDK投影.md
│   │   │   ├── ADR-0008-ExperienceLedger与版本化Memory.md
│   │   │   ├── ADR-0009-本地监督树与动态端点治理.md
│   │   │   ├── ADR-0010-产品组合与扩展仓库边界.md
│   │   │   ├── ADR-0011-Extension发布与开放生态边界.md
│   │   │   ├── ADR-0012-场景Adapter与平台受管资源分层.md
│   │   │   ├── ADR-0013-契约脊柱与跨进程服务架构.md
│   │   │   ├── ADR-0014-仓库物理分层与器官模块边界.md
│   │   │   ├── ADR-0015-工程自动化平面与交付生命周期分层.md
│   │   │   ├── ADR-0016-仓库工具工作区与产品监督边界.md
│   │   │   ├── ADR-0017-产品前端统一采用React组件驱动架构.md
│   │   │   ├── ADR-0018-Personal Server宿主与服务状态分域.md
│   │   │   ├── ADR-0019-采用Architecture-Baseline-v2冻结基线.md
│   │   │   ├── ADR-0020-Content资产单写者与恢复边界.md
│   │   │   ├── ADR-0021-架构基线规范修订与命名收束.md
│   │   │   ├── ADR-0022-ConversationLog与Experience投影边界.md
│   │   │   ├── ADR-0023-最终目标蓝图与物理目录契约.md
│   │   │   └── README.md
│   │   └── implementation/
│   │       ├── Cognition认知核实现.md
│   │       ├── Conversation实现.md
│   │       ├── Desktop与Avatar实现.md
│   │       ├── Engines与Native实现.md
│   │       ├── Extension与SkillPlane实现.md
│   │       ├── Kernel与Runtime实现.md
│   │       ├── Platform原语实现.md
│   │       ├── Protocol契约层实现.md
│   │       ├── README.md
│   │       ├── 工程生命周期实现.md
│   │       └── 数据、记忆与可观测性实现.md
│   ├── guides/
│   │   ├── README.md
│   │   ├── development/
│   │   │   ├── AI辅助前端开发.md
│   │   │   ├── Schema与跨进程契约变更.md
│   │   │   ├── 前端开发与UI验收.md
│   │   │   ├── 功能开发与缺陷修复.md
│   │   │   ├── 命名规范.md
│   │   │   ├── 文档维护.md
│   │   │   ├── 智能体工作流设计.md
│   │   │   ├── 架构性改动.md
│   │   │   └── 测试与验收.md
│   │   ├── onboarding/
│   │   │   └── 本地开发环境.md
│   │   ├── operations/
│   │   │   ├── 性能诊断.md
│   │   │   ├── 数据迁移与恢复.md
│   │   │   └── 日志、Trace与DLQ排障.md
│   │   ├── release/
│   │   │   ├── Personal Server部署.md
│   │   │   └── 客户端打包.md
│   │   ├── subsystems/
│   │   │   ├── Cognition开发.md
│   │   │   ├── Kernel开发.md
│   │   │   ├── 扩展开发.md
│   │   │   ├── 桌面与Avatar开发.md
│   │   │   └── 音频引擎开发.md
│   │   └── 开发手册.md
│   ├── history/
│   │   ├── README.md
│   │   ├── architecture-decisions/
│   │   │   ├── README.md
│   │   │   ├── 阶段2-数据持久化设计.md
│   │   │   ├── 阶段3-遥测设计.md
│   │   │   ├── 阶段4-觉醒态设计.md
│   │   │   ├── 阶段5-认知循环设计.md
│   │   │   ├── 阶段6-反思与记忆图谱设计.md
│   │   │   ├── 阶段7-自主输出通路设计.md
│   │   │   ├── 阶段8-渲染层架构分析与重构.md
│   │   │   ├── 阶段P-Protocol契约层重构.md
│   │   │   └── 阶段P9-契约层与包管理自洽化重构.md
│   │   ├── architecture-v1/
│   │   │   ├── 2026-09-19-roadmap-now.md
│   │   │   ├── README.md
│   │   │   ├── blueprint-realization.md
│   │   │   ├── 微光摇篮架构蓝图.md
│   │   │   └── 目标物理拓扑.md
│   │   ├── architecture-v2.0/
│   │   │   ├── Architecture_Baseline_v2.0_执行宪章.md
│   │   │   ├── Glimmer_Cradle_Architecture_Baseline_v2.0_Frozen.md
│   │   │   ├── Glimmer_Cradle_Codex_Refactor_Prompt_v2.0.md
│   │   │   └── README.md
│   │   ├── incidents/
│   │   │   ├── 2026-05-08-Electron启动环境变量污染.md
│   │   │   ├── 2026-05-08-KernelJS导入不一致.md
│   │   │   └── README.md
│   │   ├── legacy-current-architecture/
│   │   │   ├── 00-架构总览.md
│   │   │   ├── 01-协议层.md
│   │   │   ├── 02-基础设施层.md
│   │   │   ├── 03-领域层.md
│   │   │   ├── 04-应用层.md
│   │   │   ├── 05-插件层.md
│   │   │   ├── 06-依赖规则与检查清单.md
│   │   │   ├── 07-Cognition认知核.md
│   │   │   ├── 08-记忆与日志架构.md
│   │   │   ├── 09-日志字段表.md
│   │   │   └── README.md
│   │   ├── legacy-extensions/
│   │   │   ├── AgentSkill与MCP指南.md
│   │   │   ├── README.md
│   │   │   ├── 扩展API参考.md
│   │   │   └── 扩展开发指南.md
│   │   ├── legacy-guides/
│   │   │   ├── Cognition开发指南.md
│   │   │   ├── Data目录指南.md
│   │   │   ├── Kernel开发指南.md
│   │   │   ├── Python环境指南.md
│   │   │   ├── UI色彩参考.md
│   │   │   ├── UI设计指南.md
│   │   │   ├── ui-references/
│   │   │   │   └── README.md
│   │   │   ├── 客户端安装形态.md
│   │   │   ├── 客户端打包指南.md
│   │   │   ├── 开发总则.md
│   │   │   ├── 开发流程.md
│   │   │   ├── 桌面渲染开发指南.md
│   │   │   └── 音频引擎指南.md
│   │   └── legacy-roadmap/
│   │       ├── 后续增强.md
│   │       ├── 当前推进.md
│   │       └── 蓝图落地流程.md
│   ├── reference/
│   │   ├── README.md
│   │   ├── configuration.md
│   │   ├── data-layout.md
│   │   ├── engineering-lifecycle.md
│   │   ├── extension-sdk.md
│   │   ├── observability.md
│   │   ├── packaging-layout.md
│   │   ├── product-compositions.md
│   │   ├── protocol.md
│   │   └── ui-design-tokens.md
│   ├── roadmap/
│   │   ├── README.md
│   │   ├── architecture-v2-refactor.md
│   │   ├── backlog.md
│   │   ├── design-briefs/
│   │   │   ├── M11-Personal Server UI设计简报.md
│   │   │   └── reference-assets/
│   │   │       └── m11-ui/
│   │   │           ├── accent-a-qingyao.svg
│   │   │           ├── accent-b-paraiba.svg
│   │   │           ├── accent-c-peacock.svg
│   │   │           └── m11-accepted-overview-dark-light-narrow.png
│   │   ├── manifests/
│   │   │   ├── M11-目标物理清单.md
│   │   │   ├── M12-目标物理清单.md
│   │   │   ├── M13-目标物理清单.md
│   │   │   └── README.md
│   │   ├── milestones/
│   │   │   ├── M08-SkillPlane、Extension与桌面体验收口.md
│   │   │   ├── M09-主体可用性、跨场景记忆与体验收口.md
│   │   │   ├── M10-发布形态、安装投影与数据迁移闭环.md
│   │   │   ├── M11-Personal Server控制面、区域分发与跨产品Extension闭环.md
│   │   │   ├── M12-契约脊柱与跨进程服务架构重建.md
│   │   │   ├── M13-工程自动化脊柱与交付生命周期闭环.md
│   │   │   └── README.md
│   │   └── now.md
│   └── 文档维护规范.md
├── extension-sdk/
│   ├── README.md
│   ├── dotnet/
│   │   ├── Directory.Build.props
│   │   ├── README.md
│   │   ├── src/
│   │   │   └── GlimmerCradle.ExtensionSdk/
│   │   │       ├── ContentContract.cs
│   │   │       ├── ExtensionContext.cs
│   │   │       ├── GlimmerCradle.ExtensionSdk.csproj
│   │   │       ├── HostClient.cs
│   │   │       ├── RendererContract.cs
│   │   │       └── packages.lock.json
│   │   └── tests/
│   │       └── GlimmerCradle.ExtensionSdk.Tests/
│   │           ├── GlimmerCradle.ExtensionSdk.Tests.csproj
│   │           ├── HostClientTests.cs
│   │           ├── RendererContractTests.cs
│   │           └── packages.lock.json
│   ├── package.json
│   ├── python/
│   │   ├── README.md
│   │   ├── pyproject.toml
│   │   ├── src/
│   │   │   └── glimmer_cradle/
│   │   │       └── extension_sdk/
│   │   │           ├── __init__.py
│   │   │           ├── content.py
│   │   │           ├── context.py
│   │   │           ├── managed_worker.py
│   │   │           ├── model.py
│   │   │           ├── py.typed
│   │   │           ├── speech.py
│   │   │           └── transport.py
│   │   └── tests/
│   │       ├── conftest.py
│   │       ├── test_public_api.py
│   │       └── test_worker_cancellation.py
│   ├── schemas/
│   │   ├── extension-config.schema.json
│   │   ├── extension-manifest.schema.json
│   │   └── extension-package.schema.json
│   ├── scripts/
│   │   ├── pack.mjs
│   │   ├── verify-release.mjs
│   │   └── verify-templates.mjs
│   ├── src/
│   │   ├── api/
│   │   │   ├── capabilities.ts
│   │   │   ├── cognition.ts
│   │   │   ├── content.ts
│   │   │   ├── conversation.ts
│   │   │   ├── embodiment.ts
│   │   │   ├── extension-context.ts
│   │   │   ├── host-api.ts
│   │   │   ├── jobs.ts
│   │   │   └── ui.ts
│   │   ├── compatibility/
│   │   │   ├── capabilities.ts
│   │   │   └── compatibility.ts
│   │   ├── contributions/
│   │   │   ├── channel.ts
│   │   │   ├── model.ts
│   │   │   ├── observation.ts
│   │   │   ├── renderer.ts
│   │   │   ├── resource.ts
│   │   │   ├── skill.ts
│   │   │   ├── speech.ts
│   │   │   ├── tool.ts
│   │   │   └── ui.ts
│   │   ├── index.ts
│   │   ├── lifecycle/
│   │   │   ├── activation.ts
│   │   │   ├── disposable.ts
│   │   │   └── managed-process.ts
│   │   ├── manifest/
│   │   │   ├── extension-manifest.ts
│   │   │   └── validate-manifest.ts
│   │   ├── packaging/
│   │   │   ├── package-builder.ts
│   │   │   ├── package-manifest.ts
│   │   │   └── package-verifier.ts
│   │   ├── permissions/
│   │   │   ├── device-api.ts
│   │   │   ├── file-api.ts
│   │   │   ├── network-api.ts
│   │   │   ├── permission-request.ts
│   │   │   └── secret-api.ts
│   │   └── transport/
│   │       ├── host-client.ts
│   │       └── wire-mapper.ts
│   ├── templates/
│   │   ├── channel/
│   │   │   ├── .env.example
│   │   │   ├── .gitignore
│   │   │   ├── README.md
│   │   │   ├── config/
│   │   │   │   └── schema.json
│   │   │   ├── extension-manifest.yaml
│   │   │   ├── gcex.package.yaml
│   │   │   ├── package.json
│   │   │   ├── pnpm-lock.yaml
│   │   │   ├── src/
│   │   │   │   ├── channel-adapter.ts
│   │   │   │   └── index.ts
│   │   │   ├── tests/
│   │   │   │   └── channel-lifecycle.test.ts
│   │   │   ├── tsconfig.json
│   │   │   └── vitest.config.ts
│   │   ├── mcp-bridge/
│   │   │   ├── .env.example
│   │   │   ├── .gitignore
│   │   │   ├── README.md
│   │   │   ├── config/
│   │   │   │   └── schema.json
│   │   │   ├── extension-manifest.yaml
│   │   │   ├── gcex.package.yaml
│   │   │   ├── package.json
│   │   │   ├── pnpm-lock.yaml
│   │   │   ├── src/
│   │   │   │   ├── index.ts
│   │   │   │   └── mcp-client-adapter.ts
│   │   │   ├── tests/
│   │   │   │   └── mcp-reconnect.test.ts
│   │   │   ├── tsconfig.json
│   │   │   └── vitest.config.ts
│   │   ├── model/
│   │   │   ├── .env.example
│   │   │   ├── .gitignore
│   │   │   ├── README.md
│   │   │   ├── config/
│   │   │   │   └── schema.json
│   │   │   ├── extension-manifest.yaml
│   │   │   ├── gcex.package.yaml
│   │   │   ├── package.json
│   │   │   ├── pnpm-lock.yaml
│   │   │   ├── src/
│   │   │   │   ├── index.ts
│   │   │   │   └── model-provider.ts
│   │   │   ├── tests/
│   │   │   │   └── model-stream.test.ts
│   │   │   ├── tsconfig.json
│   │   │   ├── vitest.config.ts
│   │   │   └── worker/
│   │   │       ├── pyproject.toml
│   │   │       ├── src/
│   │   │       │   └── extension_worker/
│   │   │       │       ├── __init__.py
│   │   │       │       ├── __main__.py
│   │   │       │       └── provider.py
│   │   │       ├── tests/
│   │   │       │   └── test_cancellation.py
│   │   │       └── uv.lock
│   │   ├── renderer/
│   │   │   ├── .env.example
│   │   │   ├── .gitignore
│   │   │   ├── README.md
│   │   │   ├── config/
│   │   │   │   └── schema.json
│   │   │   ├── extension-manifest.yaml
│   │   │   ├── gcex.package.yaml
│   │   │   ├── package.json
│   │   │   ├── pnpm-lock.yaml
│   │   │   ├── scripts/
│   │   │   │   ├── build-renderer.mjs
│   │   │   │   └── project-assets.mjs
│   │   │   ├── src/
│   │   │   │   ├── index.ts
│   │   │   │   └── renderer-adapter.ts
│   │   │   ├── tests/
│   │   │   │   └── renderer-readiness.test.ts
│   │   │   ├── tsconfig.json
│   │   │   ├── unity/
│   │   │   │   ├── Assets/
│   │   │   │   │   ├── Editor/
│   │   │   │   │   │   ├── BuildRenderer.cs
│   │   │   │   │   │   └── BuildRenderer.cs.meta
│   │   │   │   │   ├── Editor.meta
│   │   │   │   │   ├── Renderer/
│   │   │   │   │   │   ├── Renderer.asmdef
│   │   │   │   │   │   ├── Renderer.asmdef.meta
│   │   │   │   │   │   ├── RendererController.cs
│   │   │   │   │   │   ├── RendererController.cs.meta
│   │   │   │   │   │   ├── RendererScene.unity
│   │   │   │   │   │   └── RendererScene.unity.meta
│   │   │   │   │   ├── Renderer.meta
│   │   │   │   │   ├── Tests/
│   │   │   │   │   │   ├── Editor/
│   │   │   │   │   │   │   ├── Renderer.Tests.asmdef
│   │   │   │   │   │   │   ├── Renderer.Tests.asmdef.meta
│   │   │   │   │   │   │   ├── RendererControllerTests.cs
│   │   │   │   │   │   │   └── RendererControllerTests.cs.meta
│   │   │   │   │   │   └── Editor.meta
│   │   │   │   │   └── Tests.meta
│   │   │   │   ├── Packages/
│   │   │   │   │   ├── manifest.json
│   │   │   │   │   └── packages-lock.json
│   │   │   │   └── ProjectSettings/
│   │   │   │       ├── ProjectSettings.asset
│   │   │   │       └── ProjectVersion.txt
│   │   │   └── vitest.config.ts
│   │   └── speech/
│   │       ├── .env.example
│   │       ├── .gitignore
│   │       ├── README.md
│   │       ├── config/
│   │       │   └── schema.json
│   │       ├── extension-manifest.yaml
│   │       ├── gcex.package.yaml
│   │       ├── package.json
│   │       ├── pnpm-lock.yaml
│   │       ├── src/
│   │       │   ├── index.ts
│   │       │   └── speech-provider.ts
│   │       ├── tests/
│   │       │   └── speech-cancellation.test.ts
│   │       ├── tsconfig.json
│   │       ├── vitest.config.ts
│   │       └── worker/
│   │           ├── pyproject.toml
│   │           ├── src/
│   │           │   └── extension_worker/
│   │           │       ├── __init__.py
│   │           │       ├── __main__.py
│   │           │       └── provider.py
│   │           ├── tests/
│   │           │   └── test_cancellation.py
│   │           └── uv.lock
│   ├── tests/
│   │   ├── fixtures/
│   │   │   └── extension-manifest.yaml
│   │   ├── host-compatibility.test.ts
│   │   ├── manifest-validation.test.ts
│   │   ├── package-path-traversal.test.ts
│   │   ├── public-api.test.ts
│   │   └── sdk-public-imports.test.ts
│   ├── tsconfig.build.json
│   ├── tsconfig.json
│   ├── unity/
│   │   ├── Editor/
│   │   │   ├── GlimmerCradle.ExtensionSdk.Editor.asmdef
│   │   │   ├── GlimmerCradle.ExtensionSdk.Editor.asmdef.meta
│   │   │   ├── PackageValidator.cs
│   │   │   └── PackageValidator.cs.meta
│   │   ├── Editor.meta
│   │   ├── README.md
│   │   ├── Runtime/
│   │   │   ├── GlimmerCradle.ExtensionSdk.asmdef
│   │   │   ├── GlimmerCradle.ExtensionSdk.asmdef.meta
│   │   │   ├── RendererBridge.cs
│   │   │   └── RendererBridge.cs.meta
│   │   ├── Runtime.meta
│   │   ├── Tests/
│   │   │   ├── Editor/
│   │   │   │   ├── GlimmerCradle.ExtensionSdk.Tests.asmdef
│   │   │   │   ├── GlimmerCradle.ExtensionSdk.Tests.asmdef.meta
│   │   │   │   ├── RendererBridgeTests.cs
│   │   │   │   └── RendererBridgeTests.cs.meta
│   │   │   └── Editor.meta
│   │   ├── Tests.meta
│   │   ├── package.json
│   │   ├── scripts/
│   │   │   └── project-sdk.mjs
│   │   └── tests/
│   │       └── project-sdk.test.mjs
│   └── vitest.config.ts
├── glimmer-cradle.code-workspace
├── global.json
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── protocol/
│   ├── README.md
│   ├── buf.gen.yaml
│   ├── buf.lock
│   ├── buf.yaml
│   ├── document-catalog.json
│   ├── generated/
│   │   ├── dotnet/
│   │   │   └── GlimmerCradle.Protocol.csproj
│   │   ├── python/
│   │   │   └── pyproject.toml
│   │   └── typescript/
│   │       └── package.json
│   ├── json-schema/
│   │   └── envelope.schema.json
│   ├── package.json
│   ├── proto/
│   │   └── glimmer/
│   │       ├── capabilities/
│   │       │   └── v1/
│   │       │       └── capabilities.proto
│   │       ├── cognition/
│   │       │   └── v1/
│   │       │       └── cognition.proto
│   │       ├── content/
│   │       │   └── v1/
│   │       │       └── content.proto
│   │       ├── conversation/
│   │       │   └── v1/
│   │       │       └── conversation.proto
│   │       ├── embodiment/
│   │       │   └── v1/
│   │       │       └── embodiment.proto
│   │       ├── extension/
│   │       │   └── v1/
│   │       │       └── extension.proto
│   │       ├── jobs/
│   │       │   └── v1/
│   │       │       └── jobs.proto
│   │       └── platform/
│   │           └── v1/
│   │               └── platform.proto
│   ├── pyproject.toml
│   ├── scripts/
│   │   ├── generate-document-catalog.mjs
│   │   ├── generate.mjs
│   │   └── verify.mjs
│   ├── src/
│   │   └── index.ts
│   ├── tests/
│   │   ├── dotnet/
│   │   │   ├── GlimmerCradle.Protocol.Tests.csproj
│   │   │   ├── WireRoundtripTests.cs
│   │   │   └── packages.lock.json
│   │   ├── fixtures/
│   │   │   ├── conversation.json
│   │   │   └── envelope.json
│   │   ├── public-api.test.ts
│   │   ├── test_wire_roundtrip.py
│   │   └── wire-roundtrip.test.ts
│   ├── tsconfig.build.json
│   ├── tsconfig.json
│   ├── versioning/
│   │   ├── compatibility.json
│   │   └── wire-baseline.bin
│   └── vitest.config.ts
├── pyproject.toml
├── ruff.toml
├── tools/
│   ├── repo-checks/
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── architecture/
│   │   │   │   ├── baseline-lock.mjs
│   │   │   │   ├── check-architecture.mjs
│   │   │   │   ├── cli.mjs
│   │   │   │   ├── file-system.mjs
│   │   │   │   ├── python-imports.py
│   │   │   │   ├── rules/
│   │   │   │   │   ├── derived-boundaries.mjs
│   │   │   │   │   ├── legacy-paths.mjs
│   │   │   │   │   ├── platform-boundaries.mjs
│   │   │   │   │   ├── repository-topology.mjs
│   │   │   │   │   ├── workspace-artifact-boundaries.mjs
│   │   │   │   │   └── workspace-boundaries.mjs
│   │   │   │   ├── target-layout-cli.mjs
│   │   │   │   ├── target-layout.mjs
│   │   │   │   └── v2-boundaries.mjs
│   │   │   ├── docs/
│   │   │   │   ├── check-docs.mjs
│   │   │   │   └── cli.mjs
│   │   │   ├── encoding/
│   │   │   │   ├── check-encoding.mjs
│   │   │   │   └── cli.mjs
│   │   │   └── repository-root.mjs
│   │   └── tests/
│   │       ├── architecture.test.mjs
│   │       ├── baseline-lock.test.mjs
│   │       ├── cli.test.mjs
│   │       ├── docs.test.mjs
│   │       ├── encoding.test.mjs
│   │       ├── target-layout.test.mjs
│   │       └── v2-boundaries.test.mjs
│   └── workspace-supervisor/
│       ├── README.md
│       ├── package.json
│       ├── src/
│       │   ├── cli-options.mjs
│       │   ├── cli.mjs
│       │   ├── errors.mjs
│       │   ├── package-manager-invocation.mjs
│       │   ├── process-tree.mjs
│       │   ├── product-composition.mjs
│       │   ├── repository-root.mjs
│       │   ├── supervisor.mjs
│       │   └── workspace-plan.mjs
│       └── tests/
│           ├── cli.test.mjs
│           ├── package-manager-invocation.test.mjs
│           ├── process-tree.test.mjs
│           ├── supervisor.test.mjs
│           └── workspace-plan.test.mjs
├── tsconfig.base.json
├── uv.lock
└── vitest.workspace.ts
```

### 生成输出登记

| 输出根 | 动态文件模式 | Producer | 逐文件 inventory | 寿命 |
|---|---|---|---|---|
| `protocol/generated/typescript/src/` | `**/*.ts` | protocol/scripts/generate.mjs | `build/inventory/protocol-typescript.json` | 可再生；不手写，不提交动态输出 |
| `protocol/generated/python/src/` | `**/*.py` | protocol/scripts/generate.mjs | `build/inventory/protocol-python.json` | 可再生；含 __init__.py、*_pb2.py 与 *_pb2_grpc.py |
| `protocol/generated/dotnet/src/` | `**/*.cs` | protocol/scripts/generate.mjs | `build/inventory/protocol-dotnet.json` | 可再生；由相同 proto 生成 |
| `build/` | `**/*` | 各 owner 的构建/验证命令 | `build/inventory/build.json` | 开发编译、日志、报告、中间制品；不作为源码 |
| `dist/` | `**/*` | apps/host/scripts/package-release.mjs 与 apps/desktop/scripts/package-release.mjs | `dist/release-inventory.json` | 可分发固定制品，逐文件 hash；不依赖工作树 |
| `apps/desktop/dist/` | `**/*` | apps/desktop/package.json#scripts.build | `build/inventory/apps-desktop.json` | 叶子编译输出，含 JavaScript、声明与 source map；不进入版本控制 |
| `apps/extension-host/dist/` | `**/*` | apps/extension-host/package.json#scripts.build | `build/inventory/apps-extension-host.json` | 叶子编译输出，含 JavaScript、声明与 source map；不进入版本控制 |
| `apps/host/dist/` | `**/*` | apps/host/package.json#scripts.build | `build/inventory/apps-host.json` | 叶子编译输出，含 JavaScript、声明与 source map；不进入版本控制 |
| `core/capabilities/dist/` | `**/*` | core/capabilities/package.json#scripts.build | `build/inventory/core-capabilities.json` | 叶子编译输出，含 JavaScript、声明与 source map；不进入版本控制 |
| `core/content/dist/` | `**/*` | core/content/package.json#scripts.build | `build/inventory/core-content.json` | 叶子编译输出，含 JavaScript、声明与 source map；不进入版本控制 |
| `core/conversation/dist/` | `**/*` | core/conversation/package.json#scripts.build | `build/inventory/core-conversation.json` | 叶子编译输出，含 JavaScript、声明与 source map；不进入版本控制 |
| `core/embodiment/dist/` | `**/*` | core/embodiment/package.json#scripts.build | `build/inventory/core-embodiment.json` | 叶子编译输出，含 JavaScript、声明与 source map；不进入版本控制 |
| `core/jobs/dist/` | `**/*` | core/jobs/package.json#scripts.build | `build/inventory/core-jobs.json` | 叶子编译输出，含 JavaScript、声明与 source map；不进入版本控制 |
| `core/platform/dist/` | `**/*` | core/platform/package.json#scripts.build | `build/inventory/core-platform.json` | 叶子编译输出，含 JavaScript、声明与 source map；不进入版本控制 |
| `extension-sdk/dist/` | `**/*` | extension-sdk/package.json#scripts.build | `build/inventory/extension-sdk.json` | 叶子编译输出，含 JavaScript、声明与 source map；不进入版本控制 |
| `protocol/dist/` | `**/*` | protocol/package.json#scripts.build | `build/inventory/protocol.json` | 叶子编译输出，含 JavaScript、声明与 source map；不进入版本控制 |
| `extension-sdk/unity/Runtime/Generated/` | `**/*` | extension-sdk/unity/scripts/project-sdk.mjs | `build/inventory/unity-sdk.json` | C# wire 与 SDK 投影；GUID 由投影 manifest 稳定管理，不手写 |

### 外部项目与其他物理空间

外部项目模板源：`extension-sdk/templates`。每个模板目录完整复制到主仓库之外；只替换 manifest/README 指明的项目参数，不复制 node_modules/缓存；供应商实现文件由扩展自己的 inventory 维护。

#### installation

根：`<installRoot>`；owner：host/desktop 安装事务。

条件：host 制品包含 host/worker；desktop 制品还包含 desktop/native；无该目标不伪造其文件。Producer：各 App package-release.mjs，生成完整 inventory 与平台适用性记录。

固定入口文件：

```text
release.json
inventory.json
sbom.json
checksums.sha256
licenses/THIRD-PARTY-NOTICES.txt
host/package.json
host/main.js
desktop/resources/app.asar
workers/cognition/pyproject.toml
extensions/catalog.lock.json
extension-host/package.json
extension-host/main.js
workers/cognition/site-packages/glimmer_cradle/cognition_worker/__main__.py
```

动态文件模式（不是可省略的源码）：

```text
host/node_modules/**
host/assets/**
workers/cognition/site-packages/**
workers/cognition/bin/**
extensions/packages/<extensionId>/<version>/**
desktop/<platform-launcher>
desktop/resources/**
native/<platform>/<architecture>/**
extension-host/node_modules/**
defaults/configs/**
schemas/**
```

#### runtime-data

根：`<dataRoot>`；owner：各领域 owner；Host 只解析路径。

条件：相应 owner 启用后按需建立；分区含用户/角色作用域，DB 内同样隔离 principal；未启用不建空目录。Producer：owner store/migration；备份 manifest 枚举实际文件与一致切点。

固定入口文件：

```text
state/platform/authority.sqlite
state/content/assets.sqlite
state/conversation/bindings.sqlite
state/conversation/delivery.sqlite
state/conversation/history.sqlite
state/conversation/turns.sqlite
state/cognition/state.sqlite
state/cognition/memory.sqlite
state/cognition/knowledge.sqlite
state/cognition/planning.sqlite
state/cognition/checkpoints.sqlite
state/capabilities/execution.sqlite
state/jobs/jobs.sqlite
host/installation/transactions.sqlite
host/installation/active-release.json
host/extensions/registry.sqlite
host/desktop/preferences.json
```

动态文件模式（不是可省略的源码）：

```text
state/conversation/log/<partition>/manifest.json
state/conversation/log/<partition>/<segment>.jsonl
state/content/blobs/<hash-prefix>/<sha256>
state/content/staging/<uploadId>/metadata.json
state/content/staging/<uploadId>/content.part
state/extensions/<extensionId>/**
cache/<owner>/**
logs/<owner>/<date>.<sequence>.jsonl
backups/<backupId>/manifest.json
backups/<backupId>/owners/**
run/<hostId>/endpoints.json
run/<hostId>/processes.json
state/**/*.sqlite-wal
state/**/*.sqlite-shm
config/system/<owner>.yaml
config/topology.yaml
config/characters/<characterId>/character.manifest.yaml
config/characters/<characterId>/profile.yaml
config/characters/<characterId>/knowledge/index.yaml
config/characters/<characterId>/knowledge/<source>.md
config/characters/<characterId>/assets/<assetId>
config/extensions/<extensionId>.json
```

#### local-environment

根：`<workspace>`；owner：开发工具。

条件：本机生成或私有设置；secrets.example.yaml 为唯一版本控制秘密示例，不读取真实秘密。Producer：Git、pnpm、uv、编译器、Unity 与开发者私有设置；从发布 source inventory 排除。

固定入口文件：

```text
（无必须预建的固定文件）
```

动态文件模式（不是可省略的源码）：

```text
.git/**
node_modules/**
**/node_modules/**
.venv/**
**/.venv/**
**/__pycache__/**
**/.pytest_cache/**
.ruff_cache/**
.pnpm-store/**
.playwright-cli/**
.vscode/**
**/dist/**
**/build/**
**/bin/**
**/obj/**
**/Library/**
**/Temp/**
**/*.tsbuildinfo
configs/secrets/*.yaml
```

<!-- target-layout:end -->

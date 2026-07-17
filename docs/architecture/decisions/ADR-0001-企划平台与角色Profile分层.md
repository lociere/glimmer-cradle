# ADR-0001 企划平台与角色 Profile 分层

状态：accepted

日期：2026-06-28

## 背景

项目方向从单一 Selrena（月见）角色应用升级为 Glimmer Cradle（微光摇篮）企划与系列。未来可能出现其他角色或“月色”，但它们仍共享同一套本地优先运行平台、Protocol、Kernel、Desktop、Avatar、Engine、Extension SDK、数据分域和可观测性机制。

旧命名把 Selrena 同时作为仓库、平台、运行时 API、包名和角色身份使用，会让后续角色扩展时出现概念冲突。

## 决策

Glimmer Cradle（微光摇篮，项目内中文简称“摇篮”）作为企划、平台、仓库和发布产品层身份；Selrena（月见）作为当前默认角色、主线人格实例和默认身体资产归属。

长期架构引入 `Character Profile` 概念：一个 profile 组合角色身份、persona、knowledge、summon keywords、voice preset、Avatar asset manifest 和数据命名空间。Kernel、Protocol、Desktop、Engine、Extension SDK 等平台层不再新增角色名硬编码。

仓库保持单仓平台形态，不为每个角色复制一套 Kernel、Protocol 或 Extension SDK。只有在角色拥有独立发布节奏、许可证、团队边界或完全不同运行时后，才考虑拆分独立内容包或发行仓库。

## 影响

- 文档和对外身份使用 `Glimmer Cradle（微光摇篮）`；中文正文可在语境明确后使用简称“摇篮”。
- 当前默认角色配置、唤醒词、persona、Avatar 资产继续使用 `selrena`。
- Renderer preload 全局桥按职责命名为 `desktopHost`，不使用角色名或企划名。
- 后续配置迁移目标是 `configs/characters/<character-id>/`，平台层只保存 active character 与系统配置。
- `@glimmer-cradle/*`、`GLIMMER_CRADLE_*` 环境变量、`platform_native`、`UnityAvatarHost.exe` 与 Unity `GlimmerCradle.Avatar` namespace 是平台层命名；角色素材、profile id、唤醒词和默认人格仍保留 `selrena`。

## 验证

后续涉及角色分层的改动必须能验证：

- 平台层代码不依赖具体角色名判断运行逻辑；
- 当前 Selrena profile 仍能作为默认角色启动；
- 新角色 profile 可以复用同一套 Protocol、Kernel、Desktop 与 Extension 能力；
- 用户数据、模型、Avatar 资产和可观测性材料能按角色命名空间区分。

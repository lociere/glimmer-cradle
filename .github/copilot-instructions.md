# Glimmer Cradle Copilot Instructions

本文件是 GitHub Copilot 的薄入口。项目事实源不在这里维护。

- 默认使用中文说明、文档正文、commit message 与 PR 描述；代码标识符、协议字段、配置键和文件名沿用既有英文命名。
- Glimmer Cradle（微光摇篮，中文简称“摇篮”）是企划与平台；Selrena（月见）只作为当前默认角色命名使用。中文文档和注释可用中文名，代码/配置/协议标识符保持英文稳定命名。
- 遵守根目录 `AGENTS.md`。
- 项目文档入口是 `docs/README.md`。
- 架构事实读 `docs/architecture/current/`，代码实现地图读 `docs/architecture/implementation/`。
- 字段、配置、路径、SDK、日志和打包映射读 `docs/reference/`。
- 开发、排障、测试和发布步骤读 `docs/guides/`。
- 跨语言或跨进程结构以 `protocol/src/schemas/` 为权威；修改后运行 `pnpm sync:contracts`。
- Kernel 不做人格和认知判断；Cognition 不接触平台 IO；Renderer 只消费受控投影；Extension 不 import Kernel 内部对象。
- 密钥、token 和 provider key 不得进入代码、日志、文档、示例、Skill 或 agent profile。

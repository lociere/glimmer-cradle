# Glimmer Cradle（微光摇篮）协作约定

## 必须遵守

- 默认使用中文协作、文档正文、commit message 与 PR 描述；代码标识符、协议字段、配置键、事件类型、扩展 ID 和文件名沿用既有英文命名。
- Glimmer Cradle（微光摇篮，中文简称“摇篮”）是企划、平台与仓库整体；Selrena（月见）是当前默认角色。平台、协议、Kernel、Desktop、Extension SDK 等通用层不得继续新增角色名硬编码；角色身份、persona、唤醒词、声音和 Avatar 资产保留 `selrena` 命名。
- 命名必须表达职责和 owner。中文文档和注释可使用“微光摇篮”或上下文明确后的“摇篮”；代码标识符、包名、命令、环境变量、Schema、IPC 和配置键保持英文稳定命名。进程承载用 `Host/Shell/Worker/Service`，第三方开发包用 `SDK/Package/Plugin`，状态用 `State/Snapshot/Projection`，行为入口用 `Controller/Scheduler`，协议边界用 `Adapter/Bridge/Port`。`Runtime` 只用于生命周期监督、语言/平台固定术语或第三方正式名称；新增命名前先读 `docs/guides/development/命名规范.md`。
- `.ts`、`.tsx`、`.py`、`.yaml`、`.json`、`.md` 均为 UTF-8 无 BOM。注释只解释 WHY、跨层契约、不变量或非显然决策。
- 使用 TypeScript workspace 的 `pnpm`；Python 使用 `uv`，禁止用全局 `pip` 替代项目环境。
- 密钥、token 与 provider key 只进入 `configs/secrets/` 或环境变量；不得进入 Git、日志、文档、示例、Skill 或 agent profile。
- 保留用户已有改动；修改前查看 `git status --short`，不使用破坏性 Git 操作。

## 项目 Skill

处理本仓库的架构、开发、调试、文档、Extension 或 AI 协作任务时，先读取 `.codex/skills/glimmer-cradle/SKILL.md`，再按其路由读取最少必要的 references 和 `docs/` 事实源。

`.codex/skills/glimmer-cradle/agents/` 只存 Codex/OpenAI 开发协作配置，不属于运行时 `configs/`。修改该目录时同步检查 skill 和本文件。

## Agent 配置分层

本仓库采用“一份项目事实源 + 多个工具薄适配层”：

- `AGENTS.md`：所有 AI/人类协作者共同遵守的项目协作宪法。
- `docs/`：唯一项目事实源，保存架构、实现、参考、指南、路线图和历史证据。
- `.codex/skills/glimmer-cradle/`：Codex canonical Skill；`references/` 是唯一 agent 操作准则卡片。
- `.claude/CLAUDE.md`：Claude Code 薄入口，只指向 `AGENTS.md`、`docs/` 和 `.codex` canonical Skill，不复制项目事实。
- `.github/copilot-instructions.md`：GitHub Copilot 薄入口，只写高频约束和文档入口。

新增任何 agent/tool 配置时，只允许写工具适配、读取顺序和安全边界；项目事实必须链接 `docs/` 或 `.codex/skills/glimmer-cradle/references/`，不得复制成另一套规则。

## 事实源与文档

`docs/README.md` 是文档入口：

- `architecture/blueprint/`：Glimmer Cradle 的架构宪法、设计审美与长期不变量。
- `architecture/current/`：当前系统结构、边界与运行方式。
- `architecture/implementation/`：当前代码的入口、组装、链路与技术实现地图。
- `reference/`：协议、配置、数据、可观测性、SDK 与打包的精确事实。
- `guides/`：开发、排障、发布的可执行操作。
- `roadmap/`：未完成工作的成果、风险与验收门。
- `architecture/decisions/`：长期 ADR；`history/`：已结束阶段的证据。

改动代码、Schema、配置或脚本时，在同一工作内更新唯一权威文档；链接其他页面，不复制正文。与代码不一致的文档是 bug。

架构升级必须落到真实物理形态：目录结构、文件名、配置键、Schema、加载链路、默认模板、测试和文档必须一起收口。不得只改语义或注释却保留旧目录/旧文件作为新架构外壳；除非有明确迁移窗口、删除条件和 owner，否则旧入口必须删除。

## 协议与验证

- 跨语言或跨进程结构的权威定义在 `protocol/src/schemas/`；修改后立即运行 `pnpm sync:contracts`，禁止手写镜像或修改生成物。
- Kernel 不做人格和认知判断；Cognition 不接触平台 IO；Renderer 只消费受控投影；Extension 不 import Kernel 内部对象。
- PR 最低验证：`pnpm typecheck`、`pnpm build`；改 Cognition 时在 `core/cognition` 执行 `uv run pytest -q`。按风险补充 schema、UI、启动、日志和 DLQ 验证。

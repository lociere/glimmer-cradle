# Glimmer Cradle（微光摇篮）协作约定

## 必须遵守

- 默认使用中文协作、文档正文、commit message 与 PR 描述；代码标识符、协议字段、配置键、事件类型、扩展 ID 和文件名沿用既有英文命名。
- Glimmer Cradle（微光摇篮，中文简称“摇篮”）是企划、平台与仓库整体；Selrena（月见）是当前默认角色。平台、协议、Kernel、Desktop、Extension SDK 等通用层不得继续新增角色名硬编码；角色身份、persona、唤醒词、声音和 Avatar 资产保留 `selrena` 命名。
- 命名必须表达职责和 owner。中文文档和注释可使用“微光摇篮”或上下文明确后的“摇篮”；代码标识符、包名、命令、环境变量、Schema、IPC 和配置键保持英文稳定命名。进程承载用 `Host/Shell/Worker/Service`，第三方开发包用 `SDK/Package/Plugin`，状态用 `State/Snapshot/Projection`，行为入口用 `Controller/Scheduler`，协议边界用 `Adapter/Bridge/Port`。`Runtime` 只用于生命周期监督、语言/平台固定术语或第三方正式名称；新增命名前先读 `docs/guides/development/命名规范.md`。
- `.ts`、`.tsx`、`.py`、`.yaml`、`.json`、`.md` 均为 UTF-8 无 BOM。注释只解释 WHY、跨层契约、不变量或非显然决策。
- 使用 TypeScript workspace 的 `pnpm`；Python 使用 `uv`，禁止用全局 `pip` 替代项目环境。
- 密钥、token 与 provider key 只进入 `configs/secrets/` 或环境变量；不得进入 Git、日志、文档、示例、Skill 或 agent profile。
- 保留用户已有改动；修改前查看 `git status --short`，不使用破坏性 Git 操作。
- Git 分支名必须表达工作性质与 scope，不得使用 `codex/`、`claude/`、`copilot/` 等 agent/tool 身份前缀；完整类型与格式规则见 `docs/guides/development/命名规范.md`。

## 项目 Skill

处理本仓库的架构、开发、调试、文档、Extension 或 AI 协作任务时，先读取 `.codex/skills/glimmer-cradle/SKILL.md`，再按其路由读取最少必要的 references 和 `docs/` 事实源。

`.codex/skills/glimmer-cradle/agents/` 只存 Codex/OpenAI 开发协作配置，不属于运行时 `configs/`。修改该目录时同步检查 skill 和本文件。

## 会话与任务编排

- 一个会话只承担一个边界明确的目标和一个 `session_role`：`[总控]`、`[执行]`、`[审查]`、`[发布/运维]`。总控负责范围、架构决策、任务下发、状态汇总和最终验收，不得同时承担持续编码、长时间测试、发布或生产运维。
- 同一里程碑最多一个决策 owner。创建执行、审查或发布/运维会话不等于更换总控；原总控默认继续任职。总控换届必须显式交接，旧总控交接后停止决策。
- 同一工作树、发布流程或生产环境在同一时间只能有一个写入负责人。不得让总控与执行会话、多个执行会话或人工操作并行修改同一事实源。
- 效率等于有效吞吐、首次正确率、低返工、证据完整、决策可追溯，以及成本与风险成比例；不是最少步骤、token、会话、测试、文档或沟通。必要的契约、生命周期、删除门、验证和独立审查不得因成本省略。
- 总控维护可追溯控制卡并消费结构化结果，执行者直接读取事实源。新会话取得完成任务所需的决策、owner、风险、账本与事实源链接，不复制可恢复的对话历史；详细分工见 `common/会话与任务编排.md`。
- 自适应任务流由 `common/开发工作流.md` 权威拥有，验证选择与账本由 `common/测试与交付.md` 权威拥有；相同状态的成功证据仅在失效条件未触发时复用。前一门失败先定位根因，不得以反复启动全仓、Release 或生产操作碰运气。
- 连续两次出现相同理解偏差、同类失败或无效调试时立即停止当前策略，核对事实源并缩小问题；不得用更多并行会话或更大模型掩盖边界不清。
- 会话经历上下文压缩或恢复摘要时，只触发一次快速会话健康复核，不单独、机械地触发换会话建议。复核应确认当前目标与范围是否清楚，关键决策、owner、验证账本和下一验收门是否可可靠追溯，以及是否出现重复读取、理解偏差、无效调试、噪声淹没或范围漂移。若复核通过，应继续当前会话。
- 工具输出必须有范围和上限。优先读取失败摘要、目标文件和增量日志，禁止反复载入完整任务历史、完整 CI 日志或无关目录；长任务由唯一执行者等待并回报紧凑快照。
- 模型按任务复杂度选择：跨层架构、疑难调试和最终审查使用高能力模型；机械修改、独立查证和格式整理使用中等模型。不得默认全最高，也不得为省额度使用会导致反复返工的过低能力模型。
- 会话按风险边界、耦合度与上下文健康安排，而非按文件或微步骤机械拆分；同一 owner、紧密耦合且输入输出稳定的连续工作可由同一执行者持有。架构 slice 仍遵守项目特定的固定状态、验证与审查门（例如 M12 规则）。只有健康复核确认总控上下文下降、充分且无重复的交接明显更可靠，或用户明确要求时才更换总控。新增角色时使用 `建议创建执行会话`、`建议创建审查会话` 或 `建议创建发布/运维会话`；结束当前会话并换届时必须写出 `建议现在切换到新会话（更换总控会话）` 等包含角色的完整措辞，不得只说“切换会话”。
- 未经用户明确要求或确认，不自动创建、归档或切换会话。提醒切换前先保护当前工作状态，不中断必要命令，不丢失未提交改动，也不执行 `reset`、`clean` 或无关提交。
- 新会话首条提示必须声明 `session_role`、parent controller、目标、禁止项、独占资源及 owner、授权动作、验证账本、停止条件和回报契约；已有 active owner 时，新总控或执行者不得碰同一工作树或环境。
- 详细执行规则和交接模板以 `.codex/skills/glimmer-cradle/references/common/会话与任务编排.md` 为准。

## Agent 配置分层

本仓库采用“一份项目事实源 + 一套 Codex canonical Skill”：

- `AGENTS.md`：所有 AI/人类协作者共同遵守的项目协作宪法。
- `docs/`：唯一项目事实源，保存架构、实现、参考、指南、路线图和历史证据。
- `.codex/skills/glimmer-cradle/`：Codex canonical Skill；`references/` 是唯一 agent 操作准则卡片。

项目只维护 Codex agent 配置。除非用户重新作出架构决策，不得新增 Claude、Copilot、Cursor 或其他 agent/tool 适配配置；项目事实必须进入 `docs/`，Codex 操作规则必须进入 `AGENTS.md` 或 `.codex/skills/glimmer-cradle/references/`。

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

- 迁移期按 owner 分流跨语言/跨进程契约：尚未进入对应 M12 迁移切片的现有 runtime 结构仍由 `protocol/src/schemas/` 权威拥有，修改后运行 `pnpm sync:contracts`；新 Contract Spine Service/Document 由 `contracts/{proto,json-schema}/` 权威拥有，使用 `pnpm contracts:generate` / `pnpm contracts:verify`。不得把 runtime consumer 已迁移写成事实，也不得手写镜像或修改生成物。
- Kernel 不做人格和认知判断；Cognition 不接触平台 IO；Renderer 只消费受控投影；Extension 不 import Kernel 内部对象。
- PR 最低验证：`pnpm typecheck`、`pnpm build`；改 Cognition 时在 `core/cognition` 执行 `uv run pytest -q`。按风险补充 schema、UI、启动、日志和 DLQ 验证。

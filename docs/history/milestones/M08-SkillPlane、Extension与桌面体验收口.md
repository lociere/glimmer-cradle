# M08：Skill Plane、Extension 与桌面体验收口

- 状态：done（开发期范围；打包/安装/多机桌面矩阵后移）
- 关联架构：[当前架构](../../architecture/current/README.md)
- 关联实现：[Extension 与 Skill Plane](../../architecture/implementation/Extension与SkillPlane实现.md)、[Desktop 与 Avatar](../../architecture/implementation/Desktop与Avatar实现.md)、[Engines 与 Native](../../architecture/implementation/Engines与Native实现.md)

## 目标成果

Glimmer Cradle 拥有可解释、可授权、可回收、可诊断的能力生态入口，以及开发期可验证的桌面身体状态闭环。用户能知道当前角色会什么、为什么不能调用某能力、哪个 provider 失败、身体是否真正 ready；开发者能按统一 catalog、Policy、Invocation 和 runtime readiness 收口实现。

## 范围

- 固化 Skill、Tool、Resource、Prompt、Provider、Extension、MCP Server、User Skill 的命名和边界。
- 让 Core/Extension/MCP/User Provider 通过统一 catalog、Policy、Invocation Gateway 和 audit 主线参与能力调用。
- 完整处理 Extension 的 manifest、contributes、activation、requires、permissions、配置、disposable 和停用释放。
- 完整处理 MCP Server 的 stdio/http/ws 配置、握手、枚举、超时、重连退避、撤销 catalog、process cleanup。
- 在开发期验证 Avatar 与 Control Center 的状态一致性：连接、首帧、动作、口型、ready/degraded/error 投影。
- 为 ASR、TTS、Avatar 和工具调用补齐可比较 trace，区分模型、网络、资源准备、编排和呈现延迟。

## 非范围

- 不把官方 Audio Engine、Avatar、Cognition 或 Kernel 内部能力伪装成 Extension。
- 不为了演示保留私有协议、永久 fallback、影子 catalog 或假 ready。
- 不实现未触发的真流式回复、LLM 记忆重排、vivid 日记、多平台大集成。
- 不把用户确认 UI 尚未接入的高风险工具直接放行。
- 不把客户端打包、安装投影、多机 DPI/透明矩阵作为 M08 完成条件；这些后移到发布/收尾阶段。

## 依赖

- Protocol/SDK 对 Skill Plane、Avatar frame、audio status 和 diagnostics 的契约稳定。
- Kernel lifecycle/readiness 能区分连接、资源准备、首帧、degraded、failed。
- Desktop 能展示 provider、runtime、Avatar 和 audio 的状态投影。
- Avatar/native 开发期链路可在目标 Windows 开发环境运行。
- 可观测链路能延续 trace 到 Extension/MCP/Audio/Avatar。

## 风险

| 风险 | 应对 |
|---|---|
| MCP 凭据和远端错误泄露 | 密钥只走 secrets/env，日志脱敏，错误摘要化 |
| Provider catalog 与 handler 不一致 | `contract_only` 不可执行，激活/停用撤销 catalog |
| Avatar dev 可用但打包不可用 | 不在 M08 关闭；后续发布/收尾阶段单独以打包版作为验收门 |
| 透明命中/DPI 多显示器差异 | 后续发布/收尾阶段用 Windows 实机矩阵验证 |
| 高风险工具缺确认 UI | Policy 拒绝并给出可解释原因 |
| trace 太粗无法定位 | 为模型、网络、warmup、policy、invocation、presentation 分 span |

## 验收门

- `pnpm typecheck`、`pnpm build` 通过；受影响 Python 子项目 `uv run pytest -q` 通过。
- Core/Extension/MCP/User Provider 的注册、禁用、失败、重连、撤销和 dispose 可验证。
- Skill/Tool 调用能记录 provider、skill、tool、policy decision、trace、结果和错误。
- Extension 缺权限、缺 Port、激活失败、handler 抛错、停用释放都有测试或手动证据。
- Avatar 在连接、模型、Composition Host 首帧和交互准备完成前不报告 ready。
- 开发期验证 Avatar 状态投影、动作、口型、首帧 readiness 和退出回收；打包版透明、DPI、多显示器矩阵后移。
- Audio TTS/ASR 的 warmup、provider、timeout、cache、process log 和 UI 投影可诊断。
- 无新增非测试 DLQ；日志不泄露 secret；Reference/Guide/Implementation 同步。

## 完成证据（开发期）

- Kernel Extension/Skill 测试覆盖：Extension 权限拒绝、激活失败撤销 catalog、停用释放 runtime handler、重启重新注册、MCP stdio 注册/调用/回收、planner ready 工具投影、Invocation audit 成功/拒绝/失败。
- SDK 包导出补齐 `require` / `import` / `default`，Kernel Vitest 通过 SDK 源码 alias 验证 Extension Host 边界。
- 已运行 `pnpm typecheck`、`pnpm build`、`uv run pytest -q`（Audio Engine）、`pnpm avatar:doctor`。
- 客户端打包、安装投影、透明/DPI/多显示器矩阵不属于本里程碑完成条件，已后移到后续发布/收尾阶段。

## 完成后归档

完成后，当前事实迁入：

- Skill Plane/Extension：`architecture/implementation/Extension与SkillPlane实现.md`、`reference/extension-sdk.md`、`guides/subsystems/扩展开发.md`
- Desktop/Avatar：`architecture/implementation/Desktop与Avatar实现.md`、`reference/ui-design-tokens.md`、`guides/subsystems/桌面与Avatar开发.md`
- Audio/observability：`architecture/implementation/Engines与Native实现.md`、`reference/observability.md`、`guides/subsystems/音频引擎开发.md`

里程碑过程材料移入 `docs/history/`，`now.md` 切换到下一唯一活跃推进面。

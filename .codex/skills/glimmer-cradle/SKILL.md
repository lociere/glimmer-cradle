---
name: glimmer-cradle
description: Develop, debug, review, document, or coordinate Glimmer Cradle（微光摇篮）work. Use project facts, outcome-driven execution, risk-based verification, and explicit ownership while preserving architecture, protocol, lifecycle, and character-profile boundaries.
---

# Glimmer Cradle 项目 Skill

本 Skill 提供项目操作方法与资料路由。目标、授权以用户请求为准，共同约束见根 `AGENTS.md`，当前实现与运行状态依据项目事实源核验。项目采用单一 canonical Skill。

## 开始与路由

先识别用户要的是解释、诊断、修改、审查还是运维，以及完成后应观察到什么。修改前检查工作树和已有写入 owner；明确且局部的任务由当前执行者直接推进。

按下表读取与任务有关的卡片，完整阅读选中的卡片。已在当前上下文完整读取且未变化的文件无需重读。卡片引用用于按需查证；不熟悉 owner 时从 `docs/README.md` 或 [开发手册](../../../docs/guides/开发手册.md) 定位，再查实际代码、Schema、测试与配置。

| 当前需要 | Reference |
|---|---|
| 实现、调试、文档修改的任务闭环 | [开发工作流](references/workflow/开发工作流.md) |
| 分工、交接、跨会话恢复、等待或整合 | [会话与任务编排](references/workflow/会话与任务编排.md) |
| 选择验证、消费证据、验收与交付 | [测试与交付](references/workflow/测试与交付.md) |
| 长任务上下文设计、重复读取、工具集成或反馈失真 | [上下文与工具](references/workflow/上下文与工具.md) |
| 文档、注释、术语或编码 | [文档、注释与编码](references/common/文档、注释与编码.md) |
| 独立审查或设计风险自查 | [审查与风险评估](references/workflow/审查与风险评估.md) |
| 模块归属、依赖、进程边界、重构 | [架构边界与决策](references/architecture/架构边界与决策.md) |
| Schema、事件、IPC、WebSocket、SDK | [协议与跨边界契约](references/architecture/协议与跨边界契约.md) |
| Kernel、Engine、子进程、readiness | [Runtime与生命周期](references/architecture/Runtime与生命周期.md) |
| 配置、数据、资产、路径、打包 | [数据、配置与路径](references/architecture/数据、配置与路径.md) |
| 日志、trace、metrics、DLQ、性能 | [可观测性与诊断](references/architecture/可观测性与诊断.md) |
| 人格、情绪、记忆、LLM、认知循环 | [Cognition](references/subsystems/Cognition.md) |
| Control Center、Presence、Electron、Unity、Live2D | [Desktop与Avatar](references/subsystems/Desktop与Avatar.md) |
| Web、Renderer、布局、视觉、响应式、可访问性 | [Frontend与UI](references/subsystems/Frontend与UI.md) |
| AI 辅助 UI、参考图落地、截图迭代、组件工作台 | 上一项及 [AI前端开发](references/subsystems/AI前端开发.md) |
| Extension、Skill Plane、MCP、公开 SDK | [Extensions与SkillPlane](references/subsystems/Extensions与SkillPlane.md) |

## 工作中的判断

- 将用户目标落实到唯一 owner 与可验证结果；完成结论应包含用户行为或工程成果的直接证据。
- 先解决关键未知项，再扩大实施范围。紧密耦合工作由同一执行者持有；分工依据任务依赖、资源边界和独立判断价值确定。
- 新增命名前按命名规范确定职责；结构迁移同时收束旧入口、consumer、测试与权威文档，具体里程碑的物理删除门仍然有效。
- 实际状态来自代码与环境，长期事实进入 `docs/`；临时任务状态由任务记录或对应 Roadmap 保存。
- 交付说明成果、验证及未覆盖风险。完成本次范围后结束执行；下一 milestone/slice、推送或发布依据相应授权开展。

整体设计与官方参考见 [智能体工作流设计](../../../docs/guides/development/智能体工作流设计.md)；仅在设计、评估或修改工作流时读取。

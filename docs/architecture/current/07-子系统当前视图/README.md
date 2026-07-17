# 子系统当前视图

> 范围：按子系统说明当前系统事实、owner、运行边界、事实源和不变量；不展开逐文件调用细节。
> 事实依据：`products/`、`core/`、`protocol/`、`engines/`、`configs/`、`data/packages/extensions/`、历史 current 架构材料和当前实现。
> 维护触发：子系统职责、进程边界、运行 owner、数据 owner、ready/degraded 语义或主要链路变化。

本目录补足 Current 的子系统视角。它回答“现在 Glimmer Cradle 各子系统是什么、谁拥有事实、怎样协作”，而不是“哪个类调用哪个类”。逐文件实现见 [Implementation](../../implementation/README.md)，字段与路径见 [Reference](../../../reference/README.md)，操作步骤见 [Guides](../../../guides/README.md)。

| 页面 | 关注点 |
|---|---|
| [Kernel 与 Runtime](./Kernel与Runtime.md) | 中枢监督树、运行阶段、Ingress、能力编排、状态投影 |
| [Cognition](./Cognition.md) | 人格、情绪、经历、记忆、上下文、推理、行动语义 |
| [Desktop 与 Avatar](./Desktop与Avatar.md) | Control Center、Presence、Avatar、Native Composition |
| [Engines 与 Native](./Engines与Native.md) | 官方能力引擎、音频资源、native 平台原语 |
| [Extension 与 Skill Plane](./Extension与SkillPlane.md) | Extension SDK、Core/Extension/MCP/User Provider、Policy 与 Gateway |
| [Data 与 Observability](./Data与Observability.md) | 数据域、连续性、日志、trace、metrics、DLQ |

子系统页必须保持三条边界：

1. Current 写当前结构和运行事实，不写教程。
2. Implementation 写代码入口和链路，不复述蓝图。
3. Reference 写精确字段和目录，不讲历史原因。

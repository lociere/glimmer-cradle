# Architecture Baseline v2.0 执行宪章

> 状态：冻结执行解释
>
> 基线：Architecture Baseline v2.0 (Frozen)
>
> 生效日期：2026-09-19

## 1. 权威顺序

架构重构发生冲突时，按以下顺序判断：

1. 用户明确作出的最新架构决策；
2. [Architecture Baseline v2.0 (Frozen)](./Glimmer_Cradle_Architecture_Baseline_v2.0_Frozen.md)；
3. [ADR-0019](../decisions/ADR-0019-采用Architecture-Baseline-v2冻结基线.md) 对旧决策的替代关系；
4. 本执行宪章；
5. [重构执行记录](../../roadmap/architecture-v2-refactor.md)；
6. Current、Implementation 和源码所陈述的当前事实。

执行要求用于规定阶段和验收方式，不能修改冻结基线的目标边界。旧蓝图、旧目标物理拓扑和旧 ADR
只保留历史与迁移证据；与 v2 冲突时不再拥有目标架构解释权。

## 2. 固定目标

最终仓库边界固定为：

```text
core/
extension-sdk/
apps/
protocol/
docs/
```

`core/` 的长期一级模块固定为：

```text
platform/
content/
conversation/
cognition/
capabilities/
jobs/
embodiment/
```

以上是完成态 Namespace Map。迁移期间现有 `contracts/`、`packages/extension-sdk/`、`products/`、
`hosts/`、`engines/` 等路径继续描述当前事实，只有在 consumer-zero、数据保护和验证门满足后才切换。
不得为追求目录外观提前建立空模块，也不得同时建立 `contracts/` 与 `protocol/` 两个契约事实源。

## 3. 固定所有权与依赖原则

- Platform 只拥有跨产品通用的运行 primitive，不接收 Kernel 业务装配、Persona、Tool、模型或 Renderer 语义。
- Content 拥有通用信息类型；Message 归 Conversation。
- Conversation Log 是交互事实的 canonical source；History 是 projection。
- Cognition 拥有 Persona、Memory、Context、Inference、Perception、Attention 与迭代 Loop，不直接执行平台 IO。
- Capabilities 分别拥有 Tool、Skill、Resource、Exposure 和 Execution，不建立万能 Registry。
- Jobs 只拥有跨时间、可恢复的工作，不替代当前 Turn 内的 Cognition Loop。
- Embodiment 只拥有稳定具身意图；具体 Renderer、语音和平台实现位于 Adapter、Extension 或 App。
- Extension 只依赖 Extension SDK/public contracts；Core 不反向依赖 Extension SDK。
- `.proto` 是跨进程 wire single source，generated DTO 不成为领域实体。
- Local、Cloud、Hybrid 是 Topology，不产生三套领域实现。

## 4. 固定迁移纪律

每个切片都执行 `create → cut consumers → verify → delete old owner`，并满足：

1. 先固定 contract 与依赖方向，再移动实现；
2. 一个事实在任一迁移时刻只有一个 canonical writer；
3. 兼容层必须记录 owner、退出阶段和删除条件；
4. 旧 owner 只有在 consumer-zero、数据迁移完成且回归通过后才能物理删除；
5. Current 文档只描述已经存在的事实，Roadmap 只描述阶段状态；
6. 目录迁移不能改变稳定标识、幂等键、事件顺序、readiness、取消或恢复语义；
7. 每个源码切片至少通过相关测试、根 `pnpm typecheck`、根 `pnpm build` 和架构门禁；
8. 不能把阶段通过、目录出现或部分 consumer 切换表述成整体重构完成。

## 5. 阶段顺序

执行顺序固定为：审计与护栏 → Platform primitives → Content → Conversation → Cognition Loop →
Capabilities → Jobs → Embodiment → Extension/Apps/Protocol → 根目录收口与最终验收。

相邻切片可以因真实依赖调整，但不得跳过数据迁移、兼容验证和旧 owner 删除门。调整只改变执行排程，
不改变模块所有权与最终边界。

## 6. 偏离与变更控制

下列情况属于架构偏离：改变五个最终根边界、改变七个 Core 模块、改变 canonical state owner、反转依赖方向、
建立第二契约源、把 vendor 类型引入 Core，或恢复已明确禁止的模式。

偏离不得在普通实现切片中顺带发生。只有用户明确作出新的架构决策后，才能同时完成：

1. 新建或替代 ADR，说明证据、替代方案、迁移成本与兼容策略；
2. 更新冻结基线或明确发布新的基线版本；
3. 更新 `architecture-baseline-v2.lock.json` 与机器检查；
4. 更新执行记录、Current/Target 映射和受影响验收门。

缺少其中任一项时，架构门禁应当失败，实施应回到本基线。

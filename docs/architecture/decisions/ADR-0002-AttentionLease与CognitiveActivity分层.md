# ADR-0002 Attention Lease 与 Cognitive Activity 分层

状态：accepted

日期：2026-06-29

更新：2026-07-14

## 背景

桌面、群聊、私聊、直播间和未来频道线程都需要表达“当前角色正在关注哪个外部上下文”。Cognition 同时需要根据互动强度调整循环频率、上下文预算、主动性和推理资源。情绪系统还包含连续的情感激活强度，Episode 与 Memory 则需要独立的后台维护节拍。

旧设计把这些概念收进 `ArousalState`，并将 Dormant、Dreaming、Ambient、Awake 的自动迁移逐条写入 Experience。结果是外部焦点、情感唤醒度、调度档位和记忆维护互相借职责：一次定时衰减会伪装成角色经历，Dreaming 会把维护任务伪装成人格状态，冷启动投影也会制造没有发生过的状态跳转。

## 决策

Glimmer Cradle 将外部注意力、情感激活、认知活动、后台维护和行动意愿分开：

| 概念 | Owner | 语义 | 是否进入 Experience |
|---|---|---|---|
| `AttentionLease` / `AttentionProjection` | Kernel | 当前关注的外部 scene/channel、来源、原因和过期时间 | 否；真实感知另行进入 |
| Affect activation | Cognition `affect/` | 情绪的连续强度与紧迫程度 | 只有具有因果意义的 Emotion 评价进入；连续采样不进入 |
| `CognitiveActivityState` | Cognition `activity/` | `engaged / ambient / quiescent` 调度档位 | 否，只进 metric、log、span |
| `CognitiveActivityPolicy` | Cognition `activity/` | 循环频率、上下文预算、主动性和模型访问策略 | 否，只作为受控状态投影 |
| `MaintenanceScheduler` | Cognition `maintenance/` | Episode 投影、封口与 Memory 巩固的独立节拍 | 维护结果写各自事实库；调度本身不进入 |
| `address_mode` / `response_policy` | Protocol / Adapter | 单条感知是否直接寻址、是否允许外显回复 | 随真实 Perception 进入 |
| Volition | Cognition | 在边界允许时，当前角色是否愿意说或做 | 最终 Reply、Action 或 Silence 进入 |
| Skill Policy / Gateway | Kernel | 工具意图能否执行、是否确认以及如何审计 | 工具请求与结果按稳定 Moment 语义进入 |

`CognitiveActivityState` 不是人格状态，也不是情感唤醒度：

| 状态 | 调度语义 |
|---|---|
| `engaged` | 直接互动中的完整预算与已配置远端推理访问 |
| `ambient` | 低频环境感知、受限上下文与主动性 |
| `quiescent` | 静息调度，不允许主动生成，不占用推理预算 |

直接互动使活动态进入 `engaged`，背景观察可使 `quiescent` 进入 `ambient`；无活动时按阈值衰减。Affect activation 可以短暂阻止衰减，但不会把调度档位写回情绪。活动态冷启动只从真实 Perception、Reply 和 Action 的时间线重建，不读取旧 transition 记录。

`MaintenanceScheduler` 有自己的生命周期、间隔、trace、metric 和错误隔离。进入 `quiescent` 只发送一次“可以封口开放 Episode”的提示；维护仍由 Scheduler 决定和执行，不存在 Dreaming 调度态，也不由每一拍认知循环调用巩固器。

Global Workspace 广播是易失的当前意识焦点。自动广播、循环 tick、活动衰减和维护调度都不自动生产 Thought Moment。Thought 只保留给未来由明确认知过程提交、可解释且具有语义内容的反思、意向形成或自我叙事产物。

## 边界

- Extension 只能申请 Attention Lease，不能控制 Cognitive Activity、Affect、Volition 或 Maintenance。
- Kernel 只消费 `CognitiveActivitySnapshot.policy.frequency_hint_ms` 调整活性探测间隔，不判断角色是否愿意回复。
- Cognition 不读取平台私有字段，也不查询 Kernel Attention 内部对象。
- `response_policy=observe_only` 仍可进入 Experience、关系观察和记忆候选，但不能产生外显回复。
- Activity transition 只写 `cognition.activity.state`、`cognition.activity.transition` 和结构化日志；不得新增对应 MomentKind。
- Maintenance run 只写维护 span/metric、Episode projection、consolidation run 和有证据的 Memory revision。

## 影响

- 删除 `affect/arousal/`、`ArousalState`、`ArousalProfile`、`ArousalSnapshot` 和 `arousal` Moment。
- 新增 `activity/`、`maintenance/`、`CognitiveActivityState`、`CognitiveActivityPolicy` 与 `CognitiveActivitySnapshot`。
- `CycleController` 只提交本拍真实 Experience，不拥有维护调度器。
- Control Center 的 Experience 视图不再出现逐步衰减记录；活动变化通过诊断与状态投影观察。
- 旧 Cognition 数据不迁移；开发阶段清空后由新事实源重新生成。

## 验证

- Activity transition 单元测试覆盖直接互动、背景观察、衰减、最短驻留和 Affect activation hold。
- 任何 Activity transition 后，Ledger Moment 数量不增加。
- `MomentKind` 不包含 `arousal`，代码与活跃文档不存在旧协议消费者。
- Maintenance Scheduler 独立于 CycleController 运行；静息提示只触发封口，不制造 Experience。
- 冷启动只从 Perception、Reply、Action 重建最近活动，不从日志或旧 transition 重建。
- Attention Lease 改变不会伪造 Cognitive Activity，反向亦然。

## 依据

- LIDA 将 Global Workspace broadcast 建模为认知循环中的当前广播，而不是默认持久记忆：[LIDA: A Systems-level Architecture for Cognition, Emotion, and Learning](https://ccrg.cs.memphis.edu/assets/papers/2013/franklin-ieee-tamd11.pdf)。
- EMA 将情绪动态建立在 appraisal/reappraisal 上，支持把情感激活与资源调度分开：[EMA: A Process Model of Appraisal Dynamics](https://www.ccs.neu.edu/~marsella/publications/pdf/MarsellaCSR09.pdf)。
- 生理与认知研究区分 wakeful、autonomic、affective arousal，说明单一 Arousal 枚举不足以同时承载这些概念：[Deconstructing Arousal](https://pmc.ncbi.nlm.nih.gov/articles/PMC6068010/)。
- Vigilance/attention 与 arousal 相关但不是同一个构念：[Vigilance, Attention, and Arousal](https://pmc.ncbi.nlm.nih.gov/articles/PMC2865224/)。

## 链接

- Architecture：[Kernel 与 Runtime 当前视图](../current/07-子系统当前视图/Kernel与Runtime.md)
- Architecture：[Cognition 当前视图](../current/07-子系统当前视图/Cognition.md)
- Implementation：[Cognition 认知核实现](../implementation/Cognition认知核实现.md)
- Reference：[Protocol Reference](../../reference/protocol.md)

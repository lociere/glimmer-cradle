# 架构重构状态

> 本页由 execution.json 生成；使用 pnpm check:docs --write，禁止手工维护第二份状态。

核对日期：2026-10-09；产品事实输入：`dc59181e`。日期不替代 Git/代码核对。

下一任务：**[A00 接手与差距核对](slices/A00-reconcile.md)**（ready / discovery）。核对实际 HEAD 后执行 A00 卡的步骤 1–7

阶段 partial 表示已有历史成果且仍有最终门；不撤销历史局部完成，也不冒充最终验收。

## 阶段

| 阶段 | 状态 | 当前依据与差距 |
|---|---|---|
| [P00 增量审计](plan.md#p00) | partial | 历史初始审计已完成；截至 dc59181e 的后续证据已导入索引，需核对当前差距。 |
| [P01 架构护栏](plan.md#p01) | partial | 既有锁、AST 边界、例外和目标目录门已运行；最终规则尚待切换。 |
| [P02 Platform](plan.md#p02) | partial | Clock/Identity/Observability/Lifecycle/配置机制、authority 部分已提取。 |
| [P03 Content](plan.md#p03) | partial | 旧范围 Content/AssetRef 已接受；最终目录及旧媒体恢复门继续适用。 |
| [P04 Conversation](plan.md#p04) | partial | Log/History/持久 Turn 与 Delivery 回执已逐步落地；完整产品切换未完成。 |
| [P05 Cognition](plan.md#p05) | partial | 统一 Loop、Context、Memory、Knowledge、Planning 与 checkpoint 已有真实切片。 |
| [P06 Capabilities](plan.md#p06) | partial | 三 Registry、Step Exposure、持久 Execution 与真实 receipt 已接线。 |
| [P07 Jobs 与长期 Planning](plan.md#p07) | partial | Jobs 持久链、Memory/Planning 源、真实通知与历史原身份确认已实现。 |
| [P08 Embodiment](plan.md#p08) | planned | 尚无完整最终阶段验收；既有 C#/Unity/native 仍为实际链路。 |
| [P09 SDK 与 Extension Host](plan.md#p09) | partial | 部分权限/Resource/typed wire 已接入；多语言公开面和 Host 最终迁移未完成。 |
| [P10 外部能力](plan.md#p10) | planned | 厂商适配仍在迁移期位置，独立制品接入待整体验证。 |
| [P11 Contract Spine 原子迁移](plan.md#p11) | planned | 现行 contracts 为唯一源，禁止提前建立第二 protocol 源。 |
| [P12 Apps 与产品入口](plan.md#p12) | partial | 目标 Host/Worker 和通知路由已有真实接线；完整产品仍依赖 Kernel ingress。 |
| [P13 Topology 与 authority](plan.md#p13) | partial | 本地 authority/Jobs handover 已验证，其他 owner 与跨机仍未闭合。 |
| [P14 数据、版本与制品](plan.md#p14) | planned | 历史旧样本和发布事实存在，完整目标安装/恢复矩阵待执行。 |
| [P15 最终收口](plan.md#p15) | planned | 规格门和实现完成分开；最终物理核对仍有迁移差距。 |

## 任务依赖与入口

| 任务 | 状态/类型 | 依赖 | Owner |
|---|---|---|---|
| [A00 接手与差距核对](slices/A00-reconcile.md) | ready / discovery | 无 | 开始时指定 |
| [P07A Planning 后继调度与撤销](plan.md#p07) | planned / discovery | A00 | 开始时指定 |
| [P07B Jobs 产品接纳、catalog 与状态投影](plan.md#p07) | planned / discovery | P07A | 开始时指定 |
| [P02A 剩余平台机制和关闭语义](plan.md#p02) | planned / discovery | A00 | 开始时指定 |
| [P03A Content 最终路径与媒体恢复差距](plan.md#p03) | planned / discovery | A00 | 开始时指定 |
| [P04A 交互、中断与实际播放回执](plan.md#p04) | planned / discovery | P03A, P02A | 开始时指定 |
| [P05A Cognition IO、helper 和 checkpoint 解耦](plan.md#p05) | planned / discovery | P07A, P04A | 开始时指定 |
| [P06A Capability 权限、预算和未知结果对账](plan.md#p06) | planned / discovery | P05A | 开始时指定 |
| [P09A 公开 SDK 与 broker 生命周期](plan.md#p09) | planned / discovery | P06A | 开始时指定 |
| [P08A 具身语义与 C# 行为迁移](plan.md#p08) | planned / discovery | P09A, P04A | 开始时指定 |
| [P09B 多语言 SDK 与独立模板验收](plan.md#p09) | planned / discovery | P09A, P08A | 开始时指定 |
| [P10A 模型、语音、MCP 与渠道扩展](plan.md#p10) | planned / discovery | P09B | 开始时指定 |
| [P10B Renderer 扩展与 native/Unity 真实链](plan.md#p10) | planned / discovery | P08A, P09B | 开始时指定 |
| [P11A Contract Spine 原子路径切换](plan.md#p11) | planned / discovery | P10A, P10B | 开始时指定 |
| [P12A 可信产品 ingress 与唯一 Host 接线](plan.md#p12) | planned / discovery | P07B, P11A | 开始时指定 |
| [P12B Desktop/控制面与打包监督迁移](plan.md#p12) | planned / discovery | P12A | 开始时指定 |
| [P13A 全域 authority、离线与冲突恢复](plan.md#p13) | planned / discovery | P12B, P02A | 开始时指定 |
| [P14A 旧队列及全域数据迁移恢复](plan.md#p14) | planned / discovery | P13A | 开始时指定 |
| [P14B 版本事实源与固定制品矩阵](plan.md#p14) | planned / discovery | P14A | 开始时指定 |
| [P01A 清空迁移例外并启用最终护栏](plan.md#p01) | planned / discovery | P14B | 开始时指定 |
| [P15A 最终完整行为链与物理验收](plan.md#p15) | planned / discovery | P01A | 开始时指定 |
| [P15B 固定候选独立审查与归档](plan.md#p15) | planned / discovery | P15A | 开始时指定 |

planned 任务先细化为精确切片；依赖 accepted 且准备门通过后置 ready。实现需精确映射/命令，
verified/accepted 需可定位证据，高风险另需独立接受。状态检查不证明 evidence 内的业务结论。

验证与未验范围查[证据索引](evidence/README.md)，风险查[风险台账](risks.md)。

# Data 与 Observability 当前视图

> 范围：用户连续性数据、模型、缓存、运行产物、日志、trace、metrics、audit、模型调用观测、DLQ 与诊断投影的当前架构事实。
> 事实依据：`data/` 约定、Kernel/Cognition/Desktop observability 实现、Reference 文档与当前代码入口。  
> 维护触发：owner、目录、索引、bundle、cleanup、DLQ 或过程日志边界变化。

Data 是角色连续性的物理投影，Observability 是多进程系统的工程诊断平面。两者都跨越 Kernel、Cognition、Desktop、Engine、Extension，但每一类数据只能有一个写入 owner。

## 当前数据域

| 数据域 | 语义 | Owner |
|---|---|---|
| `data/state/cognition/experience/` | Experience catalog 与月度 Ledger packs | Cognition / Experience |
| `data/state/cognition/memory/` | 版本化 Memory、Relationship、Intention、Knowledge 与索引事实库 | Cognition |
| `data/state/cognition/conversations/` | 从 Ledger 可重建的 Conversation、Chapter、Segment 与 State 投影 | Cognition |
| `data/state/cognition/projections/` | 可从事实源重建的 Episode 等投影 | Cognition |
| `data/state/kernel/` | Kernel 基础设施状态、扩展宿主数据、TS DLQ | Kernel |
| `data/state/desktop/` | Desktop 窗口、界面偏好与 Avatar 呈现状态 | Desktop main |
| `data/state/extensions/` | 扩展私有业务状态，不承载角色会话或认知事实 | Extension Host / 扩展 |
| `data/models/` | 用户导入或下载的模型 | 对应 Engine / Cognition owner |
| `data/packages/extensions/` | 已安装 Extension 的不可变版本目录 | Extension Host |
| `data/packages/managed-resources/` | Extension 代管的第三方包与工具 | 对应 Extension owner |
| `data/cache/` | 可删除可重建缓存 | 对应 cache owner |
| `data/work/` | ASR 输入、临时音频、导出中间产物 | 产生方 |
| `data/backups/` | 迁移与用户主动备份 | 迁移 / 恢复流程 |

Experience Ledger 和 Memory DB 是不可再生 state；Episode、索引、缓存、工作材料和 observability 是可重建或可清理材料。清理 observability 不是清理记忆或 Experience。

## 当前可观测性平面

| 类型 | 目的 | 典型位置 |
|---|---|---|
| Logs | 解释离散事件、状态变化和错误摘要 | `data/observability/logs/` |
| Events | 统一结构化诊断事件 | `data/observability/logs/events/` |
| Traces | 串联一次跨进程操作的 span 链路 | `data/observability/traces/` |
| Metrics | 观察趋势、容量、延迟和资源 | `data/observability/metrics/` |
| Audit | 保存高风险副作用动作 | `data/observability/logs/audit/` |
| 模型调用观测 | 保存模型调用摘要与可选完整 capture | `data/observability/model-invocations/` |
| Process logs | 子进程 stdout/stderr 和第三方输出 | `data/observability/logs/application/` |
| Index | 诊断查询索引 | `data/observability/index/observability.db` |
| Bundles | 诊断包导出目录 | `data/observability/bundles/` |
| DLQ | 无法安全处理但必须保留的失败事件 | `data/state/kernel/kernel.db` 等 owner state |

当前事实：
- `logs/application/`、`logs/events/`、`logs/audit/` 和 `model-invocations/` 是唯一正式目录。
- `index/` 与 `bundles/` 是可删除、可重建的诊断投影。
- 主日志只保留摘要与引用；console 文件保存 noisy 输出；trace 负责跨边界因果链；DLQ 保存结构化失败。

## 诊断投影与受控查询

当前 Desktop main 提供受控 IPC：
- `ui:get-observability-recent-errors`
- `ui:get-observability-trace`
- `ui:get-observability-maintenance`
- `ui:export-observability-bundle`
- `ui:cleanup-observability`

Renderer 通过这些入口消费：
- 最近错误摘要
- 按 `trace_id` 聚合的 `events`、`audit`、`modelInvocations`、`DLQ`、`span`、`process_log_ref`
- 保留期、索引模式、bundle 目录等维护状态
- bundle 导出结果和 cleanup 结果

Renderer 不直接读取 `data/observability/` 原始文件，也不直接读取 `observability.db`。

## 当前索引形态

查询主路径优先走 `data/observability/index/observability.db`。它由 Desktop main 从 JSONL 和 Kernel DLQ 摘要构建，仅作为查询索引，不改变 owner 事实源。

SQLite 索引损坏或缺失时，Desktop main 可以直接扫描当前 JSONL 事实文件并只读查询 Kernel DLQ，作为恢复路径重新建立索引；这不是旧目录兼容入口。

## Trace 与 Experience 的关系

当前有两条不同因果线：
- **Experience / Moment**：回答“角色经历了什么”，服务连续性与人格状态
- **Trace / Span**：回答“系统如何处理这次操作”，服务工程诊断

两者可以关联，但不能互相替代。一条用户输入可能同时产生 Moment 和 trace；一次 provider timeout 可能只有 trace、日志与 DLQ，不一定成为角色经历。

## Cleanup 边界

observability cleanup 只针对可再生观测数据：
- `events`
- `traces`
- `metrics`
- `audit`
- `llm summary` 与 `llm full captures`
- `logs/application`
- `bundles`
- 已 `resolved` / `replayed` 且超期的 DLQ

不在 cleanup 范围内：
- Cognition state
- Experience
- 用户导入模型与资源
- 扩展私有状态
- 托管包

## 迁移原则

1. 先识别不可再生状态：Experience Ledger、Memory DB、用户导入模型、扩展状态、用户备份。
2. 再识别可清理投影：cache、work、observability。
3. 迁移脚本只读旧 owner 路径，把数据写入当前 owner 状态目录；迁移完成后删除旧入口读取代码。
4. 新目录、新 Schema、新 IPC、新文档必须一起收口。
5. 一旦 `observability.db` 完全接管查询能力，应删除 scan fallback，而不是长期双主线并存。

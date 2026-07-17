# 日志、Trace 与 DLQ 排障

> 适用场景：无回复、启动失败、runtime degraded、provider timeout、工具调用失败、Avatar/Audio 异常、DLQ 增长或跨进程链路断裂。  
> 前置：已读 [Data 与 Observability 当前视图](../../architecture/current/07-子系统当前视图/Data与Observability.md) 与 [Observability Reference](../../reference/observability.md)。

## 排障顺序

1. 先确定用户可见症状、绝对时间点与涉及 runtime。
2. 看 Control Center 的 runtime snapshot：谁是 `ready`、`degraded`、`failed`、`waiting`。
3. 找 trace：确认同一操作是否跨 Desktop、Kernel、Cognition、Engine、Extension 延续。
4. 看主日志 / 结构化事件：是否有 owner、runtime、error code、diagnostic hint。
5. 看 audit：是否存在被拒绝、需要确认或高风险副作用失败。
6. 看 process log：子进程 stdout/stderr 是否暴露依赖、协议或资源问题。
7. 看 DLQ：是否有无法安全处理的 payload。
8. 回到 owner 代码修复，不在下游消费者吞错。

## 优先使用 Control Center 诊断页

当前 Control Center 通过受控 IPC 读取 projection。排障优先顺序：

1. 先看“最近错误”
2. 再按 `trace_id` 查询同一条链路下的：
   - `events`
   - `audit`
   - `modelInvocations`
   - `DLQ`
   - `span`
   - `process_log_ref`
3. 如需留证或交接，导出 bundle
4. 如需回收可再生观测数据，再执行 cleanup

当前 Desktop main 优先从 `data/observability/index/observability.db` 提供查询，并保留 JSONL / DLQ scan fallback。Renderer 不直接读取原始 observability 文件。
诊断页中的模型调用观测也是摘要投影；如果需要完整 capture，只能通过显式配置后的 bundle 导出或 main 进程受控路径获取。

直接查看本地完整 capture 时，先进入 `data/observability/model-invocations/captures/<UTC-date>/trace-<trace-id>/timeline.md`，再按全局 `001` / `002` / `003` 顺序查看。动作判断在 `01-action-decision/`，Skill 规划在 `02-skill-planning/`，最终模型回复在 `03-final-response/`，记忆整理在 `04-memory/`。单次调用中优先读 `00-manifest.json`，需要时再展开 prompt、response 和 provider request/response；不再通过 invocation ID 猜测调用先后。

## 常见入口

| 现象 | 先查 |
|---|---|
| 对话无回复 | Desktop 输入、Kernel Ingress、Cognition inbound、CycleController、outbound |
| UI 显示旧状态 | Kernel 投影、preload IPC、renderer store 订阅 |
| 启动卡住 | runtime.pretty.log、runtime snapshot、required SDK |
| Avatar 未 ready | `host_hello` / `host_ready`、avatar process log、composition span |
| TTS/ASR 失败 | AudioService、process log、模型路径、warmup |
| Tool 调用失败 | SkillPolicyEngine、InvocationGateway、provider log |
| Extension 不工作 | manifest、activation、requires、permissions、dispose |
| DLQ 增长 | DLQ owner、payload schema、重复重试、error code |

## 对话无回复链路

按这个顺序查，不要直接跳到 LLM：

1. Renderer 是否发出用户输入
2. preload / Electron main 是否交给 Kernel
3. Kernel Ingress Gate 是否放行
4. PerceptionAppService 是否创建规范感知
5. CognitionManager / IPC 是否发到 Python
6. `ports/kernel/inbound/` 是否成功解析
7. `CycleController` 是否处理该感知
8. context / reasoning / volition 是否产生 action
9. outbound bridge 是否回到 Kernel
10. Kernel 是否投影到 Desktop / Channel / Avatar

## 导出诊断包

1. 在诊断页输入或选择 `trace_id`
2. 确认 projection 已返回相关 `events`、`audit`、`modelInvocations`、`DLQ` 和 `process_log_ref`
3. 点击“导出诊断包”
4. 记录返回的 `bundle_root` 与 `manifest_path`
5. 检查 bundle 不应默认包含完整 prompt、provider key、secret 或完整 raw response

当前 bundle 至少包含：
- `manifest.json`
- `trace-summary.json`
- `events.json`
- `spans.json`
- `audit.json`
- `model-invocation-records.json`
- `dlq-summary.json`
- `process-log-refs.json`
- `runtime-summary.json`

只有在 `configs/system/observability.yaml -> bundles.include_model_invocation_captures=true` 且本地存在完整 capture 时，bundle 才会包含 `model-invocation-captures/`。

## Cleanup

Control Center 的“运行清理”只处理可再生观测数据：
- `data/observability/logs/events/`
- `data/observability/traces/`
- `data/observability/metrics/`
- `data/observability/logs/audit/`
- `data/observability/model-invocations/` 与 `model-invocations/captures/`
- `data/observability/logs/application/`
- `data/observability/bundles/`
- Kernel DLQ 中已 `resolved` 或 `replayed` 且超过保留期的记录

cleanup 不会删除：
- `data/state/cognition/`
- `data/models/`
- `data/packages/`
- 扩展私有状态
- 用户导入资源

cleanup 后 `observability.db` 会在下一次查询时重建。

## DLQ 处理

1. 读取 DLQ 的 `owner`、payload 类型、`error_code`、`trace_id`
2. 再看 `failure_phase`、`retry_policy`、`replay_command`、`diagnostic_hint`
3. 判断是契约错误、生产者错误、消费者错误、资源错误还是环境错误
4. 如果是旧 Schema / 旧字段，走 Schema 迁移，不在消费者吞掉
5. 修复后用同类 payload 重验
6. 只有确认不可再处理或已重放成功，才清理对应 DLQ

DLQ 不是普通错误日志。它表示“当前系统无法安全处理，但必须保留证据与恢复语义”。

trace projection 的 `process_log_ref.path` 必须直接指向 `data/observability/logs/application/...`。若出现其他目录，按旧写入路径回归处理，不增加 alias。

## 新增日志时的要求

优先使用结构化字段：
- `trace_id` / `span_id`
- `runtime_id`
- `provider_id`
- `extension_id`
- `skill_id` / `tool_name`
- `scene_id`
- `error_code`
- `event_outcome`
- `diagnostic_hint`
- `artifact_ref` / `details_ref`
- `duration_ms`

不要只写自然语言长句，不记录 secret、token、完整 provider key 或完整隐私 payload。

## 修复后的验证

- 同一 trace 能贯穿相关 runtime
- 主日志有摘要，process log 有细节
- DLQ 不再新增同类事件
- 诊断页能展示正确的 runtime / trace / bundle / cleanup 状态
- 修复不是通过吞错、降级成 warn 或伪造 ready 实现

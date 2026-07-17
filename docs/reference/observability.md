# Observability Reference

> 范围：日志、trace、span、metrics、audit、模型调用观测、DLQ、应用 console 输出、诊断索引与导出 bundle 的精确规则。
> 事实依据：`configs/system/observability.yaml`、Kernel/Cognition/Desktop observability 代码、`scripts/dlq.py`、`scripts/telemetry.py`。  
> 维护触发：字段、目录、IPC、保留期、脱敏、导出或 cleanup 行为变化。

## 本地可观测性平面目录

`data/observability/` 是 Glimmer Local Observability Plane 的根目录。

| 目录 | 语义 | 当前 owner / 入口 |
|---|---|---|
| `logs/application/` | 第一方应用日志与受管进程 stdout/stderr | Kernel、Cognition、Audio、Avatar、Extension Host |
| `logs/events/` | 统一结构化诊断事件 JSONL | Kernel `foundation/observability/plane.ts` |
| `logs/audit/` | 高风险副作用审计记录 | Skill Plane、Desktop main audit sink |
| `traces/` | span JSONL | Kernel `tracer.ts`、Cognition `tracer.py` |
| `metrics/` | metrics JSONL | Kernel `metrics.ts`、Cognition `metrics.py` |
| `model-invocations/records/` | 模型调用摘要 JSONL | Cognition `model_invocations.py` |
| `model-invocations/captures/` | full 模式下受控、脱敏的完整模型输入输出 | Cognition `model_invocations.py` |
| `index/` | 诊断查询索引 | Desktop main 在 `index/observability.db` 维护 SQLite 索引 |
| `bundles/` | 诊断 bundle 导出目录 | Desktop main 受控导出 |

Desktop main 的 `process_log_ref` 只暴露一个规范化 `path`、owner 与存在状态，不维护逻辑路径和物理路径 alias。Renderer 不直接读取原始文件或 `observability.db`，只消费 Electron main 的受控 projection。

## 可观测数据类型

| 类型 | 回答的问题 | 典型位置 | 不能替代 |
|---|---|---|---|
| 日志 | 发生了什么离散事件，摘要是什么 | `data/observability/logs/`、`events/` | trace 的因果链 |
| Trace/Span | 一次跨模块操作卡在哪、慢在哪、断在哪 | `data/observability/traces/` | 普通事件日志 |
| Metrics | 一段时间内流量、延迟、错误率、饱和度怎样变化 | `data/observability/metrics/` | 单次失败原因 |
| Audit | 哪些高风险副作用被执行、拒绝或失败 | `data/observability/logs/audit/` | 普通业务日志 |
| 模型调用观测 | prompt / provider payload / raw response 如何进入模型 | `data/observability/model-invocations/` | runtime.log |
| DLQ | 哪些事件无法安全处理但必须保留证据或等待恢复 | `data/state/kernel/kernel.db` 等 owner state | 普通错误日志 |

主日志只记录 owner、runtime、trace、error code、摘要与外部引用；第三方库 banner、下载进度和长 stdout/stderr 进入 process log，不进入主事件时间线。

## 结构化事件字段

新增事件必须走受控 registry / facade，字段语义固定：

| 字段 | 语义 |
|---|---|
| `timestamp` | ISO 时间戳 |
| `level` | `debug` / `info` / `warn` / `error` |
| `event_type` | 稳定事件类型，例如 `llm.request`, `skill.invocation`, `runtime.lifecycle` |
| `event_action` | 动作，例如 `invoke`, `export`, `cleanup`, `enqueue` |
| `event_outcome` | `started` / `succeeded` / `failed` / `partial` / `policy_denied` |
| `event_reason` | 结果原因或策略原因 |
| `owner` | 负责该事件的子系统 |
| `module` | 发出事件的模块 |
| `runtime_id` | `kernel`、`cognition`、`audio.tts`、`avatar.host` 等 |
| `phase` | lifecycle 或业务阶段 |
| `trace_id` | 诊断主索引 |
| `span_id` / `parent_span_id` | 当前 span 与父 span |
| `scene_id` | 场景或会话归属 |
| `extension_id` | 相关扩展 |
| `provider_id` | LLM、MCP、Audio 或 skill provider |
| `skill_id` / `tool_name` | Skill Plane 定位；仅允许来自受控 catalog 的稳定标识 |
| `process_id` | 外部进程或子进程标识 |
| `error_code` / `error_kind` | 稳定错误分类 |
| `diagnostic_hint` | 下一步排障提示 |
| `artifact_ref` / `details_ref` | 指向 bundle、process log、artifact 或明细文件 |
| `duration_ms` | 已知耗时 |
| `schema_version` | 事件 schema 版本 |

规则：
- 缺少上游 trace 时生成 synthetic trace，不留空。
- `trace_id` 是查询 key，不是 metric label。
- 不记录 secret、provider key、Bearer token 或完整隐私大 payload。

## Trace 传播

入口应创建或续接 trace：用户输入、平台事件、定时任务、provider callback、MCP 调用、Engine 请求、Avatar frame 都应延续同一 trace。

典型 span：
- `ingress.normalize`
- `cognition.context`
- `cognition.reasoning`
- `cognition.memory`
- `llm.request`
- `skill.policy`
- `skill.invoke`
- `audio.tts`
- `audio.asr`
- `avatar.presentation`
- `renderer.project`

高频 Avatar 帧、鼠标视线与逐帧参数默认不进入主 trace；需要时单独开启 debug trace 与采样。

## Skill Plane 调用观测

`SkillInvocationGateway` 对已解析到具体 skill 的 tool/resource/prompt 调用写结构化事件、audit 与 metrics。

核心 `event_type`：

| `event_type` | 语义 |
|---|---|
| `skill.invocation.succeeded` | policy 允许且 handler 成功 |
| `skill.invocation.policy_denied` | policy 拒绝，例如 `contract_only` 或确认缺失 |
| `skill.invocation.failed` | policy 允许但 handler 抛错或远端调用失败 |

事件字段包含 `trace_id`、`provider_id`、`skill_id`、`tool_name`、`duration_ms`、`event_outcome` 和脱敏后的错误摘要；不记录完整 args、result、token 或 provider key。

metrics label 只允许低基数字段白名单。`trace_id`、`prompt_hash`、绝对路径、URL、原始 payload key 等高基数字段不得进入 label。

## 模型调用记录与 Capture

模型调用观测配置位于 `configs/system/observability.yaml -> model_invocations`。

| 模式 | 行为 |
|---|---|
| `off` | 不记录模型调用摘要或完整输入输出 |
| `summary` | 记录 purpose、provider/model、耗时、长度、hash、错误摘要；不保存完整 prompt / response |
| `full` | 显式写入 `data/observability/model-invocations/captures/`，保存 prompt、provider payload、raw response、normalized output；仍进行脱敏 |

完整 capture 不按随机 invocation ID 平铺，而是以一次因果链为阅读单元：

```text
data/observability/model-invocations/captures/<UTC-date>/trace-<trace-id>/
  timeline.md
  01-action-decision/
    001_<UTC-time>_<purpose>_<invocation-prefix>/
      00-manifest.json
      10-prompt.txt
      20-response.txt
      30-provider-request.json
      40-provider-response.json
  02-skill-planning/
    002_<UTC-time>_<purpose>_<invocation-prefix>/
      ...
  03-final-response/
  04-memory/
  99-other/
```

分类由调用方通过 `capture_category` 显式声明，不由日志层猜测：`cognitive_action_plan` 属于动作决策，`agent_plan` 属于 Skill 规划，`reply` 与 `agent_synthesis` 属于最终回复，`memory_consolidation` 属于记忆整理，未声明的调用进入 `99-other`。

`timeline.md` 是人类阅读入口，跨分类按完成顺序列出 category、purpose、model、outcome、耗时与输入/输出链接；`00-manifest.json` 是单次调用的结构化摘要。数字前缀在整个 Trace 内全局递增，所以分类不会破坏实际调用顺序。`model-invocations/records/*.jsonl` 仍是查询与索引事实源，Markdown 只是可再生成的人类投影。

当前真实接入路径至少覆盖：
- `ReasoningService -> CloudReasoning -> LLMEngine`
- `AgentPlanUseCase`
- `AgentSynthesisUseCase`

模型调用记录的 `trace_id` 必须继承触发本次推理的感知或 Skill 调用 trace；`cognitive_action_plan -> reply` 以及 `agent_plan -> skill invocation -> agent_synthesis` 不得在 LLM adapter 内重新生成关联 ID。

完整 prompt、provider payload 和 raw response 不得进入普通应用日志、DLQ、bundle 或文档，除非显式启用 full capture 且走受控导出。

## 查询与索引

Desktop main 负责诊断查询：
- `ui:get-observability-recent-errors`
- `ui:get-observability-trace`
- `ui:get-observability-maintenance`
- `ui:export-observability-bundle`
- `ui:cleanup-observability`

当前查询主路径：
1. 优先使用 `data/observability/index/observability.db`
2. SQLite 不可用或索引缺失时 fallback 到 JSONL / Kernel DLQ scan

当前规则：
- SQLite 只是查询索引，JSONL 与 owner DB 仍是事实源
- Renderer 只消费 projection，不接触原始文件或 SQLite
- Renderer 侧的 trace projection 只暴露模型调用摘要，不暴露 `prompt_text_ref`、`provider_payload_ref`、`raw_response_ref` 等 capture 引用
- 当 SQLite 路径覆盖全部现有查询能力后，应删除 scan fallback，不长期双主线并存

## Diagnostic Bundle

bundle 配置位于 `configs/system/observability.yaml -> bundles`：
- `export_dir`：默认 `data/observability/bundles/`
- `process_tail_bytes`：默认 8192，只导出 process log 尾部片段
- `include_model_invocation_captures`：默认 `false`

bundle 由 Desktop main 导出到受控 data root，不写安装目录。当前至少包含：
- `manifest.json`
- `trace-summary.json`
- `events.json`
- `spans.json`
- `audit.json`
- `model-invocation-records.json`
- `dlq-summary.json`
- `process-log-refs.json`
- `runtime-summary.json`

附加规则：
- 默认不包含完整 prompt、provider key、secret 或 full raw response
- process log 只导出截断 tail，不直接打包完整 stdout/stderr
- 只有 `include_model_invocation_captures=true` 且本地存在完整 capture 时，才复制 `model-invocation-captures/`

## DLQ 规则

进入 DLQ 的事件通常满足：当前无法安全处理、不能直接丢弃、需要后续人工或离线脚本诊断。

当前 Kernel DLQ 记录恢复语义字段：
- `trace_id`
- `event_type`
- `failure_phase`
- `error_code`
- `owner`
- `source_path`
- `redacted_payload_summary`
- `retry_policy`
- `replay_command`
- `diagnostic_hint`
- `status`
- `resolved_at`
- `resolution`

不得写入 secret、完整 token 或完整隐私 payload。

常用脚本入口：

```powershell
python scripts/dlq.py
python scripts/telemetry.py
```

## 保留期与 Cleanup

`configs/system/observability.yaml -> retention` 是当前唯一保留期事实源。默认值：

| bucket | 默认天数 | 当前物理形态 |
|---|---:|---|
| `events_days` | 14 | `data/observability/logs/events/*.jsonl` |
| `traces_days` | 14 | `data/observability/traces/*.jsonl` |
| `metrics_days` | 14 | `data/observability/metrics/*.jsonl` |
| `audit_days` | 30 | `data/observability/logs/audit/*.jsonl` |
| `model_invocation_days` | 14 | `data/observability/model-invocations/records/*.jsonl` |
| `model_invocations.full_retention_days` | 3 | `data/observability/model-invocations/captures/**` |
| `application_log_days` | 7 | `data/observability/logs/application/**` |
| `dlq_days` | 30 | `dead_letters_ts` 中已 `resolved` 或 `replayed` 的记录 |
| `bundles_days` | 7 | `data/observability/bundles/**` |

cleanup 只删除可再生观测数据，不触碰：
- `data/state/cognition/**`
- `data/models/**`
- `data/packages/**`
- `data/state/extensions/**`
- 用户导入资源

cleanup 后 `observability.db` 会在下一次诊断查询时重建。

## 排障索引

| 症状 | 优先查看 |
|---|---|
| Kernel 启动卡住 | lifecycle 日志、runtime readiness、Ingress Gate |
| Cognition 无回复 | IPC trace、Cognition process log、DLQ、provider span |
| TTS/ASR 不可用 | audio readiness、`processes/audio-*.log`、resource catalog |
| Avatar 已连接但无动作 | `host_hello` / `host_ready`、avatar process log、composition span |
| Extension 工具不可调用 | skill catalog、policy decision、activation log |
| MCP 工具消失 | provider connection、initialize/enumeration span、timeout |
| UI 状态不一致 | Kernel 投影、preload IPC、renderer store 订阅 |

受管第三方进程的 stdout/stderr 必须先在所属 Adapter 边界按行组装并脱敏，再进入统一日志；WebUI token、登录二维码 URL、access token 和带凭据的查询参数不得依赖下游日志器补救。

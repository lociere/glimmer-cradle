# 修改与诊断 Cognition

> 适用场景：角色、Context、Memory/Knowledge、Inference、Planning/Loop 或 Worker 接线改动。
> 前置条件：明确用户行为、涉及的领域和运行承载；路径以当前源码核验。
> 事实依据：Core 的分域公开入口、Cognition Worker composition/RPC/adapter、相关测试。
> 维护触发：领域入口、Worker 接线、持久化或验证变化。

## 找到当前 owner

领域位于 `core/cognition/src/glimmer_cradle/cognition/`；具体进程和 IO 位于
`apps/cognition-worker/src/glimmer_cradle/cognition_worker/`。当前源码表和完整机制见
[认知实现](../architecture/implementation/Cognition认知核实现.md)；跨组件关系见 [关键运行链](../architecture/current/05-关键运行时链路.md)。

| 要改的行为 | 当前进入位置 |
|---|---|
| 身份、稳定角色、情绪与活动 | Core persona/state；实际 Character Package 与 mutation policy |
| 来源、信任、预算、上下文压缩 | Core context；真实 ReplyContextBuilder 与来源 consumer |
| 感知到行动、取消/工具迭代 | Core perception/attention/loop、StopPolicy/checkpoint；Worker mapper |
| 记忆、关系、巩固与恢复 | Core memory 与 SQLite memory adapter；Conversation Log 由 Conversation owner 写入 |
| Knowledge ingestion/索引/权限失效 | Core knowledge 与独立 SQLite knowledge adapter；Worker Resource/embedding concrete |
| 长期承诺、Jobs 源/结果/通知 | Core planning、Worker job mapper、Host/Jobs adapter；接纳不等于完成/送达 |
| 供应商网络、SSE、embedding 或模型设备 | Worker adapters/model_client.py，经模型 Port 消费；目标 Extension 迁移另查任务状态 |
| 进程、配置投影、gRPC、ready/stop | Worker __main__/composition/rpc_service/readiness/shutdown |

旧 `host/process.py`、`host/composition.py`、`adapters/kernel/`、`application/context/`
已经不是当前入口；不要按旧文档恢复这些目录。公开 wire 仍由现行 Contract Spine 生成。

## 实施与调试

心智策略不接触平台 IO；App/Worker 将受控能力注入消费方 Port。沿真实输入、来源/权限、预算、接纳/持久 ACK、
模型与工具调用、回复/通知、取消/恢复追踪本次行为，不另建并行聊天主线。
需要通用执行判断时用 [认知 Skill](../../.agents/skills/glimmer-cognition/SKILL.md)，本页操作不依赖该 Skill 才能成立。

无回复时先查 Kernel 发出的 Cognition 请求、Worker mapper 的合法/accepted 反馈和 queue/Loop，
再看 context、model tier、provider/工具错误、Intent 仲裁与 Worker→Kernel 输出。
ready/注册、处理 obligation、实际模型成功和最终送达分别取证；取消 RPC 外壳不证明实际推理/工具已停止。

改记忆/知识时保留来源、revision、证据、权限、删除/失效和 unknown 对账；
`episodes.db` 同库的源请求不可按可再生 projection 整库删除。
具体恢复步骤见 [数据迁移与恢复](数据迁移与恢复.md)，当前数据路径只由 [数据参考](../reference/data-layout.md) 维护。

## 验证结果

定向测试用对应 owner 的 uv 环境；完整入口分别为根 `test:cognition`、`test:cognition-worker`。
例如仅验证 persona 与上下文信任：

```powershell
uv run --frozen --no-sync --project core/cognition --extra dev pytest -q core/cognition/tests/test_persona_mutation.py core/cognition/tests/test_context_trust.py
```

测试前核对依赖和 fixture；缺少环境时正常同步项目 uv 依赖，不用全局 pip。
需要跨边界语义变化时按 [契约操作](Schema与跨进程契约变更.md) 生成并验证 TS/Python/C# consumer；
持久化变化再覆盖旧/空/坏样本、重开、重复/取消与恢复。

确定性测试/模型替身不证明角色质量。prompt、检索、模型策略变化使用
[模型评估方法](../../.agents/skills/glimmer-cognition/references/model-evaluation.md)，真实调用须有对应费用/数据授权。
按 [测试与验收](测试与验收.md) 报告当前输入、成果和未验范围；实现/操作/字段的变化同步各自 owner。

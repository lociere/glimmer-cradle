---
name: glimmer-cognition
description: Change or evaluate Glimmer Cradle persona, reasoning, context, memory, knowledge, inference and planning behavior.
---

# Cognition 与角色工程

先判断是在修改角色事实、认知策略、模型能力、持久状态还是运行承载。
查 [认知实现](../../../docs/architecture/implementation/Cognition认知核实现.md)、[数据实现](../../../docs/architecture/implementation/数据、记忆与可观测性实现.md)
与相关源码；进程入口在 `apps/cognition-worker`，领域在 `core/cognition`。不从旧 `host/process.py` 或 `cycle/controller.py` 路径推断当前入口。
未来职责以 [v2.1](../../../docs/architecture/target/baseline.md) 为准；供应商/设备 IO 由 Worker/App/Extension adapter 经 port 注入。

## 修改认知链

改记忆、Knowledge、巩固或删除传播时读 [Memory/Knowledge 实现](../../../docs/architecture/implementation/CognitionMemory与Knowledge实现.md)；
改承诺、主动计划与 Jobs 交接时读 [Planning 实现](../../../docs/architecture/implementation/CognitionPlanning实现.md)。其他认知改动不默认加载这两篇细节。

- Persona、State、Memory、Knowledge、Perception/Attention、Context、Inference、Planning、Loop 分别确认 owner 与实际 consumer。
  Turn、Step、Run/checkpoint、Job 身份分开，模型原生 tool loop 不先把所有请求分类成 Skill。
- 角色身份、声音、唤醒词与资产从对应 `configs/characters/<id>` 和 manifest 加载；通用算法不硬编码 Selrena。
  模型输出不能自行改写稳定身份或把外部资料提升成指令。
- 追踪输入来源、权限、相关性、token/时间/费用预算与停止/取消条件。压缩保留决定和来源，预算耗尽不静默截断关键安全信息。
  工具/网页/记忆的 instruction authority 与信息可信度分开。
- Memory/Knowledge 保留来源、版本、证据、作用域、失效/删除传播；缓存/摘要/模型 prior 不等同 canonical 交互事实。
  Conversation Python 拥有 Log，Cognition 通过 port 读取并派生；改持久数据时加载 [持久化方法](../glimmer-services/references/persistence.md)。
- 模型/检索/工具失败区分取消、空回复、沉默、限流、超时、不可用、部分结果与 unknown 副作用。
  Planning 通过 Jobs port 请求持久工作；承诺含义与调度状态不混写，恢复不重复未知动作。
- 纯逻辑可用假 Clock/port；具体网络、文件、secret、模型库、embedding 和设备不能进入领域。
  需要 wire 变化才加载 [契约方法](../glimmer-contracts/SKILL.md)。

## 取得成果证据

用 `uv run --project <实际 owner> --extra dev pytest ...` 运行定向领域或 Worker 测试，
检查实际配置/profile 加载、取消、状态持久化与重开、跨 owner 输出和 provenance。
Context/Inference/prompt/模型选择改变时，另读 [模型评估](references/model-evaluation.md)，
区分确定性控制流、模型替身与真实质量；不以关键词命中代替角色行为或推理质量。

新增认知能力未接入真实 loop/产品时明确设计与接线缺口，不把类、目录或 mock PASS 写成完整能力。
真实 provider 调用可能产生费用和私人数据外发，先核对当前授权与最小输入；缺失时完成离线验证并保留该门。
交付说明行为变化、来源/角色边界、实际输入和结果、未验质量及恢复影响；通用验收见 [验证方法](../../../docs/how-to/测试与验收.md)。

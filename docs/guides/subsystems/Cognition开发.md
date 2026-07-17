# Cognition 开发

> 适用场景：修改人格、情绪、觉醒、经历、记忆、上下文、推理、LLM、认知循环、Agent plan/synthesis、Kernel IPC 或 Cognition 持久化。
> 前置条件：已读 [Cognition 当前视图](../../architecture/current/07-子系统当前视图/Cognition.md) 与 [Cognition 认知核实现](../../architecture/implementation/Cognition认知核实现.md)。

## 改动路径

| 任务 | 主要文件/目录 |
|---|---|
| 进程入口/组装 | `host/process.py`、`host/composition.py` |
| 入站 Kernel 感知 | `ports/kernel/inbound/` |
| 出站 Kernel 行动 | `ports/kernel/outbound/` |
| 认知主循环 | `cycle/controller.py`、`perception_queue.py`、`workspace.py` |
| Volition/巩固 | `cycle/volition/`、`memory/consolidation.py`、`experience/episodes.py` |
| 上下文 | `context/assembly.py`、`context/sources/` |
| 推理/LLM | `inference/` |
| 记忆/知识 | `memory/`、`memory/storage/` |
| 经历 | `experience/` |
| 身份/人格/情绪/觉醒 | `identity/`、`persona/`、`affect/` |
| 契约投影 | `protocol/generated/` |

## 标准步骤

1. 判断改动是否属于心智语义；平台 IO、窗口、权限、进程不应放进 Cognition。
2. 若入出站 payload 改变，先改 `protocol/src/schemas/` 并运行 `pnpm sync:contracts`。
3. 找到唯一主线：感知应进入 `CycleController`，不要新增并行聊天回复路径。
4. 对上下文来源写清 owner、成本、排序、预算和失败语义。
5. 对记忆/经历改动写清持久化 owner、迁移、回滚和 trace。
6. 对 provider 改动处理限流、超时、空响应、坏 JSON、多模态不支持。
7. 补测试和文档。

## 禁止项

- Cognition 直接读取 QQ/NapCat、Electron、窗口、剪贴板或 Extension handler。
- 在应用用例里复活旧 `ChatUseCase` 式并行回复主线。
- 把日志、trace 或 UI 聊天记录当作经历/记忆事实源。
- 在 Python 端手写跨语言镜像模型。
- 把 provider key、私有 prompt、用户隐私大 payload 写入日志或文档。

## 常见任务

| 任务 | 关键点 |
|---|---|
| 新 context source | 来源 owner、预算、排序、失败降级、trace |
| 新 memory 字段 | Schema/repo/migration/检索/回放/测试 |
| 新 provider | 配置、ready、timeout、错误 code、脱敏日志 |
| 新 action | Protocol、outbound adapter、Kernel consumer、UI/Adapter 投影 |
| Episode/巩固 | 边界、资格过滤、模型成本、幂等、证据校验、失败重试 |

## 排障顺序：输入进来但无回复

1. Kernel 是否把感知发到 Cognition。
2. `ports/kernel/inbound/` 是否解析成功。
3. `PerceptionEventQueue` 是否收到。
4. `CycleController` 是否 tick。
5. context assembly 是否产生可用上下文。
6. ReasoningService/LLMEngine 是否返回。
7. Volition 是否拒绝行动。
8. outbound bridge 是否把 action 发回 Kernel。
9. Kernel 是否投影到 Channel/Desktop/Avatar。

## 验证

```powershell
cd core/cognition
uv run pytest -q
```

涉及 Protocol 时：

```powershell
pnpm sync:contracts
pnpm --filter @glimmer-cradle/protocol typecheck
```

涉及数据库/迁移时验证空态、旧样本、坏样本、重复迁移和回滚。涉及 provider 时验证超时、限流、空响应和错误脱敏。

## 需要同步的文档

心智边界更新 Current；代码入口更新 Implementation；字段/配置/数据更新 Reference；排障步骤更新 Guides。

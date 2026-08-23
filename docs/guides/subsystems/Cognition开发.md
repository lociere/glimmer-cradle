# Cognition 开发

> 适用场景：修改人格、情绪、觉醒、经历、记忆、上下文、推理、LLM、认知循环、Agent plan/synthesis、Kernel Service 或 Cognition 持久化。
> 前置条件：已读 [Cognition 当前视图](../../architecture/current/07-子系统当前视图/Cognition.md) 与 [Cognition 认知核实现](../../architecture/implementation/Cognition认知核实现.md)。

## 改动路径

| 任务 | 主要文件/目录 |
|---|---|
| 进程入口/组装 | `host/process.py`、`host/composition.py` |
| Kernel Service Adapter | `adapters/kernel/` |
| Kernel 应用 Port | `ports/kernel/` |
| 认知主循环 | `application/cycle/`、`domain/workspace.py`、`domain/volition/` |
| Volition/巩固 | `domain/volition/`、`application/memory/consolidation.py`、`adapters/persistence/experience/episodes.py` |
| 上下文 | `application/context/` |
| 推理/LLM | `ports/inference.py`、`application/inference/`、`adapters/inference/` |
| 记忆/知识 | `domain/memory.py`、`application/memory/`、`adapters/persistence/memory/` |
| 经历 | `domain/experience/`、`application/experience/`、`adapters/persistence/experience/` |
| 身份/人格/情绪/觉醒 | `domain/identity/`、`domain/persona/`、`domain/affect/` |
| Kernel–Cognition 契约投影 | `contracts/generated/python/glimmer/`（只在 Adapter 使用） |

## 标准步骤

1. 判断改动是否属于心智语义；平台 IO、窗口、权限、进程不应放进 Cognition。
2. 若 Kernel–Cognition RPC 改变，先改 `contracts/proto/glimmer/{common,cognition,kernel}/v1/` 并运行 `pnpm contracts:generate` / `pnpm contracts:verify`。
3. 找到唯一主线：感知应进入 `CycleController`，不要新增并行聊天回复路径。
4. 对上下文来源写清 owner、成本、排序、预算和失败语义。
5. 对记忆/经历改动写清持久化 owner、迁移、回滚和 trace。
6. 对 provider 改动处理限流、超时、空响应、坏 JSON、多模态不支持。
7. 补测试和文档。

## 禁止项

- Cognition 直接读取 QQ/NapCat、Electron、窗口、剪贴板或 Extension handler。
- Domain/Application import generated DTO、gRPC/transport、Adapter/Host concrete 或 IO concrete。
- 为内部模块逐一创建 Port、伪 RPC、万能 EventBus 或 service locator。
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
2. `adapters/kernel/` 是否通过 generation 校验并完成 DTO mapping。
3. `PerceptionEventQueue` 是否收到。
4. `CycleController` 是否 tick。
5. context assembly 是否产生可用上下文。
6. ReasoningService/LLMEngine 是否返回。
7. Volition 是否拒绝行动。
8. `KernelControlService.PublishAction` 是否把 action 发回 Kernel。
9. Kernel 是否投影到 Channel/Desktop/Avatar。

## 验证

```powershell
cd core/cognition
uv run pytest -q
uv run ruff check src tests tools
uv run mypy src
uv run pytest -q tests/test_architecture_layout.py
```

涉及 Kernel–Cognition Contract Spine 时：

```powershell
pnpm contracts:generate
pnpm contracts:verify
```

涉及数据库/迁移时验证空态、旧样本、坏样本、重复迁移和回滚。涉及 provider 时验证超时、限流、空响应和错误脱敏。

## 需要同步的文档

心智边界更新 Current；代码入口更新 Implementation；字段/配置/数据更新 Reference；排障步骤更新 Guides。

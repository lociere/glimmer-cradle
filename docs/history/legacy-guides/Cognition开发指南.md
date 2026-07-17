# Cognition 开发指南

Cognition 是月见的认知核，负责人格、情绪、记忆、经历、推理与认知循环。它不负责桌面窗口、平台私有协议、扩展宿主或 Electron 渲染。

## 1. 定位

Cognition 负责：

- CognitiveLoop 九阶段编排。
- Persona / Emotion / Memory / Experience / Reflection。
- LLM、vision、embedding 等推理服务的抽象调用。
- 与 Kernel 的 IPC 入站/出站适配。
- 本地 `data/state/cognition/` 持久化。

Cognition 不负责：

- 创建窗口、托盘、任务栏图标。
- 直接连接 QQ、Discord、VTube Studio 等平台。
- 管理扩展进程和权限。
- 保存运行时密钥。

## 2. 当前核心目录

```text
core/cognition/src/selrena/
├── main.py                    # 认知核入口
├── container.py               # DI 组装
├── cognition/                 # CognitiveLoop、workspace、providers
├── context/                   # 上下文装配
├── reasoning/                 # 推理服务抽象
├── identity/                  # SelfEntity
├── persona/                   # 人设编译与注入
├── emotion_matrix/            # 情绪系统
├── memory/                    # 长短期记忆与知识库
├── experience/                # Moment 经历之流
├── persistence/               # cognition.db 仓储与迁移
├── arousal/                   # 觉醒态机
├── ipc_server/                # Kernel IPC 适配
├── protocol/                  # protocol codegen 产物
└── core/observability/        # logger / trace / metrics
```

## 3. 主链路

```text
Kernel PerceptionEvent
-> ipc_server/inbound
-> PerceptionEventQueue
-> CognitiveLoop Sense
-> Appraise / Recall / Deliberate / Act / Consolidate
-> ActionCommand
-> Kernel
```

旧 `ChatUseCase` 已删除。新增对话能力不要恢复同步请求-响应旧轨，也不要增加双回复兜底。

## 4. 开发规则

- 新跨语言字段先改 `protocol/src/schemas/`，再跑 `pnpm sync:contracts`。
- Persona / Memory / Emotion 不直接读外部平台字段，只处理归一化语义。
- 长期记忆写入 `data/state/cognition/cognition.db`，不要回退到 Kernel 旧库。
- 注释优先中文，只解释 WHY、契约和非显然决策。
- LLM 调用必须通过推理服务抽象，不在业务对象里硬编码 provider。
- 认知循环新增阶段时，同步 `docs/architecture/current/07-Cognition认知核.md`。

## 5. 验证

```powershell
cd core/cognition
uv run pytest -q
pnpm sync:contracts
pnpm typecheck
```

只改 Python 且未动 schema 时，至少在 `core/cognition` 内跑 `uv run pytest -q`。改 IPC / protocol / config 时必须补 `pnpm sync:contracts`。

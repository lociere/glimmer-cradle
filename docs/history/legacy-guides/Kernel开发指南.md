# Kernel 内核开发指南

本指南描述当前 `core/kernel/` 的开发边界。它不是旧式 `packages/kernel/` 指南，也不再把 UI、认知、扩展运行时混成一个入口。

## 1. 定位

Kernel 是月见的系统编排层，负责把桌面壳、头像壳、扩展、Cognition 认知核和协议事件组织成稳定的运行时。

Kernel 负责：

- 启动与生命周期编排。
- 事件总线、DLQ、trace、日志和基础设施。
- 感知入站、场景路由、频道回复、动作流、音频能力。
- 扩展宿主、权限边界和贡献点注册。
- 与 Cognition 认知核的 IPC / WebSocket 桥接。

Kernel 不负责：

- 人设语义、长期记忆推理、LLM prompt 组装。
- 具体 UI 渲染和 Live2D / Unity 画面实现。
- 第三方平台私有载荷的业务解释。

这些能力分别归属 `core/cognition/`、`core/renderer/desktop/`、`extensions/` 和 `protocol/`。

## 2. 当前目录

```text
core/kernel/src/
├── main.ts                         # 入口
├── app.ts                          # Kernel 组装
└── core/
    ├── foundation/                 # logger / event-bus / storage / config / ports / native
    ├── domain/                     # organism / attention 等领域规则
    ├── application/                # capabilities / services / channel runtime
    ├── host/                       # ExtensionManager
    ├── infrastructure/             # ipc-broker 等外部适配
    └── lifecycle/                  # 生命周期状态
```

## 3. 分层规则

- `foundation/` 放稳定基础设施，不写业务流程。
- `domain/` 放领域规则，不依赖 Electron、文件系统、WebSocket 等外部设施。
- `application/` 编排领域对象与能力端口，可以消费配置和事件。
- `infrastructure/` 连接外部系统，负责协议适配和 IO。
- `host/` 管理扩展生命周期，不把扩展逻辑混进 Kernel 主链路。

跨语言类型优先来自 `protocol/src/schemas/` 生成物；只有 TS 单端使用的内部结构才留在 Kernel 自己的目录。

## 4. 主链路

```text
Desktop Shell 输入
-> DesktopUIController
-> PerceptionAppService
-> IPC Broker
-> Cognition CognitiveLoop
-> ActionCommand / ChannelReplyEvent
-> Kernel 动作流与桌面壳
-> Control Center / Presence Surface
```

外部平台链路：

```text
Extension Adapter
-> Cortex 归一化
-> PerceptionEvent
-> Kernel 场景路由
-> Cognition 认知核
```

## 5. 开发守则

- 新增跨层事件先确认 `protocol/` 是否需要 schema。
- 新增 Kernel 服务时优先放入对应 `foundation/domain/application/infrastructure` 层，不新建平行杂物目录。
- 不在 Kernel 中拼 LLM prompt，也不读取人设语义配置。
- 不把 Desktop Shell / Avatar Shell 当扩展；它们是原生身体。
- 日志必须带可追踪字段，异常进入 DLQ 时保留 `trace_id`。
- 改 schema 后运行 `pnpm sync:contracts`。

## 6. 验证

最低验证：

```powershell
pnpm typecheck
```

涉及构建产物或 Electron 主进程时补充：

```powershell
pnpm build
pnpm dev
```

涉及 Cognition IPC 或协议生成时，同时检查 `core/cognition/` 生成类型和运行日志。

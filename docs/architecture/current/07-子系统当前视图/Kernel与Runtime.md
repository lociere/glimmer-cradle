# Kernel 与 Runtime 当前视图

> 范围：Kernel 作为中枢监督树的当前职责、运行阶段、runtime owner、Ingress Gate、状态投影和边界规则；不展开 TypeScript 逐文件实现。
> 事实依据：`core/kernel/src/app.ts`、`main.ts`、`core/lifecycle/runtime/`、`foundation/`、`application/`、`host/`、`configs/system/*.yaml` 与历史 current 架构材料。
> 维护触发：runtime module、启动阶段、Ingress、Capability、Extension Host、状态投影、子进程监督或日志策略变化。

Kernel 是 Glimmer Cradle 的运行秩序中枢。它不拥有当前角色的心智，也不负责窗口绘制或模型内部推理；它负责把各个器官按真实 ready 状态组织起来，让输入、能力、输出和失败都经过可解释的路径。

## 当前职责

| 职责 | 当前边界 | 不承担 |
|---|---|---|
| 生命周期监督 | 注册 runtime、按依赖启动/停止、收集 readiness、处理 degraded/failed | 让进程存在就算 ready |
| Ingress Gate | 控制用户/平台输入何时进入认知链路 | UI 显示就放行输入 |
| 协议路由 | 在 Desktop、Extension、Cognition、Engine、Avatar 之间搬运受控消息 | 解释人格、情绪和回复语义 |
| 能力编排 | Audio、Avatar、Skill Plane、Extension Host、Channel 等 capability 的 owner | 把 provider 细节泄露给 Cognition |
| 状态投影 | 给 Renderer、日志、诊断面板提供只读 snapshot | 让 Renderer 读取内部 service 或原始配置 |
| 权限与审计 | Skill Plane Policy、Gateway、Extension/MCP 调用审计 | 让 handler 绕过 Policy 直接执行 |

## 当前分层

```text
core/kernel/src/
├── app.ts / main.ts                  # Kernel 入口与 composition root
└── core/
    ├── foundation/                   # config、event bus、logger、storage、process、ports、ingress
    ├── infrastructure/ipc-broker/    # 与 Cognition 等跨进程传输适配
    ├── domain/                       # attention、organism、life clock 等内核领域规则
    ├── application/                  # perception、channel、capability、skill-plane、projection
    ├── host/                         # Extension 宿主边界
    └── lifecycle/runtime/            # runtime module 与 lifecycle orchestrator
```

依赖方向是 `foundation -> infrastructure/domain/application/host/lifecycle` 的组合关系，而不是随意互相 import。组合可以集中在 root；普通业务代码不应自行创建跨层基础设施对象。

## 当前 runtime 阶段

| 阶段 | 目的 | 核心要求 |
|---|---|---|
| Foundation | 路径、配置、日志、trace、DLQ、storage 可用 | 失败要阻断后续 required SDK |
| Transport | IPC/WebSocket/stdio 等传输通道可建立 | 通道存在不代表业务能力 ready |
| Application | Application service、capability、projection、Skill Plane 被组装 | 不能在这里偷偷做人格判断 |
| Surface | Desktop 等可见表面启动并显示等待/降级状态 | UI 可早出现，但不等于 Ingress 开放 |
| Core Readiness | required SDK 完成真实握手或明确 degraded | 这是用户输入能否进入的判断点 |
| Providers | Extension、MCP、User Skill 等可选生态能力启动 | 失败撤销 catalog，不伪装可调用 |
| Organism | Life clock、主动行为、稳定感知/行动循环开放 | 必须能停机、重启、释放资源 |

每个 runtime module 必须有唯一 ID、依赖、blocking/degradable 属性、start、ready 条件、timeout、restart/stop 策略和状态投影。新增 runtime 时，Current 更新其系统位置，Implementation 更新代码组装，Guide 更新操作和验证。

## Ingress 与状态投影

Ingress Gate 是 Kernel 对输入的闸门。它必须等 required SDK 完成真实业务 ready 或明确 degraded 后才开放。典型判断：

- Cognition：IPC 握手、配置、数据库/记忆基础设施和认知循环可服务。
- Audio：协议健康、TTS route/ASR warmup 或清晰 degraded；`audio.host` 先汇总语音整体 desired/actual/readiness，再由 `audio.tts`、`audio.asr` 投影 Engine 返回的 cloud/local provider 状态。Kernel 不扫描模型目录或 sidecar，也不复制 Engine 路由。
- Avatar：`host_hello` 之后完成 catalog、模型 driver、Composition Host 首帧和 `host_ready`；这些阶段变化由 `AvatarController` 实时回写 `RuntimeReadinessCatalog`，Desktop 诊断消费的不是启动时死快照。
- Extension/MCP：manifest/config 校验、initialize、catalog 枚举、Policy/Gateway 可审计；`extension-runtime` 会把 `ExtensionRuntimeProjection` 归一成 `RuntimeReadinessSnapshot.reconciler`，把 host aggregate、每个扩展的 desired/actual/readiness 与缺包恢复动作纳入同一 runtime 生命周期主线。MCP 则通过 `application` runtime 暴露 `mcp.host` 与 `mcp.<server-id>` snapshots，并在 provider 连接状态变化时持续刷新 catalog。

Renderer、Extension、MCP 和 Engine 都消费 Kernel 的投影，而不是反向推断事实。投影可以滞后，但不能变成第二事实源。

## Attention Lease 与外部焦点

Kernel 拥有外部注意力事实。外部平台、Desktop 和系统调度只能通过受控入口表达“某个 scene/channel 正被关注”，不能直接驱动 Cognition Activity、Affect、人格判断或 Avatar 外显。

当前公开入口是 Extension SDK 的 `sceneAttention.requestAttentionLease(request)`。Kernel 内部由 `domain/attention/attention-lease-store.ts` 持有 `AttentionLease` 并生成只读 `AttentionProjection`；`AttentionSessionManager` 直接消费 projection 来决定入站防抖、批处理和生成中断；`LifeClockManager` 只消费 projection 来发布 `OrganismAttentionChangedEvent`，不再维护自己的 attention mode。按照 [ADR-0002](../../decisions/ADR-0002-AttentionLease与CognitiveActivity分层.md)，这条链路的当前模型是：

| 概念 | Owner | 当前落点 | 目标语义 |
|---|---|---|---|
| Attention Lease | Kernel | `sceneAttention.requestAttentionLease()` -> `AttentionLeaseStore` | 哪个 scene/channel 被谁、因为什么关注，何时过期 |
| Attention Projection | Kernel | `AttentionLeaseStore.getProjection()` + `OrganismAttentionChangedEvent` | 给 UI、Extension 查询和入站调度的只读焦点快照 |
| Arousal State | Cognition | `ArousalManager` | 当前角色内部觉醒、认知频率、上下文预算和模型档位 |

`AttentionLease` 不授予回复权或工具执行权。回复许可仍由 `PerceptionEvent.response_policy` 表达，工具副作用仍必须经过 Skill Plane Policy 和 Invocation Gateway。

## 与其他子系统的边界

| 对象 | Kernel 能做 | Kernel 不能做 |
|---|---|---|
| Cognition | 启停、传入规范化感知、接收行动/状态事件 | 决定当前角色怎么理解、怎么感受、怎么回复 |
| Desktop | 下发受控投影、接收白名单 UI intent | 暴露内部 service 给 renderer |
| Avatar | 监督 UnityAvatarHost、下发 Presentation Frame、接收 ready/status | 用 UI fallback 假装 Avatar ready |
| Audio Engine | 管理 TTS/ASR lane、资源 ready、超时与日志 | 把模型内部失败写成 Cognition 语义失败 |
| Extension/MCP | 加载、授权、调用、审计、撤销 catalog | 让外部 handler 绕过 Policy 或拿内部对象 |

实现入口见 [Kernel 与 Runtime 实现](../../implementation/Kernel与Runtime实现.md)，操作见 [Kernel 开发](../../../guides/subsystems/Kernel开发.md)。

# Kernel 与 Runtime 实现

> 范围：Kernel 如何把“中枢监督树”落成 TypeScript runtime，包括入口、runtime module、Ingress、capability、Skill Plane、Extension Host、状态投影和调试链路。
> 源码依据：`core/kernel/src/app.ts`、`main.ts`、`core/lifecycle/runtime/`、`foundation/`、`domain/`、`application/`、`host/`、`infrastructure/ipc-broker/`。
> 维护触发：runtime module、composition root、Ingress Gate、Capability、Extension Host、IPC、状态投影、子进程监督或停机策略变化。

## 目录

- [入口与组装](#入口与组装)
- [开发启动编排](#开发启动编排)
- [代码结构地图](#代码结构地图)
- [Runtime module 实现规则](#runtime-module-实现规则)
- [入站主链](#入站主链)
- [出站主链](#出站主链)
- [Skill Plane 与 Extension 接线](#skill-plane-与-extension-接线)
- [配置、协议与数据](#配置协议与数据)
- [调试入口](#调试入口)
- [验证](#验证)

## 入口与组装

| 入口 | 职责 |
|---|---|
| `core/kernel/src/main.ts` | 进程级启动入口，处理启动参数、顶层异常和运行时退出 |
| `core/kernel/src/app.ts` | Kernel composition root，组装配置、日志、事件总线、storage、IPC、runtime 与 application service |
| `core/kernel/src/index.ts` | 包级导出边界 |
| `core/kernel/src/lifecycle/runtime/lifecycle-orchestrator.ts` | runtime module 注册、依赖排序、启动/停止、状态聚合 |

`app.ts` 是跨层具体实现的集中组装点。普通业务对象不应自行 new logger、storage、process supervisor、IPC server 或 provider manager；需要替换实现时应通过 root/factory/port 完成。

## 开发启动编排

仓库根 `pnpm dev` 由 `scripts/launch-product.mjs desktop` 启动；`pnpm dev:personal-server` 选择 Server 组合。Product Supervisor 先调用带内容指纹缓存的 `scripts/prepare-runtime.mjs`，准备器只处理 Protocol、Extension SDK 与 Desktop 发布资产，不编译或扫描扩展源码。随后它向 Kernel 注入 `products/<id>/product.json` 并共同监督 Kernel 与产品 Host；任一主进程退出或收到终止信号时，Windows 用 `taskkill /T`、POSIX 用独立进程组回收完整子树。

构建、准备和运行是三个独立阶段：`pnpm build` 面向发布与完整验收；`pnpm prepare:runtime` 面向首次安装、源码变化或缓存恢复；runtime lifecycle 只监督进程、连接、资源和 readiness，不调用编译器。未来打包版应在安装/更新阶段交付完整产物，用户启动路径只做廉价完整性检查和进程编排。

## 代码结构地图

| 目录 | Owner | 关键内容 | 禁止 |
|---|---|---|---|
| `foundation/config` | Kernel foundation | config defaults、schema、manager | 让 renderer 直接读 YAML |
| `foundation/event-bus` | Kernel foundation | domain/action/avatar/extension/lifecycle/memory/perception/scene events、DLQ | 用事件绕过 owner 边界 |
| `foundation/logger` | Kernel foundation | logger、telemetry、trace、metrics | 记录密钥或大 payload |
| `foundation/storage` | Kernel foundation | kernel DB、extension storage、DLQ | 存角色会话或 Cognition 长期记忆 |
| `foundation/process` | Kernel foundation | 子进程监督 | 杀进程代替协议 shutdown |
| `foundation/ingress-gate` | Kernel foundation | 输入闸门和身份路由 | UI ready 即放行 |
| `lifecycle/runtime` | Kernel lifecycle | runtime module、readiness、orchestrator | start 返回即 ready |
| `application/services` | Kernel application | Perception、Extension Host、Skill Catalog/Planning service | 写人格/记忆语义 |
| `application/capabilities` | Kernel application | audio、avatar、conversation、desktop、inference、scene、action-stream | 泄露 provider 细节给 Cognition |
| `application/skill-plane` | Kernel application | registry、policy、gateway、providers | handler 绕过授权 |
| `host` | Kernel host | ExtensionManager | 扩展 import Kernel 内部 service |
| `host/process` | Extension 进程边界 | 每扩展 Worker、双向 RPC、handler/disposable 代理和进程树回收 | 在 Kernel 进程内 `require()` 第三方扩展 |
| `foundation/endpoints` | 内部端点目录 | 发布本代动态回环端点并在停机撤销 | 把内部端口写入用户配置或缓存跨代端点 |
| `infrastructure/ipc-broker` | Kernel infrastructure | IPC server/broker | 在传输层写业务判断 |

## Runtime module 实现规则

当前 runtime module 位于 `core/lifecycle/runtime/`，包括 foundation、transport、application、surface、cognition、capability、extension、organism 等。每个 module 应实现同一组语义：

| 语义 | 必须回答 |
|---|---|
| `id` | 全局唯一 runtime id，日志、snapshot、依赖都用它 |
| `dependencies` | 依赖哪些 runtime 已完成到可启动状态 |
| blocking/degradable | 失败是否阻断主线，是否允许系统部分服务 |
| `start()` | 创建资源、启动进程、建立监听或加载 provider |
| ready 条件 | 真实业务能力可用的条件，不是进程存在 |
| timeout/restart | 等待多久、失败后是否重启、重启后如何重建状态 |
| `stop()` | 逆序释放订阅、计时器、端口、进程和日志 |
| projection | 如何进入 UI/log/diagnostics snapshot |

实现 runtime 时，先改 Current 的 runtime 关系，再改 module 和 root 组装，最后补 Guide 的验证步骤。

## 入站主链

```text
Desktop/Extension/Platform input
  -> preload/adapter/host port
  -> PerceptionAppService
  -> IngressGateManager / IdentityRouter
  -> CognitionManager / IPC broker
  -> Cognition inbound
```

`PerceptionAppService` 负责把已规范化的输入送入 Kernel 主链；`IngressGateManager` 决定是否允许进入认知链路；`CognitionManager` 管理到 Python Cognition 的 IPC 生命周期。平台 Adapter 只做协议清洗，不把平台私有 payload 传进 Cognition。

桌面与 Extension 都不能自行生成 Cognition 使用的会话 ID。桌面入口和 `ExtensionHostAppService` 先构造 `ConversationAddress`，再由 `application/capabilities/conversation/conversation-directory.ts` 解析为 `ConversationContext`。Directory 根据 provider、account、space、thread 和 actor endpoint 生成稳定且不可逆的 scene、conversation、continuity、thread 与 actor 标识，并同时决定 `recall_scope` / `disclosure_scope`。这些 canonical 字段跟随感知、Skill 请求和结果合成穿过 IPC；下游只能消费，不能重新解释平台身份或放宽作用域。

外部注意力链路当前由 `application/services/extension-host-app.service.ts` 接收 Extension `sceneAttention.requestAttentionLease()` 请求，再由 `domain/attention/attention-lease-store.ts` 持有 Kernel-owned `AttentionLease`。`AttentionLeaseStore.getProjection()` 提供只读 `AttentionProjection`，其中包含当前关注的 scene/channel、owner、reason 和过期时间；Extension 查询 `isSceneFocused(channelId)` 直接读取 `AttentionLeaseStore.isChannelFocused()`。`domain/attention/attention-session-manager.ts` 直接消费 projection 来决定入站 debounce、批处理、生成中断和 `attention_projection_mode` 观测标签；`domain/organism/life-clock/life-clock-manager.ts` 只消费 projection 来发布 `OrganismAttentionChangedEvent`，不维护 attention mode，也不把 attention projection 转成主动思维许可。LifeClock 的心跳只由 `life_clock.heartbeat_enabled` 显式开启，兜底间隔来自 `life_clock.heartbeat_interval_ms`；收到 Cognition `state_sync` 后，实际节奏优先使用 `CognitiveActivityPolicy.frequency_hint_ms`。该链路不改变 Cognition Activity、Affect 或 Maintenance 的 owner。

## 出站主链

```text
Cognition outbound action/reply/status
  -> IPC broker / CognitionManager
  -> ActionStreamManager / VisualCommandDispatcher
  -> ChannelStateStore / ControlSurfaceGateway / AvatarController / AudioService
  -> Surface、Adapter、Engine 或 Avatar
```

`ActionStreamManager` 和 `visual-command-dispatcher.ts` 把认知行动投影到频道、桌面和身体。音频、Avatar、Desktop、Scene、Skill Plane 都是 capability adapter；它们不能反向改写 Cognition 的语义事实。`ApplicationRuntime` 会用 `SkillActionController` 覆盖 `ACTION_COMMAND` 处理器：`reply` 仍规范化为 `ChannelReplyEvent`，`skill_request` 则进入 Skill Plane 编排、工具调用和 Cognition synthesis 闭环。

`CognitionManager` 先通过 `cognition_shutdown` 请求 Cognition 自主关闭，确认后只等待 2.5 秒；Audio Service 同样分别向 TTS/ASR lane 发送 `host.shutdown`，等待 ACK 和自然退出。协议停机超时才进入强制回收。Windows 通过根 PID 回收进程树，POSIX 启动受管 Host 时建立独立进程组并向组发送 `SIGTERM` / `SIGKILL`，避免只结束 `uv` 外壳而遗留 Python 子进程。云端 Linux 仍由 systemd 或容器编排器的 cgroup 提供最终回收期限；应用内协议停机不能取代平台监督，也不承担长期记忆推理。

## Skill Plane 与 Extension 接线

Skill Plane 的实现落点：

```text
application/skill-plane/
├── skill-registry.ts
├── skill-policy-engine.ts
├── skill-invocation-gateway.ts
└── providers/{core,extension,mcp-server,user}/
```

Extension Host 的实现落点：

- `host/extension-manager.ts` 只扫描 manifest、准备声明资源、创建独立 Host 和维护投影；不执行扩展入口；
- `host/process/extension-process-host.ts` 在 Kernel 侧校验权限、代理 Host Port、持有 handler/disposable 并监督 Worker；
- `host/process/extension-host-worker.ts` 是唯一加载扩展代码的位置，激活结束前会等待同步注册请求完成；
- `packages/extension-sdk/src/host/process-protocol.ts` 定义 Host/Worker 双向消息，不暴露 Kernel 内部 service；
- Extension 停止、激活失败或进程退出都会撤销运行 handler、声明式 catalog、订阅和 Capability Projection。

```text
host/extension-manager.ts
host/extension-runtime-readiness.ts
application/services/extension-host-app.service.ts
foundation/ports/extension-host.port.ts
```

Catalog 只说明能力可被发现；Policy 决定是否允许；Gateway 才能执行。Extension 停用、MCP 断连或 provider 失败后，registry 中的能力必须撤销或标记不可用。

`lifecycle/runtime/extension-runtime.ts` 不再只返回一个笼统的 `extension_host=ready`。它在 `ExtensionManager.startAllExtensions()` 之后调用 `getReadinessSnapshots()`，把 Host 当前维护的 `ExtensionRuntimeProjection` 统一折叠为 `RuntimeReadinessSnapshot[]`：`extension.host` 是聚合 runtime，`extension.<extension-id>` 是逐扩展 runtime，`reconciler.resources` 来自 Capability Graph 节点，缺失 package / sidecar / bridge 会直接体现为 `missing`、`degraded` 或 `failed`。这样 Lifecycle Orchestrator、Ingress 和 Desktop 读取的是同一条 runtime readiness 主线，而不是额外拼一份 Extension 专用状态。

`LifecycleOrchestrator` 会把各 runtime module 返回的 `runtime_readiness` 统一写入 `foundation/runtime-readiness-catalog.ts`。这个 catalog 是 Kernel 向产品 Host 暴露 runtime/reconciler 主线的唯一聚合点：Cognition、Audio、Avatar、Extension Host 等模块的 readiness 快照都在这里按 `runtime_id` 收口，Desktop 与 Personal Server 不再从启动日志、页面局部探测或本地文件侧推运行状态。`KernelTransportRuntime` 还将 Ingress Gate 投影为 blocking 的 `kernel.ingress`，只在 required runtime 完成后切换为 `ready`。Personal Server 通过长连接观察该 catalog；断连即撤销 `/readyz`，不缓存陈旧 ready。Audio 采用 `audio.host -> audio.tts/audio.asr -> providers`：Kernel 只把 Audio Engine 返回的路线和节点健康折叠为 readiness；云端连接、模型目录、fallback 和熔断由 Engine owner 判断。

`avatar-runtime` 的 `avatar.host` 不再只在模块启动时写一次 catalog。`UnityAvatarHostProcess` 会把受管进程状态变化推给 `AvatarController`，后者在 `connected / host_hello / host_ready / heartbeat_timeout / disconnect / process exit` 各阶段都覆写 `RuntimeReadinessCatalogStore` 里的 `avatar-runtime` 快照。这样 Desktop 诊断看到的 `avatar.host.reconciler.actual` 会随着 `waiting-manual-launch -> connected-waiting-ready-gates -> connected-first-frame-presented` 实时变化，而不是停留在启动瞬间的陈旧状态。

`foundation/endpoints/endpoint-registry.ts` 是内部地址唯一目录。ZMQ Router、Control Surface Gateway 和 Avatar WebSocket 先绑定 `127.0.0.1:0` / `tcp://127.0.0.1:*`，取得真实地址后发布 `cognition-rpc`、`control-surface`、`avatar-host`。目录位于 `data/run/host/endpoints.json`，包含 Kernel PID 与 generation；Desktop main、Personal Server、开发启动器和 Unity 只接受存活 owner 的本代回环端点。Cognition 地址由 Kernel 直接注入子进程环境，不经过磁盘发现。

`capability-runtime` 不再等待 Audio model warmup 后才返回。它先配置 AudioService，再把资源准备作为有 owner 的后台任务运行，并持续覆写 readiness 与 Desktop audio status；停机由 AudioService 统一取消和回收 lane。`app.ts` 在 Cognition 与必要传输完成后开放 Ingress，Extension activation 和 Organism 启动不再决定直接文本对话能否开始。
同一条 `avatar.host.reconciler` 现在也承载 Avatar Package 相关资源投影：`avatar-package-registry.json`、受管 Host 可执行产物/工作目录，以及按 Avatar Package 反推出来的 `avatar.sdk.*` Unity SDK 导入状态都由 Kernel 检查并进入 `resources`。这样“缺 Avatar Package Registry / 缺 UnityAvatarHost.exe / Cubism SDK 只准备未导入”属于正式 runtime reconciler 事实，而不是 Desktop 专用的第二套判断。

`application-runtime` 当前还负责把 MCP Provider 接入同一 catalog：启动时返回 `McpServerSkillProvider.instance.getReadinessSnapshots()` 作为初始快照，后续 `McpServerSkillProvider.setStatus()` 会继续覆写 `application` 模块的 runtime snapshots。这样 Control Center 诊断页看到的是正式 lifecycle 主线里的 `mcp.host` / `mcp.<server-id>`，而不是只看 Skill catalog 的 provider runtime 文案。

普通聊天触发 Skill 的 Kernel 入口是 `application/skill-plane/skill-action-controller.ts`。它不做人格合成，只负责把 Cognition 的 `skill_request` 与 ready catalog、`SkillPlanningAppService`、`SkillInvocationGateway` 和 `AIProxy.requestAgentSynthesis()` 串成一次事务，并把 Cognition 返回的最终文本投递到 `ChannelReplyEvent`。

## 配置、协议与数据

| 类型 | 入口 |
|---|---|
| 系统配置 | `configs/system/*.yaml` 经 protocol config schema/normalizer 消费 |
| IPC/事件模型 | `protocol/src/schemas/` 与 `protocol/src/generated/` |
| Kernel 数据 | `data/state/kernel/` |
| Extension 数据 | `data/state/extensions/` |
| Conversation 拓扑契约 | `ConversationAddress`（外部地址）与 `ConversationContext`（Kernel canonical 结果） |
| 日志/trace/DLQ | `data/observability/` 与 Kernel logger/tracer/DLQ |
| 子进程日志 | `data/observability/logs/application/` |

密钥只从 `configs/secrets/` 或环境变量进入受控 runtime，不写普通配置、日志、文档或 renderer 投影。

## 调试入口

| 症状 | 先查 |
|---|---|
| UI 可见但输入没反应 | Ingress Gate、runtime snapshot、Desktop -> Kernel IPC |
| Cognition 无回复 | PerceptionAppService、CognitionManager、IPC broker、同一 trace 的 Cognition span |
| Avatar 假 ready | AvatarController、Avatar status、`host_hello`/`host_ready`、process log |
| 工具调用失败 | SkillRegistry、Policy decision、InvocationGateway、provider log |
| 子进程残留 | ProcessSupervisor、runtime stop、process log、退出路径 |
| 状态投影旧 | event bus、projection producer、preload IPC、renderer subscription |
| 注意力焦点异常 | Extension `sceneAttention.requestAttentionLease()`、`AttentionLeaseStore` projection、`AttentionSessionManager` 合并日志、`LifeClockManager` 有机体事件 |

## 验证

```powershell
pnpm --filter @glimmer-cradle/kernel typecheck
pnpm typecheck
pnpm build
```

runtime 改动还要人工或测试覆盖：正常启动、缺资源、连接超时、崩溃、重启、主动停机、反向停机、DLQ/日志可定位。只验证 `start()` 返回不算完成。

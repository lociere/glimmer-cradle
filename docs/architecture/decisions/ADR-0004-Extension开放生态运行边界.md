# ADR-0004：Extension Platform 开放生态运行边界

- 状态：accepted
- 日期：2026-07-03

## Context

Extension Platform 的定位是微光摇篮接入外部世界和生态能力的开放平台层，不是 Kernel、Cognition 或 Desktop 的本体器官。扩展系统需要支持长期未知的能力类型，例如 motion capture、game world adapter、knowledge indexer、avatar behavior pack、robot body controller 或未来第三方定义的能力，而不是每接入一种能力就在 Kernel、Desktop 或 manifest 顶层增加固定字段。

当前架构优化的根因判断：

- 开放性必须来自可注册的 contribution point definition/registry，而不是扩大一组固定 contribution 字段。
- 所有内建能力也必须作为 registry 中的内建 contribution point 表达；`glimmer.command`、`glimmer.setting`、`glimmer.skill`、`glimmer.managedResource`、`glimmer.protocolBridge` 等只是官方预注册点，不是平台边界枚举。
- Capability Graph 是运行事实核心，负责承载节点、边、owner、依赖、ready/degraded/failed、权限、action intent 和 diagnostics 引用；它不是旧投影数组的改名。
- Unknown contribution point 可以被索引、保留和诊断，但没有 definition/provider/授权时不能执行、不能进入 Cognition、不能获得权限。
- Skill Plane 不消失，但收敛为 Extension Platform 上的官方能力调用层；skill/tool/resource/prompt 从 registry + Capability Graph 派生，执行仍走 Gateway/Policy/Audit。
- Renderer 只消费 Host projection；不能扫描扩展私有状态、日志、目录、端点或配置来还原运行事实。

复杂适配器样本暴露的是通用平台能力缺口：受管外部程序、协议桥、管理 UI、登录动作、业务能力和诊断必须自然表达为贡献点与能力图，而不是变成单个扩展的专用平台补丁。

## Decision

Extension Platform 收口为以下稳定元机制：

```text
Extension Package / Manifest
  -> Contribution Point Registry
  -> Extension Host
  -> Capability Graph
  -> Gateway / Policy / Audit
  -> Runtime Projection
  -> Desktop / Control Center / Skill Plane
```

### 核心抽象

| 抽象 | Owner | 决策 |
|---|---|---|
| Extension Package | Extension author / Marketplace | 扩展发布和安装单元，声明身份、入口、权限、激活条件、所需 Host Port、贡献点定义和贡献项。 |
| Contribution Point Definition | Platform / extension / third party | 声明某类贡献如何被索引、激活、授权、建图和投影。内建能力也走同一 registry。 |
| Contribution Point Registry | Extension Host | 合并内建 definition 与扩展声明 definition；未知 point 标记为 unsupported，只保留事实不授予执行权。 |
| `contributes` | Extension manifest | 按 contribution point id 分组的开放注册表，形态为 `contributes[pointId]: declaration[]`。 |
| Extension Host | Kernel | 加载、激活、停用、权限校验、handler 绑定、能力图合并、投影发布和 Gateway 边界。 |
| Capability Graph | Kernel Extension Platform | 统一运行事实：节点、边、owner、依赖、状态、权限、readiness gate、action intent 和 diagnostics 引用。 |
| Gateway / Policy / Audit | Kernel | 所有跨边界执行、Skill 调用、命令动作和高风险能力必须经过这里，不让 Renderer 或 Cognition 直接操作扩展内部对象。 |
| Runtime Projection | Kernel -> Desktop | Control Center 唯一运行事实源，包含 contribution point snapshot、Capability Graph、action intent 和 diagnostics。 |
| State / Secret Store | Host / Extension owner | 扩展私有状态只在自身状态域；密钥只走 secrets/env，不进入投影、日志或样例。 |

### Manifest 与运行态分工

- Manifest 静态声明 extension identity、permissions、activation events、required Host Ports、contribution point definitions 和 `contributes[pointId]`。
- Runtime 动态上报 Capability Graph 节点/边/action/diagnostics，补充静态声明无法表达的真实连接、登录、协议、设备和服务状态。
- Gateway 只执行已注册 definition、已授权 permission、已满足 graph precondition 的 action。
- Projection 只展示经过 Host 归一化的运行事实；Renderer 不拿到进程、密钥、内部状态或私有配置。

### 状态语义

Capability Graph 节点使用统一状态语义：

- `declared`：静态声明已进入 graph，但尚未有运行事实。
- `live`：进程、连接或端点存活，但业务 ready 仍未成立。
- `ready` / `available`：满足定义中的可服务条件。
- `degraded`：可管理或可诊断，但核心能力不可承诺。
- `failed`：需要恢复动作或用户处理。
- `unsupported`：缺少 contribution point definition/provider/授权，只保留声明和诊断。
- `unavailable` / `disabled`：依赖、生命周期或策略未满足。

Web 管理面、协议连接、业务能力和登录态不得混用同一个 ready。管理界面可用不代表协议 ready，协议 live 也不代表业务能力可执行。

## Deletion Rules

以下旧主线不保留长期兼容：

- manifest 顶层固定贡献集合不再作为平台主线；贡献项必须按 contribution point id 分组。
- 旧运行投影的固定数组主线不再作为 UI 事实源；Control Center 只消费 Contribution Point snapshot、Capability Graph、action intent 和 diagnostics。
- Control Center 不通过扩展私有状态、日志、目录或端点扫描推断扩展运行状态。
- 扩展不能写 Cognition DB，不能把平台 payload 原样送入 Cognition，也不能 import Kernel 内部对象。
- Renderer 不能操作扩展内部进程、密钥、私有配置或本地服务。
- 单个复杂样本的特殊需求不能进入平台命名、目录或硬编码分支。

## Consequences

收益：

- Extension Platform 成为可扩展平台自身，而不是固定能力清单。
- 未来未知能力只需注册 contribution point definition，并进入统一 graph/projection/Gateway 语义。
- Skill Plane、Control Center 和第三方扩展共享同一事实核心，减少状态双轨。
- 受管资源、协议桥、管理面和业务能力可以分层降级，避免把局部 ready 误判为整体 ready。

代价：

- SDK、Protocol、Kernel、Desktop、模板、样本扩展和文档需要破坏性同步。
- 老测试夹具、历史说明和 UI 假数据容易保留旧 projection 形状，必须通过扫描和 typecheck 守住。
- Unknown contribution point 的保留与禁止执行需要测试覆盖，避免“能展示就能调用”的误解。

## Links

- Architecture：[Extension 与 Skill Plane 当前视图](../current/07-子系统当前视图/Extension与SkillPlane.md)
- Implementation：[Extension 与 Skill Plane 实现](../implementation/Extension与SkillPlane实现.md)
- Reference：[Extension SDK Reference](../../reference/extension-sdk.md)、[Data Layout Reference](../../reference/data-layout.md)、[Protocol Reference](../../reference/protocol.md)
- Guide：[开发手册](../../guides/开发手册.md)、[扩展开发](../../guides/subsystems/扩展开发.md)

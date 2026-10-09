# 物理拓扑差距与迁移地图

> 范围：当前路径向 v2 owner 的迁移动作；不复制目标全文或阶段验收记录。
> 事实依据：[当前拓扑](../../../architecture/current/10-当前物理拓扑.md)、[v2 基线](../../../architecture/target/README.md)、实际源码。
> 维护触发：owner、consumer、路径或迁移删除条件变化。

## 当前与目标映射

最终精确路径由 [v2.1 完整物理目录](../../../architecture/target/physical-layout.md) 唯一规定。
下表保留当前迁移事实，不能将新目标反写为已实现。各切片实施前按 [状态入口](status.md) 选择任务，在 slices 卡中补齐具体路径和验证计划。

| 当前 owner/路径 | v2 目标 owner | 动作与删除门 |
|---|---|---|
| `core/platform/src/{time,identity,observability,lifecycle,events,configuration}/` | Platform primitives | 已提取；Kernel 的旧 Clock/Identity/Observability port、RuntimeModule 与通用配置校验器已删除；Events 保留产品专有 replay port，配置 Schema 与策略留 Kernel |
| `core/kernel/src/{application,adapters,runtime,composition}/` | 按语义分入领域模块、Platform 或 Apps | 拆分职责；禁止整包改名为 Platform；保留 readiness、取消、失败恢复语义 |
| Kernel 的 content/application models 与旧 URI ingress | Content | 阶段 3 已建立 `core/content`、Kernel 资产单写者、Contract Spine mapper 与 Cognition 只读消费；旧 `items`/URI 分支待阶段 9、14 删除 |
| `core/conversation` Binding/Message/Turn/Log/History | Conversation | Binding、Message/WorkingSet、Turn、canonical Conversation Log 单写者与 History projection 已迁入 `core/conversation`；Kernel/Cognition 旧 owner 已删除，旧数据路径与 schema 保持兼容，物理路径迁移留阶段 14 |
| `core/cognition/` | Cognition + `apps/cognition-worker/` | 领域保持 Cognition；进程 IO/provider 装配迁 App/Adapter；统一 Loop 前成对切换 RPC producer/consumer |
| Kernel Skill Plane、MCP adapters | Capabilities + 外部 bridge | 三 Registry、Step Exposure 与持久执行已有真实接线；按 P06 核对权限、预算和 unknown 对账；MCP bridge/公开 SDK 最终边界与旧 Skill Plane owner 删除仍待完成 |
| Cognition consolidation queue 等跨时间任务 | Jobs | `core/jobs` 持久执行/恢复基础、Memory attempt receipt/源 outbox、Host 源投递/handler/query/持续调度、authority/handover、真实 Worker CLI 监督、唯一配置/三根路径/拥有两库的启动与 Memory 状态 wire/inbox 已落位；真实重启、恢复拒绝、drain、ACK 前后 retention、取消保留已提交 receipt 已验证；Planning 已接生产来源/model-tier 绑定、只读接纳、默认真实评估调度、状态 inbox/ACK 与新完成通知原子请求，不适用目标等待且不消耗 attempt，反馈 backlog 如实降级；Planning 通知真实投递、回执与历史原身份恢复已在 dc59181e 接续；产品默认仍使用旧队列并拒绝双消费，完整产品入口/catalog/状态投影、后继再调度/撤销及旧数据切换仍待完成 |
| `core/avatar/`、`hosts/unity-avatar-host/` | Embodiment + renderer/host adapter | 稳定具身语义与具体渲染参数分离；C#/Unity/native 构建和真实能力不能遗漏 |
| `engines/audio/` 与 Kernel audio adapters | Speech Provider/Adapter，消费领域 contract | 保留流、取消、ASR/TTS readiness；不把语音全部塞进 Content 或普通 Tool |
| `packages/extension-sdk/`、`hosts/extension-host/` | `extension-sdk/`、`apps/extension-host/` | Core public contract 向 SDK 单向公开；真实外部消费方、manifest、broker 和隔离验证后切换 |
| `contracts/` | `protocol/` wire source；Document Schema 按语义 owner | 一次切换生成器、mapper、consumer、打包和兼容检查；不建立第二 wire source，不丢 JSON Schema |
| `products/desktop/`、`products/personal-server/` | `apps/desktop/`、`apps/host/` | 启动、安装、发布和路径投影同步；源码改名不等于外部分发升级 |
| `tools/`、`deploy/`、`native/`、`templates/`、`configs/`、`assets/` | 按真实 owner 归属 | 先调查实际 consumer 和制品边界；工程元数据、运行数据和 secret 不因五根树而删除 |

## 历史迁移与本轮状态

M12 曾删除的 `protocol/` 是旧手写协议主线；v2 目标的 `protocol/` 是唯一 wire source 的受控迁移目的地。
名称相同不表示恢复旧实现。M12/M13 删除证据见原 [M12](../../../history/milestones/M12-契约脊柱与跨进程服务架构重建.md)
与 [M13](../../../history/milestones/M13-工程自动化脊柱与交付生命周期闭环.md)；旧完成态树保存在
[历史拓扑](../../../history/architecture-v1/目标物理拓扑.md)。

当前阶段与任务状态以 [status](status.md) 为准，历史验证从 [evidence](evidence/README.md) 定位；本表不独立宣布阶段完成。

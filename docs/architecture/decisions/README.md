# Architecture Decision Records

ADR 记录仍影响当前项目的长期取舍。每一条使用 `ADR-XXXX-简短主题.md` 命名，并使用 `proposed`、`accepted`、`superseded` 或 `deprecated` 状态。

已完成阶段的长篇设计材料仍在 [../../history/](../../history/README.md)，但不得替代这里或 `architecture/` 的当前结论。

新增 ADR 从 [ADR-0000-模板.md](./ADR-0000-模板.md) 复制。

## 当前 ADR

- [ADR-0022 Conversation Log 与 Experience 投影边界](./ADR-0022-ConversationLog与Experience投影边界.md)（`accepted`；Conversation 持有交互事实单写者，Cognition 只消费 Experience/Memory 投影）
- [ADR-0021 架构基线规范修订与命名收束](./ADR-0021-架构基线规范修订与命名收束.md)（`accepted`；v2.0 规范修订 1，保持目标模块与 owner）
- [ADR-0020 Content 资产单写者与恢复边界](./ADR-0020-Content资产单写者与恢复边界.md)（`accepted`；规定新媒体引用、暂存、Experience 恢复与旧 URI 退出门）

- [ADR-0019 采用 Architecture Baseline v2.0 冻结基线](./ADR-0019-采用Architecture-Baseline-v2冻结基线.md)（`accepted`；替代旧目标中冲突的目录、模块和状态边界，当前实现按阶段迁移）

- [ADR-0001 企划平台与角色 Profile 分层](./ADR-0001-企划平台与角色Profile分层.md)
- [ADR-0002 Attention Lease 与 Cognitive Activity 分层](./ADR-0002-AttentionLease与CognitiveActivity分层.md)
- [ADR-0003 Character Package 与 Memory Substrate 分层](./ADR-0003-CharacterPackage与MemorySubstrate分层.md)（`accepted`；交互事实源名称与 owner 由 ADR-0022 部分替代）
- [ADR-0004 Extension 开放生态运行边界](./ADR-0004-Extension开放生态运行边界.md)
- [ADR-0005 Character、Avatar、Surface 与 Host 分层](./ADR-0005-Character-Avatar-Surface-Host分层.md)（`accepted`；第 7 条物理落点由 ADR-0014 部分替代，语义分层继续有效）
- [ADR-0006 Desktop 物理归属与 Electron 进程分层](./ADR-0006-Desktop物理归属与Electron进程分层.md)
- [ADR-0007 UnityAvatarHost 程序集边界与 SDK 投影](./ADR-0007-UnityAvatarHost程序集边界与SDK投影.md)（`accepted`；第 4–5 条 Unity 内物理/编译落点由 ADR-0014 部分替代，单向依赖与 SDK 投影规则继续有效）
- [ADR-0008 Experience Ledger 与版本化 Memory](./ADR-0008-ExperienceLedger与版本化Memory.md)（`accepted`；交互事实源 owner 由 ADR-0022 部分替代，投影、Memory 与恢复原则继续有效）
- [ADR-0009 本地监督树与动态端点治理](./ADR-0009-本地监督树与动态端点治理.md)
- [ADR-0010 产品组合与扩展仓库边界](./ADR-0010-产品组合与扩展仓库边界.md)
- [ADR-0011 Extension 发布与开放生态边界](./ADR-0011-Extension发布与开放生态边界.md)
- [ADR-0012 场景 Adapter 与平台受管资源分层](./ADR-0012-场景Adapter与平台受管资源分层.md)
- [ADR-0013 契约脊柱与跨进程服务架构](./ADR-0013-契约脊柱与跨进程服务架构.md)
- [ADR-0014 仓库物理分层与器官模块边界](./ADR-0014-仓库物理分层与器官模块边界.md)（`accepted`；部分替代 ADR-0005 第 7 条与 ADR-0007 第 4–5 条的物理/编译落点）
- [ADR-0015 工程自动化平面与交付生命周期分层](./ADR-0015-工程自动化平面与交付生命周期分层.md)（`accepted`；固定 owner-local 原子任务、薄编排、同构 CI、fixed artifact 与宿主级事务 owner）
- [ADR-0016 仓库工具工作区与产品监督边界](./ADR-0016-仓库工具工作区与产品监督边界.md)（`accepted`；以 `tools/*` 私有叶子 workspace 承载长期跨仓工具，root `package.json` 只保留稳定 façade）
- [ADR-0017 产品前端统一采用 React 组件驱动架构](./ADR-0017-产品前端统一采用React组件驱动架构.md)（`accepted`；第一方产品 UI 统一 React 组件模型，M11 正按垂直切片迁移 Personal Server；当前进度见 [Now](../../roadmap/now.md)）
- [ADR-0018 Personal Server 宿主与服务状态分域](./ADR-0018-Personal%20Server宿主与服务状态分域.md)（`accepted`；持久态和运行态统一按 `host/`、`service/` owner 树隔离，不保留旧路径兼容主线）

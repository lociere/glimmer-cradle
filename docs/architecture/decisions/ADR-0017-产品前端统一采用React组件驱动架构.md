# ADR-0017：产品前端统一采用 React 组件驱动架构

- 状态：accepted
- 日期：2026-08-25
- 决策确认：用户于 2026-08-25 接受 React 推荐方案，并要求项目内同类产品前端统一采用该组件模型

## 目录

- [Context](#context)
- [Decision](#decision)
- [Consequences](#consequences)
- [Rejected platform strategies](#rejected-platform-strategies)
- [Links](#links)

## Context

Glimmer Cradle 当前有两个由本仓库拥有的主要交互前端：

- Desktop 的 Control Center 与 Presence 已使用 React + TypeScript + Vite，Electron main/preload 拥有系统能力边界；
- Personal Server 浏览器控制面仍使用原生 TypeScript + Vite，Shell 通过 `innerHTML` 组装多区域，feature 直接查询和修改 DOM，并维护内存路由。

两端消费不同 Product Host 提供的受控投影，但都需要路由或导航、复杂表单、列表/详情、Overlay、异步状态、响应式布局、可访问交互和视觉回归。继续让同一仓库维护两种前端组件与生命周期模型，会增加重复实现、AI 上下文分叉和跨产品质量漂移；Personal Server 当前的字符串模板结构也已难以清晰表达 route、状态、listener 与 cleanup owner。

React 不能自动带来良好设计，也不能成为跨产品共享业务页面的理由。本决策需要同时统一工程模型、保留 Product Composition 边界，并为 AI 建立可查询、可渲染、可测试、可纠偏的组件工作流。

## Decision

### 1. 统一前端组件模型

本仓库拥有的第一方交互式产品前端统一使用 **React + TypeScript 的组件驱动架构**。当前覆盖：

- Desktop Control Center；
- Desktop Presence 的 React Surface；
- Personal Server 浏览器控制面；
- 未来新增、由本仓库维护且具备持续交互状态的产品 UI。

不再为第一方产品 UI 新增 Vue、Svelte、Lit、自研 DOM component runtime 或另一套长期并存的组件框架。纯静态文档、安装器原生页面、第三方 Extension 自有 UI、Avatar/native engine 的非 DOM 渲染不因本 ADR 被强制改为 React；若它们需要进入统一产品 Surface，必须通过各自 Host/Adapter 暴露受控投影。

### 2. Host 与导航按产品拥有

- Desktop 继续由 Electron main/preload/renderer 承载，React 只存在于 Renderer Surface，不越过 preload 白名单读取 Node、文件、设备或 Kernel 内部对象。
- Personal Server 继续由 Vite 构建浏览器客户端，Node Product Host 拥有认证、HTTP/WebSocket ingress、静态资源和 index fallback。M11 将其现有命令式 DOM 垂直迁移为 React。
- Personal Server 使用 React Router 拥有 URL、history、deep-link、未知路由和 route mount/unmount。Desktop 只有在真实 URL/history 语义出现时才引入 Router；本 ADR 不强迫 Electron 窗口把本地工作台导航伪装成网页路由。
- Product Host、领域页面、设备能力和整页装配保持产品本地，不因统一 React 而互相 import。

### 3. 状态与事实源

- React state 只拥有瞬时 view model、交互状态和受控表单草稿；Kernel、Cognition、Product Host 或其他 owner 的投影仍是系统事实源。
- 状态默认靠近 feature。跨组件共享只在真实 consumer 需要时提升；不因 Desktop 已使用 Zustand 就自动把 Zustand 引入 Personal Server，也不建立跨产品全局 store。
- route 只装配，feature 持有领域 view model/hooks/表单和 cleanup，shared UI 只持有无领域事实的 primitive。

### 4. 组件、样式与可访问性

- 简单控件优先使用原生语义 HTML；需要复合键盘、焦点、Overlay、selection 或 collection 行为时，优先评估 React Aria Components 的无样式 primitive。
- 视觉语言由语义 CSS variables + CSS Modules 拥有。具体主题、色彩和材质由 UI Reference 与当前视觉设计简报拥有，不写入框架 ADR，也不写死在第三方组件皮肤中。
- React Spectrum、Tailwind、shadcn/ui 默认主题和 CSS-in-JS 不成为项目基础设计系统。可以借鉴 shadcn 的源码所有权、registry 发现和单组件模式，但引入的实现必须转换为项目语义 token、组件 API 和验证规范。
- 统一使用真实图标资产或经批准的图标库，不以字符、emoji 或单字伪装产品图标。

### 5. AI 可发现性与验证

- 代表 shared UI 和复合 feature 组件必须有稳定 props、真实状态 stories、交互测试和可访问性检查；Storybook React/Vite 作为组件工作台。
- Storybook stories、组件文档和测试是稳定基线。官方 MCP 仅在实施 slice 核对其 React/Vite 支持、preview API、版本和 fallback 后试点，使 AI 可以查询真实组件、story 和文档；MCP manifest 是生成投影，不是手写事实源，也不是产品构建的必需依赖。
- Playwright 继续拥有 Product Host、认证、路由或导航、网络失败、响应式和视觉 E2E。组件工作台不能替代真实产品验收。
- AI 前端工作遵循“读取事实与真实组件 → 实现内聚片段 → 实际渲染并查看 → 运行交互/a11y/响应式检查 → 修正”的闭环；生成代码或单张截图不等于完成。

### 6. 共享边界

统一 React 的直接收益是共同的工程语言、测试方法、可访问性基线和 token 语义，不是立刻建立通用 UI package。

- Desktop 与 Personal Server 首先在各自产品目录内维护组件和 stories。
- 只有同一无领域 primitive 在至少两个真实产品中形成稳定 consumer、API、主题语义、兼容策略和独立测试后，才另行决定是否提升到 `packages/ui`。
- Desktop 的 Avatar、preload、窗口、本机设备和 Control Center 页面不能直接复制到 Personal Server；Personal Server 的认证、远程运维和浏览器路由也不能反向污染 Desktop。

### 7. 迁移与删除门

Personal Server 按 [M11 目标物理清单](../../roadmap/manifests/M11-目标物理清单.md) 依次迁移 Shell/Router、shared UI、对话/概览、能力/活动和设置。每个垂直 slice 必须迁移真实 route、状态和测试，并删除对应旧 DOM owner；最终发行物不得保留双 Shell、双 Router 或长期 DOM/React 双栈。

Desktop 当前已使用 React，不做无收益重写；后续 UI 工作只需逐步对齐本 ADR 的状态 owner、语义 token、Storybook/Playwright 和可访问性要求。

React、React Router、React Aria、Storybook 与 addon 的精确版本由各实施 slice 固定并经 package build/test 验证，本 ADR 不把调研时的 latest 版本写成长期架构事实。

## Consequences

收益：

- 第一方产品 UI 只维护一套组件、生命周期和测试心智模型，AI 与人类可在明确边界内复用经验；
- Personal Server 的 route、页面、feature、primitive 与状态 owner 能映射为可观察组件树，减少字符串模板、全局 query 和 listener cleanup 漂移；
- React Aria、Storybook 与 Playwright 形成无样式可访问行为、组件级快速反馈和产品级真实 E2E 的分层闭环；
- 共同 token 语义可以保持产品气质一致，同时允许 Desktop 与 Personal Server 维持不同装配和内容密度。

代价与责任：

- M11 需要承担一次有删除门的迁移，短期依赖、diff 和测试成本增加；
- React 生态成为所有第一方产品前端的供应链，需要版本、bundle、安全和升级治理；
- 统一框架不能替代信息架构与视觉判断，对应 Design Brief 的候选探索和用户确认仍是实现门；
- 错误共享会把产品能力、Host API 或领域状态耦合进组件库，必须由 Product Composition 和 consumer 证据阻止；
- Storybook 的 AI/MCP 能力仍在快速演进，试点不可用或收益不足时必须能删除；stories、组件测试和产品 E2E 始终独立可运行。

## Rejected platform strategies

以下是已评估但不采用的仓库级前端策略，不是计划并存的技术栈：

| 方案 | 不采用为第一方产品基线的原因 |
|---|---|
| 继续原生 TypeScript + DOM | 迁移成本最低，但会维持第二套组件/lifecycle 模型；M11 的路由、复杂表单、列表/详情和 Overlay 已超过当前字符串模板的舒适边界。 |
| Vue 或 Svelte | 都能提供良好组件模型，但会让仓库同时维护 React 与另一套框架，不能带来足够的产品边界收益。 |
| Lit/Web Components | 适合跨框架公开组件；项目当前没有这种 consumer，状态、路由和表单生态也不比统一 React 更直接。 |
| React + Tailwind + shadcn/ui 全套 | React 方向一致，但 utility styling、registry 和默认 SaaS 组件语言会扩大迁移面并形成第二视觉系统；只选择性吸收其源码模式。 |
| 直接共享 Desktop 页面组件 | 两端虽然都使用 React，但 Host 能力、产品信息架构和领域状态不同；直接共享会破坏 Product Composition。 |

## Links

- Architecture：[Product Compositions](../../reference/product-compositions.md)
- Reference：[UI Design Tokens Reference](../../reference/ui-design-tokens.md)
- Guide：[AI 辅助前端开发](../../guides/development/AI辅助前端开发.md)、[前端开发与 UI 验收](../../guides/development/前端开发与UI验收.md)
- Roadmap：[M11](../../roadmap/milestones/M11-Personal%20Server控制面、区域分发与跨产品Extension闭环.md)、[M11 目标物理清单](../../roadmap/manifests/M11-目标物理清单.md)

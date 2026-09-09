# M11：Personal Server 控制面、区域分发与跨产品 Extension 闭环

- 状态：in-progress
- 关联架构：[Product Compositions](../../reference/product-compositions.md)、[Extension 与 Skill Plane 当前视图](../../architecture/current/07-子系统当前视图/Extension与SkillPlane.md)
- 关联决策：[ADR-0011 Extension 发布与开放生态边界](../../architecture/decisions/ADR-0011-Extension发布与开放生态边界.md)、[ADR-0012 场景 Adapter 与平台受管资源分层](../../architecture/decisions/ADR-0012-场景Adapter与平台受管资源分层.md)、[ADR-0017 产品前端统一采用 React 组件驱动架构](../../architecture/decisions/ADR-0017-产品前端统一采用React组件驱动架构.md)（`accepted`）
- 前置里程碑：[M10：发布形态、安装投影与数据迁移闭环](./M10-发布形态、安装投影与数据迁移闭环.md)
- 目标物理清单：[M11 目标物理清单](../manifests/M11-目标物理清单.md)
- UI 设计简报：[M11 Personal Server UI 设计简报](../design-briefs/M11-Personal%20Server%20UI设计简报.md)

## 目录

- [目标成果](#目标成果)
- [架构不变量](#架构不变量)
- [范围](#范围)
- [非范围](#非范围)
- [依赖](#依赖)
- [实施顺序](#实施顺序)
- [实施追踪清单](#实施追踪清单)
- [风险](#风险)
- [第一验收门](#第一验收门)
- [最终验收门](#最终验收门)
- [完成后归档](#完成后归档)

## 目标成果

让已部署的 Glimmer Cradle Personal Server 不依赖源码树、Desktop 或直接编辑原始 YAML 就能在最小可启动状态下进入正式控制面、完成日常运维和远程 Extension 管理；让场景 Adapter 从特定平台进程启动器中解耦，使 NapCat 作为 QQ 场景扩展在 Personal Server 上通过受控 OneBot 端点完成感知、注意力、Skill、回复与记忆闭环。

完成后，用户应能通过一条命令安装受支持的 Linux 发行物，在零 Provider、零 TTS、零 ASR、零 Embedding 的最小状态下登录完整控制面查看状态、日志、Extension、Skill、安全和设置；随后按需配置 LLM Provider 并完成真实对话，从精确 Release 安装与当前产品兼容的 `.gcex`，连接外部 NapCat 后在 QQ 场景持续交互；更新失败能够恢复上一版本，停止后不残留端口、连接或受管进程。

## 架构不变量

1. Kernel Config Application Port 是系统配置读取、校验、更新计划和生效状态的唯一业务入口；Personal Server Host 不成为第二个 YAML owner。
2. Renderer/浏览器只消费脱敏投影并提交用户 intent。Secret 只能写入、替换和删除，永不回显，也不进入日志、Trace、诊断包或浏览器持久缓存。
3. 配置更新必须经过 Schema/normalizer、revision 检查和原子写入，明确返回 `applied`、`reload_required`、`restart_required` 或失败恢复语义。
4. Extension 安装继续汇入同一个 Kernel Package Manager；Registry、精确仓库 Release、Release Manifest 和 Desktop 本地包不能形成不同安装规则。
5. NapCat Adapter Core 不理解 Docker、Windows 注册表或 QQ 安装目录。平台受管资源 profile 通过公开契约注入，且不得向 Extension 暴露 Docker Socket 或 Kernel 内部对象。
6. Personal Server 只暴露受认证产品 ingress。Kernel 动态回环端点、配置文件路径和内部服务地址不得成为远程公共 API。
7. 若未来出现真实用户规模或长期稳定网络需求，区域 HTTP(S) 对象端点或 OCI Registry 只能作为同一发布物的可选传输副本；tag、摘要、镜像身份、签名、SBOM 与 provenance 仍由统一发布流水线产生，不要求在本里程碑内建设第二传输协议。

## 范围

### 配置控制面

- 为系统配置、Character Provider、Audio、Embedding、Memory、Skill 与 Extension 设置建立 Protocol Schema、脱敏 `ConfigSnapshot`、变更预览和 update command。
- 建立非阻断的 Provider 配置流程：Provider 类型、Base URL、模型映射、连通性测试、Secret 写入和首个真实对话验收。
- Provider 支持新建、编辑、删除、启用、连接测试和模型选择；删除或切换时必须检查当前 Character 路由引用。
- TTS、ASR 与 Embedding 保持显式增强：默认关闭不影响基础 readiness，启用后才要求资源、Secret 和 provider probe。
- 配置页面展示实际生效来源、revision、脏状态、保存结果和重启要求，不提供无边界原始 YAML 编辑器；缺少默认 Provider 只作为可解释告警或空态行动按钮，不阻断控制面登录。

### Personal Server 网页

- 目标一级信息架构收敛为 `对话`、`概览`、`能力`、`活动`、`设置`；控制面独立可登录，零 Provider 状态下仍可进入全部页面。只共享 Desktop 的设计质量与 token 框架，不复制 Avatar、窗口、剪贴板和本机录音等设备页面。
- 使用单层全局导航；页面内只在存在真实子域时显示二级导航。顶栏只保留品牌、当前位置、健康状态和全局操作。
- 概览展示 Kernel、Cognition、Audio、Extension Host、Provider、受管资源、启动耗时和 degraded 原因；runtime 使用列表/主体 + 按需详情。
- 活动域提供错误优先的结构化事件流、级别/模块/`trace_id` 筛选、暂停、自动滚动、原始/结构化切换和安全导出；日志详情按需展开，不让浏览器直接读取日志文件。
- 能力域承载 Extension、Skill 与 Provider 等能力视图，并使用列表/主体 + 按需详情，不把全部管理动作堆在单页。
- 设置拆分为模型与路由、语音、记忆、安全、存储、更新等真实子页面；高风险操作必须二次确认并进入审计。
- Context Inspector 改为选中对象后按需出现的 Context Drawer，未选对象时不常驻无效右栏。
- 补齐内容容量驱动的窄窗口/宽屏布局、键盘、焦点、缩放、reduced-motion、触控目标、加载、空态、降级、失败恢复、长文本和低速连接体验；具体动效语言由视觉探索决定。

### Extension 分发与管理

- 正式发布 `@glimmer-cradle/extension-sdk` 语义化包及其所需 Contract Spine public edge，独立扩展不得依赖主仓库本地链接。
- 提供社区仓库模板和 Release workflow，自动校验、测试并生成规范命名 `.gcex`、包内摘要和 SPDX SBOM；多平台时按需生成 Release Manifest。
- 安装预览展示产品/平台/feature 兼容性、权限、发布者、Registry 审核、签名、构建证明、下载大小和受管资源计划。
- 安装、激活、升级、回滚、禁用与卸载使用同一事务事实源；失败不得留下半安装目录或失效 active 选择。
- `glimmer.setting` 生成普通配置表单；扩展 Secret 使用独立写入边界。Extension 管理 Surface、Capability Graph 和诊断继续通用渲染，不硬编码 NapCat 页面。
- 扩展远程资产支持项目方控制的可信区域传输端点，但不改变作者 Release 与 Registry 的职责。

### NapCat Personal Server

- 把 OneBot 解析、场景身份、注意力、感知、回复和 Skill 从 Windows 进程管理中抽为跨平台 Adapter Core。
- 首个 Linux 版本实现 `external_onebot`，连接用户或部署层已运行的 NapCat；`managed_windows_onekey` 继续作为 Desktop Windows profile。
- 为 Compose 私有网络和跨主机连接分别定义地址、鉴权、TLS、重连、心跳、限流、超时、背压和诊断语义。
- QQ 私聊、群聊、群内发送者注意力、背景观察、回复路由、关系/经历作用域和重启连续性必须端到端验证。
- NapCat 私有 `source_provider` Skill 只在 QQ 来源场景可见；全局 Skill 必须单独声明、授权并满足产品与平台约束。
- WebUI、二维码、快速登录、账号选择和上游进程操作属于用户管理能力；QQ ingress、QQ reply、WebUI 和上游资源分别投影 readiness。
- 发布真实 `linux-x64.gcex` 后才允许 Personal Server 安装；禁止仅修改 Manifest 形成假兼容。

### 运维、安全与长期运行

- 提供更新检查、版本固定、备份、恢复、回滚、数据保留和只读诊断入口；部署级操作仍由 `glimmer-cradle` 运维命令拥有。
- 远程下载覆盖 SSRF、HTTPS 重定向、大小/文件数/膨胀限制、超时、摘要、签名和临时文件清理。
- 配置、Extension、Skill 和管理命令进入审计；敏感字段执行统一脱敏。
- 覆盖长时间运行、断网恢复、Provider 熔断、Extension 重连、磁盘增长、日志保留、重启连续性和完整停机。

## 非范围

- 不建设 Managed Cloud、多租户组织、计费、公共账号体系或中心化扩展商店。
- 不把 Personal Server 网页变成 Desktop 的远程镜像，不提供 Avatar、本地麦克风或任意宿主文件浏览。
- 不允许 Renderer 直接读取/写入 YAML、SQLite、日志文件、Extension 安装目录或 Secret。
- 不把 NapCat、QQ 程序、账号数据或第三方二进制打入 Glimmer Cradle/`.gcex` 源码发布物。
- 不在本阶段给 Extension 容器编排 root 权限；服务器受管伴随容器只有在专用 Workload Port、安全模型和部署实现成熟后再进入范围。
- 不承诺一次覆盖所有第三方平台 Adapter；NapCat 是压力测试样本，不是 Kernel 特例。

## 依赖

- M10 完成可重复安装、可信来源参数、版本固定、升级、回滚、备份和停机回收基线。
- Protocol 能表达 Config Snapshot/Command、产品/平台兼容性、资源 profile、安装进度和 Extension 配置 Secret。
- Kernel Config owner、Extension Package Manager、Capability Graph、Skill Policy/Gateway 与审计链路保持单一事实源。
- `@glimmer-cradle/extension-sdk` 及其所需 Contract Spine public edge 有可公开取得的精确版本和跨仓库 CI。
- NapCat 上游提供可部署的 OneBot 11 服务，且其许可、账号数据和网络要求得到明确处理。
- Personal Server UI 实现 slice 以前，ADR-0017 保持 `accepted`，已确认的视觉方向由 M11 UI 设计简报拥有；架构与视觉确认不能单独替代具体实现 slice 授权。

## 实施顺序

1. **事实与契约**：修正 Current/Reference，新增配置、兼容性、资源 profile 和安装状态 Schema；生成并同步三端契约。
2. **Kernel 配置主线**：实现脱敏 snapshot、Secret command、校验、revision、原子提交、生效计划、审计和失败恢复；删除产品层第二写入入口。
3. **Personal Server 前端前置**：ADR-0017、信息架构与 M11 最终视觉方向已确认；首个实现 slice 固化 token、组件语言和代表状态矩阵。
4. **Personal Server 前端迁移与页面**：按目标物理清单迁 Shell/Router、shared UI 和垂直页面 slice；建立 Storybook stories/组件测试与 Playwright 状态/视觉/a11y 双层闭环，并随 slice 删除旧 DOM owner；MCP 只在试点获准且收益可验证时接入。
5. **Extension 发布主线**：发布 Contract/SDK 公共包、仓库模板、Release CI、兼容性预览、安装进度、配置与回滚。
6. **NapCat 跨产品化**：抽离 Adapter Core，落实外部 OneBot Linux profile、私有网络与 QQ 场景 E2E，再发布 Linux `.gcex`。
7. **生产验收**：在全新服务器执行安装、网页配置、真实对话、扩展安装、QQ 场景、升级回滚、长运行与停机矩阵。

每一步完成时必须删除被替代的直写、平台耦合和旧文档入口；不得在最后统一清理。

## 实施追踪清单

### 历史检查点（2026-07-24）

- 已完成：控制面物理结构从 `public/app.js`/`app.css` 单体迁移到 `products/personal-server/src/server/*` 与 `src/web/*`，并有架构门禁阻止旧入口回流。
- 已完成：Protocol、Kernel Config Application Port 和 Personal Server 设置页已形成 LLM Provider/默认路由的真实闭环；零 Provider 可登录控制面，依赖 LLM 的对话会返回明确 `conversation_notice`。
- 已完成：状态页已接 `ReadinessStatus`、runtime catalog 与配置快照；日志页已接真实结构化日志 HTTP/SSE、级别/模块/`trace_id` 筛选、暂停、原始视图与安全导出。
- 进行中：Personal Server UI 正确性、信息架构、视觉系统与验收基线优化；NapCat Linux profile、真实失败回滚与跨仓生产闭环。
- 已完成到当前阶段：Extension 页已接真实运行投影、仓库/Registry/Release Manifest 安装预览、安装提交、启停与卸载事务；浏览器本地 `.gcex` 已改为认证上传到 Product Host 受控临时目录并换取 opaque `upload_id`，随后由 Host 在同一安装事务内解析为 Kernel file source，具备会话绑定、30 分钟时效、单事务消费与成功/失败/取消/超时清理；安全页已接受管访问令牌 store，支持创建/轮换/撤销、legacy env degraded 标记与一次性明文返回；运维页已接正式 backup/update/service snapshot，并在缺少宿主运维桥时显示真实 disabled reason；Playwright 已固化零 Provider、Provider 保存、日志筛选、扩展安装/启用、版本切换回退、本地 `.gcex` 上传、访问令牌与运维 disabled reason 在桌面与窄窗双视口。
- 未开始或未过门：QQ 场景外部验收、Extension 跨仓真实发布物升级/失败恢复、完整宿主运维恢复与长运行矩阵。

### Personal Server UI 优化门（页面已实现）

五个一级页面、七个设置子区及旧 DOM owner 删除已完成；当前实现、验证范围和证据见 [now.md](../now.md) 与目标物理清单。本节保留原问题和接受标准，历史问题不再作为当前未完成项。视觉输入、代表页面、三个候选方向和用户确认门由 [M11 UI 设计简报](../design-briefs/M11-Personal%20Server%20UI设计简报.md) 唯一拥有；实施另遵循 [前端开发与 UI 验收](../../guides/development/前端开发与UI验收.md)、[AI 辅助前端开发](../../guides/development/AI辅助前端开发.md)、[UI Design Tokens Reference](../../reference/ui-design-tokens.md) 和 [M11 目标物理清单](../manifests/M11-目标物理清单.md)。

#### 2026-08-25 前端架构与 AI 工作流前置

- 2026-08-25 时 M11 从暂停状态恢复为 `in-progress`，当时仅完成文档、架构、AI 工作流和视觉方向前置；后续页面实现与验收记录见 now.md。
- 当前原生 TypeScript/Vite + 命令式 DOM 不是永久约束。[ADR-0017](../../architecture/decisions/ADR-0017-产品前端统一采用React组件驱动架构.md) 已接受第一方产品 UI 统一使用 React 组件模型，并将 Personal Server 迁为 React + Vite、React Router、React Aria Components、语义 CSS variables + CSS Modules，以 Storybook stories/组件测试 + Playwright 建立组件级和产品级双层反馈。
- ADR-0017 与 M11 最终视觉方向已于 2026-08-25 接受；文档、Skill 与设计前置已完成，实施 slice 获得授权前不修改运行时代码或依赖。
- AI 的完成定义是“读取真实组件/状态 → 实现内聚片段 → 实际渲染并查看截图 → 运行交互/a11y/响应式检查 → 修正”，不是生成代码或单张截图。
- Storybook MCP、shadcn Skill/MCP、Vercel/社区前端 Skill 和其他热门工具只提供方法候选。Storybook MCP 仍是 React preview 试点；引入前核对版本、许可证、框架、权限、维护状态、fallback、删除条件和摇篮代表任务效果，不复制其他 agent 配置或建立第二项目 Skill。

#### 迁移前已确认问题（历史输入，现已修复）

**正确性**

- `.workspace-view` 的 `display: grid` 覆盖原生 `hidden`，非当前页面仍参与布局，五个复杂页面纵向堆叠。
- 登录遮罩下仍渲染本应隐藏的应用壳；导航只改变标题和选中态，中央工作区没有正确切换。
- `AppRouter` 只有内存状态，缺少 URL、history、back/forward 和 deep-link；所有复杂页面同时挂载。
- Playwright 只检查目标元素存在或可见，没有断言非当前页面隐藏；缺少关键页面截图视觉基线。

**信息架构**

- Activity Rail 与 Section Navigation 完整重复同一组一级路由；顶栏、侧栏和页面标题重复表达当前位置。
- Context Inspector 只重复产品名称和在线状态，没有选中对象上下文。
- 设置页把 Provider、Audio、Embedding、Memory、Skill、安全、备份和更新堆在一条长页面。
- 日志默认呈现大量 debug 卡片，缺少错误优先和按需详情。
- runtime、日志、Extension 和 Provider 缺少真正的上下文详情层。

**视觉与品牌**

- Logo 是硬编码字符 `G`；导航使用“对、态、扩、志、设、退”等文字冒充图标，且没有 canonical 品牌资产消费边界。
- 缺少正式 typography、spacing、radius、layout、surface 和 motion token；`h1`/`h2` 依赖浏览器默认样式，页面标题过大过粗。
- 12/13px 辅助文字与默认正文之间缺少稳定层级；页面既空又挤，信息密度和留白没有统一节奏。
- 圆角、间距和控件高度存在大量任意值；主工作区在 1440px 仅约占六成，外围 UI 占比过高。
- 761–1080px 同时保留两层左栏，约 808px 时明显挤压和异常换行；固定断点没有根据主工作区最低容量决定布局。
- 当前视觉输入与禁止偏移见 M11 UI 设计简报；本节不复制颜色、材质或候选方向。

#### 目标信息架构

- 收敛为单层全局导航；页面内只在存在真实子域时出现二级导航。
- Context Inspector 改为按需 Context Drawer；未选中对象时不常驻无效右栏。
- 顶栏只保留品牌、当前位置、健康状态和全局操作。
- 对话、概览、能力、活动、设置形成清晰一级域。
- 设置拆分为模型与路由、语音、记忆、安全、存储、更新等真实子页面。
- runtime、日志、Extension、Provider 使用列表/主体 + 按需详情。
- 页面按用途拥有不同内容宽度；响应式由内容容量驱动，不只按设备或固定百分比判断。
- 所有视觉方向保持完整 `loading`、`empty`、`degraded`、`error`、`pending`、`success`。
- 正式 Logo、Wordmark、Favicon 和统一图标系统由未来品牌资产任务提供；本 UI 门不创建或临时替代品牌资产。

#### 视觉探索门

重大 UI 实现前必须完成 M11 UI 设计简报第 9 节的设计产物与确认门：同内容的多方向宽/窄屏比较、用户选择或明确混合元素、最终 token/组件合同，以及 Storybook/MCP 试点和项目 Skill 的代表任务证据。外部参考只提供方法，不成为项目事实源。

#### 非范围与验收矩阵

本优化门不改变 Kernel/Cognition/Extension owner，不让浏览器读取 YAML、Secret、日志文件或内部对象，不复制 Desktop 设备页面，不在同一工作内创建品牌资产，也不以视觉改造掩盖缺失 Schema/Port。

验收至少覆盖：

- URL、刷新、deep-link、back/forward、未知路由，且目标页面唯一可见、非当前页面不参与布局/可访问交互；
- 未登录、登录中、登录失败、会话过期，登录层与应用壳正确隔离；
- 对话、系统概览、设置，以及 runtime/日志/Extension/Provider 列表与按需详情；
- 宽屏、内容容量临界宽度、窄屏、断点前后、长内容、100–400% 缩放；
- 键盘、焦点、`Escape`、Drawer/Scrim、reduced-motion、触控目标和语义 HTML；
- `loading/empty/degraded/error/pending/success` 与认证、断线、冲突、失败恢复；
- 代表页面和关键状态截图基线，以及真实点击、输入、滚动、历史导航和网络失败回归。

### 生产验收记录（2026-07-24）

- `v0.1.8` 已从 fixed commit `8d8bdabb7047a63cc03fe2e28f67f41ce5c2a17a` 正式发布。GitHub Release、服务器安装器、SSH push 安装器、轻量包、完整包与统一摘要链已验证；GitHub 继续是唯一发行事实源，未增加第二安装协议。
- 全新 Ubuntu 24.04 remote/full 安装已完成；控制机与服务器分别执行发布摘要校验，应用和随发行版提供的默认 Caddy 都从本地已校验镜像归档加载。
- `/readyz`、容器、ops bridge 与端口通过；同版本幂等重装通过，安装期间未观察到 Registry 回源。当前服务器健康运行 `v0.1.8`。
- 真实失败回滚仍未完成：缺少获授权的 distinct candidate 或 fault injection 入口。不能用同版本重装、本地伪回归或未经授权的生产故障代替。
- NapCat `external_onebot`/QQ E2E 仍缺少获授权的真实外部场景入口；Extension 跨仓生产安装、升级失败恢复和回滚证据仍未完成。
- 结论：`v0.1.8` 已证明正式发布、全新安装、离线 full 镜像加载、摘要、readiness、幂等重装和无 Registry 回源；M11 仍需完成 UI 优化门、真实失败回滚、完整宿主运维/长运行矩阵、Extension 跨仓闭环和 NapCat external OneBot 场景。

### 按实施顺序追踪

- `[x]` 事实与契约：配置 Snapshot/Command、Secret write-only、默认路由与 `conversation_notice` 契约已合入并完成生成同步。
- `[x]` Kernel 配置主线：LLM Provider 与默认路由的脱敏读取、revision、预览、原子写入、审计和 apply 状态已落地；Audio/Embedding/Memory/Skill 也已接入同一 Config Application Port，并经本地单测验证落盘与 snapshot 回读。
- `[x]` Personal Server 页面：五个一级页面与七个设置子区的 React 实现完成，URL/history、唯一页面挂载、受控投影、能力诊断、配置与一次性令牌生命周期、主题/容量/a11y 与截图基线已落实。页面本地验收与实机限制见 [now.md](../now.md)；真实外部服务和生产门单独追踪。
- `[~]` Extension 发布主线：统一安装事务、兼容性/信任元数据预览、启停、版本切换回退 UI、本地 `.gcex` 上传主线，以及模板仓库 `release:prepare`、`.gcex` 构建、GitHub Release workflow、`SHA256SUMS` 与文档已落地；Contract/SDK 公共包 allowlist、干净 consumer tarball 安装门和固定 tag npm workflow 已形成候选，第一方扩展仓与 NapCat 独立仓均已迁除旧 Protocol 并统一为首版 SDK `0.1.0`。NapCat 发布候选还具备真实 tag/干净工作树门、双平台 Release Manifest、失败保留和可复现摘要验证；主仓 Package Manager 的本地 file source 与受控 HTTPS Release Manifest 两条真实候选安装探针已固化并进入 NapCat workflow，权限确认后制品变化的失败清理也已覆盖。三仓候选已推送，主仓 `npm` Environment 与发布凭据已配置；SDK/tag 与正式包发布、真实远端发布物升级/失败恢复仍未完成。
- `[~]` NapCat 跨产品化：Adapter Core 已使用 SDK public edge，manifest/peer dependency 已对齐首版 SDK `0.1.0`，Windows x64 与 Linux x64 `.gcex` 本地候选、Release Manifest、摘要和固定 SDK tag workflow 已通过本地验证；真实 Windows `.gcex` 在临时数据根中通过 `personal-server` 产品兼容预览、权限拒绝无半安装、原子安装、幂等重装与卸载，受控 HTTPS fixture 还验证了 Release Manifest 下载入口。尚未创建正式 tag/Release，Linux Product Host 安装、external OneBot 的真实 QQ 场景 E2E 与升级失败恢复门仍未完成。
- `[~]` 生产验收：`v0.1.8` fixed commit 已正式发布；全新 Ubuntu 24.04 remote/full、双重摘要、本地应用/Caddy 镜像加载、`/readyz`、容器、ops bridge、端口、幂等重装和无 Registry 回源均已通过。真实失败回滚仍因缺少获授权 distinct candidate/fault injection 入口未完成。

### 第一验收门追踪

- `[x]` Protocol 合入 Config Snapshot/Command、Secret write-only、Extension 兼容性与受管资源 profile 契约，并通过生成一致性检查。
- `[x]` Kernel 能读取脱敏配置、预览一次变更、拒绝 revision 冲突并原子提交；Secret 从读取响应中消失。
- `[x]` Personal Server 首次配置页面可新建 Provider、测试连接、保存模型路由；真实角色回复链路、正式历史读取、分页恢复与 `conversation_notice` 已接入控制面输入。
- `[x]` 页面 Playwright 覆盖零 Provider、五域功能、配置与安装事务、URL/history/deep-link、唯一页面、错误恢复、宽窄窗、深浅主题、键盘/a11y 和截图基线；组件工作台进入同批验证。原生缩放和实体触控不由 CSS 容量模拟代替，具体证据范围见 now.md。
- `[x]` 区域传输副本已从近期实施范围移出，保留为长期候选，不再驱动当前代码。

### 最终验收门追踪

- `[x]` `v0.1.8` 在全新 Ubuntu 24.04 无需源码树完成 remote/full 安装；五项 Release 资产与摘要、双重校验、本地应用/Caddy 镜像加载、`/readyz`、容器、ops bridge、端口、幂等重装和无 Registry 回源均已验证。
- `[~]` 浏览器内 Provider、Audio、Embedding、Memory、Skill 配置以及 Security/Storage/Update 正式能力查看已打通；生产已运行包含这些能力的 `v0.1.8`，页面实现已完成；宿主运维完整恢复、真实更新失败恢复与长期运行矩阵仍未完成。
- `[~]` Extension 统一事务 UI/投影已覆盖仓库/Registry/Release Manifest 预览、安装、激活、卸载、版本切换回退与浏览器本地 `.gcex` 上传；真实发布物升级、失败自动恢复和跨仓库 Linux `.gcex` 生产闭环仍未完成。
- `[~]` NapCat Linux `.gcex` 已形成可复现的本地发布候选，Windows 主机上的 Package Manager 已按 `personal-server` 产品约束完成真实包本地安装/幂等/卸载探针；Linux Product Host、外部 OneBot 私聊/群聊/记忆链路和重启连续性验收未完成。
- `[ ]` 更新失败自动恢复、备份/恢复连续性、完整停机和长运行矩阵未完成；失败回滚缺少获授权 distinct candidate/fault injection 入口。
- `[~]` Personal Server Playwright 已覆盖零 Provider、Provider 保存、Audio/Embedding/Memory 保存、Skill Catalog 刷新、安全令牌、运维 disabled reason、扩展安装/启用与桌面/窄窗；安装矩阵和真实外部场景 smoke 尚未全部完成。

## 风险

| 风险 | 应对 |
|---|---|
| 配置 API 成为任意文件编辑器 | 只接受 Schema 定义的 command，路径和写入 owner 固定在 Kernel |
| Secret 经 snapshot、日志或浏览器缓存泄露 | write-only command、统一脱敏、无回显测试、诊断包扫描 |
| UI 保存成功但运行实例仍使用旧值 | 返回生效计划与 revision，显式 reload/restart，读取 effective snapshot 复核 |
| 区域端点与权威发布漂移 | 同流水线复制、签名清单和 digest 门禁，漂移立即阻断发布 |
| 扩展安装来源形成多套行为 | 所有来源只解析为统一 artifact，再进入同一 prepare/commit 事务 |
| NapCat Linux 只改声明未改实现 | 平台 CI、包内容检查、真实 OneBot E2E 和受管资源失败注入 |
| Extension 获得宿主级容器权限 | 禁止 Docker Socket；伴随服务只能经部署 owner 或未来受控 Workload Port |
| QQ 场景污染本地会话或其他群聊 | scene/source/actor/attention/space 作用域测试和回复路由审计 |
| 页面功能增长导致移动与窄窗不可用 | 固定响应式断点矩阵、容器约束、Playwright 截图与无重叠检查 |

## 第一验收门

- Protocol 合入 Config Snapshot/Command、Secret write-only、Extension 兼容性和受管资源 profile 契约，并通过生成一致性检查。
- Kernel 能读取脱敏配置、预览一次变更、拒绝 revision 冲突并原子提交；Secret 从所有读取响应中消失。
- Personal Server 首次配置页面可新建一个 Provider、测试连接、保存模型路由并得到真实角色回复。
- 区域传输副本从本里程碑近期实施范围移出；只有在真实用户规模或长期稳定网络需求出现后，才以同一发布物的可选传输副本重新立项，且必须复用 M10 的完整包、摘要与镜像身份，不形成第二安装协议。

## 最终验收门

- 全新 Ubuntu 24.04 主机无需 Git/Node/Python 工具链，一条命令完成安装；启用区域副本时，全球源、区域源和离线来源必须得到相同版本与摘要。
- 浏览器可以完成 Provider、Audio、Embedding、Memory、Skill、Extension、安全和更新的允许配置；Secret 不回显，重启要求明确。
- 通过仓库精确 tag 或 Registry 安装与 Personal Server 兼容的 `.gcex`，完成权限确认、激活、升级、回滚和卸载。
- NapCat Linux 包经外部 OneBot 完成私聊、群聊、背景观察、注意力、私有 Skill、自然回复、经历与记忆链路；重启后场景连续性正确。
- 更新失败自动恢复上一镜像和状态；备份/恢复不丢配置、记忆、Extension 选择与账号外部数据引用。
- `stop` 后产品端口、OneBot 连接、Extension Worker 和受管进程全部释放；不存在孤儿进程。
- 类型检查、构建、受影响 Python 测试、Package Manager 安全测试、Personal Server Playwright、安装矩阵和真实场景 smoke 全部通过。
- Architecture、Implementation、Reference、Guide、SDK 文档和两个扩展仓库与实际代码一致，不保留旧入口或假兼容描述。

## 完成后归档

- 配置与 Secret：`reference/configuration.md`、对应 Protocol/Implementation 文档。
- Personal Server 产品与页面：`reference/product-compositions.md`、Personal Server Implementation、部署与运维 Guide。
- 区域分发、安装和更新：`reference/packaging-layout.md`、`guides/release/Personal Server部署.md`。
- Extension 发布、安装和资源 profile：`reference/extension-sdk.md`、Extension Implementation、扩展开发 Guide。
- NapCat 当前事实：Extension 当前视图、Extension Implementation 与独立 NapCat 仓库文档。
- 里程碑过程证据进入 `docs/history/`，`now.md` 切换到后续唯一推进面。

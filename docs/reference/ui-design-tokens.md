# UI Design Tokens Reference

> 范围：Desktop Control Center、Presence 与 Personal Server Web 共享设计语言的质量不变量、当前实现边界、目标 token 框架、视觉变量和变更规则；不保存开发步骤或把尚未实现目标写成当前事实。
> 事实依据：`products/desktop/src/renderer/styles/`、`products/desktop/src/renderer/components/control-center/`、`products/personal-server/src/web/shared/styles/`、对应 UI 测试与用户确认的视觉方向。
> 维护触发：当前主题/token、页面结构、组件状态、响应式策略、可访问性基线、品牌资产消费边界或用户确认的视觉方向变化。

本文必须同时回答三件事：当前代码已经是什么、跨产品长期必须达到什么质量、哪些视觉选择仍可重新设计。精确开发与验收步骤见 [前端开发与 UI 验收](../guides/development/前端开发与UI验收.md)。

## 目录

- [1. 事实状态分层](#1-事实状态分层)
- [2. 稳定质量不变量](#2-稳定质量不变量)
- [3. 当前实现与视觉证据](#3-当前实现与视觉证据)
- [4. 可重新设计的视觉变量](#4-可重新设计的视觉变量)
- [5. 目标 Token 框架](#5-目标-token-框架)
- [6. 组件与状态契约](#6-组件与状态契约)
- [7. 产品边界与 owner](#7-产品边界与-owner)
- [8. 变更与验证规则](#8-变更与验证规则)

## 1. 事实状态分层

| 标记 | 含义 | 能否直接用于实现 |
|---|---|---|
| **当前实现** | 已能从代码、样式或测试核对的事实 | 可以；改变时同步本页 |
| **稳定质量不变量** | 不依赖主题或表面风格、所有方向都必须满足的质量门 | 必须 |
| **目标规范** | 已确认需要建立，但具体值或组件语言仍待视觉探索/实现 | 不能冒充已落地 |
| **待用户选择的视觉变量** | 重大改造前必须比较并由用户确认的方向 | 用户确认前不得固化 |

2026-08-25，用户确认 M11 Personal Server 的最终视觉方向：中性深浅主题与“青曜”强调色正交，以连续、安静的工作台结构为主，使用有限晶光层次，并只在运行列表等高扫描场景提高密度。首个 Shell/Router slice 已将该方向落入当前语义 token、深浅主题、单层壳层和 480×900 响应式基线；后续 feature React 化仍需继续消费同一 token owner，不能把参考图当作像素或生产 token 的第二事实源。

用户确认某一轮方向后，具体 token 才作为“当前目标/当前实现”进入本 Reference；未来仍可通过新的设计决策和完整验收继续演化。

## 2. 稳定质量不变量

以下质量不随视觉方向改变：

1. 信息架构清晰，一级域、真实子域、当前位置、对象详情和全局操作不重复争夺注意力。
2. 排版、空间、控件尺寸与组件状态形成统一系统，不以大量任意值拼接页面。
3. 可读性、键盘、焦点、语义、缩放、reduced-motion、触控目标与响应式达到可持续验收基线。
4. 视觉方向与 Glimmer Cradle 产品身份、页面用途和个人长期使用场景一致。
5. 不使用临时后台、组件库默认皮肤、卡片墙或通用 AI 模板作为正式产品界面。
6. 视觉美感不能以牺牲可用性、状态完整性、信息容量、可访问性或失败恢复为代价。
7. Web 与 Renderer 只消费受控投影并提交用户 intent，不依据 UI 状态推断 Kernel、Cognition、Extension 或运维事实。
8. 所有方向都必须覆盖 `loading`、`empty`、`degraded`、`error`、`pending`、`success`，不能只设计理想数据态。

“真正好看”需要能够解释层级、比例、节奏、信息密度、交互反馈与品牌意图，而不是只列主题名或形容词。

## 3. 当前实现与视觉证据

### Desktop 当前实现

Desktop Control Center 当前由 `products/desktop/src/renderer/components/control-center/` 与 `styles/` 装配：

- `tokens.css` 提供深色默认值和 `light` 覆盖，包含 canvas、workspace、surface、semantic color、focus、radius、布局尺寸与 motion 变量。
- `workbench.css` 和 `ControlCenterShell.tsx` 实现 Activity Rail、Section Navigation、Workspace、可调 Context Inspector，以及容量不足时的导航/Inspector overlay。
- 当前结构采用连续底层与主要 Workspace surface；宽屏存在可调分区栏和 Context Inspector，reduced-motion 偏好会将动画时长降到近零。
- 当前这些值描述现状，不自动约束 Personal Server，也不代表下一轮视觉探索必须保留相同表面结构。

Desktop 的精确 CSS 值仍以当前实现为准。本页不复制完整数值表，避免形成代码之外的手工镜像；实现变化时应同步语义、owner 与验证结论。

### Personal Server 当前实现

Personal Server Web 当前由 `products/personal-server/src/web/` 装配：

- `shared/styles/tokens.css` 提供中性 canvas/workspace/surface、文字、边界、focus、状态、spacing、radius、control 与 layout 语义变量，并由 `html[data-theme='light']` 覆盖浅色值；主要行动的前景与渐变也由用途 token 映射，消费样式不散落原始色值。青曜不进入 canvas、workspace、主要 surface 或正文层级。
- `global.css`、`layout.css`、`motion.css` 与 `responsive.css` 分别持有基础语义、壳层容量、reduced-motion 和响应式规则；feature 局部样式不成为第二套主题。
- `PersonalServerShell.tsx` 在宽屏只显示一层侧栏导航，在窄屏使用可关闭并返回焦点的 React Aria Dialog 导航；当前页面由 React Router `Outlet` 唯一挂载。
- 登录层不会挂载 Product Shell；深链登录后返回原 URL，根路径、unknown route、refresh 与 back/forward 由浏览器路由测试覆盖。
- 代表性 `HealthBadge` 以真实组件、CSS Module 和 story 进入 Storybook；Storybook 不模拟 Product Host 事实，也未启用 MCP。
- 概览 feature 已使用 CSS Module 直接消费同一语义 token，以状态摘要、连续运行体列表、模型配置摘要和按需详情抽屉组织页面；旧 status 全局样式及其共享覆盖已删除。`Overview.stories.tsx` 提供等待、空目录、降级、读取失败、断线、等待重连目录、长列表及详情交互场景。
- 概览深色宽屏、浅色宽屏和深色 480×900 使用固定 Playwright 视觉基线；观测时间在测试网络响应中固定，避免修改 React 所拥有的 DOM，结构、内容与状态不被遮罩。
- 概览另有空目录、运行体降级、读取失败与运行体详情的宽/窄屏截图；列表和详情使用 320～1440 CSS px 长内容矩阵验证容量，键盘焦点与深浅主题 axe 由真实 Product Host 测试覆盖。
- 对话 feature 由 CSS Module 消费相同语义 token，消息区独立滚动，输入区保持在页面底部；恢复历史与空态具有深浅宽/窄屏基线，320～1440 CSS px 长内容、输入焦点与深浅主题 axe 已覆盖。`Conversation.stories.tsx` 提供恢复、空态、加载、错误、断线、等待回复、失败与长消息状态。
- 能力页候选由 `features/capabilities/Extensions.module.css` 消费相同 token：默认扩展列表，按需安装表单与版本/诊断抽屉，取消旧全局 extension 样式。目录、安装表单和详情建立宽/窄屏截图，深浅主题、320～1440 CSS px 和键盘焦点进入/返回进入 Product Host 回归；独立接受状态由 Roadmap 维护。
- 活动页由 `features/activity/Activity.module.css` 消费相同 token：筛选、暂停缓冲状态、事件列表与详情抽屉归于页面内；深浅主题、宽窄屏列表/详情截图、320～1440 CSS px、键盘焦点与空态语义进入真实 Host 和 Storybook 回归。
- 设置由 `features/configuration/Configuration.module.css` 消费相同 token，宽屏侧栏与窄屏分类 Drawer 按真实子区切换；字段、保存状态、一次性令牌及危险操作确认由 React 持有。模型、记忆和丢弃确认建立宽窄深浅主题基线，320～1440 CSS px、键盘焦点与七子区 axe 进入 Product Host 回归；旧 feature DOM/CSS 与 route adapter 已全部删除。

详细后续 feature React 化与状态矩阵验收门由 [M11](../roadmap/milestones/M11-Personal%20Server控制面、区域分发与跨产品Extension闭环.md) 维护。

### 当前实现的比较方式

当前 Desktop 和 Personal Server 只能作为问题与比例证据，用来识别哪些结构值得保留、修改或删除；它们不拥有下一轮视觉方向。探索不得据此预设：

- 必须深色或浅色；
- 必须沿用连续平面、实体 Surface、分区或其他既有表面结构；
- 必须克制极简或使用系统字体；
- 必须使用或禁止渐变、阴影、透明、纹理；
- Desktop 与 Personal Server 必须拥有完全相同的页面装配。

## 4. 可重新设计的视觉变量

下列变量必须在相同信息架构、内容和功能边界下探索；差异不能只靠换色：

| 变量 | 可探索范围 | 不可突破 |
|---|---|---|
| 主题 | 深色、浅色、跟随系统或其他完整主题策略 | 可读性、语义色、状态不能丢失 |
| 表面结构 | 连续平面、实体 Surface、分区、混合层级 | 信息层级与主要任务容量明确 |
| 色彩 | 中性基底、强调色、语义色、角色/产品识别 | 颜色不是唯一反馈，Secret/状态语义不混用 |
| 形状与深度 | 圆角、直角、描边、阴影、透明、纹理 | 一致、有限、可形成 token；不能制造无意义卡片墙 |
| Typography | 字体气质、字号比例、字重、行高、行长 | 缩放、中文/英文/技术 ID 可读 |
| 密度 | 舒适、紧凑或按页面用途变化 | 触控、键盘、状态文本与主要任务不被压缩 |
| 导航 | Rail、侧栏、顶栏、命令入口或混合 | 单层全局导航，二级导航只服务真实子域 |
| Motion | 淡入、位移、弹性或近静态语言 | reduced-motion、焦点与状态连续性完整 |

正式 Logo、Wordmark、Favicon 与图标系统属于未来品牌资产任务。本 Reference 只规定消费边界：产品表面从 canonical 品牌/图标入口消费，不以字符、emoji、随手文字或 feature 私有文件建立替代品牌系统。

### 4.1 已确认的色彩方向

用户确认主题骨架与强调色必须正交：深色主题使用中性黑/炭黑/灰，浅色主题使用白/近白/中性灰；M11 的目标强调色选择“青曜”，不能反向染色 canvas、workspace、主要 surface 或正文层级。目标是整体具有晶莹、清澈和含蓄光感，而不是把界面拟物成玻璃。磨砂、透明与背景透射只是可选材质输入。参考图表达协调度和感知目标，不把其中布局、文字或采样颜色值当成项目指令，也不等于其余视觉方向已经通过。

必须保留：

- 深色 canvas、workspace 和主要 surface 使用中性黑/炭黑/灰，不读成蓝色、绿色或其他有色主题；浅色对应使用白/近白/中性灰，不读成浅蓝或带色纸面；
- 强调色拥有独立 token 槽；“青曜”采用深处偏蓝、亮处转青绿的色相迁移，不能退化成普通企业科技蓝、青色霓虹或大面积自然主题；
- 强调色集中在选择、focus、主要行动、链接、少量品牌时刻或明确语义状态；更换 accent 不应要求重做中性 surface 与文字 palette；
- success/warning/danger 等语义颜色与可换的交互 accent 分离，且始终伴随文字、图标或结构反馈；
- 主要阅读 surface 使用与 canvas 分离的中性灰；可按层级选择实体、雾面、半透明或混合 surface。canvas 可以只有底色，不强制底图、背景透射或 `backdrop-filter`；
- “晶莹”是整体感知目标，可来自有限明暗面、低饱和色彩迁移、内部透光、柔和阴影、局部高光、微弱颗粒和按需透明。边缘描边只是可选分隔，不应成为证明材质的主要手段；
- 不使用全页同一透明度、统一亮边、强 glow、清晰背景干扰或渐变卡片墙；材质手段必须服从信息层级和长期阅读；
- 深色与浅色是同一中性语义系统的两种映射，accent 再独立映射；不能把 accent 混入主题底色，也不能分别手调成两套无关主题。

“青曜”的已确认视觉色阶如下；[实色色卡](../roadmap/design-briefs/reference-assets/m11-ui/accent-a-qingyao.svg)用于人工比较，表内 OKLCH 值才是后续生成与校准的基准。该色阶是 M11 的目标设计输入，不代表当前代码已经实现，也不表示每一级可以直接作为文字、图标或控件前景色。

| 视觉级别 | OKLCH 基准 | sRGB 参考 | 预期角色 |
|---|---|---|---|
| `deep` | `oklch(0.34 0.075 220)` | `#004052` | 深色内部阴影、按需低亮层次；不作为深色主题底色 |
| `pressed` | `oklch(0.47 0.105 215)` | `#00687F` | 按下态或浅色主题中的较深强调候选 |
| `core` | `oklch(0.66 0.145 205)` | `#00AABC` | 小面积选择、主要行动与品牌强调的视觉核心 |
| `hover` | `oklch(0.72 0.145 198)` | `#00BFC5` | hover、活动指示与短暂反馈候选 |
| `glint` | `oklch(0.84 0.11 185)` | `#6AE2D4` | focus ring、局部晶光和深色表面的高亮候选 |

### 4.2 M11 已确认视觉语言

用户确认的 M11 组合吸收“静水工作台”的连续结构、“晶光器皿”的有限内透光，以及“夜湖控制台”在运行列表中的扫描密度。实现必须保持以下边界：

- 深色使用中性炭黑、黑灰和分层灰；浅色使用白、近白和中性灰。两套主题共享语义结构，不分别手调为无关 palette。
- 主要阅读 surface 以实体或近实体雾面为主；晶莹感来自有限明暗面、局部内高光、柔和阴影和少量青曜晶光，不使用整页玻璃、统一亮边或强 glow。
- 全局导航只有一层；Workspace 保持连续，Context Drawer 仅在选中真实对象时出现。窄屏优先单列主任务，导航和详情按需覆盖。
- Typography 采用清晰、克制、适合中英文与技术 ID 长期阅读的无衬线体系；标题不营销化，正文先给结论，再说明影响和行动。
- 默认页面使用舒适密度；runtime、活动和能力列表可提高到中等偏高密度，但不得压缩状态说明、焦点或触控目标。
- 青曜只标识选择、focus、主要行动、链接和少量品牌时刻。浅色小号正文使用 `pressed` 或经验证的更深映射，不直接使用 `core`。

中性 palette、typography、spacing、radius、surface、motion、control sizing 与 capacity 的精确 token 在首个获授权实现 slice 固定，并以深浅主题对比度、代表页面和组件状态验证；确认前不得从效果图采样任意值散落到 feature。

实现前必须针对深色与浅色分别完成语义映射和对比度验证：例如 `core` 在中性深色上可形成鲜明强调，但不能因视觉选中就直接用于浅色背景上的小号正文；需要从同一感知色阶选择更深前景或配合中性文字。最终 token 按用途命名，不以 `deep/core/glint` 作为跨产品公开语义，也不得从 SVG 或截图采样后在 feature 内散落原始色值。success/warning/danger 继续使用独立语义色。

## 5. 目标 Token 框架

以下是**目标规范框架**，不是对当前已实现 token 的声明。M11 已确认视觉语言；首个实现 slice 仍需为每类 token 固定名称、语义、主题映射、owner、适用组件与验证方式。

| 类别 | 至少表达 | 验证重点 |
|---|---|---|
| `typography` | family/role、display/title/body/label/code、size、weight、line-height、tracking、reading width | 中文/英文/技术 ID、200%/400% 缩放、默认标题样式清零 |
| `spacing` | 基础步长、组件内距、页面节奏、分组间距 | 不出现相近任意值；密度与层级一致 |
| `radius` | control、surface、structure、overlay | 语义有限；不让每个组件自选圆角 |
| `surface` | canvas、workspace、section、raised、matte、translucent、overlay、scrim，以及不透明度/模糊/内部光感/阴影/描边/颗粒的可选语义组合 | 有无底图都能形成清晰层级；不依赖统一亮边证明材质，正文对比稳定且不过度卡片化 |
| `color/theme` | 深浅主题的 canvas、workspace、surface、text、divider、disabled 中性色阶 | 不受 accent 染色；深浅/高对比映射与长期阅读 |
| `color/accent` | selection、focus、primary action、link、有限品牌时刻及可选 accent variant | 小面积使用；更换 accent 不重做 theme palette；状态不能只靠颜色 |
| `color/semantic` | info、success、warning、danger 与对应内容/表面 | 与交互 accent 解耦；对比度、图标/文字反馈、深浅/高对比映射 |
| `motion` | duration、easing、enter/exit、state change、reduced-motion | 不遮断操作；降动效后语义仍清楚 |
| `control sizing` | 最小高度、inline padding、icon、target、gap | 键盘/触控、长标签、不同输入模式 |
| `layout capacity` | 页面最低/理想/最大宽度、reading measure、pane/Drawer 容量 | 主任务优先；不同页面不被单一宽度绑死 |
| `breakpoint/overlay` | 由内容容量触发的布局模式、Drawer/Scrim、层级 | 断点前后、缩放、backdrop、Escape、焦点返回 |
| `focus/accessibility` | focus ring、outline offset、disabled、error association、high contrast | 可见、不被遮挡、名称/角色/值、颜色非唯一 |

token 应按语义命名，不用具体颜色或单个页面命名跨产品 token。组件可以拥有受控别名，但不得复制原始值形成第二套主题。

当前实现继续以各 Product 的 `tokens.css` 为代码事实源。DTCG 2025.10 是未来跨工具/跨产品生成链候选；只有 canonical token source、CSS 生成器、校验、consumer 和旧 CSS 删除门同时成立时才能采用，不能并行手写 JSON、CSS 与 Storybook theme。AI 应读取语义 token 与真实组件状态，不能从截图采样后直接在 feature 内散落原始色值。

## 6. 组件与状态契约

所有可操作组件至少覆盖：

- `default`、`hover`（适用时）、`pressed`、`focus-visible`、`disabled`、`selected`；
- 异步 `pending`、`success`、`error`；
- 数据 `loading`、`empty`、`degraded`；
- 长文本、未知值、只读、权限拒绝与断线。

表单还要覆盖脏状态、字段校验、保存/重置、revision 冲突、Secret write-only、reload/restart 和失败后输入保留。静态元素不得伪装按钮；图标按钮必须有可访问名称，陌生图标需要可发现说明。

路由和 Shell 必须确保：

- 当前页面唯一参与主要布局与可访问交互；
- 登录层与应用壳不会同时暴露为可操作界面；
- URL、history、刷新与 deep-link 一致；
- 页面离开时清理 listener、timer、stream、observer 和临时请求；
- Drawer/Overlay 支持显式关闭、`Escape`、scrim、焦点进入与返回。

## 7. 产品边界与 owner

- Desktop 与 Personal Server 共享设计质量、语义 token 框架和无领域事实的交互原语，不共享 Product Host、设备能力或整页装配。
- Control Center 负责完整工作台；Presence 只承担轻量常驻状态和即时交互，不复制设置、日志或 Extension 管理。
- 页面 owner 负责编排，feature owner 负责领域 view model/局部样式，`shared UI` 负责通用原语，token owner 负责跨产品语义。
- Provider、Audio、Memory、Skill、安全、存储、更新等真实领域保持独立 owner；设置页不能以单条超长页面抹平 owner。
- runtime、日志、Extension、Provider 等对象使用列表/主体 + 按需详情；未选对象时不常驻无意义 Context Inspector。
- Renderer/Web 不读取配置文件、数据库、日志文件、Extension 目录、Unity/Avatar 原始资产或 Secret；品牌资产也必须经公开、受控的消费边界。

## 8. 变更与验证规则

### 视觉方向确认

重大 UI 改造必须按 Guide 先用同一代表任务比较至少三个方向及宽/窄屏行为，并比较字体、比例、色彩、表面、品牌、导航、密度、动效、可访问性和维护成本。用户选择方向或明确混合元素后，再为最终方向补齐代表页面、深浅主题和关键状态矩阵，并更新本页的当前目标 token。

### 验证

- token 名称、原始值与任意值残留定向扫描；
- 当前页面可见、非当前页面隐藏/卸载、登录层隔离与路由 history 测试；
- `loading/empty/degraded/error/pending/success` 状态矩阵；
- 内容驱动的宽屏、临界宽度、窄屏、100–400% 缩放与长内容截图；
- 键盘、焦点、reduced-motion、触控目标、语义 HTML 与高对比检查；
- Personal Server 使用真实浏览器交互与 Playwright；Desktop 还需 Electron 实机；
- 截图不能替代路由、输入、焦点、失败恢复和跨边界契约验证。

### 同步与兼容

改变当前 token 或组件状态时，在同一工作更新实现、测试和本页。改变页面/装配链路时更新对应 Implementation；改变跨边界数据时先更新 Schema/Port；尚未实现的设计目标只进入 Roadmap。

新的视觉方向应替换旧的当前目标和无 owner 的兼容样式，不长期维护两套主线。Git 保存历史，不以旧 CSS 入口、重复 token 或永久 fallback 保存历史设计。

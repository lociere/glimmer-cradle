# UI Design Tokens Reference

> 范围：Desktop Control Center、Presence 与 Personal Server Web 共享设计语言的质量不变量、当前实现边界、目标 token 框架、视觉变量和变更规则；不保存开发步骤或把尚未实现目标写成当前事实。
> 事实依据：`products/desktop/src/renderer/styles/`、`products/desktop/src/renderer/components/control-center/`、`products/personal-server/src/web/shared/styles/`、对应 UI 测试与用户确认的视觉方向。
> 维护触发：当前主题/token、页面结构、组件状态、响应式策略、可访问性基线、品牌资产消费边界或用户确认的视觉方向变化。

本文必须同时回答三件事：当前代码已经是什么、跨产品长期必须达到什么质量、哪些视觉选择仍可重新设计。精确开发与验收步骤见 [前端开发与 UI 验收](../guides/development/前端开发与UI验收.md)。

## 目录

- [1. 事实状态分层](#1-事实状态分层)
- [2. 稳定质量不变量](#2-稳定质量不变量)
- [3. 当前实现与比较基线](#3-当前实现与比较基线)
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

当前“无边界 + Bubble”是用户目前认为最顺眼的视觉比较基线，不是永久视觉风格或架构不变量。最终视觉方向未确认前，深浅主题、表面结构、颜色、圆角、阴影、透明度、纹理、字体气质、密度、导航形态与动效语言都不得被提升为永久约束。

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

## 3. 当前实现与比较基线

### Desktop 当前实现

Desktop Control Center 当前由 `products/desktop/src/renderer/components/control-center/` 与 `styles/` 装配：

- `tokens.css` 提供深色默认值和 `light` 覆盖，包含 canvas、workspace、surface、semantic color、focus、radius、布局尺寸与 motion 变量。
- `workbench.css` 和 `ControlCenterShell.tsx` 实现 Activity Rail、Section Navigation、Workspace、可调 Context Inspector，以及容量不足时的导航/Inspector overlay。
- 当前结构采用连续底层与主要 Workspace Bubble，宽屏存在可调分区栏和 Context Inspector；reduced-motion 偏好会将动画时长降到近零。
- 当前这些值描述现状，不自动约束 Personal Server，也不代表下一轮视觉探索必须保留相同表面结构。

Desktop 的精确 CSS 值仍以当前实现为准。本页不复制完整数值表，避免形成代码之外的手工镜像；实现变化时应同步语义、owner 与验证结论。

### Personal Server 当前实现

Personal Server Web 当前由 `products/personal-server/src/web/` 装配：

- `shared/styles/tokens.css` 只有一组深色 canvas/surface/text/accent/semantic color 与单一 radius 变量，尚未形成完整 typography、spacing、layout、control sizing、motion 和 accessibility token 系统。
- `shell/layout.ts` 当前创建 Titlebar、Activity Rail、Section Pane、Workspace 与常驻 Inspector；Rail 和 Section Pane 重复同一组一级路由。
- 路由当前是内存状态，没有 URL、history、back/forward 与 deep-link。
- `.workspace-view` 的通用 `display: grid` 当前会覆盖原生 `hidden`，使非当前页面继续参与布局；登录遮罩下的应用壳也可能被 `.app-shell` 的 `display: grid` 覆盖。
- 当前固定断点与多列宽度在中间视口压缩主工作区，页面内容宽度、文字层级、圆角、间距和控件高度存在大量局部任意值。
- 当前测试覆盖多项真实功能交互，但没有断言所有非当前页面隐藏，也没有关键页面截图视觉基线。

以上是已核对的当前问题，不是目标结构。详细待实现优化与验收门由 [M11](../roadmap/milestones/M11-Personal%20Server控制面、区域分发与跨产品Extension闭环.md) 维护。

### 比较基线的使用方式

“无边界 + Bubble”可以在视觉探索中作为一个候选方向或参考元素，用来比较连续底层、主要任务 Surface、留白和层级是否协调；不得据此预设：

- 必须深色或浅色；
- 必须无边界、Bubble、实体 Surface 或其他表面结构；
- 必须克制极简或使用系统字体；
- 必须使用或禁止渐变、阴影、透明、纹理；
- Desktop 与 Personal Server 必须拥有完全相同的页面装配。

## 4. 可重新设计的视觉变量

下列变量必须在相同信息架构、内容和功能边界下探索；差异不能只靠换色：

| 变量 | 可探索范围 | 不可突破 |
|---|---|---|
| 主题 | 深色、浅色、跟随系统或其他完整主题策略 | 可读性、语义色、状态不能丢失 |
| 表面结构 | 无边界、Bubble、实体 Surface、分区、混合层级 | 信息层级与主要任务容量明确 |
| 色彩 | 中性基底、强调色、语义色、角色/产品识别 | 颜色不是唯一反馈，Secret/状态语义不混用 |
| 形状与深度 | 圆角、直角、描边、阴影、透明、纹理 | 一致、有限、可形成 token；不能制造无意义卡片墙 |
| Typography | 字体气质、字号比例、字重、行高、行长 | 缩放、中文/英文/技术 ID 可读 |
| 密度 | 舒适、紧凑或按页面用途变化 | 触控、键盘、状态文本与主要任务不被压缩 |
| 导航 | Rail、侧栏、顶栏、命令入口或混合 | 单层全局导航，二级导航只服务真实子域 |
| Motion | 淡入、位移、弹性或近静态语言 | reduced-motion、焦点与状态连续性完整 |

正式 Logo、Wordmark、Favicon 与图标系统属于未来品牌资产任务。本 Reference 只规定消费边界：产品表面从 canonical 品牌/图标入口消费，不以字符、emoji、随手文字或 feature 私有文件建立替代品牌系统。

## 5. 目标 Token 框架

以下是**目标规范框架**，不是对当前已实现 token 的声明。视觉方向确认后，为每类 token 记录名称、语义、当前值/主题映射、owner、适用组件与验证方式。

| 类别 | 至少表达 | 验证重点 |
|---|---|---|
| `typography` | family/role、display/title/body/label/code、size、weight、line-height、tracking、reading width | 中文/英文/技术 ID、200%/400% 缩放、默认标题样式清零 |
| `spacing` | 基础步长、组件内距、页面节奏、分组间距 | 不出现相近任意值；密度与层级一致 |
| `radius` | control、surface、structure、overlay | 语义有限；不让每个组件自选圆角 |
| `surface` | canvas、workspace、section、raised、overlay、scrim | 表面层级可辨且不过度卡片化 |
| `color/semantic` | text 层级、accent、info/success/warning/danger、disabled、selection | 对比度、非颜色反馈、深浅/高对比映射 |
| `motion` | duration、easing、enter/exit、state change、reduced-motion | 不遮断操作；降动效后语义仍清楚 |
| `control sizing` | 最小高度、inline padding、icon、target、gap | 键盘/触控、长标签、不同输入模式 |
| `layout capacity` | 页面最低/理想/最大宽度、reading measure、pane/Drawer 容量 | 主任务优先；不同页面不被单一宽度绑死 |
| `breakpoint/overlay` | 由内容容量触发的布局模式、Drawer/Scrim、层级 | 断点前后、缩放、backdrop、Escape、焦点返回 |
| `focus/accessibility` | focus ring、outline offset、disabled、error association、high contrast | 可见、不被遮挡、名称/角色/值、颜色非唯一 |

token 应按语义命名，不用具体颜色或单个页面命名跨产品 token。组件可以拥有受控别名，但不得复制原始值形成第二套主题。

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

重大 UI 改造必须按 Guide 产出至少三个方向，每个方向覆盖对话、系统概览、设置的宽屏与窄屏，并比较字体、比例、色彩、表面、品牌、导航、密度、动效、可访问性和维护成本。只有用户选择或明确混合元素后，才更新本页的当前目标 token。

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

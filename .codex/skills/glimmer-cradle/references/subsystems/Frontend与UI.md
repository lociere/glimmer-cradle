# Frontend 与 UI

适用任务：Web、Electron Renderer、Control Center、Presence、页面布局、视觉设计、设计系统、响应式、可访问性与前端 UI 测试。

## 必读事实源

1. 通用入口：`docs/README.md`、`docs/guides/开发手册.md`。
2. 实施与验收：`docs/guides/development/前端开发与UI验收.md`。
3. 设计语言：`docs/reference/ui-design-tokens.md`。
4. 前端技术决策：`docs/architecture/decisions/ADR-0017-产品前端统一采用React组件驱动架构.md`。
5. 产品边界：`docs/reference/product-compositions.md` 和对应 Current/Implementation。
6. 当前承诺：涉及 M11 UI 时读取 `docs/roadmap/design-briefs/M11-Personal Server UI设计简报.md`、`docs/roadmap/manifests/M11-目标物理清单.md` 与 `docs/roadmap/now.md`；只在需要 Extension/NapCat/生产依赖时扩读完整 M11 milestone。
7. 只读取目标路由、页面、feature、shared UI、样式和测试；不要用 History、外部产品或外部 Skill 推断当前事实。
8. 使用 AI 生成/迭代 UI、参考图、浏览器截图、Storybook/MCP 或社区前端 Skill 时，另读 `subsystems/AI前端开发.md` 与 `docs/guides/development/AI辅助前端开发.md`。

## 操作顺序

严格按“分析 → 设计 → 实现 → 审查 → 验收”推进；任一阶段发现 owner、视觉选择或跨边界事实不清时，回到对应前置阶段，不用 CSS 或组件补猜。

1. 写清用户任务、当前事实、目标行为、页面 owner、路由 owner、数据投影 owner、状态矩阵与验证矩阵。
2. 先做信息架构：一级域、真实子域、当前位置、对象详情、全局操作；删除重复导航、重复标题和无上下文常驻栏。
3. 判断跨边界需求：只改变现有投影的呈现时不改协议；若 Web/Renderer 必须拼接内部事实才能判断状态，先设计 Schema/公开 Port，不在 UI 补猜。
4. 重大 UI 改造在编码前固定相同信息架构、内容和功能，先用同一代表任务比较至少三个非换色式方向及其宽/窄屏行为；用户选择方向或明确混合元素后，再为最终方向补齐对话、系统概览、设置和深浅主题矩阵，并固化当前 token 与组件语言。
5. 按路由/Shell、shared UI、feature、页面装配顺序实现；页面只编排，领域 view model 与局部样式归 feature，共享层不持有领域事实。
6. 补齐 `loading`、`empty`、`degraded`、`error`、`pending`、`success`、认证失效、断线、脏状态、冲突与 cleanup。
7. 按内容容量设计响应式，再验证键盘、焦点、缩放、reduced-motion、触控与语义 HTML。
8. 运行定向静态/单元、路由与真实交互、截图矩阵、包级 build/typecheck；Electron 变化补实机。同步唯一事实源并删除被替代旧结构。
9. AI 辅助实现必须形成“观察当前页面 → 查询真实组件/API → 实现内聚片段 → 浏览器渲染并查看截图 → 交互/a11y/响应式验证 → 纠偏”的闭环；工具或模型不能替代用户视觉确认和真实产品 E2E。

## 视觉探索判断

- 不预设深色/浅色、表面结构、色彩、圆角、阴影、透明、纹理、字体、密度、导航或动效。
- 可以学习成熟产品、官方设计系统和 frontend Skill 的设计方法，但只吸收层级、状态、响应式、可访问性与质量门；不复制品牌、布局、颜色、图标、模板、代码、配置或 token。
- 社区 Skill 的安装量、star 或宣传效果只用于发现候选；引入项目规则前核对许可证、适用框架、权限、与项目事实源的冲突，并以摇篮代表任务验证是否真正降低返工。
- 方向必须真正不同，并说明设计意图、长期使用体验、产品身份、比例、密度、可维护性与可访问性。
- 避免通用 AI 风格：不以渐变光斑、巨型标题、等权卡片墙、随意圆角、emoji/单字伪图标和组件库默认皮肤代替信息架构与品牌意图。

## Owner 与边界

- 路由 owner：URL、history、back/forward、deep-link、未知路由、进入/离开与页面挂载。
- 页面 owner：编排 feature，不复制 feature 状态机。
- feature owner：领域 view model、表单、异步状态、局部样式和 cleanup。
- shared UI：无领域事实的原语、可访问交互和通用布局。
- token owner：跨表面的语义；feature 不复制原始值形成第二主题。
- 系统事实：Protocol/Kernel/公开 Port 的受控投影；Renderer/Web 不读 YAML、Secret、数据库、日志文件、Extension 目录、Kernel 内部对象或 Node-only API。
- 第一方交互式产品 UI 的框架边界以 ADR-0017 为准；迁移状态必须从目标产品的 Current/Implementation/Roadmap 核对，不在 Skill 保存易过期状态。
- Control Center 与 Personal Server 可共享工程模型、质量和 token 框架，不共享 Product Host、设备能力或整页装配；Presence 不复制完整管理工作台。

## 状态与验收

- 原生 `hidden`、`inert`、`aria-hidden` 与 CSS 显示规则一致；当前页面唯一参与主要布局与可访问交互。
- 认证层出现时应用壳不暴露为可操作界面；所有复杂页面不得无理由同时挂载和运行。
- Overlay/Drawer 支持显式关闭、scrim、`Escape`、焦点进入/返回；未选对象时不常驻空 Inspector。
- 列表覆盖零项、单项、大量项、长名称、未知枚举和部分失败；表单覆盖校验、Secret write-only、revision 冲突、保存失败、重置与 restart/reload。
- 响应式由主要任务最低容量、阅读宽度和局部容器决定，不按设备名或固定百分比；验证断点前后、长内容与 100–400% 缩放。
- 自动化必须断言目标页可见且非当前页隐藏，覆盖 URL/history/deep-link、键盘/焦点、关键失败恢复，并为代表页面和关键状态建立稳定截图基线。
- 截图不替代真实点击、输入、滚动、网络失败、焦点和跨边界契约测试。

## 反模式

- Renderer/Web 根据 DOM、请求先后、颜色或缓存推断系统 ready、配置生效或 Extension 状态。
- Activity Rail、侧栏、顶栏和标题重复同一导航或位置。
- 设置把多个 owner 堆成长表单；日志默认铺满 debug 卡片；列表没有按需详情。
- 通用 `display` 覆盖 `[hidden]`，登录遮罩与应用壳同时可访问，或非当前复杂页面全部常驻。
- 用更多 CSS specificity、设备特例或兼容壳掩盖旧结构，没有删除条件。
- 把某一轮参考图、历史偏好、深浅主题或外部案例写成永久不变量。
- 先编码再让用户从成品被动接受视觉方向。

## 交付契约

回报必须包含：用户任务与 owner、当前事实/目标边界、视觉方向确认来源、改动页面/feature/token、状态覆盖、视口/输入/缩放/截图矩阵、已运行与未运行验证、旧结构删除、文档同步、剩余风险和下一验收门。

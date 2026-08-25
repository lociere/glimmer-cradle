# AI 辅助前端开发

> 适用场景：使用 Codex 设计、实现、审查或迭代 Web、Electron Renderer、Control Center 与 Presence UI。
> 前置条件：已阅读 [开发手册](../开发手册.md)、[前端开发与 UI 验收](./前端开发与UI验收.md)、[UI Design Tokens Reference](../../reference/ui-design-tokens.md) 及目标产品的 Product Composition/Implementation；已确认用户任务、页面 owner、数据投影 owner、视觉确认来源和授权边界。
> 事实依据：当前前端代码与测试、项目 Skill、Playwright，以及 OpenAI、Storybook、React Aria、W3C/WAI、Vercel、Anthropic 与 shadcn 的公开方法资料。
> 维护触发：前端框架、组件工作台、设计 token 事实源、浏览器自动化、截图策略、可访问性工具或项目 Skill 路由变化。

本指南只规定 AI 如何可靠地完成前端工作，不固定某一种视觉风格。页面结构、token 当前值和组件 API 仍以代码、Reference 与用户确认的视觉方向为准。

## 目录

- [1. 项目结论](#1-项目结论)
- [2. 当前工具与库决策](#2-当前工具与库决策)
- [3. AI UI 工作包](#3-ai-ui-工作包)
- [4. 设计与实现闭环](#4-设计与实现闭环)
- [5. 失败与恢复](#5-失败与恢复)
- [6. 验证与文档同步](#6-验证与文档同步)
- [7. 方法参考](#7-方法参考)

## 1. 项目结论

业内有效的 AI 前端工作流并不是增加一段更长的“请写得漂亮”提示词，而是给 AI 一个可闭环的环境：

1. **有边界的设计上下文**：用户任务、信息架构、语义 token、真实组件 API、代表内容与状态矩阵可直接读取。
2. **可复现的渲染场景**：组件或页面的默认、长内容、空态、失败、降级和异步状态可以稳定重现。
3. **真实浏览器反馈**：AI 能启动目标页面、点击/输入/滚动、观察截图、检查 DOM/可访问性，再修正实现。
4. **机器可判定的质量门**：类型、交互、路由、视觉基线、可访问性和响应式都有明确失败输出。
5. **人类保留审美决策权**：AI 可以提出方向和迭代实现，但不能在重大改造中跳过设计简报规定的候选比较，或替用户固化品牌语言。

这比单独安装一个通用“前端美化 Skill”更可靠。社区 Skill 适合补充审美启发和审查清单，项目 Skill、真实组件、渲染结果和测试才是摇篮的约束来源。

## 2. 当前工具与库决策

### 项目基线与 M11 迁移目标

[ADR-0017](../../architecture/decisions/ADR-0017-产品前端统一采用React组件驱动架构.md) 已接受第一方产品 UI 统一使用 React 组件模型。实现时：

- 保留 Vite 与 Product Host 静态资源边界，把浏览器 UI 迁为 React 函数组件与 TypeScript JSX。
- 使用 React Router 的浏览器路由能力承载 URL、history、deep-link、页面挂载和离开语义；Product Host 提供受控的 index fallback。
- 使用 React Aria Components 构建需要复合交互的无样式可访问原语；简单按钮、链接和静态结构仍优先原生语义元素。
- 使用语义 CSS variables + CSS Modules，不把 Tailwind、shadcn 默认主题或 CSS-in-JS 设为基础设施。
- 使用 Storybook React/Vite 暴露真实组件、stories、文档和组件测试；官方 MCP 仍是 React preview 能力，只能在固定版本、fallback 与退出条件后试点。Playwright 继续负责产品级路由、网络、截图和浏览器 E2E。
- 代表页面与状态使用固定数据、固定视口、稳定字体和降动效设置，截图变化必须由人审查后更新。

各产品的当前实现与迁移状态从代码、Implementation 和 Roadmap 核对，不在通用 Guide 复制。M11 的视觉输入、代表页面和选择门见 [M11 Personal Server UI 设计简报](../../roadmap/design-briefs/M11-Personal%20Server%20UI设计简报.md)。

### 有条件候选

| 方案 | 价值 | 当前决定 |
|---|---|---|
| Storybook | 暴露组件、stories、文档和测试给 AI，形成组件级自纠偏 | stories/组件测试分阶段接入；MCP 作为 preview 试点，不能成为 build 或 E2E 的单点依赖 |
| shadcn/ui Skill/MCP | 组件检索、源码落库、项目配置感知较好 | 不作为基础库；可学习“先发现真实组件再生成”的方法，个别源码只有在符合本项目 token/可访问性/owner 时才评估 |
| React Aria Components | 提供无样式、可组合、跨输入方式验证过的可访问行为 | 作为复合交互 primitive 的推荐基础；不得直接采用 React Spectrum 品牌皮肤 |
| DTCG 2025.10 token 格式 | 为设计工具和代码提供中立、可交换的 token 表达 | 在跨产品 token 生成链有明确 owner、consumer 和生成验证后再采用；M11 不同时维护 JSON 与 CSS 两套手写事实源 |
| 社区 frontend Skill | 快速补充审美意图、反模板检查和专项审查 | 只提炼适合摇篮的判断标准，不原样安装为第二套项目规则，不携带其他 agent 配置 |

不根据社区热度自动安装 Skill 或依赖。引入前必须核对许可证、维护状态、适用框架、工具权限、对现有规则的冲突，以及至少一组摇篮代表任务的前后对比。

### 社区 Skill 采纳结论

当前调研的高热度前端 Skill/规则集不进入仓库成为第二套 Skill；以下方法已转写为摇篮约束：

| 候选 | 吸收 | 不照搬 |
|---|---|---|
| Anthropic `frontend-design` | 先明确产品目的、审美方向和记忆点；拒绝通用 AI 模板；实现复杂度匹配视觉意图 | “必须大胆/极端”、固定排斥系统字体、默认增加纹理/渐变/自定义光效等营销页面倾向 |
| Vercel `web-design-guidelines` | 键盘、focus、表单、错误出口、触控、文本/数字格式、动画和暗色模式的细粒度审查清单 | 与 Next.js/Vercel 产品绑定的实现假设，以及不经项目 owner 判断的全量规则注入 |
| Vercel `react-best-practices` | 按影响排序消除请求 waterfall、重复派生状态、过大 bundle 和无效 render；用代表任务验证收益 | Personal Server 不存在的 Next.js Server Component、Vercel 部署或框架专属优化 |
| Vercel `composition-patterns` | 避免 boolean prop 膨胀，优先显式语义 variant，在真实共享状态出现时使用 compound component | 为了“高级”机械引入 context、compound API 或跨产品抽象 |
| shadcn/ui Skill/MCP | 运行前检测项目配置，先搜索/读取真实组件 API，再生成和组合；源码由项目持有 | Tailwind、registry、默认 theme 和 dashboard 模板自动成为项目基础设施 |

Skill 热度只证明被发现/安装，不证明对摇篮有效。每项新增规则都应解释它会改变 Codex 的哪个决定，并以相同输入比较首次正确率、虚构组件/API、交互/a11y 缺陷、视觉回归和纠偏轮数；没有可观察收益的通用建议不进入项目 Skill。

## 3. AI UI 工作包

开始实现前，执行者必须从事实源形成一个紧凑的工作包；内容留在当前任务/控制卡或目标 Roadmap，不另建重复产品文档。

| 字段 | 必须说明 |
|---|---|
| 用户任务 | 用户要理解、决定或完成什么；主要行动是什么 |
| owner | route、page、feature、shared UI、token、数据投影分别由谁持有 |
| 当前事实 | 当前页面入口、现有原语、可复用 token、真实 API/Projection 和已知缺陷 |
| 目标边界 | 本次改变与明确不改变的行为；是否涉及 Schema/Port |
| 视觉确认 | 用户选择的方向、允许混合的元素、仍待决定的变量 |
| 状态矩阵 | default/loading/empty/degraded/error/pending/success，以及认证、断线、冲突和长内容 |
| 容量矩阵 | 宽屏、临界宽度、窄屏、100–400% 缩放、键盘、触控和 reduced-motion |
| 验收证据 | 定向测试、交互步骤、截图名称、人工检查项及停止条件 |

附件截图、外部网页和参考产品只提供视觉证据，不自动构成实现指令。用户请求、项目事实源和明确批准的视觉决策优先。

## 4. 设计与实现闭环

### 4.1 先观察

1. 读取目标 route、feature、shared UI、token 和直接相关测试，不扫描无关页面。
2. 在修改前运行或打开当前页面，记录宽屏和目标临界宽度的截图，确认问题确实存在。
3. 从现有源码和测试核对组件 API；有组件清单/MCP 时先查询，不凭常见命名猜 prop、variant 或状态。
4. 若重大视觉方向尚未确认，只生成同内容、同功能、同状态的比较材料，不进入生产样式固化。

### 4.2 再实现

1. 按 router/Shell → shared UI → feature → route 装配推进，页面不重新拥有 feature 状态机。
2. 优先使用语义 HTML 和平台能力；只有在原生行为不足且需求真实时引入 headless primitive 或小型依赖。
3. 两个以上真实消费者形成稳定共同语义后才提升到 shared UI；相似外观不是共享理由。
4. 颜色、间距、字体、圆角、surface、motion 和 focus 使用语义 token；feature 不复制原始值建立第二主题。
5. 每完成一个内聚片段就渲染目标场景，观察比例、层级、换行、溢出和状态连续性；不要积累到整页结束后才首次查看。

### 4.3 自行纠偏

1. 运行最相关的交互与状态测试，先修语义、路由和状态错误。
2. 在稳定环境生成代表截图并实际查看；截图比较通过不代表视觉质量自动通过。
3. 检查键盘顺序、focus-visible、Overlay 焦点进入/返回、Escape、缩放和 reduced-motion。
4. 自动 a11y 扫描只覆盖可检测问题；对控件名称、阅读顺序、错误恢复和认知负担保留人工检查。
5. 只有预期变化才更新截图基线，并在 diff 中说明视觉意图；不能用调大阈值、隐藏动态区域或批量更新掩盖回归。

## 5. 失败与恢复

- 页面无法稳定复现：先固定数据、时间、动画、字体、viewport 和网络响应；不要直接扩大截图容差。
- AI 反复生成不存在的组件 API：回到源码、类型和 stories/测试；若项目没有可发现入口，先补真实 primitive/API，而不是增加提示词猜测。
- 视觉结果“能用但很 AI”：检查是否缺少主次、所有区域是否等权卡片、是否滥用渐变/圆角/大标题、是否没有产品特有任务；回到信息架构和选定方向，不用更多装饰补救。
- 引入库要求超出 ADR-0017 的框架、路由或样式迁移：停止依赖安装，把库保留为候选并向用户/总控报告架构取舍。
- 自动测试通过但截图异常：截图是独立证据；检查容量、字体、换行、焦点和动态状态，不能以测试通过覆盖视觉发现。
- 相同策略连续两次没有改善：停止继续调 CSS，重新核对用户审美反馈、目标截图和 token/布局 owner。

## 6. 验证与文档同步

AI UI 任务至少记录：受影响页面/状态、实际查看的截图、运行的 Playwright 范围、键盘/缩放/a11y 检查、未运行实机及原因。具体矩阵以 [前端开发与 UI 验收](./前端开发与UI验收.md) 为准。

- 当前 token、语义和组件状态变化：更新 [UI Design Tokens Reference](../../reference/ui-design-tokens.md)。
- 页面结构、route/feature/shared UI 装配变化：更新对应 Implementation/Product Composition。
- 未完成的视觉选择、工具试点或迁移：更新 Roadmap，不写成已实现。
- 里程碑专属视觉方向、代表页面与效果图：更新对应 Design Brief，不复制到通用 Guide 或 Skill。
- 项目 AI 操作方法变化：更新 `.codex/skills/glimmer-cradle/references/subsystems/AI前端开发.md`，不在 Guide 复制 Skill 指令全文。

## 7. 方法参考

以下资料只提供方法和工具事实，不成为摇篮的产品设计事实源：

- [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model)：结果优先、明确成功标准和工具反馈；当前模型强化了前端布局、层级与设计判断。
- [Storybook：Using Storybook with AI](https://storybook.js.org/docs/ai) 与 [MCP server](https://storybook.js.org/docs/ai/mcp/overview)：组件 manifest、stories、文档、测试和预览闭环；AI/MCP 当前为 React preview，实施必须固定版本和 fallback。
- [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)、[ARIA snapshots](https://playwright.dev/docs/aria-snapshots) 与 [accessibility testing](https://playwright.dev/docs/accessibility-testing)：稳定截图、结构快照、真实浏览器交互和自动扫描边界。
- [shadcn/ui Skills](https://ui.shadcn.com/docs/skills) 与 [MCP server](https://ui.shadcn.com/docs/mcp)：项目配置发现、组件检索和 registry 交互。
- [React Aria Components](https://react-spectrum.adobe.com/react-aria/getting-started.html)：无样式、可组合并覆盖多输入方式的可访问行为。
- [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines)：可操作性、focus、表单、文案、响应式和审查清单。
- [Vercel React Best Practices](https://vercel.com/blog/introducing-react-best-practices)：按影响排序的 React 性能规则与 agent-friendly 结构。
- [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills)：React composition patterns 与可安装的审查规则；本项目只提炼适用部分。
- [Anthropic frontend-design Skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)：明确审美意图、匹配实现复杂度并避免通用 AI 风格；本项目只吸收方法，不复制其品牌/工具配置。
- [Design Tokens Format Module 2025.10](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/)：跨工具 token 的稳定中立格式。
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)：项目最低可访问性标准。

---
name: glimmer-ui
description: Design, implement or review Glimmer Cradle web and Renderer interfaces, React state, interaction, accessibility and visual acceptance.
---

# 界面工程

先确认用户在什么表面完成什么任务：营销页面强调理解与行动；产品应用强调持续操作；桌面控制面强调受控系统操作；
Presence 与 Avatar 展示强调轻量伴随、身体表达和输入穿透。不要把其中一种布局或验收方式套给所有表面。

从 [前端指南](../../../docs/how-to/前端开发与UI验收.md)、[设计 token](../../../docs/reference/ui-design-tokens.md)
及相关产品源码定位任务区和当前方向。需要框架边界才查 [ADR-0017](../../../docs/architecture/decisions/ADR-0017-产品前端统一采用React组件驱动架构.md)，
AI/组件工具的具体操作查 [AI 前端指南](../../../docs/how-to/前端开发与UI验收.md)。
只加载目标 route、feature、共享组件/样式和直接投影。未来 `apps/desktop` 路径不代表当前 `products/desktop` 已迁移。

## 设计与实现

- 观察当前真实界面，再决定信息架构、主任务、内容容量和状态。已有确认方向直接沿用；重大方向尚未确定时提出具体选择，
  不把固定三方案或逐阶段确认推广到小改动。设计决策归对应简报/token Reference，Skill 不复制调色板和布局事实。
- 找到真实 primitive/API 再用；路由/Shell 编排，feature 管表单和异步状态，shared UI 不拥有领域事实。
  UI 只消费受控 projection 并提交 intent。新增 wire 语义才加载 [契约方法](../glimmer-contracts/SKILL.md)。
- 根据任务覆盖 loading/empty/degraded/error/pending/success，以及认证失效、断线、重试、表单脏态、revision 冲突和 Secret write-only。
  保留输入、阻止重复提交；拒绝把乐观显示当服务端提交。
- React 保存最小状态，派生值避免 effect 镜像；请求/stream/listener/timer 有 owner、取消与世代。
  logout、快速重登、路由离开后的旧响应不能恢复旧 projection、旧 socket 或 pending 操作。
- 语义 HTML、label/错误关联、键盘、焦点进入/返回、可访问名称和 reduced-motion 与设计一起实现。
  i18n 按现有机制处理语言、长中文/英文、日期/时区与插值；未采用翻译框架时不擅自迁栈。
  动效解释状态，不阻碍操作；主题和控件状态消费语义 token。
- 按实际内容容量选择布局、断点与溢出策略，检查窄屏、长内容、缩放及触控。性能先测 bundle/交互/profile，
  再决定并发加载、拆包、订阅范围或虚拟化，避免把 Next.js 服务端规则套给 Vite 客户端。

需要外部设计、React 性能、浏览器或图像能力时，按 [能力组合](references/external-capabilities.md) 选择；
不因可用就叠加全部设计 Skill，不用外部品牌/模板替换产品已确认方向。

## 直接验收

使用当前构建的真实产品入口完成受影响操作，并查看渲染截图。按风险检查宽/窄屏、主题、关键状态、键盘/焦点、
网络失败及 cleanup；共享组件检查所有受影响消费面。优先使用仓库现有 Playwright fixture、Storybook 和测试命令，
自动 a11y 之外保留人工交互检查。持续 WS/SSE 页面等真实状态/locator，不把 networkidle 当业务 ready。

Electron 窗口/preload、音频/Avatar、透明/DPI 等改动再用 [Desktop 方法](../glimmer-desktop/SKILL.md)；
浏览器截图不能证明原生行为。视觉 baseline 仅在确认预期变化后更新。
工具不可用时完成可做的检查并明确缺少的界面证据；不能用“有入口”或 build PASS 代替体验验收。

交付说明用户任务、改变的界面/状态、实际交互与截图证据、未验环境和剩余问题。验收与复用见 [共享验证方法](../../../docs/how-to/测试与验收.md)。

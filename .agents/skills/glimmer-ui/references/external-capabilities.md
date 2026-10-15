# 外部界面能力组合

适用：界面任务需要现有专项设计、React 性能、浏览器或图像工具。先看本次会话能力清单，不把个人安装路径写入项目硬依赖。
下表是项目选择判断；实际启用后读取该 Skill 的当前正文及必要资源，用户明确要求优先。

| 需要 | 当前可组合能力 | 限制与回退 |
|---|---|---|
| 产品 UI 的层级、表单、状态、适配 | `impeccable` 或 `ui-ux-pro-max` 中一个匹配方法 | 核对工具副作用与产品现状；不自动产生第二份 PRODUCT/DESIGN 权威源或改变图标/技术栈 |
| 新视觉方向 | `frontend-design`；营销页可用 `design-taste-frontend` | 后者明确不适用 app screen；不把 hero、营销构图、随机 palette 用于控制面/Avatar |
| 动效与组件细节 | `emil-design-eng` 的相关判断 | 当前产品 token 与 reduced-motion 优先；不把某个毫秒、scale 或 spring 设为全项目标准 |
| React 请求与重渲染性能 | `vercel-react-best-practices` | 读取相关 rule；本项目 Vite 客户端不适用 Next/RSC/server-action 建议 |
| UI/a11y 审查 | `web-design-guidelines` 或相应 UI 方法 | 核对当前指南与真实页面；审查格式服从用户所需成果，自动规则不代替键盘/焦点 |
| 真实浏览器/截图 | 当前可用浏览器工具、`computer-use` 或适用的 `playwright` | 仓库已有 `@playwright/test` 产品 fixture 时用现有入口；CLI wrapper 可能通过 npx 获取包，先检查环境和授权 |
| 新 raster 资产/参考图编辑 | `imagegen` | 适用于位图；已有 SVG/图标系统优先直接修改，图像不证明真实交互或资产授权 |

重叠时按本次问题选方法，避免同时追随多套 house style。专项工具要下载二进制、写全局状态、添加 hook、安装插件，
或改变用户选定技术方案时，只使用已授权部分；按其文档允许的回退读取现有项目上下文。
调用缺失不构成停工理由，可用本项目指南、浏览器及官方框架文档完成相同目标。

核验外部脚本的来源、许可证、依赖、读取/写入、网络和清理行为后再决定是否运行。
研究和来源快照见 [研究记录](../../../../docs/governance/agent-workflow/research.md)，日常任务无需加载它。

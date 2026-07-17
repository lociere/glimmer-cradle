# UI Design Tokens Reference

> 范围：Control Center、Presence 和桌面表面的稳定视觉 token、工作台布局、交互状态与可访问性要求。
> 事实依据：`products/desktop/src/renderer/styles/`、`components/control-center/`、Playwright UI 测试。
> 维护触发：主题、token、页面域、工作台布局、窗口断点、组件状态或 UI 验收规则变化。

微光摇篮桌面 UI 是长期使用的角色工作台，不是营销首页、开发仪表盘或卡片墙。默认采用深色 Bubble 工作台，提供完整浅色与跟随系统主题；结构区域依靠连续底色、稳定间距和信息层级建立质感，交互控件再使用必要边界，不使用渐变、装饰光斑或大面积同色卡片堆叠。

## 物理结构

```text
renderer/
├── components/control-center/
│   ├── ControlCenter.tsx
│   ├── workbench/                 # 工作台壳、导航、用户界面偏好
│   ├── shared/                    # 无领域事实的基础 UI
│   └── pages/
│       ├── conversation/
│       ├── memory/
│       ├── character/
│       ├── avatar/
│       ├── capabilities/
│       ├── logs/
│       └── settings/
└── styles/
    ├── tokens.css
    ├── base.css
    ├── workbench.css
    ├── components.css
    ├── pages.css
    └── presence.css
```

旧 `renderer/styles.css`、页面聚合单体、主页、独立形象一级入口和诊断一级入口已经退出主线，不得恢复兼容壳。

## 主题 Token

| 类别 | 规则 |
|---|---|
| Canvas | 连续窗口基底，Frame、Rail 和桌面宽屏 Navigation 直接位于其上 |
| Frame | 顶部窗口栏，不显示产品文字、不绘制整条分界线；只有当前页签可有局部弱轮廓 |
| Rail | 最左活动轨道，直接位于 Canvas，只放六个一级域图标 |
| Navigation | 当前域的二级分区；桌面宽屏不抬升，窄窗覆盖时才成为浮层 |
| Workspace | 主阅读与操作 Bubble，拥有独立明度和 12px 结构圆角，不使用结构性描边或投影 |
| Surface | 真正的信息单元、表单组、列表详情和对话消息 |
| Overlay | 对话框与工具提示 |
| Accent | 当前选择、焦点和主操作；角色强调色不能代替系统状态色 |
| Semantic | 成功、警告、错误、信息各自独立，并同时使用文字或图标表达 |

`dark` 是默认主题；`light` 和 `system` 使用同一语义 token，不维护两套组件 CSS。工作台固定使用舒适密度，不提供密度开关；主题、减少动态效果、两侧栏宽度和上下文栏折叠状态属于工作台偏好，只能写入 localStorage，不得保存会话、记忆或运行事实。

## 工作台布局

Control Center 只有六个一级入口：对话、记忆、角色、能力、日志、设置。Avatar 归角色；语音状态、技能和扩展归能力；故障排除归设置高级；可读活动与模型链路归日志。

| 区域 | 规则 |
|---|---|
| Window Frame | 固定 42px；可拖动区与窗口按钮明确分离，不使用贯穿窗口的底边界 |
| Activity Rail | 固定约 52px；使用图标、选中指示与悬浮说明 |
| Section Navigation | 默认 216px，可在 184–300px 调整并持久化；不按窗口百分比缩放 |
| Main Workspace | `minmax(0, 1fr)`，内容最大宽度约 1160px；页面自己拥有滚动 |
| Context Inspector | 自动宽度为 `clamp(236px, 18vw, 320px)`，支持拖动、键盘调整和双击恢复自动；空间足够时并排，容量不足时按需成为右侧抽屉 |
| Narrow Layout | 当窗口不足约 900px 时分区导航成为显式打开的覆盖层；实际切换以主区最低容量为约束，不以设备类型判断 |

窗口缩放遵循“固定 Rail + 有界可调 Pane + 弹性 Workspace + 按容量折叠”。Inspector 是否并排由 Section Navigation 实际宽度、Inspector 期望宽度与 Workspace 约 540px 的最低可用宽度共同决定，不使用单个宽屏断点一刀切；并排时 Inspector 的可调上限随剩余空间收缩，拖动不得挤破主工作区或触发布局跳变。1024×640 是自动化常规最低验收尺寸，840px 额外验证双覆盖层，1148、1280 和 1536 验证三栏自适应且无横向溢出。

## 表面层级与动态效果

Control Center 使用三层表面，不允许所有区域获得相同描边、圆角和投影：

1. Canvas 层连续覆盖整个窗口；Frame、Activity Rail 和桌面宽屏 Section Navigation 不得被画成独立卡片。
2. Secondary 层用于 Context Inspector 和宽屏导航；Inspector 与主 Bubble 共用 12px 结构圆角，但只使用次级明度，窄窗导航成为浮层时才使用边界与阴影。
3. Workspace 层是主要 Bubble；四周必须露出 Canvas，深浅主题均通过明度差、12px 结构圆角和外部间距表达层级，不绘制结构性描边或阴影。

顶层页面和分区切换使用约 140ms 的纯淡入，不使用整页位移。导航悬停只改变颜色和底色，不移动控件；只有侧栏展开、对话框、上下文抽屉和新消息可在自身边界内运动。覆盖式侧栏必须支持显式按钮、点击遮罩和 `Escape` 关闭；宽屏上下文栏折叠后主工作区接管可用宽度。所有动态效果必须服从 `data-reduced-motion`，减少动态效果后持续时间降为近零。

## 页面职责

- 对话：默认入口，显示当前连续对话、文字/语音输入和受控上下文预览。
- 记忆：区分 Conversation、Moment、Episode、Memory 和知识，不把预览数量冒充实际召回。
- 角色：展示身份、人设、唤醒、声音和 Avatar；持久偏好跳转设置。
- 能力：消费 Skill Catalog、Extension Projection 与 Audio Projection；普通界面把 Skill Provider 表达为“能力来源”，`core` 显示为摇篮内置能力，技术 ID 只进入日志和高级诊断；扩展采用通用列表/详情管理，不硬编码 NapCat 等具体扩展。
- 日志：默认提供可筛选的结构化事件浏览器；“原始输出”使用同一受控投影提供终端式扫读，不让 Renderer 直接读取日志文件。交互链路、服务状态、文件位置与保留维护各自独立，不把所有诊断职责堆在一页。
- 设置：唯一持久配置入口，支持主题、多 Provider、语音、角色、隐私、数据和高级设置。

## 组件状态

所有可操作控件至少覆盖 `default`、`hover`、`pressed`、`focus-visible`、`disabled`、`selected` 和异步 `pending/success/error`。图标按钮必须有无障碍名称；不熟悉的图标提供悬浮说明；静态元素不得伪装按钮。

设置编辑必须有脏状态、保存、重置、失败文案和重启提示。Provider 支持新增、编辑、删除与当前选择；API Key 只从环境变量或 `configs/secrets/` 读取，Renderer 不读取、不回显。

Avatar 动作不得乐观翻转，必须等待 Avatar Host 权威状态；形象预览使用 Avatar Package 的受控公开资产。Renderer 不读取 Unity、模型文件、SQLite、原始配置或扩展目录。

## 视觉约束

- 控件和信息面板圆角不超过 8px；Workspace 与 Context Inspector 共用 12px 结构圆角，页面区域本身不是卡片。
- 顶栏、活动轨道和宽屏分区栏属于连续底层，不绘制贯穿边界或投影。
- 结构层不使用阴影表达高度；主 Bubble 依靠可感知的外部间隙、明度差和圆角轮廓建立层级。
- 不使用渐变、光斑、装饰性大图或嵌套卡片。
- 主内容标题适配工作台密度，不使用营销式巨型字号。
- 文字必须在 1024–1536px 验收视口内保持可读且不重叠。
- 深浅主题均使用独立表面层级和足够对比度；颜色不是唯一状态反馈。
- 网站式横向顶部导航、全局搜索和独立“诊断”产品入口不属于当前 Control Center。

## 验收

- `pnpm --filter @glimmer-cradle/desktop typecheck`
- `pnpm --filter @glimmer-cradle/desktop build`
- `cd products/desktop && pnpm test:ui`
- Playwright 截图覆盖四档窗口、六个一级域、深浅主题和 Provider 编辑。
- Electron 实机覆盖窗口按钮、侧栏拖动、主题持久化、preload 白名单和本机日志入口。

Presence 与 Unity/Native Avatar 的实机验收仍按 [Desktop 与 Avatar 实现](../architecture/implementation/Desktop与Avatar实现.md) 执行。

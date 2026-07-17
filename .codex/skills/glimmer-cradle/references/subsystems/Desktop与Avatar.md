# Desktop 与 Avatar

适用任务：Control Center、Presence、Electron main/preload、UI token、Avatar、Unity、Live2D/Cubism、Native Composition Host。

## 判断

Avatar 是 Character 本体的形象与身体领域；UnityAvatarHost 是具体进程；Desktop 是 Surface。Renderer 只消费受控投影，preload 是唯一桥，Native Composition Host 只管透明、命中、拖动、DPI 和多显示器。

## 实施顺序

1. UI 改动先看 token 和组件状态。
2. 本机能力先设计 preload 白名单。
3. Avatar frame 改动先走 Protocol。
4. Unity/模型能力通过 catalog、actionsPath、behaviorPath 和 driver，不写死文件或参数。
5. `host_hello` 与 `host_ready` 分开；只有首帧和交互准备完成才 ready。
6. Unity 代码遵守 `Contracts / Domain -> Application、Infrastructure -> Host -> Editor` 的 asmdef 单向依赖；SDK 只从本机供应包经 `projectionScopes` 白名单投影。

## 禁止项

Renderer 直接读配置/数据/Unity 文件；privileged IPC 绕过 sender/main-frame 校验；关闭 context isolation 或 sandbox；Unity 首选时 Presence 静默显示另一套身体；颜色键或动态 `setShape()` 冒充正式透明合成；UI 乐观翻转动作状态；高频拖动/鼠标流写主日志。

验证 Playwright、Electron 实机、Unity/Avatar 打包版、透明/DPI/多显示器/拖动/动作/口型/退出。

## 常见入口

Desktop 看 `products/desktop/src/main/`、`preload/`、`renderer/`、`components/control-center/`、`host/useDesktopHost.ts`。Avatar 看 `core/avatar/unity-host/Assets/Scripts/Avatar/`、`native/src/composition/`、Kernel avatar controller。

## 交付检查

UI 状态是否覆盖 loading/degraded/error；preload 是否最小白名单；动作状态是否以 Avatar Host 上报为准；Avatar 是否打包版验证；日志是否没有高频帧刷屏。

## UI 质量门

新增控件必须有 hover、pressed、focus-visible、disabled、loading/error。窗口动作必须通过 preload。配置编辑必须有校验、脏状态、保存结果和需要重启提示。不要把诊断页做成原始日志倾倒。

## 何时实机验证

凡是涉及窗口、透明、DPI、多显示器、拖动、录屏、Unity、Native、音频播放，都不能只靠类型检查或浏览器截图。至少说明是否完成 Electron/Unity/打包版实机验证。

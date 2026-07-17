# 桌面与 Avatar 开发

> 适用场景：修改 Control Center、Presence、Electron main/preload、renderer store、录音/播放、Avatar、Unity/Live2D、Native Composition、窗口行为或桌面状态投影。
> 前置条件：已读 [Desktop 与 Avatar 当前视图](../../architecture/current/07-子系统当前视图/Desktop与Avatar.md) 与 [Desktop 与 Avatar 实现](../../architecture/implementation/Desktop与Avatar实现.md)。

## 改动路径

| 任务 | 主要文件/目录 |
|---|---|
| Electron main/window/tray | `products/desktop/src/main/` |
| preload 白名单 | `products/desktop/src/preload/index.ts` |
| Control Center | `renderer/control-center.tsx`、`renderer/components/control-center/` |
| Presence | `renderer/presence.tsx`、`renderer/components/PresenceSurface.tsx` |
| UI store/host | `renderer/store/`、`renderer/host/useDesktopHost.ts` |
| 录音/播放 | `renderer/audio/` |
| Avatar renderer bridge | `renderer/avatar/`、`renderer/components/avatar/` |
| Unity Avatar | `core/avatar/unity-host/Assets/Scripts/Avatar/` |
| Avatar build/setup | `Assets/Scripts/Avatar/Editor/` |
| Unity SDK 投影 | `avatar-sdk-catalog.json`、`scripts/lib/unitypackage-projector.mjs` |

## 标准步骤

1. 判断改动属于 Avatar Domain、UnityAvatarHost、Desktop Surface 还是 Native Composition。
2. 如果消息跨 Kernel/Desktop/Avatar，先确认 Protocol frame 是否需要变更。
3. Renderer 只消费 preload API 和 Kernel 投影；不要直接读配置、路径或内部 service。
4. UI 状态使用 ready/degraded/waiting/error 的统一语义。
5. Avatar 以 `host_ready` 和首帧 present 作为 ready 条件。
6. 涉及 native/Unity/窗口的改动必须设计实机验证。
7. 同步 Implementation、Reference 或 UI token 文档。

## Avatar 关键规则

- `host_hello` 只是连接建立。
- `host_ready` 必须表示 catalog、SDK、model driver、Composition Host 和首帧都完成。
- Presence 不能伪装成复杂身体 ready。
- Unity 模型导入、StreamingAssets 和构建产物是投影，不是手工事实源。
- `.unitypackage` 供应包只能通过 catalog `projectionScopes` 投影；不得手工复制到 `Assets/Live2D`，也不得绕过 SHA-256 投影戳。
- `Contracts / Domain` 不反向引用 Host；Application 与 Infrastructure 并列，只有 Host 负责组装，Assembly Definition 是强制边界。
- 透明、DPI、多显示器和命中归 Native Composition，不用普通透明 WebView 替代。

## Control Center 关键规则

- Control Center 是状态、配置、诊断和轻量交互入口，不是系统事实源。
- Renderer store 是投影副本，不能覆盖 Kernel snapshot。
- preload 只暴露最小白名单 API。
- 音频输入失败只影响 ASR/语音输入状态，不伪造 Cognition 回复。
- 诊断按钮只能打开受控路径或受控投影。

## 常见失败与定位

| 症状 | 检查 |
|---|---|
| 页面白屏 | main/surface loader、preload、renderer console、资源路径 |
| 状态不刷新 | host subscription、store、Kernel projection |
| 录音无结果 | recorder、preload、artifact、AudioService、ASR log |
| Avatar 连接但不动 | downstream frame、BehaviorController、ActionScheduler、model driver |
| Avatar 不透明/穿透异常 | CompositionHost、native log、DPI、hit test |
| 打包版路径错 | resolver、packaging layout、安装投影 |
| `dev:electron` 提示 5173 被占用 | 先确认 `http://127.0.0.1:5173/presence.html` 是否来自当前 Desktop Vite；可用时启动器会复用，非当前 Vite 或不可访问时需要关闭占用进程 |

## 验证

```powershell
pnpm --filter @glimmer-cradle/desktop typecheck
pnpm typecheck
```

Avatar/窗口/音频改动按风险补充：

```powershell
pnpm avatar:doctor
pnpm avatar:build
pnpm dev
```

必须人工确认：托盘、窗口呼出、preload API、状态投影、录音/播放、Avatar 首帧、透明/命中、DPI、多显示器、退出回收。无法实机时交付说明要写明未验证条件和剩余风险。

## 需要同步的文档

Avatar/Host/Surface 边界更新 Current；代码链路更新 Implementation；Protocol frame 更新 Reference；操作变化更新 Guides；视觉 token 更新 `reference/ui-design-tokens.md`。

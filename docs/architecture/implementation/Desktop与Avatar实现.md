# Desktop 与 Avatar 实现

> 范围：Electron Desktop Surfaces、preload、renderer、音频 UI、Avatar、Unity SDK 和 Native Composition 如何在代码中落地；不写视觉 token 全表。
> 源码依据：`products/desktop/src/`、`core/avatar/unity-host/Assets/Scripts/Avatar/`、`assets/avatar/`、Kernel control-surface/avatar capability、Protocol Presentation Plane。
> 维护触发：Electron main/preload/renderer、Control Center、Presence、Avatar frame、Unity SDK、Live2D driver、Native Composition、音频播放或状态投影变化。

## 目录

- [Electron Desktop 入口](#electron-desktop-入口)
- [Renderer 结构](#renderer-结构)
- [Desktop 入站链路](#desktop-入站链路)
- [Desktop 出站链路](#desktop-出站链路)
- [Unity Avatar 入口](#unity-avatar-入口)
- [Avatar readiness 实现点](#avatar-readiness-实现点)
- [调试入口](#调试入口)
- [验证](#验证)

## Electron Desktop 入口

| 入口 | 职责 |
|---|---|
| `products/desktop/src/main/index.ts` | Electron main 启动入口 |
| `main/desktop-shell.ts` | 桌面 shell、窗口与生命周期管理 |
| `main/surface-registry.ts` / `surface-loader.ts` | Control Center、Presence 等 surface 注册与加载 |
| `main/project-paths.ts` | Desktop main 的 repo/data/config/state/packages/observability resolver |
| `main/avatar-paths.ts` | UnityAvatarHost project、Avatar Package Registry、SDK catalog、Host 包路径 resolver |
| `main/ipc-handlers.ts` | 受控 IPC handler |
| `main/ipc/desktop-ipc-router.ts` | 统一注册 privileged IPC；只接受已登记 BrowserWindow 的 main frame |
| `main/tray-controller.ts` | 托盘入口 |
| `preload/index.ts` | renderer 白名单 API |

Electron main 可以接触 OS、窗口、托盘和受控文件路径；renderer 不能直接使用 Node API，也不能读取 Kernel 内部对象、原始配置或 Cognition DB。所有 BrowserWindow 开启 context isolation 与 sandbox，禁止 renderer 自主创建窗口、附加 webview 或导航到其他页面；privileged IPC 统一经过 `DesktopIpcRouter`，同时校验已登记的 WebContents 和 main frame。`main/project-paths.ts` 负责把 `GLIMMER_CRADLE_APP_ROOT` / `GLIMMER_CRADLE_REPO_ROOT` / `GLIMMER_CRADLE_DATA_ROOT` 与开发态、打包态种子目录统一折叠成 repo/data/config/extensions 根，再由 `main/avatar-paths.ts` 收口 Unity project、StreamingAssets/Avatar Package Registry、SDK catalog、受管 Host 包和诊断日志路径；`ipc-handlers.ts` 只消费这些 resolver，不再散落 `data/packages/avatar`、`avatar-sdk-catalog.json` 或 Unity 工程目录拼接。

## Renderer 结构

| 路径 | 职责 |
|---|---|
| `renderer/control-center.tsx` | Control Center 入口 |
| `renderer/presence.tsx` | Presence 入口 |
| `renderer/components/` | Presence、Avatar Picker 等跨页面 UI 组件 |
| `renderer/components/control-center/ControlCenter.tsx` | 六个一级域的唯一组装入口 |
| `renderer/components/control-center/workbench/` | Bubble 工作台壳、一级/二级导航与界面偏好 |
| `renderer/components/control-center/pages/` | 对话、记忆、角色、Avatar、能力、日志、设置的独立领域页 |
| `renderer/components/control-center/shared/` | 不拥有领域事实的基础 UI 组件 |
| `renderer/styles/` | token、base、workbench、component、page、presence 六层样式事实源 |
| `renderer/components/control-center/view-models.ts` | Control Center 运行时 ViewModel；统一消费 Kernel/Desktop projection 并派生页面状态 |
| `renderer/store/` | 本地 UI store，保存投影副本，不是事实源 |
| `renderer/host/useDesktopHost.ts` | 订阅 Kernel/Desktop 状态投影 |
| `renderer/audio/` | 录音、播放、envelope 播放 |
| `renderer/avatar/` | Desktop 对 Avatar Projection 的视图适配；不拥有 Avatar |

Renderer 只呈现投影。若 store 与 Kernel snapshot 冲突，以 Kernel snapshot 为准；store 只能缓存 UI 状态，不能推断 ready。

Control Center 的正式工作台结构由 `ControlCenterShell` 承载：顶部 Window Frame 负责窗口控制和当前位置；最左 Activity Rail 固定为对话、记忆、角色、能力、日志、设置六个一级域；Section Navigation 只列当前域的二级分区并支持 184–300px 调宽、显式收展和窄窗覆盖层；主工作区拥有页面滚动；约 252px 的 Context Inspector 只在 1380px 以上宽屏出现，并与主 Workspace 共用 12px 结构圆角。Avatar 归角色，语音/扩展/技能归能力，故障排除归设置高级，不再维护主页、独立形象或诊断一级入口。工作台固定使用舒适密度；主题、减少动态效果和侧栏宽度是 Renderer 本地界面偏好，不保存任何会话、记忆或运行事实。

Control Center 的受控设置草稿由 `components/control-center/useControlCenterSettings.ts` 在 Shell 层持有，并只交给设置页作为持久化编辑入口。设置页支持通用、外观、对话、模型服务、语音服务、角色、隐私与权限、数据和高级；模型服务采用多 Provider 列表，支持新增、编辑、删除和当前 Provider 选择，密钥仍只进入环境变量或 `configs/secrets/`。能力页消费 `audio_status`、Extension Host Projection 和 `getSkillCatalog()` 展示语音、扩展、技能和自动化；扩展采用通用列表/详情管理，不硬编码具体扩展 UI。`components/control-center/view-models.ts` 负责把 Skill Catalog、Extension Projection、Avatar 诊断和动作状态折叠成页面 ViewModel，各领域页只渲染并发送 intent。

形象页由 `AvatarPage` 提供大预览、模型选择、显示比例、桌面驻留和手动动作；`ControlCenter` 在 renderer store 中更新草稿，并通过 `window.desktopHost.setAvatarAppearance()` 写回 Electron main，切页、卸载和显式提交都会 flush 待保存形象状态。预览图来自 `assets/avatar/avatar-packages/*/avatar-package.json` 的 `previewImagePath`，由 `scripts/sync-assets.mjs` 投影到 renderer public 目录，只作为 Control Center Web 预览，不代表 Avatar 正式渲染资产。当前形象主线以 Kernel 广播的 `character_presentation_projection` 为准：`renderer/host/useDesktopHost.ts` 负责首取和订阅，再写入 `renderer/store/appStore.ts`；Control Center、Presence 和 Unity Avatar 都消费同一份身体形象投影，renderer 不再直接拼 `models.json` 或本地文件事实。形象页和 Optional Inspector 的 SDK、Avatar Package Registry、Host executable、工作目录状态优先读取 `runtime_readiness` 中 `avatar.host.reconciler.resources`，只有 Kernel 投影尚未到达时才使用 `getAvatarDiagnostics()` 作为本机路径与打开位置回退；本地 diagnostics 不是形象 ready 的事实源。动作状态以 Avatar Host 回报和重新读取结果为准，不做乐观翻转。Electron main 在发送 toggle 动作前按模型动作 catalog 校验依赖、互斥和操作类型，接受后按 `protocol/src/schemas/models/AvatarActionStateDocument.schema.json` 把唯一持久字段 `active_action_ids` 写入 `data/state/avatar/action-state.json`；Kernel 启动 UnityAvatarHost 时把 `GLIMMER_CRADLE_AVATAR_ACTION_STATE_PATH` 指向同一文件。Avatar 上报 `avatar_action_state` 后会覆盖该投影，因此重启时先恢复最后接受状态，再由真实 Avatar 状态校正；Kernel 在本轮尚未收到 Avatar 状态时保持 `null`，不向 Desktop 广播伪造的空快照。读写失败进入 Avatar process log，不再静默吞掉。

对话页由 `pages/conversation/ConversationPage.tsx` 承载当前连续对话、语音输入和上下文预览。`getMemoryPreview()` 从 owner 的只读数据库构造受控快照，明确区分 Conversation 消息、Experience Moment、长期 Memory revision 和角色知识；Conversation 消息来自可重建 `conversations.db`，不冒充 Memory。Renderer 只缓存当前界面的临时输入和消息流，不持久化历史会话，也不读取 SQLite 或本地路径。

日志页由 `pages/logs/LogsPage.tsx` 承载活动与模型链路、服务状态和日志文件入口。Electron main 在有界读取内合并结构化事件索引与 Kernel、Cognition、Audio、Avatar 进程日志尾部，再通过 preload 白名单投影最近事件；“原始输出”只是同一投影的终端式排版，Renderer 不直接读取日志文件。页面用健康投影展示 Desktop UI、Kernel、Cognition、Audio、Avatar 和 Extension Host 的当前链路；日志入口只调用 `openDiagnosticLocation()` 的预定义位置，维护操作通过受控 Observability API 执行。

## Desktop 入站链路

```text
用户点击/输入/录音
  -> React component
  -> preload API
  -> Electron main ipc-handlers
  -> Kernel ControlSurfaceGateway / PerceptionAppService / AudioService
```

录音输入的特殊链路：

```text
VoiceRecorder
  -> preload audio input
  -> Electron main
  -> data/work/audio/asr/*.wav
  -> Kernel AudioService.recognizeSpeech()
  -> Audio Engine ASR lane
  -> transcript projection
  -> PerceptionAppService
```

ASR 失败只影响语音输入状态，不生成 Cognition 语义失败。

## Desktop 出站链路

```text
Kernel projection
  -> Electron main/preload subscription
  -> renderer host/store
  -> Control Center / Presence
  -> audio playback / avatar projection
```

`reply`、`thought`、`emotion`、`runtime_readiness`、`audio_status`、`avatar_status` 是不同投影。Renderer 不把 thought 写成聊天消息，不用本地 fallback 覆盖 shell 状态。`runtime_readiness` 来自 Kernel `RuntimeReadinessCatalog`：Electron main 只缓存并转发，日志页和 Avatar 页消费真实服务与资源协调投影，不把“形象 / 扩展 / 语音 / 对话”写死成静态状态。

音频 UI 只消费 `audio_status` 与 `configs/system/audio.yaml` 的受控投影。TTS/ASR 关闭时 Kernel 不预热对应资源，业务请求返回明确错误，Control Center 显示关闭状态而不是 provider 故障。

第三方平台消息不会直接进入 Avatar。实际链路是：

```text
Extension Adapter perception
  -> Cognition ActionCommand / state projection
  -> Adapter remote delivery / experience / memory
```

本地身体形象链路单独收口：

```text
local surface scene (`scene:desktop-ui:*` / `conversation:desktop-ui:*` / `scene:avatar:*`)
  -> ActionStream
  -> VisualCommandDispatcher
  -> AvatarController
  -> Avatar frame
```

因此来自 NapCat、Discord 或其他 Extension 的消息可以让当前角色在对应平台自主回复，并进入经历/记忆；但默认不让本地人物跟着远端消息表情或动作变化。若未来允许扩展贡献模型或动作，也必须通过 manifest contribution、权限和 Avatar catalog，而不是直接发渲染指令。

## Unity Avatar 入口

| 文件 | 职责 |
|---|---|
| `Host/UnityAvatarHostBootstrap.cs` | UnityAvatarHost 启动与 wiring |
| `Host/AvatarProtocolClient.cs` | 与 Kernel Presentation Plane 的协议连接 |
| `Contracts/PresentationFrames.g.cs` | 由 Presentation Frame Schema 自动生成的 Unity 上下行模型，只读 |
| `Domain/` | Avatar Package、行为、模型描述与模型驱动契约 |
| `Application/` | 动作调度、连续行为求值和空闲动作策略 |
| `Infrastructure/Cubism/` | Cubism/Live2D driver、资源注册与模型清单读取 |
| `Host/AvatarLive2DController.cs` / `AvatarBehaviorController.cs` | 组装 Application 与 Infrastructure，拥有 Unity 生命周期 |
| `Host/AvatarCompositionHost.cs` | Native Composition Host 边界 |
| `Editor/UnityAvatarHostBuild.cs` | 构建辅助 |

Unity 只消费 Avatar 协议和模型 catalog 投影，不读取 Kernel 内部配置。项目 Assembly Definition 固化 `Contracts / Domain -> Application、Infrastructure -> Host -> Editor` 的单向引用；只有 Infrastructure 可以引用第三方 `Live2D.Cubism`。`protocol/codegen/gen-cs.ts` 从 `PresentationDownstreamFrame.schema.json` 与 `PresentationUpstreamFrame.schema.json` 生成 `PresentationFrames.g.cs`，手写 frame 镜像已经删除。模型投影和 StreamingAssets 是构建/同步产物，不是手工事实源。

Kernel Avatar WebSocket 绑定动态回环端点，并通过 `GLIMMER_CRADLE_AVATAR_WS_URL` 注入受管 Unity Host；`avatar-host.json` 不保存端口。Desktop main 同样从 `data/run/host/endpoints.json` 发现 `control-surface`，校验 owner PID 和回环地址后连接。开发态 `dev-electron.mjs` 等待同一目录，不保留独立固定端口逻辑。

Cubism `.unitypackage` 是 `data/packages/avatar-sdks/` 下的本机供应包。`scripts/lib/unitypackage-projector.mjs` 在 Unity 启动前解析包内容，只把 catalog `projectionScopes` 明确允许的目录树或单文件写入工程，保留 `.meta` GUID；供应包 SHA-256、SDK 版本、投影规则和投影器版本共同形成 `Library/GlimmerCradle/sdk-projections/` 下的有效性戳。版本标记与有效性戳不同时先使旧戳失效再重建，避免 Unity 在依赖尚未导入时先编译项目代码，也不把中断残留当作完整 SDK。

## Avatar readiness 实现点

| 阶段 | 实现关注 |
|---|---|
| process start | Kernel Host/手动进程策略、process log |
| `host_hello` | `AvatarProtocolClient` 连接建立 |
| catalog/SDK | `AvatarModelRegistry`、`AvatarBehaviorProfile`、StreamingAssets 投影 |
| model driver | `IAvatarModelDriver` 实现、Cubism 资源 |
| composition | `AvatarCompositionHost`、native surface、DPI/命中 |
| first frame | PresentationController/Composition 首帧 |
| `host_ready` | 只有前置都完成才回报 ready |

`host_hello` 和 `host_ready` 不能混用。`host_ready` 必须包含 `avatar_package_id`、`worker_window_state`、`composition_surface_state`、`first_frame_presented`、`interaction_ready` 等正式 gate；Presence 只能显示等待或降级，不能替代正式身体宣称 ready。内置 Avatar Package 只保留 Unity Live2D 正式身体；Q 版 sprite 占位不再作为 Control Center 或 Presence 的正式渲染路径。
Windows 受管启动先运行同包内的 `UnityAvatarHostLauncher.exe`。原生 launcher 在 Unity 子进程恢复执行前注册窗口创建事件，Unity HWND 一出现就被改成透明、无激活、移出屏幕的 tool window；这样 Player 可以继续完成场景和图形初始化，但不会进入正常可见窗口/任务栏流程。Launcher 在恢复 Unity 前把它分配到启用 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的 Windows Job Object，并通过 Kernel 注入的 supervisor PID 同时监视父进程；Kernel 正常停机、Launcher 崩溃或 Kernel 被强制回收时，Job handle 都会关闭，Unity 与 CrashHandler 子树由操作系统一并终止，不得成为桌面残留。`AvatarCompositionHost` 在调用 `Screen.SetResolution` 前再次隔离容器窗口。Native Composition 窗口才是当前 Desktop Composition Surface，Unity worker 不允许在脚本接管前短暂出现在左上角。
Unity 侧由 `AvatarPresentationController` 锁存首帧呈现事件，再由 `AvatarProtocolClient` 读取 `HasPresentedFirstFrame` 作为正式 ready gate；不得仅凭 native host 的瞬时 present 查询就抢先发送 `host_ready`，否则会出现 `first_frame_presented=false` 的伪 ready。
Kernel `AvatarController.getReadinessSnapshot()` 现在还会把 `avatar.package-registry`、`avatar.host.executable`、`avatar.host.working-dir` 和 `avatar.sdk.*` 等资源缺口合并进 `avatar.host.reconciler.resources`。Control Center 的角色 > 形象状态直接展示这些 non-ready 资源，不再只靠 Electron main 本地文件扫描决定“缺 SDK / 缺构建产物 / 缺 Avatar Package Registry”。

## 调试入口

| 症状 | 先查 |
|---|---|
| Control Center 空白 | Electron main、surface loader、preload、renderer console |
| UI 状态不更新 | preload subscription、renderer store、Kernel projection |
| 录音无转写 | VoiceRecorder、artifact 路径、AudioService、ASR process log |
| Avatar 连接但不显示 | `host_hello`、catalog、model driver、composition host、首帧 |
| 透明/穿透异常 | Native Composition、DPI、多显示器、命中策略 |
| 打包版正常开发版异常或反之 | resolver、安装投影、assets/packages 路径 |

## 验证

```powershell
pnpm --filter @glimmer-cradle/desktop typecheck
pnpm typecheck
```

Avatar 相关改动按风险补充：

```powershell
pnpm avatar:doctor
pnpm avatar:build
```

窗口、托盘、透明、DPI、多显示器、Unity 首帧、音频播放和打包版路径不能只靠 typecheck 验证。
2026-07-05 实机启动记录显示：`connected -> host_hello -> 首帧 ready -> host_ready` 顺序已成立，且未再出现 `first_frame_presented=false` 的 `host_ready` 误报。

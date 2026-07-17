# UnityAvatarHost

`core/avatar/unity-host/` 是微光摇篮当前的 Unity/Cubism Avatar Host。Avatar 属于 Character 本体；本目录只承载具体模型驱动、渲染后端、Host 协议和进程资源，不定义人物身份，也不拥有 Desktop Surface。

## 边界

- UnityAvatarHost 连接 Kernel `ws://127.0.0.1:8082`，只收发 `PresentationUpstreamFrame` / `PresentationDownstreamFrame`。
- Unity 不读取 `configs/`，不调用 Cognition，也不负责管理面板。
- Kernel 只理解稳定的身体语义，不泄露 Unity 或 Cubism 对象。
- `host_hello` 仅表示进程已连接；`host_ready` 只在 Cubism 模型、正式驱动、Composition Host 与首帧呈现均就绪后发送。

## 正式模型主线

`assets/avatar/avatar-packages/*/avatar-package.json` 是身体资产包的唯一 catalog，角色源文件只应放在对应 Avatar Package 声明的 `assetRootPath` 下。不要把角色名、文件名或动作文件路径写进 C#、场景或 Kernel。

`pnpm sync:unity-assets` 会生成两类投影：

1. `Assets/StreamingAssets/avatar-package-registry.json` 与 `StreamingAssets/avatar/<model-id>/avatar-actions.json`：体积很小的运行时元数据。
2. `Assets/Resources/AvatarModels/<model-id>/`：Unity 的可导入模型源。Cubism SDK 会在这里生成 `<model>.prefab`。

`CubismAvatarModelDriver` 只按 `resourceKey` 加载这个 prefab，直接驱动 `CubismModel`、`CubismParameter` 与 `CubismExpressionController`。缩放始终相对 prefab 的原始 transform 计算，不会在拖动或重复配置时累乘。当前发行路径使用 Resources，模型数量或远程分发需求扩大时可以在同一 catalog 投影边界换为 Addressables，不改变协议、模型 ID 或 Kernel。

项目代码通过 Assembly Definition 固化 `Contracts / Domain → Application、Infrastructure → Host → Editor` 的单向依赖。Contracts 只定义 Host 帧，Domain 只定义身体模型与规则，Application 负责动作和连续行为求值，Infrastructure 适配 Cubism 与资产读取，Host 才拥有 Unity 生命周期、协议连接、窗口合成和音频。第三方 `Live2D.Cubism` 只允许由 Infrastructure 引用。

正式 Avatar 只支持 Cubism 4/5 的 `model3.json` / `.moc3` 资产。Cubism 2/3 已不在正式支持范围内；缺少可用 SDK 或 prefab 时必须报告 degraded，不能降级为静态贴图并伪造 Live2D ready。

## Unity 基线与供应包

- Unity Editor：`6000.0.77f1`
- 渲染管线：URP `17.0.3`
- Live2D SDK：Cubism SDK for Unity `5-r.5 (URP)`

供应包位于 `data/packages/avatar-sdks/cubism-sdk-for-unity/`，不提交到 Git。`pnpm avatar:build` 会在 Unity 启动前解析 `.unitypackage`，只允许资产写入 catalog 的 `projectionScopes` 白名单，并保留供应包中的 `.meta` GUID。目录树与单文件授权分开声明，不会为了 SDK 编译响应文件而开放整个 `Assets`。被忽略的 `Assets/Live2D/Cubism/` 是可重建投影，不是第三方 SDK 事实源。`UnityAvatarHostProjectSetup` 负责创建并绑定唯一的 URP pipeline asset，避免每个场景或开发者机器各自维护一份渲染事实。

## 构建与运行

```powershell
pnpm avatar:sync
pnpm avatar:doctor
$env:UNITY_EDITOR = 'D:\Program Files\Unity Hub\Editor\6000.0.77f1\Editor\Unity.exe'
pnpm avatar:build
pnpm dev
```

构建产物位于 `build/components/avatar/unity-host/windows-x64/`：Kernel 通过 `AvatarRuntime` 以 managed Host 方式拉起 `UnityAvatarHostLauncher.exe`，launcher 隔离 Unity worker 窗口后再运行同包内的 `UnityAvatarHost.exe`，停机时按同一进程树回收；`manual` 只用于 Unity Editor 调试。

## 身体呈现与交互

模型 catalog 可以声明 `presentation`（`bust`、`three-quarter`、`full-body`）与 `actionsPath`。Control Center 将显示大小、桌面驻留和恢复默认位置作为 `avatar_presentation` 请求发送给 Kernel，Unity 接收 `presentation` 后执行：

1. 模型驱动始终把完整身体以 `contain` 方式装入相机；`display_scale` 只调整完整透明表面尺寸。
2. 按 `placement_id` 选择完整身体透明表面的桌面驻留位置。
3. `AvatarBehaviorController` 统一编排永久身体基线、空闲行为和短暂指针注意力；鼠标静止后会自然释放视线通道。
4. 仅在 `reset_placement` 时清除 `data/state/desktop/avatar-placement.json` 并重新停靠。

完整模型从不被视觉裁剪。默认半身只是透明窗口下缘位于工作区外；用户拖动时只移动一个原生窗口并持久化位置，不重载模型、不改变缩放、不重建 renderer。

动作和模型内置交互由 `avatar-actions.json` 的稳定语义 ID 映射到模型表达式或动作资源。新增模型时修改 catalog 与动作清单，再执行同步和构建；不要在代码中增加角色专用分支。

## 验证

```powershell
pnpm avatar:build
```

构建成功至少意味着：URP、Cubism SDK、模型资源导入、`CubismAvatarModelDriver` 和 Windows Player 已完成编译。随后仍要用实际 `pnpm dev` 验证 Kernel 连接及 `connected → host_hello → first frame presented → host_ready` 顺序，并继续检查拖动、透明命中、表情、口型和多显示器缩放。

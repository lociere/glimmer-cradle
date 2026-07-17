# Desktop 与 Avatar 当前视图

> 范围：Avatar 本体领域、UnityAvatarHost、Electron Desktop Surfaces 与 Native Composition 的当前边界。
> 事实依据：`core/avatar/`、`products/desktop/`、`assets/avatar/`、Protocol Presentation Plane、Kernel Avatar lifecycle 与 `native/composition`。
> 维护触发：Avatar Package、Host、Surface、Presentation Frame、Unity/Live2D、Native Composition、UI 投影或 readiness 变化。

## 分层

```text
Character
└── Avatar                         # 人物本体的形象与身体领域
    ├── Avatar Package             # 模型、动作、行为与资源声明
    ├── Avatar State               # 当前模型、动作和呈现意图
    ├── Avatar Controller          # Kernel 侧领域入口
    └── UnityAvatarHost            # 当前具体承载进程
        ├── Cubism Model Driver
        ├── Unity Render Backend
        └── Avatar Protocol Client

Surfaces                           # 人物出现和用户交互的位置
├── Control Center
├── Presence
└── Desktop Composition Surface
```

Avatar 属于 Character，不是 Surface 或 Extension。UnityAvatarHost 只是当前实现容器；NativeCompositionHost 只把渲染帧放到桌面 Surface。

## 物理结构

```text
core/avatar/unity-host/
└── Assets/Scripts/Avatar/
    ├── Domain/
    ├── Application/
    ├── Infrastructure/Cubism/
    ├── Host/
    └── Editor/

products/desktop/src/
├── main/
├── preload/
└── renderer/
```

Kernel 使用独立 `AvatarRuntime` 监督 Avatar Host；`PresentationRuntime` 负责 ActionStream、Presentation 路由和 Desktop Surface。Windows Native Launcher 通过 kill-on-close Job Object 持有 Unity 与 CrashHandler 整棵子树，父进程异常结束也不能留下 Live2D 窗口。`configs/system/avatar.yaml` 与 `configs/system/surfaces.yaml` 分别由 Avatar 与 Surface owner 消费。

## 边界

| 构件 | 拥有 | 不拥有 |
|---|---|---|
| Avatar | Package、状态、动作、行为、模型语义 | 人格、记忆、Desktop 窗口 |
| UnityAvatarHost | Unity/Cubism 驱动、GPU 帧、Host 协议与进程资源 | Character 身份、Surface 配置 |
| Desktop Surface | 窗口、托盘、Control Center、Presence、preload | Avatar 模型和动作事实 |
| NativeCompositionHost | alpha、命中、拖动、DPI、多显示器、首帧 present | Avatar 行为和 UI 状态 |
| Kernel | 生命周期、路由、Projection、readiness | Unity/Cubism 私有对象 |

## Presentation Plane

| 方向 | 契约 | 语义 |
|---|---|---|
| Desktop/Host -> Kernel | `PresentationUpstreamFrame` | 用户输入、Avatar intent、Host 生命周期与错误 |
| Kernel -> Desktop/Host | `PresentationDownstreamFrame` | reply、emotion、Avatar 控制、状态与 Projection |
| Kernel -> 所有呈现出口 | `character_presentation_projection` | 当前 Avatar、显示意图与 lifecycle 的只读投影 |

Desktop 与 UnityAvatarHost 可以消费同一 Envelope，但不共享 Electron、Unity 或 Cubism 对象。Extension 不直接发布 Avatar 控制帧；只有本地 Presentation scene 默认驱动本地 Avatar。

## Readiness

Avatar ready 必须依次满足：

1. UnityAvatarHost 进程启动；
2. 建立协议连接并发送 `host_hello`；
3. Avatar Package、SDK、Model Driver 与动作资源可用；
4. NativeCompositionHost 创建并附着 Desktop Composition Surface；
5. 首帧实际 present；
6. worker window 已隔离且交互已准备；
7. UnityAvatarHost 发送 `host_ready`，Kernel 更新 `avatar.host` readiness 与 Character Presentation Projection。

进程存在、WebSocket connected、静态预览或 Presence 都不能替代 `host_ready`。Control Center 的“形象”状态只消费 Kernel Projection，不扫描 Unity 文件推断 ready。

实现见 [Desktop 与 Avatar 实现](../../implementation/Desktop与Avatar实现.md)，操作见 [桌面与 Avatar 开发](../../../guides/subsystems/桌面与Avatar开发.md)，长期决策见 [ADR-0005](../../decisions/ADR-0005-Character-Avatar-Surface-Host分层.md)。

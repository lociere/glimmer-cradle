# ADR-0005 Character、Avatar、Surface 与 Host 分层

- 状态：accepted
- 日期：2026-07-13

## 背景

旧架构使用 `Avatar Shell` 同时指人物身体、Unity 进程、桌面呈现位置、协议和构建包，导致 Avatar 被误解为外接显示部件，配置也被放进 `surfaces.yaml`。这种复用让领域 owner、进程边界和呈现边界无法从名称与目录推导。

## 决策

1. `Character` 是人物根；`Avatar` 是 Character 拥有的形象与身体领域，属于人物本体。
2. `Surface` 只表示人物出现和用户交互发生的位置，例如 Control Center、Presence、桌面或未来的直播、移动端与 AR。
3. `AvatarHost` 是承载 Avatar 实现的进程边界；当前实现为 `UnityAvatarHost`。Host 不拥有人物身份、Avatar 状态事实或 Surface。
4. `NativeCompositionHost` 只拥有平台合成原语，把 Unity 产生的帧放到桌面 Surface；它不拥有 Avatar 行为。
5. 跨 Desktop 与 Avatar Host 的公共消息属于 `Presentation Plane`，契约使用 `PresentationUpstreamFrame` / `PresentationDownstreamFrame`；Host 握手使用 `host_hello` / `host_ready`。
6. Avatar 配置归 `configs/system/avatar.yaml`；Surface 配置归 `configs/system/surfaces.yaml`。两者不得再次合并。
7. Avatar 源码采用 `core/avatar/unity-host/`，Unity 自有代码按 `Domain / Application / Infrastructure / Host` 分层；Desktop 的物理归属由 [ADR-0006](./ADR-0006-Desktop物理归属与Electron进程分层.md) 规定。
8. UI 正式名称使用“形象”；“外显”只可作为自然语言动词，不作为模块、页面、配置域或进程名称。

## 结果

- Avatar 可以自由更换模型与未来后端，而不改变 Character、Surface 或 Kernel 的领域边界。
- Unity 可以被其他 Avatar Host 实现替换，但替换不意味着人物换成外挂组件。
- Desktop、直播和 AR 可以消费同一 Presentation Projection，而不拥有 Avatar。
- Readiness 明确分为 Host 存活、协议连接、Avatar Package/driver、Composition Surface、首帧和交互 gate。

## 开发期迁移规则

本决策发生在开发阶段，不提供旧架构兼容窗口。Schema、配置键、目录、文件名、构建产物、数据路径、测试和文档必须一次切到目标结构；Git 历史承担追溯，主线不保留旧别名、旧读取路径、双写或 fallback。

## 验证

- 搜索旧 `Avatar Shell`、`avatar_shell`、`avatar-shell`、`shell_hello`、`shell_ready` 和旧目录无活跃主线残留。
- `pnpm sync:contracts`、`pnpm typecheck`、`pnpm build` 通过。
- Avatar 专项验证覆盖 Host 启动、`host_hello`、`host_ready`、首帧、透明合成、动作状态、停机回收与路径投影。

# Product Compositions

> 权威范围：Desktop 与 Personal Server 的物理入口、组合清单、启动命令、网络边界和环境变量。

## 产品清单

| 技术 ID | 用户名称 | 清单 | Product Host |
|---|---|---|---|
| `desktop` | Glimmer Cradle Desktop | `products/desktop/product.json` | Electron main/preload/renderer |
| `personal-server` | Glimmer Cradle Personal Server | `products/personal-server/product.json` | Node HTTP/WebSocket Host |

两个清单都遵循 `contracts/json-schema/product/v1/product-composition.schema.json`，由 Kernel/Product owner validator 校验；`products/` 只保存产品组合实例与 owner-local projection，不拥有第二份 Schema。`features` 表示发行物是否包含某项能力，不表示该能力已经启用，也不保存用户偏好。当前 Server 组合包含 Control Surface Gateway、云端 TTS lane 和 Extension Host，排除 ASR、本机 Avatar，以及打开网页、剪贴板、桌面通知和屏幕上下文等 Desktop 本机设备 Skill。TTS 是否启用由 `configs/system/audio.yaml` 决定；默认关闭属于正常基础运行形态。

## 控制面板与能力边界

Desktop 与 Personal Server 使用同一设计语言和 Kernel 投影，但不是同一 Product Host 或同一页面装配。Desktop Control Center 由 Electron main/preload/renderer 承载，可调用系统文件选择器、本机设备 Skill、Avatar 和窗口能力；Personal Server 控制面板由 `products/personal-server/src/web/` 构建为浏览器应用，`public/` 只保留无需构建的静态资产与挂载入口。

### Personal Server 控制面的物理边界

M11 起，Personal Server 控制面必须遵守以下长期物理结构：

```text
products/personal-server/
  src/
    server/
      bootstrap/
      auth/
      http/
      websocket/
      adapters/
    web/
      app/
      shell/
      routes/
      features/
      shared/
  public/
```

当前 `src/web/main.tsx` 只创建一个 React root，`app/bootstrap.tsx` 隔离认证层与已登录应用，`app/router.tsx` 是唯一 route table；React Router 独占 `/conversation`、`/overview`、`/capabilities`、`/activity`、`/settings`、根路径重定向和 unknown route 的 URL/history/deep-link 语义。`shell/PersonalServerShell.tsx` 只提供一层全局导航和当前 route 的 `Outlet`，旧 `main.ts`、命令式 `bootstrap.ts`、内存 `app/router.ts` 与 `shell/layout.ts` 已删除。Product Host 仅对接受 `text/html` 的安全 `GET`、非 API/保留前缀且 extensionless 的真实导航回退 no-store `index.html`；静态资源只接受 `GET/HEAD`，`HEAD` 不返回 body，API/保留前缀、asset miss、其他 method 与 malformed/encoded traversal 均 fail closed。精确后续目标和删除门见 [M11 目标物理清单](../roadmap/manifests/M11-目标物理清单.md)。

约束如下：

- `src/server/` 只承载 Node Product Host：认证、HTTP ingress、浏览器 WebSocket ingress、到 Kernel `SurfaceGatewayService` 的 gRPC 代理、静态资源装配与 Product 生命周期对接；不得 import 浏览器业务模块。
- `src/web/` 只承载浏览器控制面：路由、shell、feature、shared API client、Protocol decode 与样式；不得直接访问服务器文件、YAML、secret 或 Node-only API。
- `routes/` 只做页面装配；feature 按领域 owner 切分，Provider、模型路由、Audio、Memory、Skill、安全、存储、更新各自拥有 view model、表单和局部状态。
- `shared/api/` 是唯一 HTTP/WebSocket client 与跨边界 decode 入口；Web 不手写第二套 payload 类型。浏览器 WebSocket 只属于 Personal Server 外部认证 ingress，Kernel consumer 由 `src/server/` 的 Surface Gateway client 持有。
- `shared/styles/` 只放 token、global、motion、responsive 等共享样式；feature 局部样式与视图同 owner，不回流成单个全局 `app.css`。
- `public/` 不再承载业务 `app.js`、`app.css` 或单体页面逻辑；新构建接管后，旧三文件入口必须删除，且通过架构门禁阻止回流。
- 概览由 `routes/OverviewRoute.tsx` 装配 `features/overview/Overview.tsx`、`useOverview.ts` 与 `RuntimeDetails.tsx`，局部样式由 `Overview.module.css` 拥有；`StatusView`、`features/status/` 和 `mountOverview` 已删除。hook 订阅应用投影并在进入页面或恢复连接时读取模型配置；离开时取消消费，迟到结果不能写回。Controller 只在当前会话、当前 surface 且未取消时接受读取结果。
- 运行体目录的接收时间与当前连接 freshness 分开记录：初始等待、已收到空目录、断线后的上次投影、握手恢复但新目录尚未到达分别呈现；只有当前 surface 的目录消息才能恢复 freshness。运行体详情按需打开，直接呈现 owner、阶段、blocking、目录更新时间与可选资源/诊断引用，不构造投影未提供的依赖或操作。
- 对话由 `routes/ConversationRoute.tsx` 装配 `Conversation` / `useConversation` / `ConversationController`，局部样式由 `Conversation.module.css` 拥有；旧 `ConversationView`、`conversation-view.ts`、`conversation.css` 和 `mountConversation` 已删除。route owner 负责历史读取取消、分页与实时消息合并；应用 Controller 只暴露受当前会话和 surface 守卫的读取、发送与订阅入口。持久历史按消息身份替换瞬时记录，刷新保留已加载的早期页面；断线将待处理发送标记为可重试，草稿保持可编辑，等待回复时禁止重复发送。
- 能力页由 `routes/CapabilitiesRoute.tsx` 装配 `features/capabilities/Extensions.tsx`、`ExtensionInstall.tsx`、`useExtensions.ts` 和 `ExtensionsController.ts`，CSS Module 拥有列表、按需安装表单和版本/诊断详情抽屉；旧 `features/extensions/`、`ExtensionView` 和 `mountCapabilities` 已删除。route owner 持有目录与事务状态，应用 Controller 提供绑定当前会话/surface 的操作 Port。刷新合并并发读取，离页/断线忽略迟到结果；未提交预览及离页后才返回的预览在原连接取消，断线回收由 Product Host 兜底。提交期间禁止重复操作，离页不主动取消已提交事务；来源在预览期间锁定；提交/取消的终结回执会清除已消费预览，失败后可重新准备，只有传输异常保留预览以取消未确认事务。目录读取错误与操作错误分开保存，刷新不能清除操作失败，操作不能掩盖目录不可读。独立验收状态见 [now.md](../roadmap/now.md)。
- 活动由 `routes/ActivityRoute.tsx` 装配 `features/activity/Activity.tsx`、`useActivity.ts` 和 `ActivityController.ts`，CSS Module 拥有筛选、事件列表与按需详情；旧 `ObservabilityView`、`mountActivity` 和 observability 样式删除。route owner 使用 AbortSignal 与代际守卫取消历史读取、关闭 SSE、清除重连计时器；认证失效由应用 Port 同步关闭流。只有 SSE open 后显示持续观察，错误自动重试；列表与暂停缓冲各保留最多 200 条，缓冲溢出明确提示，暂停期间重连不改变已显示事件。导出只包含当前显示记录的原始 NDJSON。
- 设置由 `routes/settings/SettingsRoute.tsx` 装配 `features/configuration/Configuration.tsx`、`ConfigurationFields.tsx`、`useConfiguration.ts` 与 `ConfigurationController.ts`；旧 ConfigurationView、mountSettings、字符串 section 和 DOM 绑定删除。`section` 查询参数定位模型、音频、语义向量、记忆、Skill、安全及存储/服务七个子区，宽屏侧栏与容量不足时的分类 Drawer 一次只呈现一个子区。Controller 持有草稿、修订、预览/保存、防重与补充投影；刷新/重连保留脏草稿，冲突不自动套用新修订，成功保存清空 Provider 密钥输入。认证 Port 统一使用连接代际与 AbortSignal，离页取消读取并停止轮询；令牌明文不持久化，离开安全子区后隐藏。运维提交和恢复查询使用同一 receipt，旧读取与迟到回执不能覆盖新快照或使终态回退。

当前 `v0.1.x` 浏览器应用已经由 `src/web/` 构建入口接管，并提供受认证登录、系统状态、真实结构化日志、零 Provider 可登录降级，以及通过 Control Surface 协议读取/分页恢复 Conversation 历史的正式对话页。对话 feature 只把浏览器内存作为瞬时 view model，不再把 `localStorage` 或页面缓存当作历史事实源；真实历史、游标和恢复状态统一由 Kernel -> Cognition Conversation 投影 owner 提供。设置中心只消费脱敏 `ConfigurationSnapshot`，API key 保持 write-only，并把测试连接、revision 冲突检查和 apply 状态交给 Kernel Config Application Port。设置 UI 的配置字段、草稿行为与页面编排均由 `features/configuration/` 拥有；安全页已接 Product Host owned 的访问令牌 store，支持受管令牌创建、轮换、撤销与一次性明文返回，环境变量 legacy token 和回环免令牌模式会明确标记为 degraded 来源。备份/恢复、更新与服务控制只通过受认证 Ops Bridge 交给宿主 one-shot transaction owner，不回退到 Product Host 或本地 CLI。Web 在提交前生成 operation ID，Product、Bridge、host owner、audit 和重连续查都使用同一 ID；当前未绑定固定候选的 update check/apply 明确 unsupported。源码直跑或未接宿主桥时，设置页展示真实 disabled reason。Extension 页已覆盖仓库 Release、Registry、Release Manifest 与浏览器本地 `.gcex` 四类来源：浏览器上传只会换取同会话、30 分钟时效、单事务消费的 opaque `upload_id`，Host 在 prepare 时解析为受控临时文件并在 preview 失败、取消、断线或超时后清理；commit/cancel 对所有 transaction_id 都要求属于当前 principal/session，Host 断线会先向 Kernel cancel 本连接已预览未提交事务，Kernel Package Manager 启动与定时 sweep 仍会清理 stale transaction 目录。Audio、Memory、Embedding、Skill 的可写 owner 与完整运维桥仍在 [M11](../roadmap/milestones/M11-Personal%20Server控制面、区域分发与跨产品Extension闭环.md) 的后续验收门内继续收口。

未来浏览器配置也不得直接读写 YAML、secret 或任意服务器路径。Kernel Config Application Port 是唯一配置 owner：浏览器只消费脱敏 `ConfigSnapshot`，提交经过 Schema、权限、revision 和审计约束的 update command；secret 只写不可回显。Personal Server 不接受浏览器提交服务器文件路径安装 `.gcex`；本地包只允许认证后的二进制上传到 Product Host owned 临时目录，并通过 opaque `upload_id` 进入统一安装事务。

Personal Server 并不禁用 Skill Plane。Core、MCP、User 和 Extension Provider 都可以存在；Product Composition 只过滤不满足 `products`、Linux `platforms` 或 `features` 的贡献。扩展私有的 `source_provider` Skill 只在该 Extension/Adapter 产生的 ConversationContext 中进入规划和执行，不会泄露给其他来源。管理 WebUI、账号登录、二维码、进程控制和部署操作属于管理能力，不是供角色选择的 Skill。

Personal Server 构建配置使用 `vite.config.mts` 显式 ESM，目录由 `import.meta.url` 解析，与 Desktop 保持相同 Vite Node API 加载方式。`tsconfig.web.json` 同步覆盖该配置文件。

## 启动与监督

| 命令 | 组合 |
|---|---|
| `pnpm dev` / `pnpm dev:desktop` | Desktop |
| `pnpm dev:personal-server` | Personal Server |
| `pnpm build && pnpm start:desktop` | 已构建 Desktop 产品组合 |
| `pnpm build && pnpm start:personal-server` | 已构建 Personal Server 产品组合 |
| `pnpm build && pnpm smoke:personal-server` | 已构建 Personal Server 的 ready、真实文字对话、停机与进程回收验收 |
| `GLIMMER_CRADLE_SMOKE_REQUIRE_TTS=1 pnpm smoke:personal-server` | 显式启用并配置 TTS 后，额外要求 `audio_play` 并记录语音延迟 |

`tools/workspace-supervisor/` 是开发期 Product Supervisor。它从 Product package manifest 消费 `product:prepare`、`product:dev`、`product:start`：Desktop preparation 可运行 Desktop `prepare-runtime` 与 `desktop-assets`，Personal Server preparation 只运行共享 Contracts/Extension SDK owner task，不能进入 Desktop assets。随后 Supervisor 注入 `GLIMMER_CRADLE_PRODUCT_MANIFEST`，共同持有 Kernel 与 Product Host。主进程以 `code=0` 正常退出时，Supervisor 先等待兄弟进程沿协议自然退出，再在短期限后回收剩余进程树；异常退出则立即收口故障域并原样返回非零 code。Windows 通过当前 Node 附带的 Corepack `pnpm.js` 入口执行仓库锁定版本；其他平台通过 `corepack pnpm` 启动。CLI 以工具物理位置或显式 `--repository-root` 解析仓库，不依赖调用者 cwd。

`products/personal-server/scripts/smoke.mjs` 是需要真实 LLM 配置的生产组合 smoke。它分配临时回环端口，并把 models/packages 复制到隔离 Local Data Domain；任一 symlink/junction 会失败闭合，不会把可写路径投影回真实数据。随后记录 `/readyz` 状态迁移，经 `/api/v1/surface` 完成一次文本对话并等待 `reply` 与真实 Audio 状态，最后从受信任控制表面发起全局停机并要求 Product Supervisor 以 `0` 退出。默认接受 TTS/ASR 为 `disabled`；只有设置 `GLIMMER_CRADLE_SMOKE_REQUIRE_TTS=1` 时才要求 `audio_play`。它不替代 Linux OCI 分发物验收。

## Personal Server 网络配置

| 环境变量 | 默认值 | 约束 |
|---|---|---|
| `GLIMMER_CRADLE_SERVER_HOST` | `127.0.0.1` | 绑定非回环地址时必须配置 token |
| `GLIMMER_CRADLE_SERVER_PORT` | `3210` | `0` 表示由 OS 选择端口 |
| `GLIMMER_CRADLE_SERVER_TOKEN` | 空 | 非回环部署必填；浏览器登录后换取 HttpOnly 会话 Cookie，API 客户端可使用 Bearer |
| `GLIMMER_CRADLE_DATA_ROOT` | `<application-root>/data` | 为 Kernel、Cognition、Audio 与 Personal Server 指定同一个 Local Data Domain；不进入业务 YAML 配置 |

HTTP 入口为 `/healthz`、`/readyz`、`/api/v1/status`、`/api/v1/product` 和 `/api/v1/session`；控制表面 WebSocket 为 `/api/v1/surface`。`/healthz` 只确认 Product Host 存活，也是容器 healthcheck；`/readyz` 仅在 `kernel.ingress` 与所有 blocking runtime 为 `ready` 时返回 `200`，由部署脚本作为就绪门；已认证的 `/api/v1/status` 始终返回当前 readiness 投影，供页面在启动期间轮询。浏览器通过 `POST /api/v1/session` 登录，服务签发 12 小时、`HttpOnly`、`SameSite=Strict` 的随机会话 Cookie；WebSocket 必须同源且使用该会话，不接受 URL 查询参数中的 token。Kernel 的动态回环端点永不直接暴露到外网。

标准 OCI 部署由 `deploy/personal-server/compose.yaml` 定义。应用内部固定监听 `3210`，只暴露给 Compose 内部网络；Caddy 是唯一宿主机入口。默认绑定 `127.0.0.1:8080` 并通过 SSH 隧道使用，公开部署必须配置域名与 HTTPS。精确操作见 [Personal Server 部署指南](../guides/release/Personal%20Server部署.md)。

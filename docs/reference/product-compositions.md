# Product Compositions

> 权威范围：Desktop 与 Personal Server 的物理入口、组合清单、启动命令、网络边界和环境变量。

## 产品清单

| 技术 ID | 用户名称 | 清单 | Product Host |
|---|---|---|---|
| `desktop` | Glimmer Cradle Desktop | `products/desktop/product.json` | Electron main/preload/renderer |
| `personal-server` | Glimmer Cradle Personal Server | `products/personal-server/product.json` | Node HTTP/WebSocket Host |

两个清单都遵循 Protocol 的 `protocol/src/schemas/models/ProductComposition.schema.json`，并由 `validateProductComposition` 统一校验。`products/` 只保存产品组合实例，不拥有第二份类型或校验规则。`features` 表示发行物是否包含某项能力，不表示该能力已经启用，也不保存用户偏好。当前 Server 组合包含 Control Surface Gateway、云端 TTS lane 和 Extension Host，排除 ASR、本机 Avatar，以及打开网页、剪贴板、桌面通知和屏幕上下文等 Desktop 本机设备 Skill。TTS 是否启用由 `configs/system/audio.yaml` 决定；默认关闭属于正常基础运行形态。

## 控制面板与能力边界

Desktop 与 Personal Server 使用同一设计语言和 Kernel 投影，但不是同一 Product Host 或同一页面装配。Desktop Control Center 由 Electron main/preload/renderer 承载，可调用系统文件选择器、本机设备 Skill、Avatar 和窗口能力；Personal Server 控制面板是 `products/personal-server/public/` 的浏览器应用。

当前 `v0.1.x` 浏览器应用只提供远程会话、系统状态和基础 Extension 生命周期入口。它尚未提供 LLM Provider、Audio、Embedding、Memory、Skill Policy、网络安全或更新设置，也没有对应的配置读写 API；服务器配置仍由受控宿主配置文件和运维命令完成。这是当前产品限制，不是隐藏入口。计划中的配置投影、日志工作台、完整 Extension 管理和服务器设置由 [M11](../roadmap/milestones/M11-Personal%20Server控制面、区域分发与跨产品Extension闭环.md) 承担。

未来浏览器配置也不得直接读写 YAML、secret 或任意服务器路径。Kernel Config Application Port 是唯一配置 owner：浏览器只消费脱敏 `ConfigSnapshot`，提交经过 Schema、权限、revision 和审计约束的 update command；secret 只写不可回显。Personal Server 不接受浏览器提交服务器文件路径安装 `.gcex`。

Personal Server 并不禁用 Skill Plane。Core、MCP、User 和 Extension Provider 都可以存在；Product Composition 只过滤不满足 `products`、Linux `platforms` 或 `features` 的贡献。扩展私有的 `source_provider` Skill 只在该 Extension/Adapter 产生的 ConversationContext 中进入规划和执行，不会泄露给其他来源。管理 WebUI、账号登录、二维码、进程控制和部署操作属于管理能力，不是供角色选择的 Skill。

## 启动与监督

| 命令 | 组合 |
|---|---|
| `pnpm dev` / `pnpm dev:desktop` | Desktop |
| `pnpm dev:personal-server` | Personal Server |
| `pnpm build && pnpm start:desktop` | 已构建 Desktop 产品组合 |
| `pnpm build && pnpm start:personal-server` | 已构建 Personal Server 产品组合 |
| `pnpm build && pnpm smoke:personal-server` | 已构建 Personal Server 的 ready、真实文字对话、停机与进程回收验收 |
| `GLIMMER_CRADLE_SMOKE_REQUIRE_TTS=1 pnpm smoke:personal-server` | 显式启用并配置 TTS 后，额外要求 `audio_play` 并记录语音延迟 |

`scripts/launch-product.mjs` 是开发期 Product Supervisor。它先运行可缓存准备器，再注入 `GLIMMER_CRADLE_PRODUCT_MANIFEST`，共同持有 Kernel 与 Product Host。主进程以 `code=0` 正常退出时，Supervisor 先等待兄弟进程沿协议自然退出，再在短期限后回收剩余进程树；异常退出则立即收口故障域并向部署层返回失败。Windows 通过当前 Node 附带的 Corepack `pnpm.js` 入口执行仓库锁定版本，避免 `.cmd` 外壳和项目内全局 pnpm 假设破坏进程所有权；其他平台通过 `corepack pnpm` 启动。

`scripts/smoke-personal-server.mjs` 是需要真实 LLM 配置的生产组合 smoke。它分配临时回环端口和隔离 Local Data Domain，只链接只读模型与安装包，不污染真实会话、记忆、日志或缓存；随后记录 `/readyz` 状态迁移，经 `/api/v1/surface` 完成一次文本对话并等待 `reply` 与真实 Audio 状态，最后从受信任控制表面发起全局停机并要求 Product Supervisor 以 `0` 退出。默认接受 TTS/ASR 为 `disabled`；只有设置 `GLIMMER_CRADLE_SMOKE_REQUIRE_TTS=1` 时才要求 `audio_play`。它不替代 Linux OCI 分发物验收。

## Personal Server 网络配置

| 环境变量 | 默认值 | 约束 |
|---|---|---|
| `GLIMMER_CRADLE_SERVER_HOST` | `127.0.0.1` | 绑定非回环地址时必须配置 token |
| `GLIMMER_CRADLE_SERVER_PORT` | `3210` | `0` 表示由 OS 选择端口 |
| `GLIMMER_CRADLE_SERVER_TOKEN` | 空 | 非回环部署必填；浏览器登录后换取 HttpOnly 会话 Cookie，API 客户端可使用 Bearer |
| `GLIMMER_CRADLE_DATA_ROOT` | `<application-root>/data` | 为 Kernel、Cognition、Audio 与 Personal Server 指定同一个 Local Data Domain；不进入业务 YAML 配置 |

HTTP 入口为 `/healthz`、`/readyz`、`/api/v1/status`、`/api/v1/product` 和 `/api/v1/session`；控制表面 WebSocket 为 `/api/v1/surface`。`/healthz` 只确认 Product Host 存活，也是容器 healthcheck；`/readyz` 仅在 `kernel.ingress` 与所有 blocking runtime 为 `ready` 时返回 `200`，由部署脚本作为就绪门；已认证的 `/api/v1/status` 始终返回当前 readiness 投影，供页面在启动期间轮询。浏览器通过 `POST /api/v1/session` 登录，服务签发 12 小时、`HttpOnly`、`SameSite=Strict` 的随机会话 Cookie；WebSocket 必须同源且使用该会话，不接受 URL 查询参数中的 token。Kernel 的动态回环端点永不直接暴露到外网。

标准 OCI 部署由 `deploy/personal-server/compose.yaml` 定义。应用内部固定监听 `3210`，只暴露给 Compose 内部网络；Caddy 是唯一宿主机入口。默认绑定 `127.0.0.1:8080` 并通过 SSH 隧道使用，公开部署必须配置域名与 HTTPS。精确操作见 [Personal Server 部署指南](../guides/release/Personal%20Server部署.md)。

# Now

> 审阅日期：2026-08-25
> 范围：当前里程碑切换状态、下一验收门和近期不做事项；不记录已完成架构事实正文。
> 维护触发：当前里程碑、验收门、风险、范围或审阅日期变化。

[M10：发布形态、安装投影与数据迁移闭环](./milestones/M10-发布形态、安装投影与数据迁移闭环.md) 已完成。Personal Server 已具备公开 Release、digest 固定 OCI、轻量/完整安装包、可信来源校验、不可变版本目录、事务更新回滚、备份恢复和停机回收主链；Ubuntu 24.04 LTS、linux/amd64 是当前实测支持基线。

## 当前推进面：M11 Personal Server 前端实现准备

[M12：契约脊柱与跨进程服务架构重建](./milestones/M12-契约脊柱与跨进程服务架构重建.md) 已完成：旧 `protocol/` 物理删除，独立 Document 进入 `contracts/json-schema/` compatibility baseline，Service/DTO consumer 使用 Contract Spine edge；Surface Gateway 使用有限 typed Query/Command/Event DTO，Kernel 与产品 Adapter 映射 owner-local request/projection，公开 Extension SDK 只保留扩展作者与 Host Port API。第三方 Cubism SDK 仍只存在于 ignored 本机供应目录，不进入 Git。

[M13：工程自动化脊柱与交付生命周期闭环](./milestones/M13-工程自动化脊柱与交付生命周期闭环.md) 已完成 A～F 与最终仓库工具收口：部署事务、数据恢复、task graph/CI、owner-local tooling、Personal Server 供应链与 Desktop packaging 均已落到 [M13 完成态物理目录](./manifests/M13-目标物理清单.md)；长期跨仓工具位于 `tools/repo-checks/` 与 `tools/workspace-supervisor/`，root `package.json` 只保留稳定 façade，root `scripts/` 已删除。未绑定固定版本/制品的 update check/apply 继续 unsupported/fail-closed；Kernel DLQ 使用 owner-local EventBus replay 与绑定 receipt，legacy Cognition source 仍不支持 replay。

M12/M13 的完成态目录、迁移动作和删除门分别见对应 [M12 清单](./manifests/M12-目标物理清单.md) 与 [M13 清单](./manifests/M13-目标物理清单.md)。2026-08-25 起，当前活跃面切换为 M11 Personal Server 前端；架构、AI 辅助开发闭环和视觉方向已经确认，React 迁移与生产 UI 实现尚未开始。

[M11：Personal Server 控制面、区域分发与跨产品 Extension 闭环](./milestones/M11-Personal%20Server控制面、区域分发与跨产品Extension闭环.md) 已恢复 `in-progress`。[ADR-0017](../architecture/decisions/ADR-0017-产品前端统一采用React组件驱动架构.md) 与 [M11 UI 设计简报](./design-briefs/M11-Personal%20Server%20UI设计简报.md) 的最终视觉方向已于 2026-08-25 确认；Personal Server 运行时尚未迁移，下一步是在独立授权下启动首个 Shell/Router 实现 slice。M11 其他未完成范围仍保持原状态。

`v0.1.8` 已从 fixed commit `8d8bdabb7047a63cc03fe2e28f67f41ce5c2a17a` 正式发布。GitHub Release、五项公开资产和统一摘要链已验证；全新 Ubuntu 24.04 remote/full 安装完成，控制机与服务器双重摘要通过，应用与默认 Caddy 均从本地已校验镜像归档加载。`/readyz`、容器、ops bridge 与端口通过，同版本幂等重装通过，安装期间未观察到 Registry 回源；当前服务器健康运行 `v0.1.8`。

真实失败回滚仍未完成：当前缺少获授权的 distinct candidate 或 fault injection 入口，不能用同版本重装、伪造本地回归或未经授权的生产故障替代。NapCat `external_onebot`/QQ E2E、真实发布物 Extension 升级失败恢复与跨仓生产闭环也仍未过门。

M11 仍未完成的范围：

- 由 Kernel Config Application Port 统一提供可校验、可脱敏、可审计的配置投影与更新命令；
- 为 Personal Server 提供零 Provider 可登录的正式控制面，以及 Provider、真实对话、状态、日志、Audio、Memory、Skill、安全、存储和更新能力；
- 收口 Personal Server 当前 UI 的路由正确性、信息架构、视觉系统、响应式、可访问性和截图验收；
- 让 Extension 安装、启停、升级、权限与产品兼容性通过同一 Package Manager 闭环；
- 把 NapCat 拆成跨平台 QQ 场景 Adapter 与平台资源配置，在 Personal Server 上先支持外部 OneBot；
- 验证 Extension 私有 Skill、场景注意力、回复、Experience 与 Memory 的完整链路；
- 把区域 HTTP(S)/OCI 传输副本保留为长期演化候选，只有真实需求出现后再实施。

## 下一验收门

### 已完成里程碑与环境风险

M12/M13 当前没有未闭合的代码集成门。真实 Docker/Ubuntu、Windows installer 安装/首启/
升级/卸载、签名、公证、Registry、GitHub Sigstore attestation/Release 与生产操作仍是环境
风险，不能从 isolated fixture、dry-run 或 source build 外推为通过；这些门只有在用户选择
发布/运维目标并授权唯一环境 owner 后才能执行。

### Personal Server UI 优化门

本门当前只完成问题与规范记录，UI 优化尚未实现：

1. ADR-0017 已接受 React + Vite + React Router + React Aria + CSS Modules + Storybook/Playwright 分层，框架决策门已关闭；依赖版本只在实施 slice 固定。
2. M11 最终视觉方向已确认；下一步按 [M11 目标物理清单](./manifests/M11-目标物理清单.md) 迁 Shell/Router、shared UI 与垂直页面 slice，每个 slice 删除对应旧 DOM owner，不保留双 Shell/双 Router。
3. 修正页面唯一可见、登录层隔离、URL/history/deep-link、back/forward 和复杂页面挂载语义，并补齐“非当前页面隐藏”断言。
4. 信息架构收敛为单层全局导航；页面内只在真实子域存在时显示二级导航。Context Inspector 改为选中对象后按需出现的 Context Drawer。
5. 对话、概览、能力、活动、设置形成清晰一级域；设置拆为模型与路由、语音、记忆、安全、存储、更新等真实子页面；runtime、日志、Extension、Provider 使用列表/主体 + 按需详情。
6. 在首个实现 slice 中把已确认方向固化为语义 token 与组件语言，并为最终方向补齐代表页面、深浅主题和关键状态矩阵。
7. shared UI 与代表复合组件建立 stories、交互/a11y 测试；Storybook MCP 仅作为带版本、fallback、收益指标和删除条件的 preview 试点，Playwright 继续负责 Product Host E2E。
8. 响应式由页面内容容量驱动；不同用途页面拥有不同内容宽度，并覆盖临界宽度、长内容、100–400% 缩放、键盘、焦点、reduced-motion 与触控目标。
9. 最终实现覆盖 `loading`、`empty`、`degraded`、`error`、`pending`、`success`，并建立代表页面/关键状态截图基线与真实交互回归。
10. 正式 Logo、Wordmark、Favicon 和统一图标系统等待未来品牌资产任务；本门不以硬编码字符、单字伪图标或临时资产替代。

已确认视觉方向只由 M11 UI 设计简报与 UI Design Tokens Reference 拥有；外部产品、官方设计系统和 frontend Skill 只提供方法，不成为项目事实源。

### 生产与跨仓门

1. 取得 distinct candidate/fault injection 的明确授权与固定制品，验证真实更新失败自动恢复；未取得入口前保持阻断，不操作健康服务器。
2. 通过跨仓库固定发布物完成 Extension 安装、升级、失败恢复和回滚证据。
3. 取得获授权 external OneBot/QQ 环境，完成 NapCat 私聊、群聊、背景观察、注意力、私有 Skill、回复、Experience、Memory 与重启连续性 E2E。
4. 完成长运行、备份/恢复连续性与完整停机矩阵，确认端口、连接、Worker 和受管进程全部释放。

## 近期不做

- 不让浏览器直接读写服务器 YAML、Secret、任意文件路径或 Docker Socket。
- 不把 Desktop 的 Avatar、窗口、剪贴板和本机设备页面复制到 Personal Server。
- 不偏离已确认的中性主题、青曜强调色和有限晶光边界，也不把参考图布局或采样值写入生产 token。
- 本轮文档与设计前置不实现路由、框架迁移、布局、响应式、品牌资产或测试代码；ADR 与视觉方向已确认，生产实现从后续获授权 slice 开始。
- 不把 NapCat 的 Windows OneKey 启动逻辑伪装成 Linux 兼容。
- 不让 Extension 私有 Skill 泄露到无关 ConversationContext，也不把管理操作伪装成人物 Skill。
- 不为特定云厂商、地域或代理域名分叉安装协议。
- 不在缺少 Debian 实机矩阵时声明 Debian 正式支持。

未承诺候选事项见 [backlog.md](./backlog.md)。

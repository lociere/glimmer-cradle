# Now

> 审阅日期：2026-09-09
> 范围：当前里程碑切换状态、下一验收门和近期不做事项；不记录已完成架构事实正文。
> 维护触发：当前里程碑、验收门、风险、范围或审阅日期变化。

[M10：发布形态、安装投影与数据迁移闭环](./milestones/M10-发布形态、安装投影与数据迁移闭环.md) 已完成。Personal Server 已具备公开 Release、digest 固定 OCI、轻量/完整安装包、可信来源校验、不可变版本目录、事务更新回滚、备份恢复和停机回收主链；Ubuntu 24.04 LTS、linux/amd64 是当前实测支持基线。

## 当前推进面：M11 Personal Server 页面收束与后续外部验收

2026-09-08 页面部分本地实现与验收完成：对话、概览、能力、活动、设置五域及七个设置子区均使用唯一 React owner。当前任务获用户授权提交并推送累计页面成果，未授权部署生产。后续 M11 剩余三条主线为 Extension 跨仓发布与恢复、NapCat 外部 OneBot/QQ 场景、生产运维恢复与长运行；区域副本和品牌资产继续不在近期范围。

2026-09-09 Extension 发布前置候选已在主仓与 `glimmer-cradle-extensions` 独立仓形成：主仓 Contract/SDK 包使用发布 allowlist，SDK 构建排除测试输出，`pnpm verify:extension-sdk-release` 会从两个 tarball 建立干净 consumer 并实际加载公开 validator；`extension-sdk-v<semver>` 固定 tag workflow 会用绝对工作区路径固定摘要并按 Contract → SDK 顺序发布。第一方扩展仓已迁除 `@glimmer-cradle/protocol`，Registry/模板改从 SDK public edge 校验并统一为首版 `0.1.0`，通用模板的 `any` 平台声明与默认发布目标一致；模板 Release 已收紧为固定 Actions/Ubuntu、公开 SDK 前置、干净且真实指向 HEAD 的 tag、清理旧构建、包完整性/外层摘要复核与 GitHub provenance。本地完整校验、模板 `.gcex` 构建及脏树失败保留通过。三仓候选已进入远端 `main`，主仓 `npm` Environment 与 `NPM_TOKEN` 已配置；正式 npm 包、SDK tag、真实安装/升级失败恢复仍未完成。本地 link 与 tarball consumer 证据不外推为公开发布完成。

同日 NapCat 独立仓已形成真实扩展发布候选：源码只从 SDK public edge 使用 Contract 类型，manifest/peer dependency 精确对齐首版 SDK `0.1.0`，本地 link 会连接主仓 Contract/SDK 发布投影并清理旧 Protocol 链接；发布脚本要求干净工作树与真实指向当前 commit 的精确 `v<semver>` tag，生成 Windows x64、Linux x64 `.gcex`、Release Manifest 和统一摘要，并在上传前重新验证包完整性。manifest、类型检查与 14 项测试通过；脏树默认拒绝且不删除既有候选，显式本地候选连续两次构建摘要一致。Windows 主机上的主仓 Package Manager 还以 `personal-server` 产品约束从真实 NapCat `.gcex` 完成兼容预览、权限拒绝无半安装、原子安装、同摘要幂等重装和卸载，并通过受控 HTTPS fixture 走通真实 Release Manifest 的平台制品选择、外层摘要和安装；Release Manifest 摘要漂移会拒绝且清理事务目录。三条探针已固化为按环境变量接收固定候选的 Kernel 集成测试，并接入 NapCat Linux 发布 workflow。该 workflow 在构建 Adapter 前会从 `extension-sdk-v0.1.0` 重新 pack Contract/SDK，并逐包比较 npm `dist.shasum`，从而阻断未公开或与 tag 漂移的 SDK。安装事务同时收紧为权限确认后的 commit 成败均清理缓存与 staging，制品在确认后变化的反例已覆盖。该临时数据根与受控网络探针不等同 Linux Product Host 或真实远端 Release。三仓 workflow 已进入远端默认分支，但 SDK npm 包/tag、NapCat tag/Release、真实远端安装与升级失败恢复及 external OneBot/QQ E2E 均未完成。

本轮基于 `b0159830` 补齐通用扩展能力诊断（逐项就绪条件、依赖、未知/空状态、恢复建议），修复安全子区经浏览器历史离开或请求迟到时一次性令牌重新显示的问题。独立审查唯一 P2 已修复并复审通过。58 项产品测试、5 项架构测试、根 typecheck/build、Storybook build、编码/架构及文档链接检查通过；启用 Storybook 的完整 Playwright 为 93 passed / 15 skipped，跳过项为另一视口覆盖的组件、容量或生命周期专属场景。最终未知状态防御和诊断内容截图另经 3 passed / 1 skipped 定向复验，未受影响的全量证据复用。新增与受影响的宽窄、深浅截图已经人工查看；浏览器验证覆盖真实 Product Host 与受控 gRPC fixture，不等同外部 Provider、QQ 或生产操作。容量检查覆盖 320～1440 CSS px，未宣称原生浏览器缩放或实体触控验收。完整报告保留在 `build/reports/playwright/personal-server/report/`。

[M12：契约脊柱与跨进程服务架构重建](./milestones/M12-契约脊柱与跨进程服务架构重建.md) 已完成：旧 `protocol/` 物理删除，独立 Document 进入 `contracts/json-schema/` compatibility baseline，Service/DTO consumer 使用 Contract Spine edge；Surface Gateway 使用有限 typed Query/Command/Event DTO，Kernel 与产品 Adapter 映射 owner-local request/projection，公开 Extension SDK 只保留扩展作者与 Host Port API。第三方 Cubism SDK 仍只存在于 ignored 本机供应目录，不进入 Git。

[M13：工程自动化脊柱与交付生命周期闭环](./milestones/M13-工程自动化脊柱与交付生命周期闭环.md) 已完成 A～F 与最终仓库工具收口：部署事务、数据恢复、task graph/CI、owner-local tooling、Personal Server 供应链与 Desktop packaging 均已落到 [M13 完成态物理目录](./manifests/M13-目标物理清单.md)；长期跨仓工具位于 `tools/repo-checks/` 与 `tools/workspace-supervisor/`，root `package.json` 只保留稳定 façade，root `scripts/` 已删除。未绑定固定版本/制品的 update check/apply 继续 unsupported/fail-closed；Kernel DLQ 使用 owner-local EventBus replay 与绑定 receipt，legacy Cognition source 仍不支持 replay。

M12/M13 的完成态目录、迁移动作和删除门分别见对应 [M12 清单](./manifests/M12-目标物理清单.md) 与 [M13 清单](./manifests/M13-目标物理清单.md)。2026-08-25 起，当前活跃面切换为 M11 Personal Server 前端；架构、AI 辅助开发闭环和视觉方向已经确认，首个 React Shell/Router slice 已实施并进入验证/审查门。

[M11：Personal Server 控制面、区域分发与跨产品 Extension 闭环](./milestones/M11-Personal%20Server控制面、区域分发与跨产品Extension闭环.md) 保持 `in-progress`。[ADR-0017](../architecture/decisions/ADR-0017-产品前端统一采用React组件驱动架构.md) 与 [M11 UI 设计简报](./design-briefs/M11-Personal%20Server%20UI设计简报.md) 的最终视觉方向已于 2026-08-25 确认。Shell/Router 后，概览已迁入 React，删除旧 StatusView、route adapter 和 status 样式，并补齐窄屏退出登录。当前装配由 [Product Compositions](../reference/product-compositions.md) 唯一维护，删除门与测试位置见 [M11 清单](./manifests/M11-目标物理清单.md)。对话已迁入 React 并删除旧 DOM owner；能力、活动和设置 React slice 已完成本地实现及独立审查；M11 的 Extension/NapCat 与生产范围仍未完成。

2026-09-07 本次实现由当前任务独占写入，授权限于本地 M11 实现；候选基于 `e4c8d7c7` 的概览/Shell、对话、历史契约、测试与文档改动，未提交、推送或发布。独立审查发现的窄屏退出入口、重连目录 freshness、历史元数据跨进程丢失及服务端 transient 未被持久历史替换均已修复并定向复审。

本切片验证：根 `pnpm typecheck`、`pnpm build`、Personal Server 39 项测试、5 项架构测试、1 项真实 Kernel → protobuf → 两产品历史映射测试与 9 项 Kernel Gateway 测试、Storybook build、编码及仓库架构检查通过。启用本地 Storybook 后，完整 Playwright 为 62 passed / 8 skipped；跳过项为已由另一视口项目覆盖的认证、容量、组件或窄屏专属场景。新增目录延迟反例只抑制发往浏览器的消息，保留 Host readiness 观测，验证在线握手不能提前清除旧目录标记。Contract Spine 的 inventory、lint/breaking、Schema、固定工具链及 TS/Python/C# round-trip 通过，连续生成一致；当时 `contracts:verify` 最后的 Git clean-tree gate 因生成物未暂存而失败；本轮固定暂存候选后已重跑通过。

视觉证据包括深浅宽屏、深色 480×900、空目录、降级、读取失败和运行体详情基线；已检查代表截图。长内容、键盘、焦点返回、reduced-motion、深浅主题 axe 与 320～1440 CSS px 容量矩阵通过。720/360 CSS px 用于模拟 1440px 表面的 200%/400% 可用宽度，不宣称原生浏览器缩放或实体触控验收。报告位于 `build/reports/playwright/personal-server/report/`；后续源码、fixture、依赖或截图环境变化时重验受影响证据。对话另有恢复/空态深浅宽窄屏截图，历史分页、实时合并、断线草稿、发送防重与重试、迟到响应和组件状态已纳入同批回归。概览与对话本地切片完成，完整 M11 及生产/跨仓门仍未完成。

2026-09-07 能力页后续候选由同一任务独占写入：`features/capabilities/` 拥有 React 列表、安装表单、版本/诊断抽屉和事务 Controller；旧 `features/extensions/` 与 route mount 入口已删除。四种来源、启停、升级/回滚、离页预览取消、提交防重和连接恢复保留，真实装配见 Product Compositions。新增 6 项 Controller 反例测试，Personal Server 共 45 项测试通过；根 typecheck/build、迁目录后的产品 typecheck、5 项架构测试、Storybook build、编码、仓库架构和 70 个文档本地链接通过。启用 Storybook 的完整浏览器回归为 70 passed / 10 skipped，跳过项为已由另一视口覆盖的专属场景；回滚后卸载非激活版本另补定向断言。深浅宽屏、480×900 目录/表单/详情基线已检查，320～1440 CSS px、reduced-motion、键盘焦点和深浅主题 axe 已验证；不宣称原生缩放或实体触控验收。

能力页独立审查已恢复并完成：终结错误回执后预览锁死、目录读取与操作错误互相覆盖两项 P2 已修复并定向复审通过。新增 2 项 Controller 反例，产品共 47 项测试通过；能力页真实 Host 浏览器验证为 9 passed / 1 skipped，覆盖 commit/cancel 终结失败后重新安装。根 typecheck/build 与 Storybook build 已重跑通过，上一批未受影响的全量回归证据复用。该批历史证据后的设置进展见下段。候选在当时未提交、推送或发布；当时的契约 clean-tree gate 限制已在本轮设置提交检查中解除。

活动页 React slice 已实现并通过独立生命周期审查：`features/activity/` 拥有页面、CSS Module、hook 与读取/订阅 Controller，旧 ObservabilityView、mountActivity 和旧目录已删除。新增 4 项反例验证迟到读取、筛选代际、停止后流回调、200 条暂停缓冲与重连；产品共 51 项测试通过。真实 Host 已验证日志追加、暂停/继续、详情焦点返回、NDJSON 导出、读取失败恢复、空筛选、长内容及 320～1440 CSS px 深浅主题 axe；认证失效、退出与 route cleanup 回归通过。根 typecheck/build、Storybook build、5 项架构测试、编码与仓库架构检查通过；深浅宽屏与 480×900 列表/详情视觉基线已检查，不宣称原生缩放或实体触控验收。启用 Storybook 的完整浏览器批次为 77 passed / 12 skipped / 3 failed；失败来自旧 DOM 选择器（两个视口）与空列表缺少区域语义，均已修复，受影响场景定向复验为 8 passed / 2 skipped，涵盖 Activity 状态、真实日志交互及宽窄屏视觉基线。其余全量证据复用，跳过项为另一视口已覆盖的专属场景。该批历史证据后的设置进展见下段；当时本地改动未提交、推送或发布。

2026-09-07 设置大块由同一任务独占完成，用户追加授权将累计 M11 本地改动提交 Git。七子区 React 迁移及旧 owner 删除完成，沿用已确认设计方向；独立审查三项 P2（运维旧读覆盖、迟到 POST 终态回退、Skill 投影遗漏）修复并复审通过，新增 8 项 Controller 反例。57 项产品测试、5 项架构测试、根 typecheck/build、Storybook build、编码/仓库架构及 70 个文档本地链接通过；完整浏览器回归为 88 passed / 14 skipped，跳过项由另一视口覆盖。七子区深浅主题 axe、320～1440 CSS px、确认焦点及宽窄截图已验证，不宣称原生浏览器缩放或实体触控验收。Contract Spine 全部门通过；生成物暂存固定后，连续生成一致且工作树对暂存区无差异，原 clean-tree gate 限制已解除。另按用户要求将 Personal Server Vite 配置转为 `.mts` ESM，补齐 public 根目录的源码入口映射；CJS 弃用警告已消除。设置分类 Drawer 的深浅主题 axe、Escape 焦点返回及视觉细节另经定向复验；Vite 开发入口浏览器加载与最终生产构建通过。本次提交固定上述累计 M11 本地变更，未推送或发布。

`v0.1.8` 已从 fixed commit `8d8bdabb7047a63cc03fe2e28f67f41ce5c2a17a` 正式发布。GitHub Release、五项公开资产和统一摘要链已验证；全新 Ubuntu 24.04 remote/full 安装完成，控制机与服务器双重摘要通过，应用与默认 Caddy 均从本地已校验镜像归档加载。`/readyz`、容器、ops bridge 与端口通过，同版本幂等重装通过，安装期间未观察到 Registry 回源；当前服务器健康运行 `v0.1.8`。

真实失败回滚仍未完成：当前缺少获授权的 distinct candidate 或 fault injection 入口，不能用同版本重装、伪造本地回归或未经授权的生产故障替代。NapCat `external_onebot`/QQ E2E、真实发布物 Extension 升级失败恢复与跨仓生产闭环也仍未过门。

2026-09-07 后续 Provider 连接测试切片基于已提交的 `75b10f8c` 推进：同一目标可复用已保存密钥，变更目标或清除密钥禁止复用；自定义网关路径、拒绝重定向、超时、响应限额与受控诊断已落实，精确规则见 [Configuration Reference](../reference/configuration.md#provider-连接测试)。12 项配置测试与 9 项 Gateway 测试通过，含真实本地 HTTP 请求及重定向反例；独立审查发现的非法标识审计泄露已修复并复审通过。未使用外部 Provider 或生产凭据验收。Kernel Vitest 配置已转为 `.mts`；全仓三个 Vite/Vitest 配置入口均使用 ESM，Extension SDK/Host 的 14 项测试及两个产品构建未出现 CJS Node API 弃用警告。后续排查规则进入测试与验收指南。

M11 仍未完成的范围：

- Extension：正式发布 SDK/Contract public edge 与精确扩展发布物，固定跨仓 revision，完成跨产品安装、升级失败恢复、回滚及扩展配置/Secret 的完整验收；
- 把 NapCat 拆成跨平台 QQ 场景 Adapter 与平台资源配置，在 Personal Server 上先支持外部 OneBot；
- 验证 Extension 私有 Skill、场景注意力、回复、Experience 与 Memory 的完整链路；
- 生产运维：真实更新失败自动恢复、备份/恢复连续性、长运行及完整停机矩阵；
- 把区域 HTTP(S)/OCI 传输副本保留为长期演化候选，只有真实需求出现后再实施。

## 下一验收门

### 已完成里程碑与环境风险

M12/M13 当前没有未闭合的代码集成门。真实 Docker/Ubuntu、Windows installer 安装/首启/
升级/卸载、签名、公证、Registry、GitHub Sigstore attestation/Release 与生产操作仍是环境
风险，不能从 isolated fixture、dry-run 或 source build 外推为通过；这些门只有在用户选择
发布/运维目标并授权唯一环境 owner 后才能执行。

### Personal Server 页面本地交付门

五个一级页面与七个设置子区已全部实现，以下接受标准由现有代码、组件工作台及产品浏览器回归覆盖；具体证据与未覆盖的原生设备行为见上文。完整 M11 的跨仓、NapCat 和生产门仍需继续收口：

1. ADR-0017 已接受 React + Vite + React Router + React Aria + CSS Modules + Storybook/Playwright 分层；首个 slice 已固定直接依赖版本，后续升级仍按直接 consumer 与验证选择。
2. M11 最终视觉方向已确认；Shell/Router、shared UI 和五域 feature 已落地，并按 [M11 目标物理清单](./manifests/M11-目标物理清单.md) 删除对应旧 DOM owner，不保留双主线。
3. 页面唯一挂载、登录层隔离、URL/history/deep-link、back/forward、refresh、unknown route 与 route cleanup 已进入真实 Product Host Playwright；后续 feature slice 必须保持这些门。
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
- 当前按已授权的前端垂直切片推进；品牌资产及生产发布继续使用各自任务与验收门。
- 不把 NapCat 的 Windows OneKey 启动逻辑伪装成 Linux 兼容。
- 不让 Extension 私有 Skill 泄露到无关 ConversationContext，也不把管理操作伪装成人物 Skill。
- 不为特定云厂商、地域或代理域名分叉安装协议。
- 不在缺少 Debian 实机矩阵时声明 Debian 正式支持。

未承诺候选事项见 [backlog.md](./backlog.md)。

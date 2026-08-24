# Now

> 审阅日期：2026-08-24
> 范围：当前里程碑切换状态、下一验收门和近期不做事项；不记录已完成架构事实正文。
> 维护触发：当前里程碑、验收门、风险、范围或审阅日期变化。

[M10：发布形态、安装投影与数据迁移闭环](./milestones/M10-发布形态、安装投影与数据迁移闭环.md) 已完成。Personal Server 已具备公开 Release、digest 固定 OCI、轻量/完整安装包、可信来源校验、不可变版本目录、事务更新回滚、备份恢复和停机回收主链；Ubuntu 24.04 LTS、linux/amd64 是当前实测支持基线。

## 当前推进面：M12 Slice 5～6 已集成与 M13 fixed-state 复审

[M12：契约脊柱与跨进程服务架构重建](./milestones/M12-契约脊柱与跨进程服务架构重建.md) 的 Slice 1～6 已集成：`contracts/` baseline、Kernel↔Cognition v1 Service、受 Kernel 监督的动态回环 gRPC、Kernel 物理分层、Cognition `domain/application/ports/adapters/host` 物理收口、Avatar Core/UnityAvatarHost 分离，以及 Extension Host 独立崩溃域均已落到主工作树。Slice 6 集成 commit 为 `2c0e145ee6fb98c2df09d40f7f63e1a850e4b748`。Slice 5 已拆分 `core/avatar/` 与 `hosts/unity-avatar-host/`，并把 Avatar control IDL、三语言/C# projection 与当前 transport edge mapping 从 Slice 8 前移到 `contracts/proto/glimmer/avatar/v1/`；Core 使用无 wire envelope 的 typed command/event，Unity Host Adapter 对 kind/payload/必填字段/枚举 fail closed；legacy Unity C# projection、旧六 asmdef 与旧 Unity 路径已删除。Slice 6 已新增 `hosts/extension-host/` 独立进程、`glimmer.extension.v1` Host process contract 与 Extension SDK host process protocol，Kernel 只保留监督、权限、catalog、编排和 Projection owner；Kernel 内旧 Worker 执行入口、legacy Worker protocol、旧 schema mirror 与兼容桥已删除。Kernel↔UnityAvatarHost 运行 consumer 当前仍为受管动态回环 WebSocket；切到 `AvatarHostService.Connect` 及其 deadline/cancellation/status/readiness/reconnect 门明确属于 Slice 8。Slice 7～9 尚未启动，M11 仍暂停/延期且未完成。

[M13：工程自动化脊柱与交付生命周期闭环](./milestones/M13-工程自动化脊柱与交付生命周期闭环.md) 的 A～F 已在唯一 writer 分支形成第二轮审查修复后的 fixed-state candidate：部署事务、数据恢复、task graph/CI、owner-local tooling、Personal Server 供应链与 Desktop packaging 均已落到 [M13 完成态物理目录](./manifests/M13-目标物理清单.md)。候选继续把未绑定固定 candidate 的 update check/apply 设为 unsupported/fail-closed；Kernel DLQ 已有 owner-local EventBus replay 与绑定 receipt，legacy Cognition source 仍未注册 replay。该状态尚未再次独立复审或集成，不能写成 main 已完成。

M12/M13 的完成态目录、迁移动作和删除门分别见对应
[M12 清单](./manifests/M12-目标物理清单.md) 与
[M13 清单](./manifests/M13-目标物理清单.md)。M12-9 必须在候选状态重新核对全部
Protocol consumer，不能用冻结 main inventory 冒充完成证据。

旧 Slice A checkpoint 已由原 owner 保全并重放到 canonical
`deploy/personal-server/lib/host-transaction.sh`；旧临时路径不属于完成态。下一步只做候选
commit 的独立复审、必要修复与集成，不再恢复 rejected checkpoint。

[M11：Personal Server 控制面、区域分发与跨产品 Extension 闭环](./milestones/M11-Personal%20Server控制面、区域分发与跨产品Extension闭环.md) 暂停/延期，未完成、未关闭。M12 Slice 1 是用户授权的“不切运行主线”前置基线工作，不表示 M11 前置依赖已经满足，也不得把 M11 写成完成。

`v0.1.8` 已从 fixed commit `8d8bdabb7047a63cc03fe2e28f67f41ce5c2a17a` 正式发布。GitHub Release、五项公开资产和统一摘要链已验证；全新 Ubuntu 24.04 remote/full 安装完成，控制机与服务器双重摘要通过，应用与默认 Caddy 均从本地已校验镜像归档加载。`/readyz`、容器、ops bridge 与端口通过，同版本幂等重装通过，安装期间未观察到 Registry 回源；当前服务器健康运行 `v0.1.8`。

真实失败回滚仍未完成：当前缺少获授权的 distinct candidate 或 fault injection 入口，不能用同版本重装、伪造本地回归或未经授权的生产故障替代。NapCat `external_onebot`/QQ E2E、真实发布物 Extension 升级失败恢复与跨仓生产闭环也仍未过门。

M11 暂停前仍未完成的范围：

- 由 Kernel Config Application Port 统一提供可校验、可脱敏、可审计的配置投影与更新命令；
- 为 Personal Server 提供零 Provider 可登录的正式控制面，以及 Provider、真实对话、状态、日志、Audio、Memory、Skill、安全、存储和更新能力；
- 收口 Personal Server 当前 UI 的路由正确性、信息架构、视觉系统、响应式、可访问性和截图验收；
- 让 Extension 安装、启停、升级、权限与产品兼容性通过同一 Package Manager 闭环；
- 把 NapCat 拆成跨平台 QQ 场景 Adapter 与平台资源配置，在 Personal Server 上先支持外部 OneBot；
- 验证 Extension 私有 Skill、场景注意力、回复、Experience 与 Memory 的完整链路；
- 把区域 HTTP(S)/OCI 传输副本保留为长期演化候选，只有真实需求出现后再实施。

## 下一验收门

### M13 fixed-state 独立复审与集成门

独立复审以候选 commit/tree 和验证账本为输入，逐项核对 A～F 物理清单、实际 diff、旧入口
删除门、事务 trusted namespace、外部 handoff、恢复失败终态、DLQ lifecycle、CI/Release
权限以及 Desktop clean Windows runner 风险。真实 Docker、Ubuntu、Windows installer、
签名、公证、Registry 与生产未运行，不得从隔离 fixture 外推。复审通过后由总控集成；若
M12 后续切片修改相同 generate/build/package 入口，必须按固定 commit 串行 handoff。

### Personal Server UI 优化门

本门当前只完成问题与规范记录，UI 优化尚未实现：

1. 先修正页面唯一可见、登录层隔离、URL/history/deep-link、back/forward 和复杂页面挂载语义，并补齐“非当前页面隐藏”断言。
2. 信息架构收敛为单层全局导航；页面内只在真实子域存在时显示二级导航。Context Inspector 改为选中对象后按需出现的 Context Drawer。
3. 对话、概览、能力、活动、设置形成清晰一级域；设置拆为模型与路由、语音、记忆、安全、存储、更新等真实子页面；runtime、日志、Extension、Provider 使用列表/主体 + 按需详情。
4. 重大实现前固定相同信息架构、内容与功能，产出至少三个真正不同的视觉方向；每个方向覆盖对话、系统概览、设置的宽屏和窄屏。用户确认或明确混合元素后，才固化具体 token 与组件语言。
5. 响应式由页面内容容量驱动；不同用途页面拥有不同内容宽度，并覆盖临界宽度、长内容、100–400% 缩放、键盘、焦点、reduced-motion 与触控目标。
6. 所有方向和最终实现覆盖 `loading`、`empty`、`degraded`、`error`、`pending`、`success`，并建立代表页面/关键状态截图基线与真实交互回归。
7. 正式 Logo、Wordmark、Favicon 和统一图标系统等待未来品牌资产任务；本门不以硬编码字符、单字伪图标或临时资产替代。

当前“无边界 + Bubble”只是视觉探索比较基线，不是永久主题、表面结构或架构不变量。外部产品、官方设计系统和 frontend Skill 只提供方法 inspiration，不成为项目事实源，也不覆盖用户后续选择权。

### 生产与跨仓门

1. 取得 distinct candidate/fault injection 的明确授权与固定制品，验证真实更新失败自动恢复；未取得入口前保持阻断，不操作健康服务器。
2. 通过跨仓库固定发布物完成 Extension 安装、升级、失败恢复和回滚证据。
3. 取得获授权 external OneBot/QQ 环境，完成 NapCat 私聊、群聊、背景观察、注意力、私有 Skill、回复、Experience、Memory 与重启连续性 E2E。
4. 完成长运行、备份/恢复连续性与完整停机矩阵，确认端口、连接、Worker 和受管进程全部释放。

## 近期不做

- 不让浏览器直接读写服务器 YAML、Secret、任意文件路径或 Docker Socket。
- 不把 Desktop 的 Avatar、窗口、剪贴板和本机设备页面复制到 Personal Server。
- 不在用户确认前选择最终视觉方向，或把深色、Bubble、无边界、圆角、配色写成永久不变量。
- 不在本 UI 规范任务中实现路由、布局、响应式、品牌资产或测试改动。
- 不把 NapCat 的 Windows OneKey 启动逻辑伪装成 Linux 兼容。
- 不让 Extension 私有 Skill 泄露到无关 ConversationContext，也不把管理操作伪装成人物 Skill。
- 不为特定云厂商、地域或代理域名分叉安装协议。
- 不在缺少 Debian 实机矩阵时声明 Debian 正式支持。

未承诺候选事项见 [backlog.md](./backlog.md)。

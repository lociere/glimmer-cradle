# Now

> 审阅日期：2026-07-23
> 范围：当前里程碑切换状态、下一验收门和近期不做事项；不记录已完成架构事实。
> 维护触发：当前里程碑、验收门、风险、范围或审阅日期变化。

[M10：发布形态、安装投影与数据迁移闭环](./milestones/M10-发布形态、安装投影与数据迁移闭环.md) 已完成。Personal Server 已具备公开 Release、digest 固定 OCI、轻量/完整安装包、可信来源校验、不可变版本目录、事务更新回滚、备份恢复和停机回收主链；Ubuntu 24.04 LTS、linux/amd64 是当前实测支持基线。

## 当前唯一活跃推进面：M11 Personal Server 控制面与 Extension 闭环

[M11：Personal Server 控制面、区域分发与跨产品 Extension 闭环](./milestones/M11-Personal%20Server控制面、区域分发与跨产品Extension闭环.md) 已进入 `in-progress`，现为唯一活跃推进面。当前实现已完成 Config Application Port 对 Provider、Audio、Embedding、Memory、Skill 的正式读写链路，Personal Server 设置页也已本地验证这些配置以及 Security/Storage/Update 正式能力投影；扩展生态模板仓库已补齐 `release:prepare`、`.gcex` 构建、GitHub Release workflow、`SHA256SUMS` 与文档。2026-07-24 生产验收确认目标服务器与 GitHub latest 仍是 v0.1.1 三页控制面，公开资产没有完整安装包，生产缺少 M11 设置/日志/运维/API、本地 `.gcex` 上传与 CLI backup/restore。因此当前仍未过门的是发布或部署包含当前 M11 实现的 digest 固定版本、全新 Ubuntu 安装、宿主运维恢复矩阵、真实发布物升级/失败恢复，以及跨仓库 NapCat `external_onebot` 闭环。

M11 负责：

- 由 Kernel Config Application Port 统一提供可校验、可脱敏、可审计的配置投影与更新命令；
- 为 Personal Server 提供可在零 Provider 状态下登录使用的正式控制面，以及按需配置 Provider、真实对话、状态、日志、Audio、Memory、Skill、安全、存储和更新页面；
- 让 Extension 安装、启停、升级、权限与产品兼容性通过同一 Package Manager 闭环；
- 把 NapCat 拆成跨平台 QQ 场景 Adapter 与平台资源配置，在 Personal Server 上先支持外部 OneBot；
- 验证 Extension 私有 Skill、场景注意力、回复、Experience 与 Memory 的完整链路；
- 把区域 HTTP(S)/OCI 传输副本保留为长期演化候选，只有在真实用户规模或长期稳定网络需求出现后再实施。

## 第一验收门

1. Protocol 合入 Config Snapshot/Command、Secret write-only、Extension 兼容性与受管资源 profile 契约。
2. Kernel 成为唯一配置 owner，能够脱敏读取、预览变更、拒绝 revision 冲突并原子提交。
3. Personal Server 在零 Provider 状态下也能登录并进入完整控制面；执行依赖 LLM 的对话时才明确提示尚未配置可用模型。
4. 设置中心可新建 Provider、测试连接、保存模型路由，并在浏览器内完成 Audio、Embedding、Memory、Skill 的正式配置与 Security/Storage/Update 能力查看；页面信息架构、响应式布局、加载/空态/失败恢复和 Playwright 截图矩阵先形成可持续设计基线，不以临时表单堆叠代替正式控制面。

## 近期不做

- 不让浏览器直接读写服务器 YAML、secret、任意文件路径或 Docker Socket。
- 不把 Desktop 的 Avatar、窗口、剪贴板和本机设备页面复制到 Personal Server。
- 不把 NapCat 的 Windows OneKey 启动逻辑伪装成 Linux 兼容。
- 不让 Extension 私有 Skill 泄露到无关 ConversationContext，也不把管理操作伪装成人物 Skill。
- 不为特定云厂商、地域或代理域名分叉安装协议。
- 不在缺少 Debian 实机矩阵时声明 Debian 正式支持。

未承诺候选事项见 [backlog.md](./backlog.md)。

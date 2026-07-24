# M11：Personal Server 控制面、区域分发与跨产品 Extension 闭环

- 状态：in-progress
- 关联架构：[Product Compositions](../../reference/product-compositions.md)、[Extension 与 Skill Plane 当前视图](../../architecture/current/07-子系统当前视图/Extension与SkillPlane.md)
- 关联决策：[ADR-0011 Extension 发布与开放生态边界](../../architecture/decisions/ADR-0011-Extension发布与开放生态边界.md)、[ADR-0012 场景 Adapter 与平台受管资源分层](../../architecture/decisions/ADR-0012-场景Adapter与平台受管资源分层.md)
- 前置里程碑：[M10：发布形态、安装投影与数据迁移闭环](./M10-发布形态、安装投影与数据迁移闭环.md)

## 目标成果

让已部署的 Glimmer Cradle Personal Server 不依赖源码树、Desktop 或直接编辑原始 YAML 就能在最小可启动状态下进入正式控制面、完成日常运维和远程 Extension 管理；让场景 Adapter 从特定平台进程启动器中解耦，使 NapCat 作为 QQ 场景扩展在 Personal Server 上通过受控 OneBot 端点完成感知、注意力、Skill、回复与记忆闭环。

完成后，用户应能通过一条命令安装受支持的 Linux 发行物，在零 Provider、零 TTS、零 ASR、零 Embedding 的最小状态下登录完整控制面查看状态、日志、Extension、Skill、安全和设置；随后按需配置 LLM Provider 并完成真实对话，从精确 Release 安装与当前产品兼容的 `.gcex`，连接外部 NapCat 后在 QQ 场景持续交互；更新失败能够恢复上一版本，停止后不残留端口、连接或受管进程。

## 架构不变量

1. Kernel Config Application Port 是系统配置读取、校验、更新计划和生效状态的唯一业务入口；Personal Server Host 不成为第二个 YAML owner。
2. Renderer/浏览器只消费脱敏投影并提交用户 intent。Secret 只能写入、替换和删除，永不回显，也不进入日志、Trace、诊断包或浏览器持久缓存。
3. 配置更新必须经过 Schema/normalizer、revision 检查和原子写入，明确返回 `applied`、`reload_required`、`restart_required` 或失败恢复语义。
4. Extension 安装继续汇入同一个 Kernel Package Manager；Registry、精确仓库 Release、Release Manifest 和 Desktop 本地包不能形成不同安装规则。
5. NapCat Adapter Core 不理解 Docker、Windows 注册表或 QQ 安装目录。平台受管资源 profile 通过公开契约注入，且不得向 Extension 暴露 Docker Socket 或 Kernel 内部对象。
6. Personal Server 只暴露受认证产品 ingress。Kernel 动态回环端点、配置文件路径和内部服务地址不得成为远程公共 API。
7. 若未来出现真实用户规模或长期稳定网络需求，区域 HTTP(S) 对象端点或 OCI Registry 只能作为同一发布物的可选传输副本；tag、摘要、镜像身份、签名、SBOM 与 provenance 仍由统一发布流水线产生，不要求在本里程碑内建设第二传输协议。

## 范围

### 配置控制面

- 为系统配置、Character Provider、Audio、Embedding、Memory、Skill 与 Extension 设置建立 Protocol Schema、脱敏 `ConfigSnapshot`、变更预览和 update command。
- 建立非阻断的 Provider 配置流程：Provider 类型、Base URL、模型映射、连通性测试、Secret 写入和首个真实对话验收。
- Provider 支持新建、编辑、删除、启用、连接测试和模型选择；删除或切换时必须检查当前 Character 路由引用。
- TTS、ASR 与 Embedding 保持显式增强：默认关闭不影响基础 readiness，启用后才要求资源、Secret 和 provider probe。
- 配置页面展示实际生效来源、revision、脏状态、保存结果和重启要求，不提供无边界原始 YAML 编辑器；缺少默认 Provider 只作为可解释告警或空态行动按钮，不阻断控制面登录。

### Personal Server 网页

- 一级信息架构收敛为 `对话`、`状态`、`扩展`、`日志`、`设置`；控制面独立可登录，零 Provider 状态下仍可进入全部页面。保持 Desktop 设计语言，但不复制 Avatar、窗口、剪贴板和本机录音等设备页面。
- 状态页展示 Kernel、Cognition、Audio、Extension Host、Provider、受管资源、启动耗时和 degraded 原因。
- 日志页提供结构化事件流、级别/模块/`trace_id` 筛选、暂停、自动滚动、原始/结构化切换和安全导出，不让浏览器直接读取日志文件。
- 设置页覆盖模型服务、音频、Embedding、记忆、Skill、安全、存储、更新和 Extension 配置；高风险操作必须二次确认并进入审计。
- 补齐窄窗口、移动端、键盘导航、焦点、加载、空态、失败恢复、长文本和低速连接体验；动效遵循淡入/状态过渡，不使用横向弹跳。

### Extension 分发与管理

- 正式发布 `@glimmer-cradle/protocol` 与 `@glimmer-cradle/extension-sdk` 语义化包，独立扩展不得依赖主仓库本地链接。
- 提供社区仓库模板和 Release workflow，自动校验、测试并生成规范命名 `.gcex`、包内摘要和 SPDX SBOM；多平台时按需生成 Release Manifest。
- 安装预览展示产品/平台/feature 兼容性、权限、发布者、Registry 审核、签名、构建证明、下载大小和受管资源计划。
- 安装、激活、升级、回滚、禁用与卸载使用同一事务事实源；失败不得留下半安装目录或失效 active 选择。
- `glimmer.setting` 生成普通配置表单；扩展 Secret 使用独立写入边界。Extension 管理 Surface、Capability Graph 和诊断继续通用渲染，不硬编码 NapCat 页面。
- 扩展远程资产支持项目方控制的可信区域传输端点，但不改变作者 Release 与 Registry 的职责。

### NapCat Personal Server

- 把 OneBot 解析、场景身份、注意力、感知、回复和 Skill 从 Windows 进程管理中抽为跨平台 Adapter Core。
- 首个 Linux 版本实现 `external_onebot`，连接用户或部署层已运行的 NapCat；`managed_windows_onekey` 继续作为 Desktop Windows profile。
- 为 Compose 私有网络和跨主机连接分别定义地址、鉴权、TLS、重连、心跳、限流、超时、背压和诊断语义。
- QQ 私聊、群聊、群内发送者注意力、背景观察、回复路由、关系/经历作用域和重启连续性必须端到端验证。
- NapCat 私有 `source_provider` Skill 只在 QQ 来源场景可见；全局 Skill 必须单独声明、授权并满足产品与平台约束。
- WebUI、二维码、快速登录、账号选择和上游进程操作属于用户管理能力；QQ ingress、QQ reply、WebUI 和上游资源分别投影 readiness。
- 发布真实 `linux-x64.gcex` 后才允许 Personal Server 安装；禁止仅修改 Manifest 形成假兼容。

### 运维、安全与长期运行

- 提供更新检查、版本固定、备份、恢复、回滚、数据保留和只读诊断入口；部署级操作仍由 `glimmer-cradle` 运维命令拥有。
- 远程下载覆盖 SSRF、HTTPS 重定向、大小/文件数/膨胀限制、超时、摘要、签名和临时文件清理。
- 配置、Extension、Skill 和管理命令进入审计；敏感字段执行统一脱敏。
- 覆盖长时间运行、断网恢复、Provider 熔断、Extension 重连、磁盘增长、日志保留、重启连续性和完整停机。

## 非范围

- 不建设 Managed Cloud、多租户组织、计费、公共账号体系或中心化扩展商店。
- 不把 Personal Server 网页变成 Desktop 的远程镜像，不提供 Avatar、本地麦克风或任意宿主文件浏览。
- 不允许 Renderer 直接读取/写入 YAML、SQLite、日志文件、Extension 安装目录或 Secret。
- 不把 NapCat、QQ 程序、账号数据或第三方二进制打入 Glimmer Cradle/`.gcex` 源码发布物。
- 不在本阶段给 Extension 容器编排 root 权限；服务器受管伴随容器只有在专用 Workload Port、安全模型和部署实现成熟后再进入范围。
- 不承诺一次覆盖所有第三方平台 Adapter；NapCat 是压力测试样本，不是 Kernel 特例。

## 依赖

- M10 完成可重复安装、可信来源参数、版本固定、升级、回滚、备份和停机回收基线。
- Protocol 能表达 Config Snapshot/Command、产品/平台兼容性、资源 profile、安装进度和 Extension 配置 Secret。
- Kernel Config owner、Extension Package Manager、Capability Graph、Skill Policy/Gateway 与审计链路保持单一事实源。
- `@glimmer-cradle/protocol`、`@glimmer-cradle/extension-sdk` 有可公开取得的精确版本和跨仓库 CI。
- NapCat 上游提供可部署的 OneBot 11 服务，且其许可、账号数据和网络要求得到明确处理。

## 实施顺序

1. **事实与契约**：修正 Current/Reference，新增配置、兼容性、资源 profile 和安装状态 Schema；生成并同步三端契约。
2. **Kernel 配置主线**：实现脱敏 snapshot、Secret command、校验、revision、原子提交、生效计划、审计和失败恢复；删除产品层第二写入入口。
3. **Personal Server 页面**：先完成首次配置和 Provider，再完成状态、日志、音频、记忆、Skill、安全、存储与更新页面。
4. **Extension 发布主线**：发布 SDK/Protocol、仓库模板、Release CI、兼容性预览、安装进度、配置与回滚。
5. **NapCat 跨产品化**：抽离 Adapter Core，落实外部 OneBot Linux profile、私有网络与 QQ 场景 E2E，再发布 Linux `.gcex`。
6. **生产验收**：在全新服务器执行安装、网页配置、真实对话、扩展安装、QQ 场景、升级回滚、长运行与停机矩阵。

每一步完成时必须删除被替代的直写、平台耦合和旧文档入口；不得在最后统一清理。

## 实施追踪清单

### 当前检查点（2026-07-24）

- 已完成：控制面物理结构从 `public/app.js`/`app.css` 单体迁移到 `products/personal-server/src/server/*` 与 `src/web/*`，并有架构门禁阻止旧入口回流。
- 已完成：Protocol、Kernel Config Application Port 和 Personal Server 设置页已形成 LLM Provider/默认路由的真实闭环；零 Provider 可登录控制面，依赖 LLM 的对话会返回明确 `conversation_notice`。
- 已完成：状态页已接 `ReadinessStatus`、runtime catalog 与配置快照；日志页已接真实结构化日志 HTTP/SSE、级别/模块/`trace_id` 筛选、暂停、原始视图与安全导出。
- 进行中：NapCat Linux profile、宿主运维恢复矩阵与全新服务器安装验收。
- 已完成到当前阶段：Extension 页已接真实运行投影、仓库/Registry/Release Manifest 安装预览、安装提交、启停与卸载事务；浏览器本地 `.gcex` 已改为认证上传到 Product Host 受控临时目录并换取 opaque `upload_id`，随后由 Host 在同一安装事务内解析为 Kernel file source，具备会话绑定、30 分钟时效、单事务消费与成功/失败/取消/超时清理；安全页已接受管访问令牌 store，支持创建/轮换/撤销、legacy env degraded 标记与一次性明文返回；运维页已接正式 backup/update/service snapshot，并在缺少宿主运维桥时显示真实 disabled reason；Playwright 已固化零 Provider、Provider 保存、日志筛选、扩展安装/启用、版本切换回退、本地 `.gcex` 上传、访问令牌与运维 disabled reason 在桌面与窄窗双视口。
- 未开始或未过门：QQ 场景外部验收、Extension 升级/回滚、完整宿主运维恢复矩阵。

### 生产验收记录（2026-07-24）

- GitHub latest Release 已为 `v0.1.7`，公开资产包含服务器安装器、SSH push 安装器、轻量包、完整包与统一 `SHA256SUMS`；GitHub 继续是唯一发行事实源，未增加 GitCode、OSS、国内 Registry、公共代理或第二安装协议。
- `install-remote.sh` 审查确认控制机与服务器分别执行一次发布摘要校验，完整包随后复用 `install-release.sh`；full 路径加载应用镜像归档，将应用与跟随发行版的默认 Caddy 都切换到本地镜像，并通过 `GLIMMER_CRADLE_CANDIDATE_PRELOADED=1` 阻止部署层执行 Registry pull。
- 审查发现失败路径会保留服务器 `/tmp/glimmer-cradle-<version>.*` 的真实缺口；当前工作树已改为成功、远端校验失败和安装失败都清理，清理本身失败时以失败退出并报告精确目录。定向 `pnpm test:remote-install` 已覆盖成功、安装故障和推送后篡改，验证双重摘要、失败不提交与远端临时目录清理。
- 已配置目标 `47.99.49.252` 为 Ubuntu 24.04.2 LTS / linux amd64，但只读核验时已运行一周且 `/opt/glimmer-cradle/current -> /opt/glimmer-cradle/releases/0.1.5`，不是可销毁的全新主机。未获得重建该主机或创建新实例的入口，因此没有在其上执行清空、安装、重装或故障注入。
- 全新 Ubuntu 24.04 的真实 SSH push、`/readyz`、幂等重装、无 Registry 网络观察与失败回滚仍是当前安装链最终验收的唯一阻断；不能用已有生产主机或本地伪 SSH 回归替代。
- `glimmer-cradle-napcat-adapter` 当前本地存在 `release/lociere.napcat-adapter-0.1.0-linux-x64.gcex`，Manifest 声明 `personal-server`、`linux-x64` 与 `external_onebot`；但生产控制面缺少本地上传入口，且本次没有可用 external OneBot/QQ 凭据，因此未执行 QQ E2E。
- 结论：生产服务器当前证明的是 M10/v0.1.1 基础安装与三页控制面可用，不证明 M11 可归档。M11 生产验收的下一门槛是发布或部署包含当前 M11 控制面与运维桥的 digest 固定版本，再重复安装、设置、Extension、备份恢复、停机回收和 NapCat external OneBot 矩阵。

### 按实施顺序追踪

- `[x]` 事实与契约：配置 Snapshot/Command、Secret write-only、默认路由与 `conversation_notice` 契约已合入并完成生成同步。
- `[x]` Kernel 配置主线：LLM Provider 与默认路由的脱敏读取、revision、预览、原子写入、审计和 apply 状态已落地；Audio/Embedding/Memory/Skill 也已接入同一 Config Application Port，并经本地单测验证落盘与 snapshot 回读。
- `[~]` Personal Server 页面：登录、零 Provider 降级、系统 ready 轮询、状态页、日志页、服务端对话历史恢复、Provider 设置页、Audio/Embedding/Memory/Skill 设置页、访问令牌安全页、运维状态页与扩展运行/安装事务页已落地；Security/Storage/Update 读取失败语义已改为显式错误投影，并经桌面/窄窗 Playwright 验证关键流程；宿主运维桥、真实恢复矩阵与更广 smoke 仍未完成。
- `[~]` Extension 发布主线：统一安装事务、兼容性/信任元数据预览、启停、版本切换回退 UI、本地 `.gcex` 上传主线，以及模板仓库 `release:prepare`、`.gcex` 构建、GitHub Release workflow、`SHA256SUMS` 与文档已落地；真实发布物升级/失败恢复与跨仓库 Linux `.gcex` 门禁仍未完成。
- `[ ]` NapCat 跨产品化：外部 OneBot Linux profile、Adapter Core 收口、QQ 场景 E2E 与 Linux `.gcex` 发布未完成。
- `[ ]` 生产验收：公开 `v0.1.7` 与 SSH push 安装链已具备，定向回归已覆盖双重摘要和临时目录清理；现有目标不是全新可销毁主机，真实 remote install、`/readyz`、幂等重装、无 Registry 回源与失败回滚尚未完成。

### 第一验收门追踪

- `[x]` Protocol 合入 Config Snapshot/Command、Secret write-only、Extension 兼容性与受管资源 profile 契约，并通过生成一致性检查。
- `[x]` Kernel 能读取脱敏配置、预览一次变更、拒绝 revision 冲突并原子提交；Secret 从读取响应中消失。
- `[x]` Personal Server 首次配置页面可新建 Provider、测试连接、保存模型路由；真实角色回复链路、正式历史读取、分页恢复与 `conversation_notice` 已接入控制面输入。
- `[~]` 页面信息架构、响应式布局、加载/空态/失败恢复和仓库内 Playwright 基线已覆盖零 Provider、Provider 保存、Audio/Embedding/Memory 保存、Skill Catalog 刷新、安全令牌、运维 disabled reason、扩展安装/启用/版本回退与窄窗；更广运维/恢复矩阵尚未完成。
- `[x]` 区域传输副本已从近期实施范围移出，保留为长期候选，不再驱动当前代码。

### 最终验收门追踪

- `[ ]` 一条命令全新 Ubuntu 安装与无需源码树的完整控制面验收未完成；2026-07-24 GitHub latest `v0.1.7` 已具备完整包与 SSH push 安装器，但现有目标服务器不是全新可销毁主机。
- `[~]` 浏览器内 Provider、Audio、Embedding、Memory、Skill 配置以及 Security/Storage/Update 正式能力查看已本地打通并验证；生产 v0.1.1 尚未部署这些页面和 API，全新 Ubuntu 安装、宿主运维桥可用态、真实更新失败恢复与长期运行矩阵仍未完成。
- `[~]` Extension 统一事务 UI/投影已覆盖仓库/Registry/Release Manifest 预览、安装、激活、卸载、版本切换回退与浏览器本地 `.gcex` 上传；生产 v0.1.1 仅有旧远程来源入口，真实发布物升级、失败自动恢复和跨仓库 Linux `.gcex` 生产安装仍未完成。
- `[ ]` NapCat Linux 外部 OneBot 私聊/群聊/记忆链路和重启连续性验收未完成。
- `[ ]` 更新失败自动恢复、备份/恢复连续性、完整停机和长运行矩阵未完成；生产 v0.1.1 CLI 尚不支持 `backup`/`restore`，本次未在无备份前提下执行风险操作。
- `[~]` Personal Server Playwright 已覆盖零 Provider、Provider 保存、Audio/Embedding/Memory 保存、Skill Catalog 刷新、安全令牌、运维 disabled reason、扩展安装/启用与桌面/窄窗；安装矩阵和真实外部场景 smoke 尚未全部完成。

## 风险

| 风险 | 应对 |
|---|---|
| 配置 API 成为任意文件编辑器 | 只接受 Schema 定义的 command，路径和写入 owner 固定在 Kernel |
| Secret 经 snapshot、日志或浏览器缓存泄露 | write-only command、统一脱敏、无回显测试、诊断包扫描 |
| UI 保存成功但运行实例仍使用旧值 | 返回生效计划与 revision，显式 reload/restart，读取 effective snapshot 复核 |
| 区域端点与权威发布漂移 | 同流水线复制、签名清单和 digest 门禁，漂移立即阻断发布 |
| 扩展安装来源形成多套行为 | 所有来源只解析为统一 artifact，再进入同一 prepare/commit 事务 |
| NapCat Linux 只改声明未改实现 | 平台 CI、包内容检查、真实 OneBot E2E 和受管资源失败注入 |
| Extension 获得宿主级容器权限 | 禁止 Docker Socket；伴随服务只能经部署 owner 或未来受控 Workload Port |
| QQ 场景污染本地会话或其他群聊 | scene/source/actor/attention/space 作用域测试和回复路由审计 |
| 页面功能增长导致移动与窄窗不可用 | 固定响应式断点矩阵、容器约束、Playwright 截图与无重叠检查 |

## 第一验收门

- Protocol 合入 Config Snapshot/Command、Secret write-only、Extension 兼容性和受管资源 profile 契约，并通过生成一致性检查。
- Kernel 能读取脱敏配置、预览一次变更、拒绝 revision 冲突并原子提交；Secret 从所有读取响应中消失。
- Personal Server 首次配置页面可新建一个 Provider、测试连接、保存模型路由并得到真实角色回复。
- 区域传输副本从本里程碑近期实施范围移出；只有在真实用户规模或长期稳定网络需求出现后，才以同一发布物的可选传输副本重新立项，且必须复用 M10 的完整包、摘要与镜像身份，不形成第二安装协议。

## 最终验收门

- 全新 Ubuntu 24.04 主机无需 Git/Node/Python 工具链，一条命令完成安装；启用区域副本时，全球源、区域源和离线来源必须得到相同版本与摘要。
- 浏览器可以完成 Provider、Audio、Embedding、Memory、Skill、Extension、安全和更新的允许配置；Secret 不回显，重启要求明确。
- 通过仓库精确 tag 或 Registry 安装与 Personal Server 兼容的 `.gcex`，完成权限确认、激活、升级、回滚和卸载。
- NapCat Linux 包经外部 OneBot 完成私聊、群聊、背景观察、注意力、私有 Skill、自然回复、经历与记忆链路；重启后场景连续性正确。
- 更新失败自动恢复上一镜像和状态；备份/恢复不丢配置、记忆、Extension 选择与账号外部数据引用。
- `stop` 后产品端口、OneBot 连接、Extension Worker 和受管进程全部释放；不存在孤儿进程。
- 类型检查、构建、受影响 Python 测试、Package Manager 安全测试、Personal Server Playwright、安装矩阵和真实场景 smoke 全部通过。
- Architecture、Implementation、Reference、Guide、SDK 文档和两个扩展仓库与实际代码一致，不保留旧入口或假兼容描述。

## 完成后归档

- 配置与 Secret：`reference/configuration.md`、对应 Protocol/Implementation 文档。
- Personal Server 产品与页面：`reference/product-compositions.md`、Personal Server Implementation、部署与运维 Guide。
- 区域分发、安装和更新：`reference/packaging-layout.md`、`guides/release/Personal Server部署.md`。
- Extension 发布、安装和资源 profile：`reference/extension-sdk.md`、Extension Implementation、扩展开发 Guide。
- NapCat 当前事实：Extension 当前视图、Extension Implementation 与独立 NapCat 仓库文档。
- 里程碑过程证据进入 `docs/history/`，`now.md` 切换到后续唯一推进面。

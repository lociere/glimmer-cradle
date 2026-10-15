# 项目与专业能力覆盖矩阵

> 范围：开发协作的能力、事实与证据导航；不取代各模块事实源或架构 v2 状态。
> 事实依据：2026-10-15 `b885debb` 工作树、workspace/package/pyproject、源码/测试、CI、目标 v2.1；关联仓库只读调查。
> 维护触发：新增模块、入口/owner 迁移、工具与验收变化或实际任务暴露覆盖缺口。

## 目录

- [覆盖口径](#覆盖口径)
- [模块与能力域](#模块与能力域)
- [跨模块链路](#跨模块链路)
- [知识与读者需求](#知识与读者需求)
- [代表请求的读取路径](#代表请求的读取路径)
- [工程阶段和缺口](#工程阶段和缺口)

## 覆盖口径

“方法覆盖”表示请求有可执行判断和事实/验证入口，不表示产品目标已实现或该方法已通过真实任务验证。
当前拓扑以 [Current](../../architecture/current/10-当前物理拓扑.md)、[实现地图](../../architecture/implementation/README.md) 和代码核验；
完整目标以 [v2.1](../../architecture/target/baseline.md) 与 [files.json](../../architecture/target/files.json) 为准；
动态迁移状态只查 [execution.json](../../roadmap/initiatives/architecture-v2/execution.json)。本次未修改其状态。

表中 Skill 使用 `glimmer-` 后缀简称，九个实际入口见[能力边界](../agent-workflow-design.md#能力边界与按需加载)。普通查询/编译可直接走 docs/owner，无通用导航 Skill。
`services`、`ui`、`cognition`、`desktop`、`contracts`、`integrations`、`delivery`、`investigation`、`documentation` 均带 `glimmer-` 前缀。
方法中具体命令执行前核对实际 manifest 和环境，防止把源码目录、构建投影和安装制品混用。

## 模块与能力域

| 模块/能力域 | 当前与目标状态 | 典型任务 | Skill 或知识入口 | 事实源 | 工具与验证方式 | 缺口 |
|---|---|---|---|---|---|---|
| 需求/质量要求与领域建模 | 当前目标/术语/brief 与真实领域存在；目标 v2.1 与当前能力分开 | 把新请求变成验收条件、确认实体身份/状态/owner | [功能开发方法](../../how-to/功能开发与缺陷修复.md)＋实际领域 Skill | 用户目标、质量属性、术语表、公开模型/状态机/测试 | 输入/可观察结果/正常及失败反例；需要时状态/时序图 | 本轮补实质方法；未宣称符合完整工程知识体系 |
| 软件构造/生成/工程配置/集成 | TS/Python/C#/Native/Unity 构建单元不同；生成/发布投影已有 owner | 新增模块/依赖、配置默认值、连公开消费方 | [构造与集成](../../how-to/功能开发与缺陷修复.md#定位构造与集成)、contracts；制品才 delivery | workspace/manifest/exports/pyproject/codegen/composition/lock | 定向构建、实际 consumer、Schema/非法值、最终根 typecheck/build | 开发 link 不等于发布包/安装可用；平台/许可仍需环境 |
| Desktop 产品 | 当前 `products/desktop`；目标 `apps/desktop`，产品 consumer 尚未整体切换 | 修控制中心、托盘退出/启动 | desktop＋ui | [Desktop 实现](../../architecture/implementation/Desktop与Avatar实现.md)、product manifest/main/preload | 包级测试、Playwright、Electron 实机、固定安装物 | clean Windows 首启/升级/卸载仍有未验门 |
| Personal Server 产品 | 当前独立 Product/Node HTTP+WS+React；目标 Host Web 控制面，无第二业务 Host | 修 session/路由/远程控制 | services＋ui | [产品组合](../../reference/product-compositions.md)、`products/personal-server/src/server` 与 `src/web` | node/tsx server tests、临时 Host fixture、Playwright | 真实 Linux OCI 与授权环境独立验收 |
| Host App | `apps/host` 已有 Worker 监督、authority、config、Jobs/Memory/Planning 接线；gateway/完整产品装配迁移中 | 关机 drain、切代、权限 broker | services | [当前拓扑](../../architecture/current/10-当前物理拓扑.md)、Host composition/supervision/broker/tests | `test:host`、可控时钟、真实子进程与临时库 | 不能把局部 Host 通过当产品已 cutover |
| Kernel 迁移承载 | `core/kernel` 仍有产品装配/Adapter/投影；目标按 owner 拆分并删除 | 修现有链路、迁移装配 | services；需要时 cradle 迁移路由 | [Kernel 实现](../../architecture/implementation/Kernel与Runtime实现.md)、执行任务书 | kernel 定向 vitest、consumer 搜索、架构门 | 已有 dirty 生命周期工作由原任务保留 |
| Cognition Worker | Python RPC/配置/接线/生命周期存在；目标承载 Cognition 与 Python Conversation | 排查 RPC 取消、ready、恢复 | services＋cognition | `apps/cognition-worker/{pyproject.toml,src,tests}`、[认知实现](../../architecture/implementation/Cognition认知核实现.md) | `test:cognition-worker`、RPC/启动/拒权测试 | 完整产品/安装态接线未整体接受 |
| Platform | 公共 lifecycle/time/identity/config 等机制已实际消费；迁移未完 | 预算、资源监督、配置快照 | services＋investigation | [Platform 实现](../../architecture/implementation/Platform原语实现.md)、公开 exports/Host consumer | `test:platform`、monotonic Clock/barrier、Native 反例 | observability/完整目录等按当前任务继续 |
| Content/资产 | `core/content` 当前主要是 Part/AssetRef/Port；Kernel 持有实际资产写入；目标独立 Content 实现 | 安全上传、提交/引用/GC | services/persistence＋contracts | `core/content/src/index.ts`、[数据布局](../../reference/data-layout.md)、资产 Adapter | 临时媒体、大小/hash/越界/取消、引用恢复 | 独立 asset owner、GC/备份闭包不能凭 Port 宣称完成 |
| Conversation TS | binding、interaction、delivery 及 SQLite Adapter 存在；目标稳定公开协调 | 去重、打断、迟到输出 | services | [Conversation 实现](../../architecture/implementation/Conversation实现.md)、TS tests | `test:conversation`、输出 epoch、unknown delivery、重复输入 | 产品旧路径与全链路按迁移门核对 |
| Conversation Python | canonical Log/History/Turn 与持久单写者已存在 | 提交 ACK、重建 History、writer fencing | services/persistence | Python log/turn/history、[数据实现](../../architecture/implementation/数据、记忆与可观测性实现.md) | 临时真实库、crash/reopen、writer/recovery pytest | 旧用户数据/完整恢复还需专门切换门 |
| Persona/认知 State | 新分域入口存在，混合旧调用仍需查 consumer | 改角色编译、状态衰减/身份修改 | cognition | `persona/`、`state/`、character profile、对应 tests | 假 Clock、来源/权限、状态持久化 | 实现存在不证明角色体验/全链质量 |
| Context/Attention/Perception | 预算、来源、注意租约等分域迁移中 | 排查上下文污染或取消漏出 | cognition＋investigation | [认知实现](../../architecture/implementation/Cognition认知核实现.md)、domain/ports/Worker | 确定性预算/来源/租约反例、loop 接线 | 真实长上下文质量需固定案例评估 |
| Inference/模型 | Core 通用模型/realtime Port 存在，provider/embedding concrete 已在 Worker；向 Extension 迁移未整体完成 | 调模型事件、tool call/超时 | cognition/model-evaluation；IO 用 services | `inference/`、Worker `adapters/model_client.py`、[协议](../../reference/protocol.md) | fake model、流/取消/限流/错误；授权后真实 provider | fake model 不证明真实质量；不默认有付费授权 |
| Memory/Experience | 有证据的 revision、consolidation、独立存储与源 outbox | 修重复记忆/巩固恢复 | cognition＋services/persistence | memory、sqlite adapters、[数据实现](../../architecture/implementation/数据、记忆与可观测性实现.md) | 临时库、evidence/去重、恢复、删除传播 | 同库源请求不可当可删投影；产品旧队列仍有 consumer |
| Knowledge/embedding | source/revision/index/retrieval 与独立知识库存在；embedding IO 在 Worker，Extension 化仍待对应迁移 | 权限撤销后索引失效、检索质量 | cognition＋services/persistence | knowledge/、Worker model client、知识配置、tests | 版本/hash/失效与 fake embedding；授权后真实检索 | 缓存/索引不冒充来源，模型质量单列 |
| Planning/Loop/checkpoint | domain 与 Worker/Host/Jobs 接线已有增量 | 长任务恢复、取消/后继调度 | cognition＋services | planning/loop、Host tests、[执行状态](../../roadmap/initiatives/architecture-v2/README.md) | 步数/预算、crash/reopen、原信封/receipt/fencing | 不能把所有普通 async 变 Job；完整产品接线待验 |
| Capabilities 定义/执行 | Tool/Skill/Resource 分离、Exposure、journal/outbox 等存在；部分 Kernel consumer 已切 | 工具 scope、权限撤销、unknown 对账 | services/persistence＋integrations | `core/capabilities/{README.md,src,tests}`、Kernel gateways | `test:capabilities`、revoked-before-dispatch、result outbox | Speech 等目标能力不能按目录宣称完整 |
| 产品 Skill Plane/MCP | 当前 Kernel catalog/policy/gateway/User/MCP 接线；目标分域 Capabilities＋边缘桥 | 调方法读取、工具执行/撤销 | integrations | [Extension 实现](../../architecture/implementation/Extension与SkillPlane实现.md)、`configs/system/skills.yaml` | 枚举/拒权/confirmation 缺失/重连/dispose | 与本开发 Skill 目录和 Codex 插件分开 |
| Jobs | 独立 SQLite、trigger/lease/fencing、未知结果与 outbox；schema/产品迁移门仍有未关项 | v4→v5 副本迁移、双 claim、重启恢复 | services/persistence | `core/jobs/{README.md,src,tests}`、[迁移指南](../../how-to/数据迁移与恢复.md) | `test:jobs`、临时库、重复/取消/保留、原 attempt 对账 | P14 真实数据切换未由局部 migration test 关闭 |
| Extension Host | 当前 `hosts/extension-host` 独立 Node；目标 `apps/extension-host` | 停用后 handler/进程撤销 | integrations | Host main、SDK process mapping、Kernel supervisor | Host/SDK/kernel 定向测试、拒权/取消/退出 | Node 进程不是强 OS 沙箱 |
| SDK/模板/生态仓库 | 主仓 `packages/extension-sdk`/`templates/extension-basic`；目标 `extension-sdk/`，关联仓库独立 | 改公开 API 并验证作者模板 | contracts＋integrations | [SDK Reference](../../reference/extension-sdk.md)、包 exports/release tests | generate/verify、SDK/Host/template build 与发布包验证 | 关联仓库写入/公开发行需各自授权；版本有漂移 |
| NapCat/OneBot Adapter | 关联仓库有 external_onebot 与 managed_napcat_windows；主仓不拥有厂商代码 | 定位断线/登录失效/媒体入站 | integrations＋desktop（受管进程） | 关联仓库 README/manifest/测试；主仓 SDK | 只读事实核对、授权后其 validate/实际平台测试 | 本次不写关联仓库，不登录/发送真实消息 |
| Avatar/Embodiment | 当前 C# Core＋Unity Host；目标 TS Embodiment＋Renderer Extension | 语义等价迁移、首帧/动作/口型 | desktop/avatar＋contracts | csproj/asmdef、[Desktop 实现](../../architecture/implementation/Desktop与Avatar实现.md)、目标基线 | dotnet tests、projector/doctor、Unity/Native 真构建 | 需要 SDK/Unity/设备；结构测试不等于展示通过 |
| Audio/Speech | 当前 Python Engine 双 lane/云 TTS/本地 ASR；目标 Capabilities Speech＋扩展 provider | 中断/lease 清理、warmup/设备缺失 | desktop/audio＋cognition/services（按边） | [音频指南](../../how-to/音频引擎开发.md)、IDL/player/recorder | `test:audio`、媒体 fixture、设备/真实模型 smoke | 不擅自装 torch/下载模型/外发私人音频 |
| Native/OS | Windows composition、进程树机制存在，其他平台能力各别 | DPI/穿透/进程树回收 | desktop＋services | native/CMake、Platform Windows bridge、product projection | CMake/Native tests、真实 Job/句柄/多屏/安装路径 | Windows 证据不能外推 Linux/macOS |
| 前端状态/React/异步 | 两产品 React/Vite，Personal Server React Aria/CSS Modules/Storybook/Playwright | 修 logout/迟到请求、表单冲突 | ui＋investigation | [前端指南](../../how-to/前端开发与UI验收.md)、controller/hooks/routes/tests | 当前产物真实浏览器、资源计数、键盘/网络反例 | UI fixture 不证明真实模型或原生窗口 |
| 视觉/设计系统/动效/a11y | token 与已确认 Personal Server 简报存在；营销页不是当前独立产品单元 | 调密度/排版/主题/空态与焦点 | ui＋按需外部能力 | [token Reference](../../reference/ui-design-tokens.md)、设计简报、CSS/组件 | 宽/窄/缩放/主题、人工截图/焦点、axe | 不从营销 Skill 推导控制面方向；无强制新三方案 |
| i18n/内容容量 | 现有中文界面、长文本/缩放测试；未发现完整 locale 产品体系 | 长中文/英文/时区与错误文案 | ui | 实际文案/日期格式/测试、前端指南 | 长字符串、日期/时区、320 等效宽度、可访问名称 | 不虚构全语言支持；新增 locale 需真实需求/owner |
| 配置/profile/资产/数据根 | system/characters/extensions/secrets、read-only assets 与 resolver 存在；目标 owner-local Schema 分步迁 | 改默认值、保存冲突、安装态路径 | services/persistence、contracts（serialized shape） | [配置](../../reference/configuration.md)、[数据](../../reference/data-layout.md)、configs manifest | Schema/非法值/revision、空/旧/坏、只读安装根 | 不读秘密值；Schema 迁移前保持 contracts 唯一源 |
| 安全/隐私/供应链 | 会话、IPC/broker、包校验、审计与部分拒权测试存在 | 审查跨边界授权或上传 | [权限方法](../../how-to/审查权限与外部边界.md)＋contracts/desktop 按边 | 真实 session/router/broker/installer、[工程 Reference](../../reference/engineering-lifecycle.md) | 成功与拒绝、撤销竞态、路径/解压/大小/hash | 不把声明、注解、同用户子进程当安全保证 |
| 观测/诊断/性能 | logger/trace/metrics/DLQ/模型调用观测与工具存在，Platform 迁移中 | 找延迟、泄漏、DLQ 根因 | investigation | [观测](../../reference/observability.md)、[排障](../../how-to/日志、Trace与DLQ排障.md)、[性能](../../how-to/性能诊断.md) | 相关 trace、基线、profile/SQL、重放的授权与 receipt | 本次无真实设备/云/生产性能数据 |
| 构建/依赖/工具/CI | pnpm 16 workspaces、uv 多 Python owner、dotnet/CMake/Unity；repo-checks/supervisor | 修工具或流水线、依赖升级 | delivery（CI/制品）＋investigation | 根/owner manifest、`.nvmrc`、uv.lock、[工程实现](../../architecture/implementation/工程生命周期实现.md)、PR workflow | 定向工具 tests、frozen/offline lock、根最终 typecheck/build | 新技能检查仅证明静态维护不变量 |
| 打包/交付/运维/恢复 | Desktop Windows 制品、Personal Server Linux OCI/宿主事务/attestation 链已有入口 | 验证候选、回滚恢复、离线安装 | delivery＋services/desktop 按成果 | [打包布局](../../reference/packaging-layout.md)、[部署指南](../../how-to/Personal%20Server部署.md)、产品/部署 scripts | 固定 digest/source/builder、clean install、failure/rollback/recovery | 本次不发布/推送/生产；跨平台安装门不能虚报 |
| 文档与知识工程 | docs 兼具解释/参考/完整操作，入口按读者任务；已修旧认知路径，必要历史保留 | 核实当前事实、写上手/恢复指南、审计阅读链 | documentation | [文档架构](../documentation-architecture.md)、[维护操作](../../how-to/文档维护.md)、实际源码/consumer | docs/encoding/skills、沿请求实际取成果、受控命令/独立读者 | 链接/路径通过不证明内容正确；所有未运行命令单列 |
| 架构演进/协作维护 | 冻结目标清单/摘要、任务书与机器状态存在；方法深度按风险选择 | 目录迁移、设计 Skill、长任务恢复 | 相关专项、[恢复](../../how-to/长任务与恢复.md)与[验收](../../how-to/测试与验收.md) | [变更宪章](../architecture-change-policy.md)、本体系设计、实际 initiative | target/lock/skills 反例与独立审查 | 历史只溯源；临时迁移门不推广普通任务 |

## 跨模块链路

| 链路与典型请求 | 方法组合与事实入口 | 必须判断的正常/异常/退出路径 | 直接验证与当前限制 |
|---|---|---|---|
| 渠道→资产→Conversation→Cognition→Delivery | integrations＋services/persistence＋cognition＋contracts；SDK、Log、Worker mapper | 提交再引用、去重、权限、打断/迟到、provider 失效 | 临时资产/真实 Log/Worker；真实渠道另需授权 |
| 模型 tool call→Exposure→授权→journal→结果→Log | cognition＋services＋contracts；capability gateway | 执行时撤权、dispatch 后崩溃、unknown/outbox、重复回执 | fake model＋临时真实 journal/Log；不冒充真实工具副作用 |
| Planning/Memory→Jobs→Worker→状态 inbox/ACK | cognition＋services/persistence；Host tests | 原政策/attempt、fencing、缺 handler、ACK 丢失、取消/重启 | 临时两库/Worker 接线；产品旧队列 cutover 单列 |
| ASR→回复→TTS→播放进度→Avatar | desktop/audio/avatar＋cognition/contracts | lane 独立 ready、格式/抖动、取消后旧音频、实际已听范围 | 媒体 fixture 加实机/真实模型；本次未做设备验收 |
| 登录→路由/WS/SSE→logout→快速重登 | ui＋[权限方法](../../how-to/审查权限与外部边界.md)＋investigation；auth controller/fixture | 拒权、过期、旧响应/close、stream/timer 释放、输入保留 | 真实浏览器与资源计数；fixture 与真实 provider 分开 |
| 配置/资产→构建投影→制品→安装→运行根 | delivery＋desktop/services；packaging/product manifest | 源码相对路径缺失、安装根只读、摘要/许可、升级/回滚 | 固定制品与干净环境；开发 build 不关闭安装门 |
| Local/Cloud/Hybrid→authority→离线/重连 | services/persistence＋contracts；v2.1/Host fencing | 双主、旧 epoch、proposal/已提交事实、unknown 副作用 | 同实现下隔离进程/数据根测试；无生产拓扑证据 |
| 用户停止/上下文恢复→已有 dirty→原任务 | 恢复指南；当前任务记录/execution.json | 原 owner、未验门、残留进程、历史误接、重复副作用 | 状态核验与真实 Git；不擅自推进架构任务或换用户会话 |

## 知识与读者需求

| 谁在完成什么 | 需要理解/查询的问题 | 内容 owner 与实际入口 | 当前缺口 |
|---|---|---|---|
| 首次接手者 | 如何得到一个安全可观察成果，测试证明了什么 | [首次受控验证](../../tutorials/首次受控验证.md)、[环境准备](../../how-to/本地开发环境.md) | 冷机/其他 OS 安装不由当前机器 walkthrough 证明 |
| 功能实现者 | 当前 producer/mapper/consumer，数据/资源由谁提交释放 | [实现地图](../../architecture/implementation/README.md)、实际 exports/调用者 | 漂移时以源码核验并修所属页，不凭目标补 API |
| 系统理解者 | 目标与现状为何不同、哪些约束不能被工具偏好改变 | [目标](../../architecture/target/README.md)、[当前](../../architecture/current/README.md)、[ADR](../../architecture/decisions/README.md) | 目录完整不等于业务链完整 |
| 查询者/扩展作者 | 字段、配置优先级、SDK 权限、数据/制品根、兼容与默认值 | [Reference](../../reference/README.md) 与真实 Schema/manifest | 关联仓库文档仍有旧 owner/版本；本次不写其源码 |
| 调试/运维者 | 如何区分失败、unknown、降级、数据源、恢复与副作用 | [操作指南](../../how-to/README.md)、日志/trace/receipt/脚本 | 生产/设备/跨环境证据另取 |
| 迁移/恢复 owner | 当前任务/授权、准备门、行为场景、未验门和原身份 | 对应 initiative、[切片指南](../../how-to/执行架构切片.md)、[长任务恢复](../../how-to/长任务与恢复.md) | reviewedAt 是旧审计输入，不自动更新成全产品复验 |
| 资料/能力维护者 | 哪一处拥有这条事实/流程，如何复验、切消费者、归档/回退 | [文档维护](../../how-to/文档维护.md)、[设计](../agent-workflow-design.md)、research/evaluation | 实际反馈驱动最小修正，不累计无反例永久规则 |

## 代表请求的读取路径

此表是维护时的路由设计与完成标准，不代表每一行都完成真实模型触发实验；实际记录见 evaluation。

| 用户请求 | 应加载内容 | 必要决策与操作 | 预期成果 | 完成证据 | 避免的加载/越界 |
|---|---|---|---|---|---|
| 第一次验证代码和一个界面 | 首次受控验证；缺依赖再看环境 | 核工具链、编译依赖、运行现有临时 Host/浏览器 | 可复现命令、真实页面/报告和边界理解 | 工具测试、当前 Web、实际 trace/截图 | 不默认 dev、真实模型/设备或外部登录 |
| 修 docs 一处拼写 | 所属页与必要语境 | 定向修改、检查链接/编码 | 正确正文 | diff 与文档门 | 不读全架构/全部 Skill 或跑全产品 |
| 核实一段“当前已实现” | documentation、所属实现/源码/测试 | 查实际入口/consumer，分当前/目标/已验 | 有来源的说明、未知项 | 源码链与适用直接测试 | 不由目录/历史 PASS 推定接入 |
| 写一份恢复操作 | documentation＋实际 owner 的恢复资料/脚本 | 查备份闭包、停写、原身份、失败/重试 | 可执行步骤、反馈和保留源的恢复 | 临时真实库/故障/重开 | 不跑用户库或复制 ORM drop/down |
| 已批准的小表单错误/取消修复 | ui、目标 feature/controller、UI 指南 | 保留输入、识别提交状态、取消/迟到清理 | 可操作错误与正确生命周期 | controller 反例＋真实表单/焦点/axe | 不重新三方案、请示或改协议 |
| logout 后迟到 close | investigation＋UI/服务实际接线 | 固定 generation/surface/请求时序 | 明确根因及必要修复 | 真实浏览器与资源计数反例 | 不以截图证明服务端所有 WS 撤权 |
| Host 首次 await 前预算 | services、Platform/Host/产品 Kernel consumer | 查默认 Schema、真实 owner/stop 重试 | 有界等待且不重开旧资源 | Clock/barrier、迟到/重试、真实接线 | 不推进别的迁移或只验证 timeout 返回 |
| Jobs 重启/副本迁移 | services/persistence、Jobs README/实现/恢复指南 | 单写者、原 attempt、unknown/ACK 与新路径 | 恢复同一身份或保留源的候选 | 真实 SQLite/WAL/失败/重开 | 不把 helper 当已上线生产迁移 CLI |
| Avatar 新 wire 字段 | contracts＋desktop/avatar、IDL/mapper | 先确认方向/语义，唯一源生成与消费 | 兼容字段、实际映射、明确 Unity 门 | TS/Python/C# roundtrip、C# adapter | 不手写 DTO 或先建 protocol 副本 |
| 改 Persona/Context/检索 | cognition、实际 profile/domain、模型评估 | 来源/身份/权限/预算与确定性/质量分开 | 行为变化和评估限制 | fake port/真实库；获授权后真实模型 | 不将 provider IO 放 Core 或猜费用授权 |
| 音频中断/Unity 首帧 | desktop 相应 reference、实际 consumer | 分 lane/设备/渲染 ready、旧帧和释放 | 真实降级或对应环境的修复 | 媒体 fixture/实机/安装分别报告 | 不将 doctor/mock 当展示或已听证据 |
| Extension/MCP 断线撤销 | integrations、SDK/Host/registry | schema/handler/权限/世代、取消 pending | 无旧能力/重复副作用 | 注册/拒权/重连/dispose 及结果 journal | 不调用开发 skill-creator 代替产品实现 |
| 排查性能或同类缺陷 | investigation、trace/profile/原种子 | 固定输入基线、逐项因果确认 | 可复现结论和最小修复 | 延迟/资源/SQL/renderer 直接数据 | 不无症状扫库或单次耗时宣称提升 |
| 修 CI、依赖或打包恢复 | delivery、owner manifest/脚本/交付指南 | 检查固定制品、依赖、锁、路径、副作用 | 工具/制品或明确阻断 | 定向工具测试、类型/构建、适用安装门 | 不推送/发布/生产或全局换栈 |
| 继续架构 v2 | 项目入口、execution.json、nextTask 原文 | Git/owner/候选，G 证据门与 B/D 场景并用 | 正确恢复并完成授权步骤 | 机器状态、实际产物/对应门 | 不由旧日志、日期或目标目录接受任务 |
| 压缩后接手、工具超时 | 长任务与恢复、当前任务记录/句柄 | 查询真实 owner/receipt、保留 dirty/原身份 | 可续做下一动作和未知状态 | Git、状态和副作用回执 | 不建第二账本、换用户会话或盲重发 |
| 翻译普通文字/编辑 Word 文件 | 普通能力或相应制品 Skill | 按文件/语言任务处理 | 所需文本/制品 | 与成果对应的检查 | 不因 cwd 加载项目文档/Skill 全集 |

## 工程阶段和缺口

需求/设计从用户成果与真实表面/领域边界开始；实现由相关领域方法支持；调试走 investigation；测试/审查/交付共享测试与验收指南。
运维先核环境授权与恢复路径；演进维护目标、内容 owner 与 consumer-zero；长任务沿恢复指南保留可恢复状态。
每条链路都要识别输入、owner、提交/ready、失败/降级、恢复与退出，不以“有目录/章节”证明能力。

本次补齐了后端事务/并发、Jobs、资产、权限、AI 评估、音频/设备、供应链/恢复与关联仓库边界的方法入口。
仓库仍有开发版本 `0.2.x` 与统一 `0.1.0` 策略的存量差距，关联仓库文档也保留旧 owner/版本说法；
本任务不改产品版本或关联仓库，后续由对应 owner 按版本/迁移授权处理。
Unity/SDK/真实模型/设备、完整离线/安装/生产恢复的验证条件并未因此获得或满足。

能力是否已真实验证以 [验证记录](evaluation.md) 为准。新增/迁移/失败反馈的更新与撤回方式见 [体系设计](../agent-workflow-design.md)。

## 本轮主动补齐的方法

| 发现的任务缺口 | 研究的实际内容→吸收方法 | 落地位置与适配 | 实际验证入口/证据类型 |
|---|---|---|---|
| 需求到实现只剩通用步骤，概念/构造判断不足 | 真实模型/公开 exports/组合入口＋读者/运行视图方法→可观察验收、实体/状态/owner、构建单元与运行进程分开 | 重写功能开发指南；无需新增泛化 Skill/固定建模文档 | 代表请求的事实/接线审查；与受影响实现对应的真实测试另取证 |
| 集成夹在服务 reference 中，发现/生命周期方法不够明确 | mcp-builder 的 Schema/分页/错误，实际 SDK/Host/安装与 broker→声明/授权/dispatch/撤销和 unknown 各自门 | 新 integrations；合并旧 extensions reference、收窄 services；不安装外部服务 | Host/SDK/MCP/安装事务的受控真实测试；真实渠道账号未运行 |
| CI/制品只由通用导航提工具名 | gh-fix-ci 脚本的 head SHA/log fallback，SLSA/GitHub 的独立信任预期→固定字节/来源/builder/失败恢复 | 新 delivery，普通编译排除；连接现有 supply-chain/verifier/installer | supply-chain/package/supervisor fixture；远程 CI/签名/生产不在本轮 |
| 文件存在却章节失效未被发现 | CommonMark AST＋slugger→标题重命名/Unicode/重复/代码/编码反例 | repo-checks Markdown helper 与 CLI；不伪查远端或 HTML | 定向 tests、CLI exit 0/1/2、真实全库文档门 |
| 组件正文重复、长细节导致无关加载 | 独立旧正文/源码对照＋任务主题→单一组件解释、按需认知深细节 | 六主题合并，Cognition 拆 Memory/Knowledge 与 Planning；tools/UI 方法合入完整指南 | 独立只读审查、真实锚点/路由与读者任务；小样本不证明整体提速 |

新专项/正文让任务具备可操作方法；是否在具体任务已验证、复用或仍缺环境证据以 evaluation 的本轮记录为准。

# 协作体系验证记录

> 范围：2026-10-15 重设计及 2026-10-16 执行成本优化的证据、对照和限制；不是全项目或全部模型的可靠性认证。
> 事实依据：`b885debb` 起始工作树、实际工具返回、隔离快照与独立只读结果；本次无推送/发布/生产操作。
> 维护触发：本次候选变化、复验或后续真实反馈；历史观察保留，不追溯改写为更强结论。

## 目录

- [候选与授权](#候选与授权)
- [发现、静态与脚本检查](#发现静态与脚本检查)
- [独立审查与修正](#独立审查与修正)
- [代表性直接运行](#代表性直接运行)
- [触发与边界场景推演](#触发与边界场景推演)
- [隔离行为对照](#隔离行为对照)
- [限制和后续验证](#限制和后续验证)
- [第二轮：文档与知识组织](#第二轮文档与知识组织)
- [提交前的隔离复核](#提交前的隔离复核)
- [执行成本与收束效率复核](#执行成本与收束效率复核)

下列七个既有章节记录第一轮“旧单一 Skill→七个入口”的历史候选；其中七个 Skill、122 份 Markdown、
1,142 目标文件和旧 reference 路径是当时观测，不是当前结构。第二轮八入口及 docs 扩展、第三轮九专项重组见各轮记录；
原始运行和独立观察保留，未追溯改写。

## 候选与授权

唯一主仓写入者为本会话；修改开发指令、支持工具、指南/索引与目录契约，不修改产品逻辑。
起始三处 dirty 内容在中断恢复及最终核验时 SHA-256 均与起始相同：

| 保留文件 | 起始 SHA-256 |
|---|---|
| `core/kernel/src/composition/kernel-application.ts` | `6ced28a457d223aad57c025ac85d34016067f9c41095ed9f02bb26db15552186` |
| `core/kernel/src/runtime/modules/application-runtime.test.ts` | `2622727811c4f3f3bac5c073cc7570a4cfc3998ee818ad4dae96d7e0c09e7bdb` |
| 架构 v2 `execution.json` | `a4398583019abe8fc568285a5a6f186bfa86996ac379611559d2720b075c2bc9` |

环境为 Windows、Node 24.18.0、pnpm 11.13.0、Codex CLI 0.160.1、仓库 uv Python 环境。
临时研究、原始日志、发现响应、截图与两份对照快照放在本机临时目录 `glimmer-skill-audit-131b59d4`，不进入产品或 Git。
本文保留可复验命令与观察；临时文件可过期，长期事实仍由对应源码和权威页拥有。

## 发现、静态与脚本检查

| 检查 | 实际结果与证明范围 |
|---|---|
| 官方 quick_validate.py | 通过 7/7；使用已安装官方 helper 与 uv 离线 PyYAML 6.0.3，不改个人配置/产品 Python 依赖 |
| 本机 app-server `skills/list` | initialize 后用 `cwds=[仓库根, products/personal-server]`、`forceReload=true`；两处均返回 7 个新 repo Skill，enabled=true、errors=[]；每处共 28 个 Skill |
| 当前桌面会话发现 | 中断恢复后的实际 Skills 清单已列出七个新 `.agents/skills` 入口，旧项目入口不再出现；未为刷新创建用户会话 |
| `pnpm check:skills` | 7 个入口通过；YAML、目录名/描述、UI policy/prompt、唯一位置、Git 可见性、Markdown 文件链接和资源可达性；不验证自动匹配和语义质量 |
| 新检查器测试 | 10/10；合法 YAML/可选 UI、旧位置/同名、非法 YAML/类型/空描述、坏/越界/孤立链接、UI identity/policy、资源及父目录 symlink、Git ignore、嵌套清单、CLI exit 0/1/2 与非 cwd 使用 |
| ignore 反例发现及修正 | 原 `.gitignore` 忽略整个 `.agents/`，会导致宿主可读但交付漏文件；已收窄为保留 skills，并加入实际 Git ignore fixture 反例 |
| 安装/依赖 | `pnpm install --lockfile-only --ignore-scripts --offline` 成功；锁仅增加 repo-checks 对既有 yaml 2.8.2 的直接 dev dependency；后续 pnpm 确认无下载 |
| `pnpm --filter @glimmer-cradle/repo-checks test` | 最终 45/45，通过；包括 Skill 10 项、发现目录与 façade 的实际架构反例、锁/文件树/CLI/文档/编码/依赖边界；首次发现两条旧协作约定，已修正后复跑 |
| `pnpm typecheck` | 根命令 exit 0，实际依赖前置 build 与 15/16 workspace 的适用 typecheck；未运行项不由该命令补证 |
| `pnpm build` | 根命令 exit 0；含正式资产投影与当前 TS/Renderer/Web 构建；不包含 Unity/Native 真渲染、完整安装或发布 |
| docs/encoding/architecture/target-layout | 均 exit 0；docs 为 122 份活跃 Markdown，目标树为 1,142 个文件；target-layout 只核对规格，未使用 `--final` 关闭产品迁移门 |

Skill/AGENTS 的本地文件引用由新门覆盖，docs 的链接/入口由原 docs 门覆盖；章节锚点和远端语义另行核对。
目标清单删除旧入口 18 文件、增加新 Skill 23 文件、治理记录 3 文件和检查器/测试 3 文件，净增 11。
`check:docs --write` 与 `check:target-layout --write` 已重建视图；锁仅同步四份已变规范源的原始字节摘要，产品语义不变。
`status.md` 只从用户已有的 execution.json 改动生成当前说明，没有推进状态或改写 execution.json。
最终再次检查新 Skill 的 23 个文件均在目标清单且 Git 可见，旧发现目录的文件为 0。
活跃旧路径搜索只剩明确的历史说明与拒绝 fixture；本次修改文本使用 UTF-8 无 BOM、LF，原三处 dirty 字节保持不变。

## 独立审查与修正

固定 AGENTS、七个 Skill、元数据、检查器/测试、依赖与 ignore 候选后，由独立只读审查者核对权限、不变量、路由和实际 fixture。
首次结论无阻塞项，但发现检查器会接受被父入口链接的嵌套 Skill，与项目约定的 `<name>/SKILL.md` 不符。
已补严格清单深度检查及反例，同时补 `.agents` 父目录 symlink 拒绝路径，防止从链接祖先绕入资源。
复审确认原问题解决、没有新的阻塞项，独立运行 10/10 fixture 与真实仓库七入口检查均通过。
审查结论限于固定范围，不替代全项目架构、真实设备或自动触发验收。

首次全套 repo-checks 暴露两条旧结构消费者：legacy denylist 禁止整个 `.agents`，工具 façade 白名单缺少 check:skills。
已按本次明确授权同步这两条协作规则，新增目录正例/保留 protocol 拒绝反例，并使 façade fixture 实际消费新入口。
45/45 复跑通过；没有删除产品/数据/协议边界检查。
独立增量审查确认只改变这两条协作约定、未发现产品消费开发目录，并实际运行 architecture.test.mjs 4/4 通过；
该次审查没有把执行者的全套测试/typecheck 自报当作独立重跑结果。

## 代表性直接运行

下列为执行者实际运行的项目测试，验证工具/真实源码链路和本次方法所指的证据入口；
它们不是“新 Skill 自主完成所有领域实现任务”的成功率数据。

| 领域与实际命令 | 结果 | 能证明与不能证明 |
|---|---|---|
| `pnpm --filter @glimmer-cradle/jobs exec vitest run tests/lease-fencing.test.ts tests/restart-recovery.test.ts tests/public-api.test.ts` | 46 通过，3 文件 | 临时 SQLite、公开 Jobs 接线、重启/lease/fencing；不关闭生产迁移门 |
| `pnpm --filter @glimmer-cradle/capabilities exec vitest run tests/revoked-before-dispatch.test.ts tests/execution-unknown-recovery.test.ts tests/result-outbox-idempotency.test.ts` | 15 通过，3 文件 | 撤权、unknown、结果 outbox；不证明真实外部工具副作用 |
| `uv run --frozen --no-sync --project core/cognition --extra dev pytest -q` 后接 persona_mutation/context_trust/context_budget/loop_checkpoint/loop_native_tools 五个 `test_*.py` | 121 通过 | 角色修改边界、上下文信任/预算、loop/checkpoint/工具替身；不证明真实模型质量 |
| `node --test core/platform/tests/lifecycle-drain.test.ts` | 28 通过 | 可控生命周期、drain/失败 owner/迟到/进程抽象；不把模拟 group 反馈当跨 OS 原生回收证明 |
| `node --experimental-transform-types --test products/desktop/tests/packaged-supervisor.test.ts` | 6 通过 | 临时安装投影/正式 resolver/supervisor 与替身 bridge；不证明真实安装、窗口或 Native 设备 |
| `uv run --frozen --no-sync --project engines/audio --extra dev pytest -q engines/audio/tests/test_protocol.py engines/audio/tests/test_resource_catalog.py` | 10 通过 | 音频协议/资源 fixture；不调用真实 ASR/TTS，不证明设备/云模型 |
| `pnpm contracts:verify` | 全部通过；22 个 gate tests，TS/Python/C# roundtrip 均 OK、generated clean | 实际 lint、breaking、Schema、toolchain、编译与序列化；本次未改协议，无需生成伪变更来演示 |
| `pnpm --filter @glimmer-cradle/personal-server build:web` | PASS，当前静态产物 | 浏览器测试消费当前构建；没有修改 UI 源码 |
| 现有 Playwright auth-lifecycle/conversation/accessibility/visual 四 spec，grep 为 logout、quick relogin、empty/long、compact login、login/overview，`--trace on` | 7 通过、3 正常 skip，25.5 秒 | 真实 Chromium，宽/窄、焦点/重流/双主题、axe、logout/重登、WS/SSE/timer 资源与登录截图；narrow 的三项场景按原测试声明由 desktop 项目覆盖 |

浏览器报告在 `build/reports/playwright/personal-server/report/`，trace 在同级 results。
从实际 trace 提取并查看了 1440×920 的已认证界面、480×900 的概览和登录截图，核对布局/状态与无横向溢出；
窄屏最后一帧是测试关闭后的白屏，检查时回到关闭前的真实 frame，未将 teardown 帧报告为产品缺陷。
没有刷新视觉 baseline。浏览器用临时数据和受控网关，不访问真实模型、外部账号或生产。

上述缩写命令的实际参数：

```powershell
uv run --frozen --no-sync --project core/cognition --extra dev pytest -q core/cognition/tests/test_persona_mutation.py core/cognition/tests/test_context_trust.py core/cognition/tests/test_context_budget.py core/cognition/tests/test_loop_checkpoint.py core/cognition/tests/test_loop_native_tools.py
pnpm --filter @glimmer-cradle/personal-server exec playwright test tests/ui/auth-lifecycle.spec.ts tests/ui/conversation.spec.ts tests/ui/accessibility.spec.ts tests/ui/visual.spec.ts --grep 'logout invalidates|quick relogin|empty and long conversations|compact anonymous login|login and authenticated overview' --trace on
```

## 触发与边界场景推演

这是依据最终描述、正文和实际事实入口进行的静态路由推演，尚未逐项做真实模型隐式触发实验，不统计“触发成功率”。

| 典型请求 | 预期最小方法/资料 | 应避免的误触发或越界 |
|---|---|---|
| 修 docs 拼写/链接 | cradle 或直接文档指南；docs/encoding | 不读所有架构/不跑全产品 |
| 改表单错误出口/窄屏溢出 | ui、组件/token、现有浏览器 fixture | 不把营销方向与后端协议重写带入 |
| 查 logout 后迟到 close | investigation＋相关 UI/controller/服务事实 | 不用截图或 route switch 单独证明 cleanup |
| 加跨进程状态字段 | contracts＋相关 owner | 不手写 DTO、不创建第二 protocol 源 |
| 改保存的 Document/配置默认值 | contracts＋加载/normalizer/服务 owner | 不复制 Schema 或忽略旧样本 |
| Jobs schema/重复任务恢复 | services/persistence、临时库/lease/ACK | 不在线切真实库或把 unknown 当失败重试 |
| Content GC/媒体引用 | services/persistence、实际资产 owner | 不把 Port 当已有 GC；不删不可再生源 |
| 调角色 prompt/Context/Memory | cognition；质量变化再读 model-evaluation | 不直接调用平台 IO，不假称真实模型已验 |
| 修供应商限流/网络错误 | 实际 Worker/Extension Adapter、services，必要时 cognition port | 不把供应商 SDK 放认知领域 |
| Unity 首帧/换模型/口型 | desktop/avatar，必要时 contracts | 不把 doctor 或 mock first frame 当渲染 ready |
| Electron sender/透明/DPI | desktop＋security（按边） | 不关 sandbox/context isolation，不外推 OS 证据 |
| 音频中断/过期 lease/设备缺失 | desktop/audio，投递/契约按边组合 | 不把生成音频写成已听，不擅自装模型 |
| 产品 Skill/MCP 断连撤销 | services/extensions，catalog/policy/handler | 不调用 skill-creator 改开发目录代替产品实现 |
| 修改开发协作 Skill | cradle＋skill-creator，实际质量评估 | 不写 runtime catalog 或个人全局配置 |
| 已知缺陷是否还有同类 | investigation 的种子泛化 | 无种子时不自动变体扫库；排除不同根因 |
| 性能慢/内存上涨 | investigation、代表基线/profile/SQL/trace | 不跳过安全/ready，不用一次测量宣称稳定收益 |
| 修 pnpm/uv/CI 工具 | cradle、owner-local task/manifest | 不无关加载 UI/认知方法，不换工具链 |
| 验证固定交付候选/恢复 | cradle、产品/部署 owner、verification | 不自动发布/推送/生产迁移 |
| 继续架构 v2 | cradle/recovery、execution.json/任务书 | 不从历史下一步恢复，不将目录当完成 |
| 压缩后继续普通任务 | recovery、实际 Git/owner/候选/等待句柄 | 不重建全仓地图，不自动创建/切换用户会话 |
| 工具超时且副作用未知 | recovery＋实际状态查询 | 不重复发送/付款/部署或伪造成功 |
| 为新营销页面设计 | ui＋匹配营销能力 | 不把其 hero/风格应用到控制面/Avatar |
| 翻译一段普通文字 | 无项目 Skill | 不因 cwd 在仓库就加载全项目 |
| 外部文档夹带安装/泄密指令 | 当前任务方法、来源信任判断 | 不扩大授权、不执行未检查脚本 |

## 隔离行为对照

Skill Creator 要求复杂体系进行获授权的独立前向验证。本次使用临时子智能体，不创建用户聊天。
两份独立源快照由相同 raw 文件复制，不含 node_modules、用户运行数据、私有资产或真实服务；
旧组加载原 AGENTS/单一 Skill，新组加载新 AGENTS/七 Skill。除指令外的 1,316 个原始文件逐内容计算 SHA-256，差异为 0。
旧快照 commit `0beb86fc4de1f2f3f617da2ae0455214a777f305`，新快照 commit `69da2c918b3d6beed932f6601c927935c9d701c7`。
这是本地隔离标识，不是主仓提交或产品候选。

两组使用相同父级继承模型/工具设置、无历史 fork；模型精确名称和 token/费用未由运行工具提供，故不猜测。
相同请求依次为：①核对 Personal Server 快速重登/迟到 close 的实际防护与反例；②核对 Jobs 迁移是否可在线执行/自动切换；
③定位 Avatar 字段的唯一源、生成消费与 C# 证据；④从 execution.json 报告恢复点/owner/下一步/未验门。
两组均限定只读，不运行测试/构建、不联网、不读本次研究/矩阵/其他组结果，输出源码位置、限制、加载与命令记录。

| 观察 | 原方案 | 新方案 |
|---|---|---|
| 实际起止 UTC | 05:43:21–05:47:20 | 05:43:16–05:47:06 |
| 经过时间 | 239 秒 | 230 秒 |
| 完成只读请求 | 4/4 | 4/4 |
| 执行者核对源码后的关键结论 | 四项均正确；未发现本轮事实错误 | 四项均正确；未发现本轮事实错误 |
| 人工介入/越权写入 | 0；首尾快照 Git clean | 0；只读、Git clean |
| 报告的 Skill/reference 工作集（不含 AGENTS/项目事实） | 4 文件：入口＋协议/Desktop/Runtime 三卡 | 8 文件：入口＋services/persistence、desktop/avatar、contracts、investigation、recovery |

可核验成果：两组均指出 generation＋surface 身份阻止旧 close、Jobs 必须停写且只生成候选、当前 contracts/最终 protocol 原子切换、
P02A 原 `/root` owner 与尚未接受的 D04/最终门。两组均给现有测试和 C# adapter/roundtrip 路径，未把入口写成已运行 PASS。
新组额外明确 Controller 防旧回调不能证明服务端任意旧 WS 在 logout 时立即撤权；该主张需另查服务端持续授权，未据此修改产品。

这是单次、四项只读调查，答案较确定，基线可能饱和。9 秒差异、文件数或模型自报都不能证明效率/可靠性提升；
没有测得 token、总工具开销、实现成功率或统计显著性，也未加入无 Skill 组。本轮结果支持“新方案能完成这组调查”，
不支持“新体系在所有任务上优于旧方案”。中断前未完整回收的首次尝试未计入成绩。

## 限制和后续验证

本次真实实现成果是协作指令、完整能力路由、支持检查器及其反例测试；代表性产品测试提供直接工程证据，
独立对照提供受控只读调查结果。前端、后端、契约、AI 的自主实现效果尚未分别在干净上下文重复 A/B 测量。
隐式触发边界目前主要是静态推演，发现/加载则取得了本机 harness 与桌面清单的实际证据。

没有真实 Unity/Live2D 展示、GPU/麦克风/播放、云模型/付费 API、外部平台登录/消息、跨 OS 安装或生产恢复证据。
完整产品迁移、开发版本漂移及关联仓库存量说法属于原 owner 的未完成工作，本次不关闭相关门。
后续在真实需求中按 [维护机制](../agent-workflow-design.md) 留反例、修最小一处方法/工具并复验；
不因覆盖入口存在而宣称可靠，不把每次失败追加为永久全局规则。

## 第二轮：文档与知识组织

本轮用户进一步授权 docs 正文、信息架构、读者路径、治理和协作方法一起重新推导。
复用第一轮已核实的专业调查与未变源码证据，另外调查 Diátaxis/GitLab、Django/Kubernetes 实际文档和 doc-coauthoring。
来源、固定 commit、许可判断与具体取舍见 research；没有运行外部仓库脚本或安装插件。

当前落地为八个 Skill、八份 UI 元数据、七份条件 reference，共 23 文件。
共同验收/证据/审查迁入完整测试指南，恢复迁入长任务指南；删除两份中间候选 reference，避免长期双份流程。
新增 documentation 和受控上手；Current 阅读说明合并到 README 后删除；实际修正文档 owner、路径、状态与命令，
并非只调整索引。目标清单 1,143 文件、活跃 Markdown 123 份；目标语义与三处起始 dirty 字节保留。

### 直接运行与静态证据

本轮原始资料、输入清单、日志和截图在本机临时目录 `glimmer-docs-audit-Gt2e2a`。
其中 `before` 是第一轮结束后的七 Skill/docs，`after` 是 docs 重设计的八 Skill 初始候选；
它们不是最初的单 Skill 对照，也不是最终修正后的全量可运行 checkout。后续修正与最终主仓门分别记录。

| 检查/任务 | 实际结果和限制 |
|---|---|
| 官方 quick_validate.py | 当前 8/8 通过，已安装 helper＋uv 离线 PyYAML；不证明方法质量 |
| 本机 app-server 0.160.1 skills/list | 根与 Personal Server 子目录均返回 8 个 repo Skill、enabled=true、errors=[]；各总数 29；未创建用户聊天或修改个人配置 |
| 实际上手步骤 1/2 | repo-checks 45/45；SDK build:with-deps 和当前 build:web 均 exit 0；未启动全栈/模型/设备 |
| 实际上手步骤 3 | 初版命令真实执行报 No tests found；修正 spec/grep 后 2 passed，5.3 秒；没有刷新视觉 baseline |
| 界面直接检查 | 查看 trace 提取的 480×900 匿名登录、连接中及认证后系统页；测试覆盖视觉基线和 login/overview 的指定 axe 标签，未据此声称所有焦点/错误交互已验 |
| 文档正文事实 | 对照实际 consumer 修正 Cognition/Memory/观测/模型 IO 入口；精确代码路径片段的临时扫描为 0 缺失，仅为启发式辅助，不验证全部叙述 |
| Python 环境命令 | uv 本机 help 及现有共享环境约定确认 --inexact 语义；已修环境指南，未在冷机或完整语音环境重做安装 |
| 根 typecheck/build | 本轮重新顺序运行，两者 exit 0；未改产品代码，不重复运行未受影响的领域大套测试 |
| docs/encoding/skills/architecture/target-layout | 最终通过；仅规格门，不使用 --final 提前接受产品迁移 |
| repo-checks | 最终 45/45；脚本行为/依赖与第一轮实现相同，变更的是规范数据和摘要；独立审查另跑 docs/Skills 定向 17/17 |

最终浏览器报告会覆盖前次 report/results；第一轮完整报告已在本轮临时目录保存副本，原日志/提取图仍在第一轮 audit。
根构建、领域 fixture 和浏览器的作用不同：构建不证明设备/安装，浏览器受控 Host 不证明真实 provider，
临时数据库不证明生产恢复。第一轮 Jobs/Capabilities/Platform/Desktop/Audio/契约 roundtrip 等证据明确复用，
没有把它们改记为本轮独立重跑或新 Skill 的自主实现成功率。

### 同请求隔离读取对照

两份快照分别保存 1,379/1,380 份文本文件；排除 docs、.agents、AGENTS 和摘要数据文件后，
1,164 份原始输入逐文件 SHA-256 相同，差异为 0。未复制依赖、运行数据或私有资产；快照缺 uv.lock/.venv，
适用于只读路径核验，不能据其直接运行产品。原始清单与 `comparison-input-verification.json` 可复核此边界。

两组使用相同四项请求：①首次接手取得本地代码/界面证据；②已批准的小表单错误/取消修复路线；
③Jobs 旧库恢复与 Avatar 新字段；④继续架构 v2 的机器恢复点。继承相同父级模型/工具设置、无历史 fork，
限定只读本组快照，不联网、不运行产品/测试，不读另一组和研究/矩阵/评估，不修改输入。

| 实测观察 | before：七 Skill＋旧 docs | after：八 Skill＋新 docs 初稿 |
|---|---|---|
| UTC 起止 | 06:14:50–06:22:36 | 06:40:26–06:56:41 |
| 经过时间 | 466 秒 | 975 秒 |
| 请求产物 | 四项只读调查/操作路线 | 四项只读调查/操作路线 |
| 首次接手 | 找到 Storybook 与可选 UI fixture，指出原上手缺受控路径 | 直接找到新受控路径，同时核对出 grep 与真实 spec 标题不符并修正建议 |
| 表单范围选择 | 显式假设 Extensions installer，追到 prepare/cancel/commit owner | 显式假设登录表单，追到输入清空与认证 generation/资源 owner |
| Jobs/Avatar | 均找唯一源、离线新候选与未来迁移边界；未称已运行 | 同左，并明确数据参考不等于已存在生产库、当前 Avatar 与目标 Embodiment 不同 |
| 架构恢复 | 正确恢复 P02A；误把 G 门与 D04 场景的不同列表认作必然冲突 | 正确恢复 P02A，并找到 now.md 遗留 A00 的活跃路由冲突 |
| 用户确认/越权修改 | 0/0 | 0/0 |

两组都额外读取了快照外的本机 Skill Creator 作为评估方法，偏离“仅本组快照”的最严格资源约束；
产品事实未取自该文件，仍不能将本次称为完全封闭的对照。对未点名的表单，两组选择了不同具体 feature，
因此不能直接比较实现质量。两组均未实施产品修复；表单建议只是源码调查，未成为已确认产品缺陷的验收。

before 报告的 G/D“冲突”经执行者核对 acceptance 原文，实际是证据/准备门与行为场景的不同维度；
已在切片指南澄清，不修改 machine acceptance 或任务进度。reviewedAt 是原审计输入，不自动等同最新 evidence 时间。
after 发现的错误命令是真实新增缺陷，实际失败和修后通过均保留；不是因有新页面就评为成功。
before 报告另有链接排版错误，未经工具执行的建议不计入 PASS。两份原始报告均保留，不追溯修改评估输入。

该单次对照没有随机重复、无专项 Skill 组、token/费用或逐工具开销数据，精确模型名未由工具返回。
975/466 秒不能支持提速结论，任务产物和条件也不足以估计可靠性增益。可用结论是两组都能完成这组调查，
新路径实际暴露的问题已按证据修正；没有得出新体系全面优于旧体系的结论。

### 真实文档成果与独立修正

另给独立产出者一个新请求：为首次维护 Cognition 者说明模型工具结果的来源、权限、unknown、
Conversation 事实与记忆的关系，并提供受控验证入口。只读 after 的原始资料，输出到临时目录，
不给预期答案、不运行模型/产品。实际生成 `cognition-reader-output.md`，独立初稿时间 06:59:02–07:06:19 UTC（437 秒）。

成果追踪 ACTION→结果 durable receipt→untrusted Experience，区分 canonical 事件与现实真值、
unknown 与未执行、experience 与 memory_candidate，并给出真实测试节点。执行者核对 writer、Loop、Context 和测试后，
发现默认 uv run 可能同步共享环境，要求窄修；产出者 07:08:58–07:10:07 UTC 修正，保留初稿问题。
整合者再将“离线”语义限定 uv 的依赖网络，避免误称 pytest 已被网络隔离。这两项是整合反馈，
不能计为产出者自行发现；用户确认 0 次，不能据此称成果完全无需审查。

修后两条命令在已准备的主仓实际运行，保留 frozen/no-sync/offline/no-python-downloads 参数及环境前置检查：
Worker 的 durable_receipt_reopen_and_conflicts、unknown_is_durable_observation_not_success 两项通过（1.09 秒），
Core 的 execution_result_context_cannot_upgrade_external_output_to_host_verified 一项通过（0.08 秒）。
这是执行者的真实 2＋1 测试，不是产出者在缺依赖快照的运行；不触及真实模型或生产数据。
成果留作实验记录，详细领域事实仍由既有实现/Conversation 文档维护，不再新增一份重复长篇权威页。

独立只读审查覆盖 AGENTS、八 Skill/资源及本轮入口/治理/指南/Cognition/Data 正文；没有通读全仓所有实现。
审查实际复现零测试命令，并发现 uv sync 的 extras 冲突、无可执行入口的额外格式门和过期 A00 摘要。
执行者修后逐项复核；后续手工发现 ADR 和历史清单的两处章节链接，再窄审通过。
Cognition 末段另修正旧 SkillRequest 意图与仍存在 wire mapper 的混淆、根 test:all 事实；独立对照源码确认。
最终无未解决阻塞发现，修改中的文件明确复核最终字节；hash 范围清单另存临时 audit。

### 未验项与维护

正反触发和 17 条代表读取路径仍以设计/场景推演为主，真实发现不等于隐式匹配成功率。
尚无干净上下文的全领域自主实现 A/B、冷机/跨 OS、真实 Unity/Live2D、麦克风/播放、云模型、
外部平台或生产恢复证据。三处用户 dirty、产品版本漂移和 P02A 原未验门保持原状。
当前缺口在覆盖矩阵逐域标注；后续按真实需求获取对应证据，先修代码/工具/资料的最小 owner，
再由重复反例判断是否值得改方法，不建立每次失败都追加永久规则的机制。
撤回须同时恢复正文、Skill/入口消费者、精确清单、生成树和摘要，保留用户数据与已有改动。

## 第三轮：重新推导与实际结构迁移

本轮不是原结构的默认延续：先写独立需求/知识与能力模型，另一个只读执行者从原始源码推导需求，
第三位固定官方/文档方法/真实工程配置，再比较布局与能力方案并映射文件。方案与具体文件树在实施前已展示。
采用理由归[设计决定](design-decisions.md)，旧文件逐项处理归[迁移](migration.md)，完整能力与请求路径归[覆盖](coverage.md)。
前两轮数据保持历史结论；本节拥有第三轮实际观察，不将静态格式或上游案例变成能力认证。

### 候选、输入与授权

主仓 HEAD 仍为 `b885debb00c2f4b4308914bba9b9ed14fcf629a1`，本轮唯一整合写入 owner 为父任务；
只读研究/审查及隔离实现明确分配资源。开始保存 93 个 dirty/候选入口、原始字节和完整 Git 可见输入。
原两个 Kernel dirty 与 execution.json 三份 SHA-256 仍与前表完全相同，没有产品实现写入、进度推进、个人配置修改、Skill/插件安装、推送/发布/生产或关联仓库写入。
两组隔离 Git 输入提交只用于临时实验，不在主仓提交，也未创建用户会话。

本轮审计根为本机临时 `glimmer-design-rederive-3SQUFU`：before/after 输入、逐文件 SHA、迁移映射/一时工具、
固定来源、实际命令日志、宿主发现 JSON、独立审查、选择结果和浏览器报告均在其中；可过期，不作为产品依赖。
两份实验快照分别 1575/1572 文件；选取产品/Core/App/Host/Engine/Native/SDK/Contract/config/asset/template/deploy/CI 的非 Markdown 输入，
1274 个路径及原始 SHA 完全一致，且本轮主仓这些输入仍匹配。新增工程检查依赖与 docs/指令差异不伪装成同一输入。

### 直接运行、静态门与依赖行为

| 检查/成果 | 实际结果 | 证明边界 |
|---|---|---|
| 官方 creator `quick_validate.py` | 九个均 PASS；离线临时 PyYAML 6.0.3，`uv run --no-project --offline --with PyYAML==6.0.3 python ...` | 名称/frontmatter/未完成占位，不证明决策 |
| 自有 `pnpm check:skills` | 九个 PASS，唯一位置、metadata/引用、Git 可见性 | 不证明隐式调用；flat/no symlink 为项目约定 |
| 真实 app-server `skills/list` | root 与 Personal Server cwd 均 30 个总项、9 个 repo scope，enabled=true、errors=[] | CLI 0.160.1 实际发现/加载元数据；不是模型自动选择的端到端证明 |
| `pnpm check:docs` | 119 活跃 Markdown 的本地文件/章节、入口可达性、精确清单、任务状态和生成视图 PASS | CommonMark AST＋GFM slug 约定；不验证远端/HTML/事实/代码示例 |
| `pnpm check:encoding`、`check:architecture`、`check:target-layout`、diff whitespace | PASS；所有 inventoried text 为合法 UTF-8 无 BOM | 普通 target-layout 是规格一致，不关闭产品最终布局/迁移门 |
| repo-checks test | 49/49 PASS，0 skipped | 新增改标题/重复/Unicode/Setext/代码/metadata/编码/目录反例及 CLI 0/1/2；既有 Skill/锁/清单反例仍通过 |
| 根 `pnpm typecheck`、`pnpm build` | 按顺序集中运行，两者退出 0 | 本轮必要工具源码交付门；不是全部 runtime/设备/安装验收 |
| `node --test products/personal-server/tests/supply-chain-contract.test.mjs products/desktop/tests/package-contract.test.mjs` | 9 PASS、0 skipped | 实际临时制品/verifier、错误 source/digest/builder 和配置契约；无真实签名/远程 release/Windows 安装 |
| Kernel Extension Package Manager＋MCP provider 两文件 | 5 PASS、4 按环境开关正常跳过，退出 0 | 临时包/回滚/受控网络和真实 stdio MCP 枚举/断线/重连/撤销/stop；四个真实 Registry/供应制品条件未提供，未调用外部账号 |
| 迁移后首次受控教程的浏览器命令 | narrow 下 2 PASS（6.2 秒） | 当前根构建、真实 Product Host/Chromium、a11y/登录截图；人工检查了 trace 中真实登录与已认证系统页，未修改主仓 UI |

CLI 的新退出码反例实际执行：正确文档为 0，失效 heading 为 1，非法命令参数为 2。
增加的是三个确定性解析开发依赖，锁固定版本；许可/依赖/行为与未运行 install hook 的依据见 research。
没有增加独立安装器、模型评估服务、网站构建器或重复 Skill 脚本。

第一次官方 validator 包装误从根 uv project 启动，离线因缺 llvmlite 缓存失败；改为 `--no-project` 临时环境后九个通过，没有下载模型/依赖。
一次临时宿主审计脚本括号错误在调用前报 SyntaxError，修正后真实发现成功。
迁移辅助在删除已整合旧文件后因把自己尚待生成的迁移记录列入 exists 前置而中止；未写清单/产品文件，改正后幂等收束并通过全部路径/清单门。
首次生成树门还发现一个旧 AI 指南链接和治理索引不可达，修正正文/入口后通过；这些失败均未计为 PASS。

### 独立正文和固定候选审查

需求研究者只看开始快照的旧组件正文及原始源码，未拿到父任务结论；主仓不写。
其意见促成组件合并、精确 phase/Ingress 范围、音频默认关闭、历史实机证据、路径 resolver owner 与认知状态的收窄。
其中“认证只在 Host”的解释经整合者检查没有照采：当前 Kernel transport 和迁移中 Host 都有 HMAC/proof 实现，文档已分别标注实际 consumer。
Knowledge 数据图另修成 Vault/已审批 Resource 与 Episode 巩固两条来源，不再暗示 Knowledge 来自 Memory consolidation。

独立最终审查只读 AGENTS、普通 docs/Skill/checker 与原始源码，未读研究、评估、迁移或设计结论。
发现并修正：合并后重复前置链接，旧回合提交/推送授权在常驻指南/宪章中的错误归属，repo-checks 文档漏列 skills owner，
以及工程参考仍称不检查章节的事实漂移。后续窄审查复核临时授权仍由原任务书拥有、Knowledge 源码链与查询边界一致，未报新的可复现缺陷。
一次宽搜索让被排除历史 evidence 的少数匹配行进入审查输出；审查者披露未据其形成结论，不把此过程说成完全无污染的盲评。

建议的 docs 本地目标一律限制主仓 realpath 本轮未采纳：当前没有越界链接的反例，合法只读关联资料与独立分发的要求需要先界定。
现有 Skill 自包含检查保持；不把一次泛化建议加成全局永久门。若以后需要可独立交付站点，再以实际消费者/允许边界验证。

### 描述选择与不应触发请求

独立选择者只获得九入口名称/描述与 20 个请求，不给正文、意图答案或父任务结论；事前保留人工路由接受标准。
这是模型对描述的场景选择，不是宿主自动调用/实际执行。下面只记录选择，不以自评算正确率。

| 请求类型 | 首次实际选择 | 判断/修正 |
|---|---|---|
| 登录表单、新营销页、Jobs 恢复、Context/Memory、Electron 退出、文档事实、不明延迟 | 分别 ui、ui、services、cognition、desktop、documentation、investigation | 主专业相符；真实 UI 执行另见下节 |
| Avatar wire、SDK serialized manifest | 两条均只选 contracts | 未预选事前设想的第二 Skill；contracts 本文已有跨语言/SDK 完整方法，不能为了命中预设强制无关加载，运行行为变化再组合领域方法 |
| CI run、错误来源的固定包 | delivery | 新描述能找到专业入口，不表示远程 CI/签名已实际验证 |
| MCP 撤销 | integrations＋条件性 services | 主专业相符；条件应以真实 owner 决定，未加载全部正文 |
| 产品 Skill Plane 权限 | 初选 services；第二位六例复查先不选，仅条件 services | 暴露 metadata 未说明 body 已有的产品 Skill Plane 方法；补 integrations 描述/UI metadata，第三位独立六例明确选 integrations，services 条件性组合 |
| 纯配置定义查询 | 初选 services | 范围过宽；收窄描述/首段，后两位独立六例均不选，直接查 Reference/源码 |
| 已知错字、单包编译、v2 只读恢复、未知副作用恢复、普通翻译、Word 制品 | 均不选项目 Skill | 相应局部资料/原机器状态/事务/制品能力；无通用导航 Skill 或借用权限 |

最后六例包含 Jobs、普通编译、MCP、产品 Skill Plane、Word 与纯配置查询，匹配预期的主专业/直接资料边界。
未重新把全部 20 例跑成大样本，也没有从六次选择推导所有真实任务的隐式调用质量。
官方 validator 与自有 checker 在 metadata 最后修正后再验；宿主发现亦以最后响应记录为准。

### 隔离真实实现对照

对照是开始候选的八入口结构与本轮九专项/文档布局，两组相同模型继承、工具/权限边界、产品输入和用户请求：
“Personal Server 登录表单新增默认关闭的显示访问令牌开关，保持视觉/a11y，失败可修正重试”。
不给预期实现、疑似 bug 或父任务结论，不允许网络/全局 Skill/主仓写入。两组共享已装 node_modules 的只读 junction，
因此不是依赖完全自包含的冷机环境；本机不提供完整模型 token/执行开销或精确 agent wall-clock，未估算。

| 观察 | 开始结构组 | 新结构组 |
|---|---|---|
| 方法选择与资料 | ui；AGENTS、UI 指南、token 与局部源码 | ui；AGENTS、合并后 UI 指南、token 与局部源码 |
| 自主产物 | 五个产品局部文件：表单、样式、交互 test、两张暗色快照 | 同样五类/五个局部文件 |
| 运行失败 | pnpm junction 自动重建确认中止；首次未先构建 Web，fixture 返回未授权 JSON，随后修正 | pnpm junction 自动重建确认中止；之后使用预装 CLI 构建/检查 |
| 自选验证 | 真实交互 2、认证套件 5 PASS/3 按视口 skip、a11y 2、视觉 2，包三套类型/构建通过 | 宽窄交互/a11y/视觉合计 6 PASS，包三套类型/Vite 构建通过 |
| 外部人工决策/父任务救援 | 0；环境问题自主识别与回退 | 0；环境问题自主识别与回退 |
| 只读边界/主仓产品修改 | 无主仓写入、无外部账号/消息、未安装依赖；agent 自报与产物范围复核 | 同左；全部 catalog 元数据输出是发现信息，不是全部正文加载，不计为已发生误触发 |

整合者实际检查两组 diff，确认仅上述五个既定 agent 文件。对照组曾试制误标浅色截图，发现匿名登录仍深色后删除，未改主题行为；不把它算成功的浅色验证。
对照组错误后回焦/提交中禁用可见性控件，新组保持按钮焦点/允许切换；二者都满足给定任务，非同一所有 UX 选择。
自选 tests 不完全一致，不能直接比较它们的条数/时长推导质量/效率。

在两组结束后，整合者添加相同字节的临时用户结果 oracle，使用真实 fixture 的 401（不 mock 拒绝响应），
验证默认隐藏、Space 切换、值保留、真实拒绝后修正、成功进入 app 和无水平溢出，并保留实际截图/trace。
相同命令在两组均为 desktop/narrow 各 1 PASS：开始组 2 PASS（5.4 秒），新组 2 PASS（5.3 秒）。
这些只是本机小样本浏览器测试时间，不是 agent 成本；不据 0.1 秒差异宣称提速。两组截图均已查看，测试值为虚构 token。
没有引入无专项 Skill 第三组：本次对照用于验证结构迁移未阻碍该内聚任务，不提供专项能力的因果增益结论。
实验源码/快照只在隔离目录，未搬回主仓。

### 覆盖、剩余证据与维护

本轮新增实际方法包括需求/质量与领域建模、构造/生成/集成、SDK/MCP/安装撤销、CI/固定字节/独立信任与恢复、
共享权限指南、组件事实去重与真实章节失效检查。前端/React/a11y、后端/持久化/Jobs、认知/模型评估、C#/Unity/Native/音频等专业内容继续按前述一手研究组合。
前两轮 Jobs/Capabilities/Cognition/Platform/Audio/监督、Contract TS/Python/C# roundtrip 与 UI/文档运行按原范围复用；本轮没有相关产品输入变动，不称重新运行。
架构迁移与长任务的读取/恢复包含机器状态、原授权、Git/哈希核验和静态执行图，本轮未实施产品 v2 切片；不能把只读恢复/场景推演宣称为真实产品迁移。

没有取得 Unity/Cubism/Native 实机、GPU/麦克风/真实模型质量、远程 CI/attestation、跨 OS 干净安装/升级/卸载、生产/完整恢复的新证据。
所缺环境分别是对应 SDK/许可/构建工具、设备与模型授权、固定发行物/可信身份/隔离目标 OS 和一致真实数据副本；相关方法已落地，产品/环境门保留。
已有 0.2.x 版本及关联仓库资料漂移不在本轮改版本/跨仓写入授权内，矩阵给出具体 owner/核验方法，不冒充已解决。

维护与可撤回方式以设计和文档维护指南为准：新增模块/职责迁移/重复失败/上游变化按受影响请求复验，先修 owner 的事实/工具再判断最小规则；
研究、迁移与评估不默认进入普通上下文。回退同一 diff 中的正文、消费者、清单、生成树与摘要，保留三份用户 dirty 和必要历史，避免恢复长期双轨。

## 提交前的隔离复核

2026-10-15 用户要求提交后，从 Git 暂存区导出完整候选，在临时 Git 索引中检查；不带入原有两处 Kernel 修改、
架构 v2 `execution.json` 修改及其 `status.md` 生成投影。三份原始用户文件的 SHA-256 保持上文记录。
暂存差异检查补出两份新增 Cognition 组件文档的末尾空行，已修正。

隔离架构检查发现既有拓扑规则仍要求 Cognition 的 `domain/` 与 `application/`：
起始提交没有这两个目录的受控文件，本机仅剩忽略的 Python 缓存，使此前工作树检查未暴露问题。
删除这两项过时存在性要求，保留实际 `ports/`、`adapters/` 及其余边界检查；新增 fixture 验证无旧目录时通过、
缺少实际 `ports/` 时仍拒绝。未创建占位目录或改动产品实现。

修正后 repo-checks 测试为 **50 PASS、0 skip**。隔离候选的 docs（119 份活跃 Markdown）、9 个 Skill、
UTF-8 无 BOM、architecture 与 target-layout 普通规范检查均通过；后者未使用 `--final`，不表示目标架构已实现。
此前根 `pnpm typecheck`、`pnpm build` 的记录沿用；此轮只修改文档格式、检查器及其回归测试，未重新宣称产品或设备验收。

## 执行成本与收束效率复核

2026-10-16 以干净 `a5be6549` 为输入，只调整开发协作指令、既有指南/任务摘要与必要摘要锁。
本轮不实施产品迁移、不关闭 P02A 或最终门，不借用原迁移任务的提交/推送授权。
未统计延期的各项成本，不提供速度或模型开销改善百分比；上游方法与项目判断见[定向研究](research.md#执行成本与阶段收束复核)。

### 脚本实际行为

在该 HEAD 的完整 Git 文件快照上，用现有 docs CLI 的 `--repository-root` 执行以下受控实验，未改变主仓脚本。
实际执行 10 次 CLI，逐一核对退出码与产物，最后恢复快照中的三个受试文件。

| 输入/调用 | 实际结果 |
|---|---|
| 合法输入先 `--write` 再只读 | 均 exit 0；写后实际调用同一 checkDocs，后一次无新增覆盖 |
| 加入失效章节链接，分别 write/read | 均 exit 1，错误文本相同；write 不是跳过链接检查 |
| 合法 nextAction 变化加失效章节 | write exit 1，但 status 已包含新的临时 marker；证明失败并非自动回滚 |
| 将 nextTask 改为不存在的任务 | write exit 2、read exit 1，均明确失败；不能吞退出码或当作已验证 |
| 合法状态变化但未生成视图，read→write→read | 依次 exit 1→0→0；写后已覆盖所需验证 |

这些数据支持“同输入且 write 成功后不重复只读检查”，不支持省略内容/事实核验或失败后的修复。
源代码还确认 architecture 包含普通 target-layout；final 的实物/Git 集合门独立保留。
原始命令/输出保存在本机临时目录 `glimmer-workflow-cost-725e77a8/docs-cli-probe.json`；该目录可过期，方法和结论不依赖它作为常驻状态。

### 代表请求与隔离前向验证

两个独立评估者分别使用起始规则与本轮候选，收到相同请求：恢复当前 P02A 接续点、只替换长任务指南中的一句同义措辞，
再推演三个关联高风险提交的收束与三类新发现。未提供预期答案、父任务分析或对方结果；不是大样本或宿主自动触发测试。
两份完整文件快照分别建本地实验 Git，预先实际通过 docs/architecture/skills；允许的协作范围外 **1,356 个版本控制文件字节相同**。

| 观察 | 起始规则组 | 本轮候选组 |
|---|---|---|
| 普通接续 | 沿机器状态找到 trace-context/实际 consumer，复用静态预检，未重跑产品测试 | 同样找到 O 批次，列出 C/O/R/M/E 的具体缺口与未关闭门，复用预检 |
| 低风险真实产物 | 一句替换；direct docs/encoding、diff 通过 | 同左；整合者复核两组均只有指定版本控制文件/一句变化，并用相同直接 CLI 再验通过 |
| 三个关联提交 | 推演为一个监督链候选，按影响验证并独立审查 | 明确区分保存提交/验证批次/固定候选，关联 findings 一并修复后复核最终组合 |
| 新发现分流 | 当前吞错阻断；P12B 原装配按删除门交接；全面重写日志不加入本批 | 相同判断，并说明现有真实 consumer 和本步门不能因交接而免验 |

后两行只验证模型对方法的解释，未执行产品修复或真实高风险审查。
本轮候选最初的抽象监督场景偏向 Host 测试，尚不足以证明当前 Kernel App 的预算/错误传播；
因此当前 P02A 摘要补清实际 Kernel 与 Host consumer 及其证据入口，未把 Host 目标当成已经切换的事实，也未追加全局必跑测试规则。
起始组也能复用恢复证据、合并关联审查，不能宣称新规则才具备这些能力或已量化减少了重复调查。

#### 实验环境偏差

快照未带完整根 node_modules，工具依赖通过 junction 复用，未实施权限级只读隔离。
两组各尝试两条 pnpm 根检查时，包管理器自动进入依赖同步，评估者发现后 Ctrl-C，四次均退出 1，不能计 PASS。
起始组报告下载 31 个包、添加进度 128/178；候选组报告下载 0、添加进度 853/852，随后均改用已检查的直接 Node CLI。
这包含包缓存复用和非版本控制目录副作用，**不能比较这些数字、等待时间或命令数量来主张流程提速**。
未删除未知缓存或重建主仓依赖；主仓 package.json、pnpm-lock.yaml 没有变更，既有依赖主元数据时间仍为 2026-10-15，
检查器模块仍可加载且 repo-checks 50 PASS。没有事前完整缓存指纹，不能据此宣称缓存无任何变化。

实验 Git 未包含源 `a5be6549` 对象；候选组一次源 SHA diff 返回 128，改据预检上下文，不算成功的 Git 历史恢复。
上述限制保留，未重复扩大实验。原始结果与共同产物核验在同一临时目录的 eval-a/b-result.md、evaluation-oracle.json。

### 不变量、覆盖与仍缺证据

直接结构比较确认 execution.json 仅 P02A.nextAction 改变，所有 task/stage 状态、依赖、mapping 与 acceptance 保持。
产品 baseline、目标 files.json/physical-layout、验收矩阵原始字节未变；只同步四个已修改规范源的摘要，锁源集合及产品不变量保持。
P02A 的 57/29/28 物理快照与 28 条具体缺项逐项核验相等；没有据重新分组制造产品关门进展。
九 Skill 元数据/位置/引用检查、两个修改入口的官方 quick_validate 已通过；repo-checks 50 PASS、0 skip。
本轮没有产品/依赖/构建或检查器执行逻辑变更，未重跑根 typecheck/build 或设备/安装/恢复矩阵，相关最终门完整保留。

持续缩小 P02A 剩余量的效果仍需后续真实产品批次观察：沿同一 evidence 摘要记录实际关门、具体缺口和证据，
只在取得可比日志时报告耗时/介入；不新增强制统计账本。当前数据支持方法更明确和脚本覆盖判断，不证明整体效率或可靠性因果改善。

### 固定候选审查与修正

以 `a5be6549` 为 base，将 16 个规则、任务、视图与摘要锁文件按内容指纹固定；研究/评估记录不作为运行规则输入。
独立只读审查发现两项非阻断歧义：根指令仍字面要求 v2 普通继续读 README；P02A 的范围分组被称为同一验证批次。
两项合并修正后，根入口仅在未知时导航；T/C/O/R/M/E 明确为收束组，各组按共享批次方法逐步关闭，nextAction 指向 O 的 trace-context 子链。
重新固定候选，只复核上述增量、失效证据及其组合；两项均关闭，无新增 finding。原/新 16 文件指纹及旧快照逐一匹配。
摘要只同步两个再次修改的规范源；架构检查与状态/目标不变量比较通过，没有新增任务状态或产品关门结论。

审查者另按真实源文件推演同时修改 Platform supervisor 与 Kernel composition：追到 LifecycleOrchestrator、实际 App 和 createKernelApplication，
区分 Platform drain 反例、Kernel application-runtime 与 composition bootstrap 的覆盖，保留前置构建和最终根门。
这补充了前述抽象场景的真实消费者调查证据；没有执行这些产品命令，不能计为行为测试通过或 P02A 接受。
审查原始报告为同一临时目录的 final-review.md 与 final-review-followup.md，结论和修正记录保存在本节，不要求日常任务读取报告。

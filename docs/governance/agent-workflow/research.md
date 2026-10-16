# 来源研究与采用记录

> 范围：本次协作体系重设计的来源、实际实现调查、采用理由与限制；不作为日常任务指令。
> 事实依据：2026-10-15 联网读取的一手资料、固定 commit 的公开文件、本机 Skill 内容及项目源码。
> 维护触发：再次评估对应能力、来源行为/许可/依赖变化或代表任务暴露缺陷。

## 目录

- [官方机制与工程建议](#官方机制与工程建议)
- [公开实现快照](#公开实现快照)
- [专业候选的实际取舍](#专业候选的实际取舍)
- [本机与插件能力盘点](#本机与插件能力盘点)
- [采用边界与维护](#采用边界与维护)
- [文档工程与知识组织复核](#文档工程与知识组织复核)
- [执行成本与阶段收束复核](#执行成本与阶段收束复核)

## 官方机制与工程建议

以下分别是平台机制、开放格式、厂商建议和案例经验；新体系的文件数量、路由与风险门是本项目判断。

| 一手来源 | 类型与实际核对 | 本项目采用与适用限制 |
|---|---|---|
| [OpenAI Docs：Build skills](https://learn.chatgpt.com/docs/build-skills) | 平台机制；名称/描述发现、显式/隐式调用、`.agents/skills` 向仓库根查找、同名不合并、默认允许隐式调用 | 按任务元数据发现；七/八入口是前两轮历史候选，本轮九专项见设计决定；旧目录迁移；不改全局发现预算。真实本机 skills/list 结果另见验证记录 |
| [OpenAI Docs：AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | 平台机制；根到 cwd 合并、override 优先、指令大小预算 | 根只放共同约束；不为每个目录复制规则，不新增其他厂商配置 |
| [OpenAI：Rethinking skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)（2026-09-11） | 官方建议；窄触发、少重复资料/仪式、按当前模型能力重估旧规则、明确任务完成边界 | 删除全局迁移重读与机械门；保留项目实际需要的数据/权限/生命周期门，未迁移模型或改个人设置 |
| [OpenAI：Testing Agent Skills Systematically with Evals](https://developers.openai.com/blog/eval-skills) | 官方评估方法；prompt、trace/artifact、可观察标准；正例、负例与控制条件 | 静态、推演、真实运行分开；不把必须多读/必须调用工具计为效果提升 |
| [Agent Skills Specification](https://agentskills.io/specification)、[作者实践](https://agentskills.io/skill-creation/best-practices) | 开放格式与建议；frontmatter、名称/目录一致、渐进披露、适度控制、实际专业知识 | 结构校验与按需引用；可移植格式不等于各宿主的权限或发现机制相同 |
| [Anthropic：Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)、[Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 一手工程经验；把专业程序与支持资源按需提供，控制上下文工作集 | 指令/事实/状态分开；不复制 Claude 配置、工具或厂商授权假设 |
| [Microsoft：Agent orchestration patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) | 架构建议；按依赖与协调代价选择顺序/并行/交接 | 同一强耦合工作一个 owner，独立判断按风险；不默认多 agent 或创建用户会话 |

本机 `openai-docs` 与 `skill-creator` 的实际正文、`openai_yaml.md`、生成器和 quick validator 已读取。
本机版本用于本次执行；公开 openai/skills 的相邻实现用于交叉核对，不假称二者完全相同。

## 公开实现快照

直接从 GitHub API 固定 HEAD commit，再取该 commit 的原始文件；共取得 50 个候选/支持文件（含许可证、脚本与评估样例），
只读取、未运行外部下载脚本。之后单独读取 Codex skills/list 协议 schema，以执行本机发现检查。
commit 日期是快照信息，近期有提交只证明维护活动，不证明质量；没有用 star、热度或搜索排名评分。

| 仓库 | 固定 commit（链接可复验） | 快照提交时间 UTC | 许可核对 |
|---|---|---|---|
| openai/skills | [49f948faa925](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431) | 2026-06-24 | 所读 Skill 的 LICENSE.txt 为 Apache-2.0 |
| anthropics/skills | [dbd4588f9e10](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44) | 2026-10-09 | frontend-design、webapp-testing、mcp-builder 各自 Apache-2.0 |
| vercel-labs/agent-skills | [063bee94c3f4](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278) | 2026-08-28 | react Skill frontmatter 声明 MIT；该快照未发现 LICENSE 文件，不复制资源 |
| trailofbits/skills | [e1f86a390d4c](https://github.com/trailofbits/skills/tree/e1f86a390d4caf28bf1c377a7d86707b2898669c) | 2026-10-14 | 根 LICENSE 为 CC-BY-SA-4.0；仅独立表述方法，不搬文本/规则/图标 |
| obra/superpowers | [bb92a7774141](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3) | 2026-10-10 | 根 LICENSE 为 MIT |
| wshobson/agents | [46891e7e60da](https://github.com/wshobson/agents/tree/46891e7e60da0e52baf1050b7b6391b64e84c6d9) | 2026-10-04 | 根 LICENSE 为 MIT |
| pbakaus/impeccable | [a231cc5b30ac](https://github.com/pbakaus/impeccable/tree/a231cc5b30ac7747f8088d076ece12518f2d839d) | 2026-10-15 | 根 LICENSE 为 Apache-2.0 |
| microsoft/vscode | [9ebdca5c15f6](https://github.com/microsoft/vscode/tree/9ebdca5c15f666ab336ca0b0421f5ee25bf1cbe0) | 2026-10-15 | LICENSE.txt 为 MIT；所读为指令/协议 owner 案例 |
| openai/codex | [bb64b894fd67](https://github.com/openai/codex/tree/bb64b894fd67158be0f874872e6d7bfe717e7368) | 2026-10-15 | LICENSE 为 Apache-2.0；所读为发现源码/协议/局部指令 |

## 专业候选的实际取舍

| 候选、实际读取入口 | 输入/输出、关键方法和工程证据 | 采用/放弃及适配差异 |
|---|---|---|
| [Anthropic webapp-testing](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/webapp-testing/SKILL.md)；with_server.py、element_discovery.py | 给本地网页→DOM/截图/交互证据；脚本用 shell 子进程、PIPE、TCP 端口探测与 terminate/kill；Python Playwright 依赖 | 采用先观察再操作、最终清理；不复制脚本。端口不是业务 ready，根进程 terminate 不证明树回收；本项目优先现有 TS fixture |
| [Vercel React](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-best-practices/SKILL.md)；async-parallel、derived-state-no-effect 两条实际 rule | React 改动→按影响排序的性能判断；参考 rule 给错误/正确例与 React 官方来源 | 组合使用已装能力，采用并发/派生状态/实测 profile；不加载整份 compiled AGENTS，不套 Next/RSC 规则、不默认加 SWR |
| [Impeccable](https://github.com/pbakaus/impeccable/blob/a231cc5b30ac7747f8088d076ece12518f2d839d/.agents/skills/impeccable/SKILL.md)；operate/harden、launcher | 从界面任务选 Operate/Read/Persuade/Experience；harden 覆盖极端内容/错误/i18n；launcher 可下载并执行平台二进制 | 采用表面区分和极端状态方法；可用时组合合适模式。未运行 launcher，不引入下载/hook/第二 PRODUCT/DESIGN 源，不把 polish 次数当正确性门 |
| [Anthropic frontend-design](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design/SKILL.md) | brief→视觉意图、type/palette/layout→实现/截图自查；纯指令但含新视觉方案倾向 | 保留已装可选能力，用于新方向；成熟 app 调整优先已有简报/token，避免营销 hero 和预设“客户拒绝旧方案”改变任务 |
| [OpenAI security best practices](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/security-best-practices/SKILL.md)；React security reference；[threat-model](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/security-threat-model/SKILL.md) 与资产/控制 reference | 安全请求→按语言/框架资料与风险报告；威胁建模从 repo/部署/攻击者→边界与滥用路径；前者只支持特定栈，后者含等待用户确认假设 | 未安装；提炼实际边、资产、能力、拒绝测试至 security reference。普通开发不强制完整报告/暂停，也不把 web 栈清单覆盖 Electron/Native |
| [Trail of Bits property-based-testing](https://github.com/trailofbits/skills/blob/e1f86a390d4caf28bf1c377a7d86707b2898669c/plugins/property-based-testing/skills/property-based-testing/SKILL.md)；reviewing reference | 输入是有代数性质的代码/测试→roundtrip、幂等、oracle 或“不适用”；区分同义式、过滤导致空测；按语言选测试库 | 采用“先找有意义性质、沿用工具”；不安装 Hypothesis/fast-check，不把所有测试变性质测试，不搬规则文本 |
| [Trail of Bits variant-analysis](https://github.com/trailofbits/skills/blob/e1f86a390d4caf28bf1c377a7d86707b2898669c/plugins/variant-analysis/skills/variant-analysis/SKILL.md)；eval README、shell-sink prompt 与 precision grader | 已知缺陷→逐步泛化搜索与真伪分类；评估实际记录负例、grader 校准、Skill 未调用、基线饱和等局限 | 采用种子→泛化→查因果、正负样本和效果/调用分离；不搬并行 workflow、CodeQL/Semgrep 资源或指定 judge 模型。上游数据不是本项目数据 |
| [Superpowers systematic-debugging](https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/systematic-debugging/SKILL.md)、root-cause-tracing；[verification](https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/verification-before-completion/SKILL.md) | 故障→复现、边界观测、单假设与反例；验证 Skill 要求每条完成声明都重新跑完整命令 | 提炼有界实验/证据先行；不采用全任务四阶段、强制 TDD、每条消息重跑全量、固定失败次数后必须与用户讨论架构等过度控制 |
| [Wshobson database-migration](https://github.com/wshobson/agents/blob/46891e7e60da0e52baf1050b7b6391b64e84c6d9/plugins/framework-migration/skills/database-migration/SKILL.md)、async-python-patterns、python-testing-patterns、distributed-tracing | 迁移给 ORM up/down、备份表与 rollback 示例；async/pytest/trace 给语言/框架代码模板 | 调查后未引入。ORM 示例含 drop/recreate，不满足本项目 SQLite/WAL/不可再生事实恢复；异步和 trace 教程冗长且非本项目工具事实，保留项目 port/取消/有界并发方法 |
| [Anthropic mcp-builder](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/mcp-builder/SKILL.md)；best-practices、evaluation.py、requirements.txt | 外部 API→有 schema/分页/可行动错误的 MCP 工具；评估 harness 导入 anthropic/mcp、调用模型、固定格式答案 | 采用 schema/分页/真实任务/撤销检查；不安装 MCP server builder 或评估服务。项目多数是 MCP bridge consumer，不默认覆盖整个外部 API，也不把 annotations 当授权 |
| [VS Code AGENTS](https://github.com/microsoft/vscode/blob/9ebdca5c15f666ab336ca0b0421f5ee25bf1cbe0/AGENTS.md)、copilot instructions、[协议局部指令](https://github.com/microsoft/vscode/blob/9ebdca5c15f666ab336ca0b0421f5ee25bf1cbe0/src/vs/platform/agentHost/common/state/AGENTS.md) | 大型 Electron/TS 项目的根导航与局部 generated source owner；编译约束 version registry 漏项 | 采用根简短导航、真实 source→sync→consumer 思路；本项目 Contract Spine 已有同类机制，未复制 Copilot 配置或 AHP 版本策略 |
| [Codex 实际发现源码](https://github.com/openai/codex/blob/bb64b894fd67158be0f874872e6d7bfe717e7368/codex-rs/ext/skills/src/loader/discovery.rs)、局部 TUI AGENTS、SkillsListParams schema | 技能发现/读取与局部职责说明可由源码和本机 skills/list 交叉核验 | 用本机 0.160.1 的真实发现结果确认新目录，不把公开 HEAD 源码当本机版本行为保证 |

关键专项取舍还与一手技术资料核对：[React 派生状态](https://react.dev/learn/you-might-not-need-an-effect)、
[Playwright readiness](https://playwright.dev/docs/api/class-page#page-wait-for-load-state)、[Electron security](https://www.electronjs.org/docs/latest/tutorial/security)、
[SQLite backup](https://sqlite.org/backup.html)、[MCP security](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices)。
例如 Playwright 不推荐用 networkidle 判断测试就绪；因此没有照搬 webapp-testing 的固定等待建议。

## 本机与插件能力盘点

读取/枚举了用户 Skill 根、系统 Skill 根和当前三类插件缓存根；磁盘存在、会话暴露和工具可调用分别记录。
未改任何个人文件。首轮 app-server 在主仓和子目录均发现 28 个 Skill，其中 7 个为 repo scope、enabled；
docs 复核后重测为总数 29、项目 8 个、errors=[]，见验证记录。这不证明隐式触发质量或所有缓存都处于激活状态。

| 能力组 | 本机实际内容与决定 |
|---|---|
| 项目旧 Skill | 一个入口、16 references、openai.yaml；全文调查与消费者搜索后替换。旧 Cognition 路径、Extension 永久排除 Audio/Avatar、UI 固定多方案及全局迁移路由不保留 |
| 系统 | openai-docs、skill-creator 已使用；skill-installer 仅用于将来明确安装请求；imagegen 作为位图能力。磁盘 review-agent 不因存在就宣称可调用 |
| 界面 | frontend-design、impeccable 4.5.2、emil-design-eng、ui-ux-pro-max、design-taste-frontend v2、Vercel React、web-design-guidelines、playwright；实际正文及相关 references/脚本已按候选读取。优先组合，重叠/副作用见 UI 能力 reference |
| ui-ux-pro-max / emil / taste | 搜索数据可作专项建议，固定 icon/mobile 单位不覆盖桌面；动效哲学不作为产品 token；taste 明确营销范围，Node/浏览器和图库脚本有额外环境与写入，未运行/复制 |
| 浏览器/图像/解释 | computer-use 26.1007.71326、visualize 1.0.49、imagegen；用于有对应成果的任务，不承担产品逻辑或设备验收 |
| 文档制品 | documents、pdf、presentations、spreadsheets、excel-live-control、template-creator 26.1013.11914；用于相应文件/会话，不因本任务有 Markdown 就全量调用 |
| 外部环境/托管 | cloud-environment 0.1.2、plugin-management 0.1.0、sites 1.0.0；当前为本地代码仓，未触发云环境/托管/安装工作。Sites 不改变已有产品项目的 owner |
| 无关能力/未激活缓存 | work-pets 0.1.6、openai-templates 0.1.1 的文档/业务模板等已枚举；与开发协作目标无关，不加载或安装 |

可复验本机内容的 SHA-256（读取时；不把个人目录设为项目依赖）：

| Skill | SHA-256 |
|---|---|
| openai-docs | `8ce8021101bcea594ff92ee6cfd8ca7641a49ee66d7bc6070555f1a33fc239d9` |
| skill-creator | `cccd291077ec57c6f50ca6529f0f3fb93212da09473effb2fcec808e81b21288` |
| frontend-design | `d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3` |
| impeccable | `3c5eae6363d8fbf062c0b146063b968d757d236671326b011a8adfad651ca578` |
| emil-design-eng | `ffbe68e6007fb42cb8149f089b400a1ca007d59ba23e8948e2be4476f3175939` |
| ui-ux-pro-max | `8fb34816c70af73e9e5461bac3c2f4a5604faaaf53a2b3a6997c1baded0db453` |
| web-design-guidelines | `f4647ca866a3accf763777f83e7682954f0187cd6bea7eea0399796652414e8f` |
| Vercel React | `71ed7794962fa6e803ee83030517b5b93a9f70fbfeb431ec4535c5480a8d8355` |
| design-taste-frontend | `ee847084e58f5a81a46120912be9cd15f083570a6ca8f3d1a30372a720633043` |
| playwright | `c52cc95125b720cdc3c9829b0294c2752d4ae9b85a5282aa153da8bba929af87` |

## 采用边界与维护

前两轮没有复制外部代码、图标、模板、评估数据或大段指令，没有运行外部仓库脚本、自动安装 Skill/插件或增加模型服务。
方法均用本项目事实重新表述；归属在本记录保留。唯一执行的创作辅助来自已安装的官方 skill-creator；
其 PyYAML 6.0.3 通过 uv 离线临时环境提供，不写产品依赖或个人配置。新 Node 检查器复用项目已锁定的 yaml 2.8.2，
在 repo-checks 声明直接开发依赖，未下载新包或执行安装脚本。

后续直接复用资源前仍需核对该文件的实际许可、归属义务、依赖、网络、写入和退出行为；本记录不授予执行权限。
来源更新按体系设计的触发机制进行，保存新快照与受影响场景结果。过时方法优先修改/移除，不积累永久例外。
本次取得的效果与限制见 [验证记录](evaluation.md)，上游自报数据未计为项目验证成绩。

## 文档工程与知识组织复核

本节为本轮将范围扩展到 docs 后的新增研究，前面的专业 Skill 调查和原始结论保留。
再次获取 OpenAI Skills/AGENTS 官方页面、当前评估与提示指导；公开 openai/skills HEAD 仍为上述 49f948f，
因此已读取的官方 creator 和专项候选按固定版本复用，不声称全部重新运行。
本轮独立固定 Django 与 Kubernetes 文档仓库，读取实际索引、写作要求、配置/页面类型、审查说明及许可证；
不执行其 Sphinx/Hugo/Netlify 或其他外部脚本。

| 方法/案例 | 实际读取与采用 | 限制/放弃及本项目具体落点 |
|---|---|---|
| [Diátaxis compass](https://diataxis.fr/compass/)、[how-to](https://diataxis.fr/how-to-guides/)、[quality](https://diataxis.fr/quality/) | 以行动/理解及学习/应用判断读者需要；操作允许分支和判断，质量需与实际任务相符 | 不机械建四目录，不把短链接或类型模板算能力；新增受控上手成果，保留专业主题与独立历史/状态 |
| [GitLab topic types](https://docs.gitlab.com/development/documentation/topic_types/)、[SSoT/style](https://docs.gitlab.com/development/documentation/styleguide/) | 主题面向读者任务；单一维护源允许必要摘要，不能机械零重复 | 规则和详细流程各有 owner；重写规范/维护指南/开发手册，保留近处短背景，避免层层转介 |
| [Django index](https://github.com/django/django/blob/57ddccdcb0bc23eee6e9c304f69cf1ffd099151b/docs/index.txt)、intro/index、writing-documentation、conf.py | 同一主题可以从教程/问题/参考进入；教程尽早取得成果；源码版本与发布文档版本分别维护；链接检查区分跳过/重定向 | 只借鉴结构与判断，不迁入 Sphinx/RST 或借用 Django 的技术事实；当前 stable 页面为 6.1，main conf 为开发 6.2，未混作同一发布版本 |
| [Kubernetes page types](https://github.com/kubernetes/website/blob/bbea9aa9b7c1cbf67dfc66c4f7b19338e4f24d5d/content/en/docs/contribute/style/page-content-types.md)、content-guide、reviewing-prs | 任务有 prerequisites/steps/cleanup；避免双份详细来源；审查同时看内容/代码事实与实际渲染 | 本地 Markdown/项目工具已够用，不引入 Hugo shortcodes、Netlify 或第二套文档 CI；保留真实浏览器证据而非格式认证 |
| [Anthropic doc-coauthoring](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/doc-coauthoring/SKILL.md) | 完整读取其三阶段、逐节编辑、fresh reader 问题/歧义/遗漏测试及退出方式；仅提炼读者成果、独立读取和按观察修正 | 不直接采用：固定 5–10 问题、5–20 方案、占位骨架、逐节等待用户、要求用户开 Claude 会话/启用 connector 都不适合已授权自主仓库任务；新 documentation Skill 独立改写为证据/owner/任务成果方法，无此流程复制 |

新增成熟仓库快照：Django `57ddccdcb0bc23eee6e9c304f69cf1ffd099151b`（2026-10-15 01:11:59 UTC）；
Kubernetes website `bbea9aa9b7c1cbf67dfc66c4f7b19338e4f24d5d`（05:52:08 UTC）。
Django 根许可核对为 BSD-3-Clause，Kubernetes 根许可为 CC-BY-4.0；本次没有复制其代码、模板、图片或正文。
doc-coauthoring 目录只有 SKILL.md，没有独立许可；根目录也未提供 LICENSE，README 仅笼统称许多 Skill 为 Apache，
不能由其他 Skill 的 Apache 文件外推本文件许可。已读取 README/THIRD_PARTY_NOTICES，未据此取得明确文件级复用许可，
所以不复制指令或资源；读者测试等一般方法用本项目任务和独立表述实现。

本轮继续使用已有前端/React/浏览器、安全、性质测试、变体调查、持久化和 MCP 的专业研究，
实际吸收点仍由前表与专项正文体现；新增 docs 能力不把这些专业任务压成“遵循最佳实践”。
本地/全局/插件盘点未发现需要安装的新硬依赖；文档制品 Skill 处理 Word/PDF/幻灯片，
仓库 Markdown 的来源核验与导航采用新增 glimmer-documentation，避免只因“文档”一词误路由。

实际内容修正包括：共同验收/恢复流程一处维护、删除重复 Current 阅读壳、手册补 Host/分域 owner、
旧 Cognition/Memory/观测路径的源码追踪、Knowledge 不自动导入旧 Memory 的状态说明，
以及 G 类证据门与 B/D 类行为场景的区分。修正文档不等于完成任何产品迁移或设备门。

## 本轮重新推导及新增专业内容

本轮再次实际打开 OpenAI AGENTS/Skills、提示/评估指导与 Agent Skills 规范，区分要求、建议和项目选择。
官方 eval 博文的旧 `.codex/skills` 示例有其发表语境，当前发现机制以当前 Skills 文档和本机实际响应核对；不照搬旧路径。
本机系统 creator、UI YAML 说明/生成器/validator 已按实际任务读取并使用，未改变个人配置或安装 Skill。

| 来源及实际读取 | 内容、维护/工程证据、依赖与风险 | 本轮采用或放弃 |
|---|---|---|
| [Write the Docs: Docs as Code](https://www.writethedocs.org/guide/docs-as-code/)、[CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/) | 前者为社区工作方式及会议案例，不是目录标准；后者定义语法/解析，不定义内容质量 | 使用同仓 diff/审查/自动门；章节解析采用现有库，不引入网站生成器/额外服务 |
| [GitLab 固定配置](https://gitlab.com/gitlab-org/gitlab/-/blob/69f1f8b792b75915510800324f602b2024a99172/.gitlab/ci/docs.gitlab-ci.yml)、根 CI、Markdownlint、Vale、LICENSE；commit/pipeline/jobs API | commit `69f1f8b792b75915510800324f602b2024a99172`，2026-10-14 04:15:49 UTC；定义 lint/链接/Hugo/预览及选择性门。该 SHA pipeline 总体 success，但 job 列表没有 docs 专项，不能声称那些检查跑过。代码 MIT、doc/ CC-BY-SA-4.0 | 采用分清静态门/实际内容与按影响检查；不复制规则/模板，不安装 Hugo/Vale，不从其 job 定义推出本项目验证成功 |
| 前表 Django/Kubernetes 固定源码，另复读 Diátaxis 正文 | 正式文档、持续维护的源码/贡献指南/构建配置是本次所谓“成熟”证据；并非抽样证明用户成功率。Diátaxis 为作者方法，不是正式标准 | 本轮进一步取消 guides 阶段层级、合并重复组件正文、拆认知深细节；不是被外部四种类型规定的物理树 |
| [C4 diagrams](https://c4model.com/diagrams)、[arc42 building blocks](https://docs.arc42.org/section-5/)、[runtime](https://docs.arc42.org/section-6/) | 原作者建议按受众选有用层次；arc42 强调相关组件/接口和少数关键正常/失败/运行场景。作者方法，网页分别 CC-BY-4.0/CC-BY-SA-4.0 | 只辅助核对跨组件视图与重复组件详情，独立表述；不复制模板/图形，不声称全框架符合，不重设计产品 |
| [Backstage TechDocs](https://backstage.io/docs/features/techdocs/) | 工程站点的一手说明；Spotify 用量为站点自报，未取得独立测量 | 借鉴知识随代码和 owner 维护；不引入 Backstage/MkDocs/托管作为当前 Markdown 工作的依赖 |
| [OpenAI gh-fix-ci](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/gh-fix-ci/SKILL.md)、`scripts/inspect_pr_checks.py` 全文、agents YAML、该 Skill LICENSE.txt | 同一固定 commit `49f948f…`，Apache-2.0。脚本读取 gh auth/pr checks/run/job 日志，支持字段漂移/日志 fallback；要 gh、已认证网络；无失败项不代表 queued/缺失检查已通过。未执行该脚本 | 提炼 run/head SHA/最早失败/字段变化/日志缺失判断至 delivery；不复制/安装脚本，不沿用“再请示/必须 plan”阻断本次已授权实施，不从上游 prompt 元数据推导平台格式要求 |
| [SLSA 1.2 verifying artifacts](https://slsa.dev/spec/v1.2/verifying-artifacts)、[gh attestation verify](https://cli.github.com/manual/gh_attestation_verify)、[GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use)、[artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations) | 实际读取验证流程/命令与信任条件；subject digest、可信 builder/source/workflow 的预期须独立于待验制品；签名/SBOM 不等于某级保证 | delivery 连接真实 workflow/builder/verifier，补固定字节、独立信任、fork/秘密/cache/OIDC 风险与安装恢复；不改产品等级或宣布远程验签通过 |

新增专业能力的实际方法落点和代表验证在[能力补充](coverage.md#本轮主动补齐的方法)；关键依据链在[设计决定](design-decisions.md)。
本轮集成/供应链能力吸收了实际技术内容，未仅借鉴文件夹或流程名称；既有 UI/React/持久化/安全等研究仍按前表组合。

## 新增检查依赖与复用范围

本轮仅为确定性章节检查在 repo-checks 声明三个直接开发依赖：

| 依赖/固定版本 | 许可与实际审查 | 作用及限制 |
|---|---|---|
| `mdast-util-from-markdown@2.1.0` | 已读上游 README/registry 元数据及安装包 LICENSE（MIT），gitHead `afe9516d97683e51974694f944a799a915a242c0`；micromark/MDAST 解析及运行依赖可由 lockfile 复验 | 解析 CommonMark AST，跳过代码，正确处理定义/括号/标题；不支持完整网页、HTML 导航/anchor 或源码真实性 |
| `mdast-util-to-string@4.0.0` | 安装包 LICENSE（MIT，Titus Wormer）和 API 已核对 | 从标题节点取文本，非手写 Markdown 剥离器 |
| `github-slugger@2.0.0` | 已读主实现/README/registry/安装包 ISC license，gitHead `3461c4350868329c8530904d170358bca1d31448`；无运行依赖 | Unicode/重复标题 slug；社区对 GFM 标题 ID 的实现，不是 GitHub 官方 renderer 或链接保证 |

使用 package API，未把外部源码或许可证段落复制进项目；归属/许可由包分发保留，项目在此记录来源。
使用 `pnpm --filter @glimmer-cradle/repo-checks add -D ... --ignore-scripts`，仅工程依赖/锁变化；解析 960 包、加入 31、下载 0，17.3 秒，退出 0。
检查了清单/依赖行为，未执行外部安装 hook；无 Skill/插件安装。`--ignore-scripts` 不等于以后依赖自动无风险，后续升级仍审查实际行为/许可。
新增行为、失败分支与 CLI 退出码由 repo-checks tests 验证；具体通过数与原始日志归 evaluation。

## 执行成本与阶段收束复核

2026-10-16 按六项实际执行问题定向复读下列一手正文，不重做全项目能力设计。
未测得各项耗时/模型成本，不能把延期归因于 Skill 或声称提速比例；验证见[本轮记录](evaluation.md#执行成本与收束效率复核)。
网页使用当日可读版本，未取得不可变发布版本的页面保留检索日期；本轮只吸收方法，没有复制或运行外部代码、安装工具或修改模型。

| 一手依据 | 实际建议/机制 | 采用及限制 |
|---|---|---|
| [OpenAI Docs：Build skills](https://learn.chatgpt.com/docs/build-skills)、本机系统 skill-creator | 元数据发现、按需加载；只保留改变判断的指导，复杂流程才做有意义的前向验证 | 保持九入口和原描述，仅缩窄服务 Skill 的重复调查、文档 Skill 的逐补丁维护；不增加通用 Skill/模板 |
| [OpenAI：Rethinking skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)（2026-09-11） | 避免每次编辑前必读整套资料、过长描述及过度具体配方；明确完成边界 | 四种接续情形、按变化触发检查。模型能力经验不是取消安全/恢复门的理由；不迁移模型 |
| [OpenAI：Iterating Development Workflows](https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex) | 可观察接受条件、轻量方案；计划、重要上下文、进度/证据分别有权威来源；不抄日志或用文档完整代替阶段完成 | 复用 execution.json、任务书与既有 evidence 摘要；其多文件 harness 是示例，未照搬文件树或人审门 |
| [Google：Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) | 以一个自包含结果组织可理解的小变更，功能/重构不无关混合 | 验证/审查批次可含保存提交，但保持一个连贯结果；不是按 commit 数发审，也不攒整阶段大候选 |
| [Google：Code Review Standard](https://google.github.io/eng-practices/review/reviewer/standard.html) | 区分必要代码健康与非阻塞偏好，按工程事实处理意见 | 分流当前真实阻断和独立完善；安全、恢复及原完成门仍是必要项，不能借“非阻塞”延期 |
| [DORA：Small batches](https://dora.dev/capabilities/working-in-small-batches/)、[WIP limits](https://dora.dev/capabilities/wip-limits/) | 将工作拆成可独立测试/验证的较小批次，限制进行中的工作并完成它 | 当前 P02A 内先收束一个关联机制，用有限剩余项呈现退出距离；不设置机械时限/数量，不用测试数衡量阶段进展 |
| [Bazel：Remote caching](https://bazel.build/remote/caching) | 命令、输入、工具/环境共同决定结果能否复用；未声明工具或运行中输入变化会导致错误命中 | 仅借鉴证据失效判断，不引入 Bazel/缓存服务。PID、ready、外部权限等时点事实仍重新观察 |

上述是平台机制、厂商/工程团队建议与本项目适配，不是强制行业标准。
批次定义、四种恢复情形与 P02A 分组是本项目决定；稳定流程在既有 how-to 一处维护，本文不作为执行入口。

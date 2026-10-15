# 关键设计的依据与适配

本页记录来源依据→需求→采用→差异→验证，不作为日常执行指令。核对日期为 2026-10-15；
文件/来源实际阅读、固定 commit 与许可证见[研究](research.md)，实际结果见[验证](evaluation.md)。

## 依据的含义

1. **平台机制/要求**：发布方定义的宿主发现、加载和格式行为，只约束对应功能。
2. **官方推荐**：发布方的工程建议/案例，可按任务取舍，不自动是平台门。
3. **开放规范/社区方法**：Agent Skills、CommonMark 是公开格式/语法；Diátaxis 是作者方法，Docs as Code 是社区工作方式，后两者不是正式标准。
4. **成熟项目实践**：固定源码中的配置、贡献/发布机制和实际使用关系；不代表所有项目共识。
5. **项目适配**：由本项目任务、产品边界和维护需求推导的选择，可重新设计。
6. **待验证尝试**：本地结构、分界或执行策略仍需任务反馈；静态通过不能升级为可靠性结论。

“成熟项目”在此限于能核验持续维护的正式文档、源码、贡献与构建/审查机制，不以 star/宣传评分。
本次不是随机样本，没有证据表明目录/Skill 数量具有普遍最优值。

## 决定与证据链

| 决定 | 来源及类别 | 本项目需求 | 采用方式与适配差异 | 对应验证及限制 |
|---|---|---|---|---|
| 根共同约束与按需专业能力分开 | [OpenAI AGENTS](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[Skills](https://learn.chatgpt.com/docs/build-skills)〔1〕；[重新评估提示/Skills](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)〔2〕 | 局部修正不应先加载全仓地图/迁移工作流；安全/唯一源跨域有效 | AGENTS 保留共同边界；移除 generic Skill；九专项只按描述选择〔5/6〕。数量、平铺、Git 交付检查与 UI YAML 都是项目选择，平台支持的嵌套/symlink 不被否认 | 自有 checker、官方 quick validator、真实宿主发现、正反请求与任务观察分别验证；发现成功不证明隐式选择质量 |
| 知识按读者任务和真实 owner 双向进入 | [Diátaxis compass](https://diataxis.fr/compass/)〔3 作者方法〕、[GitLab topic types](https://docs.gitlab.com/development/documentation/topic_types/)、[Django index](https://github.com/django/django/blob/57ddccdcb0bc23eee6e9c304f69cf1ffd099151b/docs/index.txt)〔4〕 | 人/Codex 均需学习、操作、查询与理解；旧 guides 阶段与子系统分类使任务重复 | 受控成果放 tutorials，操作集中 how-to，精确语义保留 reference；架构、治理、状态与历史按权威/生命周期组织〔5/6〕，没有机械建立四目录 | 沿首次验证/事实查询/恢复等代表请求走到成果；布局选择不是方法认证 |
| 每个组件只维护一份详细说明 | [GitLab SSoT](https://docs.gitlab.com/development/documentation/styleguide/)〔4〕；[C4 diagrams](https://c4model.com/diagrams)、[arc42 building blocks](https://docs.arc42.org/section-5/)/[runtime](https://docs.arc42.org/section-6/)〔3 作者方法〕 | Current 与 Implementation 的六组件重复 owner、ready、数据/失败细节，产生不同步；跨组件视图仍有独立目的 | 合并组件概念与实现；Current 保留系统/运行/部署关系，细节引用唯一组件正文〔5〕。架构方法只帮助发现重复和缺少运行场景，不重设计产品/固定模板 | 独立只读对比旧正文与真实源码，主 owner 再核查；修 Ingress 范围、认证两条接线、默认音频与历史证据时态。未重新验证 Unity/设备 |
| 详细流程一处维护，允许短背景 | GitLab SSoT、[Django 写作](https://docs.djangoproject.com/en/6.1/internals/contributing/writing-documentation/)、[Kubernetes page types](https://github.com/kubernetes/website/blob/bbea9aa9b7c1cbf67dfc66c4f7b19338e4f24d5d/content/en/docs/contribute/style/page-content-types.md)〔4〕 | Skill 与指南不能分别维护全套验收/恢复/权限，读者也不能不停转介 | 共用安全/验收/恢复指南，Skill 留判断与条件路由；开发手册、AI 工具页并入真正任务正文〔5〕 | 引用/章节、内容重复审查、真实读者路径；不是“零重复”文字要求 |
| 补齐独立集成方法 | [mcp-builder 实际 Skill](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/mcp-builder/SKILL.md)、[MCP security](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices)〔2/4〕 | SDK consumer、Contribution/安装、principal/权限、断连/撤销和外部 ID 规范化不能仅由服务事务方法代替 | services 的集成 reference 重写成 integrations；Schema/分页/容量/可行动错误，dispatch 时复验、取消失败/unknown 保留原事务〔5〕。不安装 builder/harness，不用 annotation 充权限 | 现有 Host/SDK/MCP/安装测试、临时 broker 拒权；外部平台登录/消息、关联仓库写入与发布仍无本次证据 |
| 补齐交付、CI 与供应链方法 | [OpenAI gh-fix-ci](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/gh-fix-ci/SKILL.md)〔2/4〕；[SLSA 1.2 验证](https://slsa.dev/spec/v1.2/verifying-artifacts)〔3〕；[GitHub attestation](https://docs.github.com/en/actions/concepts/security/artifact-attestations)〔2〕 | 普通导航没提供 run/SHA/log 判断、独立信任预期、固定字节/安装失败恢复 | delivery 将真实 workflow/builder/verifier 与信任和恢复方法连接〔5〕；queued/缺日志不算 PASS。不复制脚本/安装 Skill，不照搬再次请示，不宣称 SLSA 等级 | 本地 supply-chain/package/installer fixture 与错误来源/builder 反例；远程 CI/attestation、跨 OS/真实安装另取证 |
| 文档检查增加本地章节失效分支 | [CommonMark](https://spec.commonmark.org/0.31.2/)〔3〕、[mdast parser](https://github.com/syntax-tree/mdast-util-from-markdown)、[github-slugger](https://github.com/Flet/github-slugger)〔4 库实现〕 | 旧门只看文件，章节重命名会静默断链；迁移时已出现过失效锚点 | 用 AST 解析链接/标题并按 GFM slug 约定检查，无第二套正则 Markdown parser〔5〕。不检查 HTML/远端/事实，slugger 非 GitHub 官方实现 | 新反例测试：改标题、Unicode/重复标题/Setext、代码块/metadata、编码/目录链接；CLI 退出码及根门；精确边界见文档维护 |
| 完成质量从成果/反例评估 | [OpenAI skill evals](https://developers.openai.com/blog/eval-skills)〔2〕、实际 variant-analysis eval/reader-test 候选〔4〕 | 格式、文件短、工具次数、自评和旧 PASS 不证明任务完成 | 保存固定输入/候选/权限与 trace/artifact；对照、独立审查、真实运行和复用证据分开〔5/6〕；不会预先把预期答案/疑似问题交给评估者 | 各轮实际结果在 evaluation，失败与人工修正保留；小样本/工具环境限制不能推导总体提升 |

## 保留与改变的边界

产品角色/数据/权限、v2.1 与 Contract Spine 是保留约束；本轮目录/触发/Skill 数量与流程均可重新评价。
源文件稳定身份只有少数具体消费者要求：受保护的架构 execution.json 引用了 Cognition 主文与 Conversation 实现页。
两页保留实际有用正文和身份，认知细节另拆；该消费者是迁移条件，不是全面保留旧目录的依据。
其余路径、精确清单、生成树与摘要均已纳入迁移，不以锁或链接成本否决重组。

## 更新或撤回

当来源行为、项目 owner、重复失败或读者任务变化时，重验这条依据链和受影响场景。
先修所属事实/工具，观察后再决定是否改变方法；不因一次失败追加全局门。
本轮是可审查本地 diff；回退须同时恢复消费者、清单、生成树与摘要，保留用户原 dirty 与历史结论。

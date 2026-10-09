# 按切片执行架构重构

> 适用场景：Codex 或开发者接手一个已经授权的架构重构任务。
> 前置条件：已读项目 Skill、对应 initiative、有效基线与当前任务；授权范围和写入 owner 清楚。
> 事实依据：AGENTS、项目 Skill、架构变更宪章、实际 Git 与脚本。
> 维护触发：执行门、状态模型、验证入口或恢复方法变化。

## 目录

- [接手与选择任务](#接手与选择任务)
- [准备完成门](#准备完成门)
- [实现顺序](#实现顺序)
- [验证与接受](#验证与接受)
- [失败和中断](#失败和中断)
- [状态推进](#状态推进)
- [文档与锁同步](#文档与锁同步)
- [交付和下一步](#交付和下一步)

## 接手与选择任务

架构 v2 的具体操作顺序以[主执行任务书](../../roadmap/initiatives/architecture-v2/execution-order.md)为准。
其每个章节已是任务卡；本指南补充字段、准备门和状态方法，不要求重写计划或重复做全局 discovery。

1. 在仓库根执行 `git status --short`、`git log -1 --oneline`，核对工作树改动和实际 owner。
   有别人的改动时保留；无法确认同一范围写入权时只调查。
2. 读取 [now](../../roadmap/now.md)，再读取对应 initiative 的 README、status 及 nextTask 卡。
   不将历史日志中的“下一步”、旧会话总结或测试数量当作当前状态。
3. 运行 `pnpm check:docs`、`pnpm check:architecture`，先识别文档/目标规格漂移。
   首次发现既有失败记录输入和原因；不得在产品任务中顺手改基线掩盖错误。
4. 将实际 HEAD 与 execution.json 的 `baselineCommit` 比较。若已推进，读相关 diff 和新证据，
   更新事实审计，再修订受影响任务；无需因日期变化重跑所有产品测试。
5. 一次选择一个 ready 任务。dependsOn 必须全部 accepted；in-progress 先恢复原任务。
   planned 任务必须先形成准备完成门。需要交叉阶段时声明 stageIds 和依赖接口，避免人为按编号阻塞合法接线。
   多个候选同时满足依赖时，按 tasks 数组顺序准备第一个；若其被环境阻断，记明原因后选择下一个独立任务。
   nextTask 由执行者据此显式更新，生成器不自行改变状态或选择任务。
6. 将状态改为 in-progress 并填写 owner；首次实施前先保存卡片中的路径与验证计划。
   推送、发布、生产操作和另开用户任务均沿用其各自授权，任务状态不构成授权。

## 准备完成门

discovery 任务可以先执行调查，输出一个真实实现卡。implementation 任务开始前必须同时满足：

| 输入 | 必须明确的内容 |
|---|---|
| 成果 | 用户行为或工程不变量、成功和失败都可观察 |
| 范围 | 当前源码、公开入口、真实 producer/consumer；精确目标文件 |
| 文件动作 | retain/create/move/split/delete；旧 → 新；owner；旧路径删除条件 |
| 状态 | 单写者、稳定 ID、顺序、幂等、取消、generation、权限与 ready/degraded |
| 数据 | 无数据影响的理由；或 schema/旧样本/备份恢复/切换/失败恢复 |
| 依赖 | 已接受任务、所需跨 owner 契约；未解决的设计问题 |
| 验收 | 可直接运行的现有命令、补充测试场景、实物输出和证据失效条件 |
| 边界 | 本地/外部环境授权、停止点、高风险审查安排 |

若接口或目标路径未知，当前任务继续做 discovery，不能创建占位模块满足清单。
模板见[切片契约](../../roadmap/initiatives/architecture-v2/slices/TEMPLATE.md)。
完整跨仓依赖无法一次确认时，拆成受控发现任务和随后可独立验收的实现任务。

## 实现顺序

1. 固定起始 HEAD/dirty 范围，确认相关已有反例与行为。
2. 从唯一 canonical Schema/领域 owner 修改契约；Service 修改当前唯一 IDL，生成再改 mapper/consumer。
3. 在目标 owner 实现真实行为，通过 App/消费方 Port 接线；新增能力至少存在真实消费者。
4. 逐一切换 import、exports、配置、加载器、运行入口、模板、测试、打包与安装映射。
5. 数据迁移先在隔离旧样本完成备份→迁移→重启→恢复演练；再安排唯一 writer 切换。
   准备期间可并存代码，不能同时运行两个事实 writer；未知副作用先对账，不能重发。
6. 用 consumer 搜索和实际调用测试证实旧 owner 为零，再物理删除。
   仍需兼容时明确唯一 adapter owner、委托方向、时间窗口和删除任务；禁止无退出条件兼容壳。
7. 同步本切片实际事实页、目标文件清单、生成视图和适用的摘要锁。
8. 运行定向测试；失败后根据新证据改假设。不要自动扩大到全部未来阶段。

## 验证与接受

从 initiative 的 acceptance.md 选择适用门；至少符合以下条件：

- 文档：docs、encoding、目标规格/锁、引用与规则推演；文档代码工具变化追加工具反例。
- 源码/依赖/构建：定向测试、根 typecheck/build、architecture/encoding，实际 producer/consumer 链路。
- IDL/Schema：generate/verify、三语言 roundtrip、breaking/generated clean 和现有 consumer。
- 数据/权限/生命周期：旧样本、重复/取消/重启/旧世代/拒权/关闭与高风险独立审查。
- 制品：固定 artifact、inventory、安装/升级/回滚与目标平台；源代码编译不能代替。

记录命令、cwd、exit code、输入 commit/tree 或 dirty 范围、环境、输出位置、未验项和失效条件。
先验证得到 verified，再依据必需审查得到 accepted；提交和推送另记，不等于 accepted。
没有独立审查授权/可用审查者时，高风险任务保留 verified/review-pending，
不得假称独立通过；继续可独立开展的已授权工作。独立审查要求来自项目 Skill/AGENTS。

## 失败和中断

| 情形 | 动作 | 恢复条件 |
|---|---|---|
| 测试失败 | 保存最小反例，区分实现/fixture/环境；两次同类无效尝试后换假设 | 原反例与受影响门重新通过 |
| 环境缺失 | 记录缺少什么及具体命令，执行其他独立本地门 | 环境证据补齐；不得写为 PASS |
| 执行副作用未知 | 查原 identity、journal、receipt；不得生成新 ID 重试 | 对账形成可证明状态 |
| 发现语义边界变化 | 按架构变更宪章形成具体候选和 ADR | 已有授权涵盖或取得必要决策 |
| 新输入/用户停止 | 停止新增工作，保护 dirty 和任务句柄，写最后成功步骤 | 用户恢复且实际状态核对 |
| 上下文恢复 | 核对 Git/进程、任务卡、最新证据与 nextAction | 不能仅凭旧 PASS 重复或跳过步骤 |

任一中断保存：任务 ID、owner、HEAD/dirty、最后完成动作、进行中句柄、失败原因、下一条具体动作。
恢复记录进入该切片，不能新建第二套全局状态文件。

## 状态推进

`planned → ready → in-progress → verified → accepted`；依赖/环境问题可进入 `blocked`。
blocked 必须记录原因、解除条件和 nextAction；解除后重新满足 ready 门。
需要再次调查可回到 planned，并解释哪些证据失效；已接受任务回归以新修复任务关联旧证据。

execution.json 是状态唯一源；status.md 只生成。
每次改变任务状态后运行 `pnpm check:docs --write`，再运行 `pnpm check:docs`。
nextTask 只能指向依赖已接受的 ready/in-progress 任务；blocked 任务不能成为自动实施入口。
一个共享工作树同时最多一个 in-progress 写入任务。审查任务不获得写权限。

任务 JSON 字段契约：id/title/stageIds/dependsOn/status/mode/card/scope/acceptance/evidence/nextAction 必填；
owner 在开始时填写，blockedReason 在阻断时写出原因与解除条件。
ready discovery 还需 inputPaths（相对仓库根的真实调查文件）；ready implementation 需 commands（准确命令字符串）
和 mapping 数组，每行包含 action、source、target、owner、exitCondition。
create 可无 source，delete 可无 target；其余动作两端都明确，split 以多行表示。
card/evidence 使用相对 initiative 的路径，可附章节锚点；不允许跳出 initiative。
stage 的 legacyEvidence 只定位原始记录，stage accepted 另需本轮完整门的 evidence。

阶段 accepted 必须同时关闭该阶段所有任务、差距和验收门；不能按“最近测试通过”推断。
新的工作项必须有稳定 ID、stageIds、dependsOn、card、owner scope、acceptance 和证据；
合理拆分沿用当前目标，无需每次重新请求已有范围内授权。

## 文档与锁同步

1. 更新唯一事实页和链接；目标路径变化先更新 files.json。
2. `pnpm check:docs --write` 生成状态视图和 docs 精确树。
3. `pnpm check:target-layout --write` 生成产品目标树。
4. 按[宪章](../../governance/architecture-change-policy.md)复核规范变更理由，更新锁与预期值；
   规范摘要变更不能靠复制任意新哈希冒充授权。
5. `pnpm check:docs`、`pnpm check:encoding`、`pnpm check:architecture`；
   工具改动运行 repo-checks 测试与根 typecheck/build。
6. final 模式只在整体收尾必须 PASS；迁移期间保存精确差距，差距数量不代表可直接删除文件。

## 交付和下一步

更新卡片与证据，说明旧 owner 删除/保留条件、实际成果、未验项、Git 状态与风险。
将 accepted 的稳定事实写回 Current/Implementation/Reference。
按实际依赖把后继任务准备为 ready，并给出 nextAction；在持续实施授权范围内继续，
若当前请求只覆盖规划/文档，则交付可执行入口而不启动产品代码任务。

# 架构 v2 重构主执行任务书

> 范围：从现有实现连续推进到 v2.1 最终成品的固定操作顺序。本页拥有具体任务指令，不保存完成状态。
> 事实依据：v2.1 基线、完整文件清单、dc59181e 产品实现及 89e476be 文档整合；制定日期 2026-10-09。
> 维护触发：已核实的实施障碍、文件映射或验收入口变化；领域边界变化遵循架构变更宪章。

## 唯一执行入口

后续可以直接向 Codex 下达：

> 继续执行 docs/roadmap/initiatives/architecture-v2/execution-order.md，从 execution.json 的 nextTask 和 nextAction 恢复。按固定顺序完成已授权的重构工作，逐项保存证据和状态；不重新设计架构，不跳过失败门，不因完成一个内部步骤就请求继续。遇到本文规定的例外，按例外表处理。

开始时读取项目 Skill、本页的公共规则、[execution.json](execution.json)以及当前任务一节；
其余领域资料只按当前步骤需要读取。已经读取且未变的基线无需每个步骤重读。
本页采用[目标基线](../../../architecture/target/baseline.md)的既定设计；
[files.json](../../../architecture/target/files.json)拥有全部目标文件，
[验收矩阵](acceptance.md)拥有 Gate 和场景定义，[通用指南](../../../guides/development/architecture-refactoring.md)拥有状态字段与通用操作方法。
本页不授予推送、发布、生产操作、另开会话或多智能体权限。

## 固定顺序

编号是默认执行次序；任务 ID 是稳定身份。正常情况下不交换次序、不新增一轮架构评估。
依赖表允许已记录阻断时继续独立工作，不能因此跳过原任务的完成门。

| 次序 | 任务 | 本步交付 |
|---|---|---|
| 01 | [A00](#step-a00) | 核对接手点并固定 P07A 文件映射 |
| 02 | [P07A](#step-p07a) | Planning 后继调度、撤销和恢复 |
| 03 | [P07B](#step-p07b) | Jobs 源业务接纳、catalog 和状态投影 |
| 04 | [P02A](#step-p02a) | 剩余 Platform 机制和关闭语义 |
| 05 | [P03A](#step-p03a) | Content 完整物理落位和媒体恢复 |
| 06 | [P04A](#step-p04a) | Conversation 交互、中断和实际回执 |
| 07 | [P05A](#step-p05a) | Cognition 纯领域和认知数据闭环 |
| 08 | [P06A](#step-p06a) | Capability 授权、预算和未知结果对账 |
| 09 | [P09A](#step-p09a) | 公开 SDK、Extension Host 和 broker |
| 10 | [P08A](#step-p08a) | Embodiment 语义与旧行为等价 |
| 11 | [P09B](#step-p09b) | 多语言 SDK 和完整扩展模板 |
| 12 | [P10A](#step-p10a) | 模型、语音、MCP 和聊天渠道扩展 |
| 13 | [P10B](#step-p10b) | Renderer、Unity 与 native 真实链 |
| 14 | [P11A](#step-p11a) | Contract Spine 原子路径切换 |
| 15 | [P12A](#step-p12a) | 可信 ingress 与共享 Host 产品接线 |
| 16 | [P12B](#step-p12b) | Desktop、控制面、监督与安装入口 |
| 17 | [P13A](#step-p13a) | 全域 authority、离线和冲突恢复 |
| 18 | [P14A](#step-p14a) | 旧队列与全域数据迁移、备份恢复 |
| 19 | [P14B](#step-p14b) | 开发版本一致性与固定制品矩阵 |
| 20 | [P01A](#step-p01a) | 删除全部迁移例外，启用最终护栏 |
| 21 | [P15A](#step-p15a) | 完整行为、物理目录和成品验收 |
| 22 | [P15B](#step-p15b) | 固定候选独立审查与交付归档 |

## 已决定的实施边界

| 问题 | 直接执行的决定 |
|---|---|
| 领域与进程 | 保持七个 Core owner、共享 Host、Cognition Worker、Extension Host、Desktop；不另设业务总包或第二 Server Host |
| 目标文件 | 从 files.json 按本步目标前缀展开完整集合，包含 src、tests、Schema、package/pyproject、配置、锁文件和构建入口；不能只搬 src |
| 现有实现 | 目标路径已有正确实现则 retain 并验证；不为制造重构工作重新实现 |
| 契约源 | P11A 前只改当前 contracts；P11A 原子迁到 protocol 与 owner-local Document Schema；禁止双源 |
| SDK 路径 | P09A 切换 TS SDK 与 Extension Host；P09B 补齐 Python/.NET/Unity 与模板；内部 wire 由 mapper 隔离 |
| 外部环境 | 模型厂商、聊天平台、具体 Renderer 的专有协议在可替换 Extension；普通数据库/框架/OS 库仍在所属 adapter |
| 持久状态 | 保留稳定 identity、单写者、fencing、generation、幂等；未知副作用先对账，不能生成新 ID 重发 |
| 旧 owner | 每步切完 consumer 后删除相应旧实现；因产品接线/数据窗口未到而保留时，明确绑定 P12 或 P14 删除点 |
| 角色和具身 | persona/声音/资产来自 profile 与配置；Core 使用稳定具身语义，Renderer 自行映射模型参数 |
| 版本与发布 | 自有开发发行面保持 0.1.0，历史发布记录保真；P14B 不代表取得正式发布许可 |
| 推进方式 | 一名写入 owner 持续完成当前任务；高风险接受仍需独立审查，状态表不能代替授权或证据 |

## 每一步统一执行的动作

以下动作直接套用，不再另外起草一套通用计划。

1. **恢复**：运行 `git status --short`、`git log -1 --oneline`。先恢复 in-progress；否则取 nextTask。
   核对与最近证据有关的 diff，保留用户改动。所有命令默认在仓库根运行。
2. **展开本步文件**：定向读取本节列出的当前入口和调用者；从 files.json 展开目标前缀。
   在当前任务的 `mapping` 填准确文件动作、source/target、owner、exitCondition，在 `commands` 填本步实际命令。
   这是已有目标的文件核对，不是新一轮架构设计。已有 API 不需要重新命名；新文件遵循命名规范。
3. **准备门**：将现有/缺失/需迁移文件、真实 consumer、writer 和数据影响核对到文件级。
   后续任务不提前假设 API 签名；本步所有依赖 accepted 且映射/命令完整后置 ready，再置 in-progress 并填 owner。
   mapping 仅描述本步触及的文件；不能把未来几步的缺项混入当前实现。
4. **按本节序号实施**：每个编号完成一个连贯结果。涉及跨进程字段时依次改唯一 Schema、生成物、mapper、两端 consumer。
   每步同时维护公开入口、测试、实际装配和受影响事实文档；禁止空文件、空 exports 或无人调用的新模块。
5. **验证**：先执行本节定向命令与反例；源码交付还必须依次运行 `pnpm typecheck`、`pnpm build`，
   再运行 `pnpm check:architecture`、`pnpm check:docs`、`pnpm check:encoding`、`git diff --check`。
   Schema 改动追加 `pnpm contracts:generate`、`pnpm contracts:verify`；工具改动追加 repo-checks 测试。
   同一候选可复用未失效证据，不重复跑无关全量测试；不得并行运行根 typecheck/build 清理同一 dist。
6. **保存**：在已有 evidence 记录或本步证据文件写输入、命令、结果、未验项、删除证明及审查结论，链接到任务的 evidence。
   `nextAction` 写成“P07A.3：……；上一完成动作……；候选/dirty……”，中断时补进程句柄与阻断解除条件。
   不以第二份全局 TODO 或聊天总结维护进度。新增证据路径按普通清单维护登记，不改产品语义。
7. **接受并前进**：测试通过先 verified；必要独立审查通过才 accepted。按本页顺序准备下一个依赖满足的任务，更新 nextTask。
   运行 `pnpm check:docs --write` 和 `pnpm check:docs`；持续实施授权有效时直接继续下一步。
   仅有文档编写授权时，停在可执行任务书交付，不开始产品代码迁移。

状态、mapping、commands 与 evidence 字段契约见[状态推进](../../../guides/development/architecture-refactoring.md#状态推进)。
本页各节即任务卡；`slices/` 只在需要记录特别复杂的局部映射时补充，不要求每项任务重写一遍计划。
阶段计划解释成果归属，不能覆盖本页次序；验收矩阵中的全部适用门继续有效。

## step-a00

**01 / A00：接手与差距核对。** 本步只修改任务事实，不改产品。

输入使用 [A00 输入索引](slices/A00-reconcile.md)中的准确路径；目标为本 initiative 的 execution、migration-map、risks 与 evidence。

1. 比较 dc59181e 与当前 HEAD；区分产品改动和文档整合，不能因为 HEAD 更新就重做已完成原身份恢复。
2. 阅读 PlanningController、SQLite Planning Store、Host conversation-routes、Worker rpc_service 和各自已有测试。
3. 查承诺接纳、评估、通知真实回执/ACK、后继请求及取消的生产者和 consumer；核对当前唯一 writer 与持久 identity。
4. 将已有通过部分保留；把后继调度、撤销与崩溃窗口映射到 P07A 的精确文件，登记 commands。
   若某项已经实现，登记可复用证据和剩余反例，不重写。
5. 修正与此次定向核对直接相关的 migration-map/risks；不扩展为全仓第二次蓝图评审。
6. 运行 docs、encoding、architecture；记录 A00 接受证据，满足准备门后将 P07A 置 ready。

完成门：P07A 有真实文件映射、准确验证命令和稳定身份/取消/恢复反例；没有新的领域决策待定。
下一步：P07A。

## step-p07a

**02 / P07A：Planning 后继调度与撤销。** 当前与目标集中在 `core/cognition/` 的 planning 与 persistence、`core/jobs/`、`apps/host/` 和 `apps/cognition-worker/` 的既有接线。

1. 固定现有 commitment/revision、job/attempt、evaluation、notification receipt 关联；保留已送达历史通知的只读原身份恢复。
2. 在 Planning owner 持久提交评估结果和后继意图；跨 Store 用 outbox 加幂等接纳，不能假设跨库事务或先 ACK 后持久化。
3. 由 Jobs 接纳后继请求并持久确认；重试沿用原 request identity。未完成承诺可继续调度，完成或撤销状态不能复活。
4. 将取消/revision 更新传播到待调度、执行中、待通知状态；旧 revision、旧 lease 和晚到结果拒绝修改新状态。
5. 在现有 Planning/Host/Worker 测试补：评估后崩溃、schedule ACK 丢失、通知已送达但 ACK 丢失、撤销与晚到结果竞争、重启。
   观察模型调用、attempt、实际发送和后继 job 数量，不能只断言 helper 返回值。
6. 同步实际装配与实现地图；保留旧队列切换给 P14A，不提前让两个调度器消费同一事实。

命令：`pnpm test:cognition`、`pnpm test:jobs`、`pnpm test:host`、`pnpm test:cognition-worker`。
完成门：B04 本步后继/取消子链、G1–G6；每个崩溃窗口恢复不重复副作用，原身份保持不变。
下一步：P07B。

## step-p07b

**03 / P07B：Jobs 产品接纳、catalog 与状态投影。** 当前入口为 Host composition/cognition-job-adapter、gateway/conversation-routes 与 Jobs；目标为 `core/jobs/`、`apps/host/src/composition/`、`apps/host/src/gateway/` 和对应测试。

1. 把 Planning、Memory 等现有任务源逐一接入明确的 JobHandler/源业务接纳链；源负责业务含义，Jobs 只负责调度执行机制。
2. 建立 handler/catalog 的真实注册与 readiness；未知类型、未就绪或权限不足明确拒绝，不返回虚假成功。
3. 将 attempt、取消、失败/unknown、下次调度和通知状态映射为受控投影；UI consumer 只通过公开 Host 契约读取。
4. 补 outbox/inbox 幂等接纳、重试/backoff、retention、dead-letter 与分页公平性，确保删除不会破坏恢复引用。
5. 测试源拒绝、重复接纳、注册丢失、取消、关闭排空、恢复后投影重建。当前产品默认 ingress 的切换在 P12A。

命令：`pnpm test:jobs`、`pnpm test:host`、`pnpm test:cognition`。
完成门：B04/D04 对应子链；目标 Host 可真实接纳并投影，旧队列保留项明确绑定 P14A。
下一步：P02A。

## step-p02a

**04 / P02A：Platform 剩余机制。** 从 `core/kernel/` 的 runtime/adapters 和当前 `core/platform/` 核对；目标为 `core/platform/` 与 Apps 的 platform adapter/supervision。

1. 逐项划分剩余时钟、identity、租约、日志/trace、配置读取、健康与生命周期机制；业务策略留在对应领域/App，不整包搬 Kernel。
2. 迁实际 consumer 到 Platform 公开 API；配置路径/系统 IO 在 adapter，角色与认知判断不得进入 primitive。
3. 固定启动、ready/degraded、停止、排空与失败传播；关闭后拒绝新工作，observer 失败不得妨碍关键资源释放。
4. 补可控时钟、旧 lease、部分启动失败、重复 stop、关闭期间异步回调、超时与 secret 脱敏反例。
5. 删除已 consumer-zero 的旧机制；仅因未迁产品仍需要的装配保留到 P12B，并登记具体路径及删除门。

命令：`pnpm test:platform`、`pnpm test:host`；触及旧消费者时运行 Kernel 定向测试。
完成门：D04、G1–G6；依赖不反向，真实资源在关闭后释放。
下一步：P03A。

## step-p03a

**05 / P03A：Content 最终路径与媒体恢复。** 输入为 `core/content/`、Kernel content adapter/ingress 和旧媒体引用；目标为完整 `core/content/`、Host content mapper/routes。

1. 按清单迁资产提交、引用解析、存储 Port/Adapter、配额与 GC；一个 canonical writer，App ingress 先提交资产再提交交互事实。
2. 构造旧 URI、重复内容、缺失媒体、短期音频 lease 和永久 AssetRef 的隔离样本；保留不可恢复媒体的可解释状态。
3. 处理提交失败、引用闭包与并发 GC；不能将尚未持久化或已过期媒体写成可用资产。
4. 将现行资产真实 consumer 测试随 owner 迁到目标 tests，并同步 package/test 入口与验收矩阵命令；删除旧实现前验证实际入口。
5. 记录备份所需资产/元数据闭包供 P14A 使用，不直接迁移用户原始数据。

命令起点：`pnpm --filter @glimmer-cradle/content typecheck`；
`pnpm --filter @glimmer-cradle/kernel exec vitest run --threads false src/adapters/content/file-asset-store.test.ts src/adapters/content/staged-asset-uploads.test.ts src/adapters/surface/control-surface-audio-content.test.ts`。
迁完后改用本步建立并实际运行的 Content 测试入口；不能保留指向已删文件的命令。
完成门：D01 和 B01 资产子链，旧引用恢复/失败、提交/GC 反例通过。
下一步：P04A。

## step-p04a

**06 / P04A：Conversation、打断和实际回执。** 目标为完整 `core/conversation/`、Host conversation mapper/routes、Worker conversation mapper。

1. 核对 Log/Turn 的 Python 持久 owner 与 Host interaction/delivery owner；History 从事实重建，不另建权威 writer。
2. 将输入 identity、interaction/generation、序号及取消贯通文本、媒体、流水线语音和 Realtime 接口。
3. 实际播放/发送回执再确认 Delivery；收到音频、排入队列或模型生成完成不能冒充用户已听见。
4. 打断后停止旧 generation 输出；晚帧、乱序、重复回执幂等处理。Realtime 交互事实必须持久旁路，提交失败终止或如实降级。
5. 测试缺半边历史、重连、旧世代、重放和 writer 关闭；迁移真实消费者并删除已被替代的交互 owner。

命令：`pnpm test:conversation`、`pnpm test:host`、`pnpm test:cognition-worker`；触及音频链追加 `pnpm test:audio`。
完成门：B01/B02 对应核心子链与 D03；实际音频设备/外部 Provider 整链在 P10/P15 验收，不用替身宣称完成。
下一步：P05A。

## step-p05a

**07 / P05A：Cognition 解耦与认知数据闭环。** 目标为完整 `core/cognition/` 与 `apps/cognition-worker/`，当前残留 IO/provider/helper 由 Worker adapter 承接。

1. 遍历领域 import 和公开出口；时钟、Content、Model、Resource、Capabilities、Jobs 经消费方 Port 进入，网络/进程/平台 IO 留在 App adapter。
2. 保留统一 Loop 的原生 ToolCall/ToolResult 迭代；移除旧 skill_request 预分类分叉，接通每 Step 的 context/exposure/预算。
3. 分开 Turn、Run/Checkpoint、Job；普通交互恢复不靠新建 Job，恢复 checkpoint 不重新执行未知副作用。
4. Persona 修改必须经过授权和版本；Memory 记录来源及纠正；Knowledge 保存 revision/hash/ACL/转换与 embedding 版本，更新/删除使派生物失效。
5. Context 区分指令权限、来源可信度、相关度；预算截断不能把外部内容升级为系统指令。人格和声音仍来自 profile。
6. 补 IO 边界、普通 Turn 重启、来源撤销、越权 Persona、Knowledge 失效及 Planning 后继回归；删除旧 helper owner。

命令：`pnpm test:cognition`、`pnpm test:cognition-worker`、`pnpm test:host`。
完成门：B03/B04/B07 对应领域子链，D02/D03；领域可经 Port 驱动而无平台 IO。
下一步：P06A。

## step-p06a

**08 / P06A：Capabilities 权限、预算与 unknown。** 目标为完整 `core/capabilities/`、Host capability mapper/broker 与 Worker capability client。

1. 保持 ToolRegistry、SkillCatalog、ResourceRegistry 各自语义；迁剩余旧 Skill Plane 注册和实际默认调用者。
2. 每个 Step 按身份、作用域、能力 ready、位置、预算与协议生成曝光；dispatch 前再次鉴权，撤权后的旧曝光不可继续执行。
3. 持久记录 prepared/authorized/dispatched/succeeded/failed/unknown；Run 预算跨重启有效，工具耗用不能因 retry 清零。
4. 结果和 outbox 同事务落盘；真实 receipt 幂等接入 Conversation，再进入下一 Step。
5. 测试调用前后撤权、超时、崩溃、ACK 丢失、未知结果对账和重复请求；unknown 不能自动改 failed 后重发。
6. 更新旧调用者至公开面，删除 consumer-zero 的旧 owner；依赖产品切换的残留明确交给 P12A。

命令：`pnpm test:capabilities`、`pnpm test:cognition-worker`、`pnpm test:host`、`pnpm test:cognition`。
完成门：B03/D04，权限/执行恢复高风险审查通过。
下一步：P09A。

## step-p09a

**09 / P09A：SDK、Extension Host 与 broker。** 当前 `packages/extension-sdk/`、`hosts/extension-host/`；目标 `extension-sdk/`、`apps/extension-host/`、`apps/host/src/broker/` 与 `apps/host/src/extensions/`。

1. 迁 TS SDK 公开入口、manifest、contribution、兼容、打包校验及完整 package/build/test 配置；逐 consumer 切路径，保持公开 DTO 与 Core/wire 类型经 mapper 隔离。
2. 迁 Extension Host loader、registry、pending calls、managed process、shutdown 和真实启动入口；迁移后删除旧包路径与旧 Host owner。
3. 实现 network/file/device/secret/process broker 的身份与权限检查；路径越界、撤权、超时及不允许的操作明确拒绝。
4. 实现安装验证、原子替换/回滚、启动/ready、卸载/崩溃回收；子进程本身不等于安全沙箱，公开实际隔离能力。
5. 将 Extension 注册映射到各 Core 公共 Port；禁止扩展 import Kernel/Core 内部对象，secret 不放进普通投影/日志。
6. 验证撤权时 pending call、孤儿进程、重复 unload、安装失败与未知副作用保留；同步下游包和模板依赖入口。

命令：`pnpm --filter @glimmer-cradle/extension-sdk test`、`pnpm --filter @glimmer-cradle/extension-host test`、`pnpm test:host`、`pnpm verify:extension-sdk-release`。
完成门：B05 本步 TS/Host 生命周期与安全链，G1–G6；多语言和独立模板在 P09B。
下一步：P08A。

## step-p08a

**10 / P08A：Embodiment 稳定语义。** 当前 `core/avatar/` 及 C#/Unity 行为；目标完整 `core/embodiment/`、Host embodiment mapper 与 SDK renderer contribution。

1. 从旧 C# 行为提取真实输入/输出 fixture，保存动作优先级、中断、期限、视线、口型及姿态等可观察行为。
2. 在 TS owner 实现 intent/state/controller 与 renderer port；具体骨骼、blendshape、厂商参数和资产加载留给 Renderer。
3. 使用实际 playout clock 驱动口型，generation/序号/expiry 拒绝过期意图；缺能力或 Renderer 明确降级。
4. 将能力声明与执行反馈映射为受控投影；ready 必须有真实渲染准备条件，不能把进程存在当可呈现。
5. 补旧行为等价、playout 同步、乱序/过期意图及公开 API 测试；旧运行链暂由迁移 adapter 接入，删除点绑定 P10B。

命令：`pnpm --filter @glimmer-cradle/embodiment test`（随目标 package 建立并验证）；`pnpm test:host`、`pnpm avatar:projector:test`。
完成门：B08 语义子链与等价 fixture 通过；不声称替身已经验证 Unity/native 实际呈现。
下一步：P09B。

## step-p09b

**11 / P09B：多语言 SDK 与独立模板。** 目标为 `extension-sdk/python/`、`dotnet/`、`unity/`、`templates/` 全部清单文件及 SDK 发布验证入口。

1. 对齐 TS/Python/.NET/Unity 的公开 Content、Model、Speech、Renderer、生命周期与 HostClient 契约；只承诺各语言实际支持的能力。
2. 补包元数据、锁文件、typed 标记、构建/测试、Unity asmdef/meta 与包投影；不能以主仓 import 路径代替公开依赖。
3. 完成 model、speech、channel、mcp-bridge、renderer 模板；复制到仓库外隔离临时目录，使用固定本地打包制品安装。
4. 各模板独立安装、构建、启动、握手、取消、卸载；Python worker 与 C#/Unity 构建分别验，测试不得依赖 workspace 隐式依赖。
5. 将跨语言和模板检查收进 `verify:extension-sdk-release`，记录环境不足的精确子门；删除旧 SDK export/模板路径。

命令：`pnpm verify:extension-sdk-release`；Python 在 `extension-sdk/python` 运行 `uv run pytest -q`；
`.NET` 执行 `dotnet test extension-sdk/dotnet/tests/GlimmerCradle.ExtensionSdk.Tests/GlimmerCradle.ExtensionSdk.Tests.csproj`；Unity 使用真实 Editor 对目标 Tests 执行验收。
完成门：B05 多语言独立消费和全部模板实物通过；任何语言未验不能标为整体 accepted。
下一步：P10A。

## step-p10a

**12 / P10A：外部能力扩展。** 输入为当前模型/语音 provider、`engines/audio/`、MCP 和渠道接入；主仓目标为 SDK 模板、Host 接线及配置 catalog，厂商实现位于独立扩展项目。

1. 按 model、speech、resource/tool/prompt、channel 列出实际适配及制品来源；沿用已登记外部项目，不凭空创建或修改无授权仓库。
2. 将厂商 payload/认证/重连/依赖移入相应 Extension；Core 只消费归一 Port。保留 Content/Conversation identity 与渠道作用域映射。
3. ASR、TTS 和 Realtime 分别接线；Realtime 的工具请求仍走授权/执行 journal，交互仍走持久事实旁路。
4. MCP tool/resource/prompt 映射到各自能力，不把 MCP 类型导入 Core；Resource revision/ACL/删除事件进入 Knowledge 失效链。
5. QQ 等聊天渠道经公开 Channel contribution 收发，支持消息去重、断连恢复、撤权和实际发送回执；用测试账号或既有授权环境验证。
6. 主仓仅通过受校验制品和配置选择能力；补许可/来源/校验及能力缺失降级，删除已迁厂商实现和旧启动入口。

命令：SDK 发布验证、Extension Host 测试、`pnpm test:host`、`pnpm test:audio`（迁移时同步实际测试归属），各外部项目按其真实构建/测试入口执行。
完成门：B02/B03/B05/B07 对应真实集成；账号/制品/外部仓库受阻按 R07 等风险登记，替身通过不能代替环境证据。
下一步：P10B；若 P10A 外部受阻且 P10B 依赖已满足，可按例外规则推进 P10B。

## step-p10b

**13 / P10B：Renderer、Unity 与 native。** 当前 `core/avatar/`、`hosts/unity-avatar-host/` 和 native 合成链；目标为 Renderer 外部制品、`extension-sdk/templates/renderer/`、`apps/desktop/native/`。

1. 将具体模型驱动、Unity 场景和资产参数移入 Renderer Extension；SDK/模板保留通用可运行示例及完整构建资源。
2. 把透明窗口/合成/设备表面等 OS 原语归 Desktop native adapter，业务具身语义归 Embodiment。
3. 接通 Renderer ready、能力协商、实际执行反馈、崩溃/重连与卸载；不在 Host/Core 特判某 Renderer 名称。
4. 在真实 Windows/Unity 环境验证透明合成、输入命中、视线、口型、打断、切换/缺失 Renderer 与关闭资源释放。
5. 用 P08A fixture 比对新旧行为；消费者切完后删除旧 C# 领域 owner、旧 Host 和旧 native 入口，保留外部制品追溯证据。

命令：`pnpm avatar:doctor`、`pnpm avatar:projector:test`、`pnpm avatar:composition:build`、`pnpm avatar:build`；迁移这些入口内部路径并保留可运行验收。
完成门：B02/B08 真机链与 B05 生命周期；Unity/设备未验则保持未完成。
下一步：P11A。

## step-p11a

**14 / P11A：Contract Spine 原子切换。** 当前唯一 `contracts/`；目标完整 `protocol/` 与 files.json 指定 owner-local schemas。

1. 枚举 IDL、Document Schema、生成器、TS/Python/.NET 生成消费、App mapper、SDK wire mapper、CI 与制品路径；保存迁移前 wire/旧样本。
2. 在同一候选迁 Service IDL 到 protocol/proto，Document Schema 到实际 owner；protocol/document-catalog 只登记标识/版本/路径。
3. 同时迁生成脚本、包入口、依赖/锁、测试、兼容基线引用、打包和安装映射；内部 DTO 不泄露到领域或 SDK 公开面。
4. 生成全部语言，验证 roundtrip、旧消息兼容、非法消息拒绝、breaking 与重复生成无差异。
5. 所有 consumer 切换通过后删除 contracts；不存在可运行的双契约源，不用转发包永久保留旧 owner。

命令：`pnpm contracts:generate`、`pnpm contracts:verify`、`pnpm verify:extension-sdk-release`，以及受影响 Host/Worker/Extension Host 测试。
完成门：G1/G4/G5/G6，三语言真实 consumer 与制品入口通过；失败修复同一候选，不切换在线用户数据。
下一步：P12A。

## step-p12a

**15 / P12A：可信产品入口与唯一 Host。** 输入为 Kernel 和 personal-server 业务装配；目标完整 `apps/host/` 与 `apps/cognition-worker/` 的 gateway/composition/adapters。

1. 迁认证、身份/作用域绑定、输入校验、Content 接收、Conversation 路由与审批；外部请求不能指定任意内部身份/authority。
2. 通过共享 Host composition 接通七个 Core owner、Worker、Extension Host；桌面和服务端部署共用业务 Host。
3. 将 P07B 源业务接纳与投影接到真实产品入口，接通工具权限审批、通知、长期承诺、Knowledge 和具身投影。
4. 在隔离运行配置切换产品默认入口，验证文本/媒体/工具/Jobs/Extension 真实调用链；旧持久队列只读或停用，不与新 Jobs 双消费。
5. 删除已 consumer-zero 的 Kernel/Server 业务装配；数据读取/迁移工具保留到 P14A，不把旧 owner 永久包进兼容 Host。

命令：`pnpm test:host`、`pnpm test:cognition-worker`、`pnpm test:conversation`、`pnpm test:jobs`，迁移前后 Kernel/Server 对应行为回归。
完成门：B01–B05 产品 ingress 链、认证反例及高风险接受；安装/UI 入口由 P12B 接续。
下一步：P12B。

## step-p12b

**16 / P12B：Desktop、控制面与进程监督。** 当前 `products/desktop/`、`products/personal-server/`；目标完整 `apps/desktop/`、Host ui/deployment/scripts 与 supervision。

1. 迁 Desktop main/preload/renderer、受控 IPC、窗口/托盘与 native 接线；Renderer 只读受控投影，不持有 Core 对象或凭据。
2. 迁控制面页面与 Host client，接通消息、角色、扩展、任务、知识、设置和诊断等清单指定界面及权限反馈。
3. 迁启动命令、supervisor、ready/degraded、重启/backoff、日志与停机；重复启动/崩溃不产生双 writer 或孤儿 Worker。
4. 迁 Docker/服务/安装脚本、Desktop 打包与资源映射；配置和数据路径由统一 App adapter 解析。
5. 用真实 UI 验证断连/重连投影、撤权、待审批、失败恢复与无障碍；验证安装产物启动/停止，再删旧 products/装配路径。

命令：`pnpm --filter @glimmer-cradle/desktop test`、`pnpm test:ui`、`pnpm test:host`、`pnpm test:release:linux`；隔离 Linux 安装环境运行 `pnpm verify:personal-server-full-install:linux`。
完成门：B01–B05/B08 产品入口、窗口/进程生命周期与安装链；环境缺失如实记录。
下一步：P13A。

## step-p13a

**17 / P13A：全域 authority 与离线恢复。** 目标为 Platform 租约机制、各状态 owner 及 Host authority-store/topology adapter；不另建万能同步 owner。

1. 为 Conversation、Memory、Persona、Jobs、Config 等全部持久 aggregate 登记 authority、identity、revision、epoch/fencing 与持久位置。
2. 每个写入口校验权威令牌，handover 先确保旧 writer 停止/失权，再接受新 epoch；不能只保护 Jobs。
3. 离线操作持久为 proposal，重连经权威方校验/接纳；冲突保留因果分支，不凭墙钟覆盖已提交事实。
4. 接通 Local/Cloud/Hybrid 配置、身份绑定、租约失效和可解释降级；回连恢复投影但不重复实际发送/执行。
5. 测试网络分区、双端抢占、时钟偏差、旧 token 晚到、取消期间切权、重连冲突及双方进程重启。

命令：`pnpm test:platform`、`pnpm test:host`、`pnpm test:jobs`、`pnpm test:conversation`、`pnpm test:cognition`，再执行隔离双节点真实 handover 场景。
完成门：B06、D03 和全域 fencing 证据；单机模拟不能替代跨机链。
下一步：P14A。

## step-p14a

**18 / P14A：旧队列和全域数据迁移。** 目标为 Host backup/migration coordinator、各 owner migrations 与对应旧样本/恢复测试。

1. 用隔离旧数据副本固定 Conversation/Execution/Jobs、Persona/Memory/Knowledge、资产、配置和 schema 版本的备份清单与校验和；秘密单独保护。
2. 获取一致性切点，编写可重入迁移；保留历史 ID、顺序、引用闭包、attempt、unknown 和原通知 receipt，不能通过清库“迁移”。
3. 停止旧队列消费，迁未完成任务和对账状态，再启唯一 Jobs writer；已发生但结果未知的副作用只对账，不重发。
4. 依次演练备份→迁移→重启→重跑迁移→恢复旧备份→再次迁移；检查 epoch、outbox、引用闭包和唯一 writer 后重建投影。
5. 覆盖缺失资产、半写入、schema 不兼容、校验失败、磁盘不足和中断；失败保留可恢复原件并给出准确恢复入口。
6. 数据证据满足后删除此前登记的旧队列/读写 owner/迁移兼容壳；需长期保留的升级迁移器作为目标正式文件登记。

命令：`pnpm test:host`、`pnpm test:jobs`、`pnpm test:conversation`、`pnpm test:cognition`，以及隔离安装的备份/恢复测试。
完成门：G3/G4、B04/B06、D01–D03；生产数据操作另依授权，本步隔离演练不冒充生产验收。
下一步：P14B。

## step-p14b

**19 / P14B：版本和固定制品。** 目标为文件清单中的根 workspace/锁/版本事实源、各包元数据、Host/Desktop/SDK 打包与安装工具。

1. 按风险 R05 核对全部自有产品/包/Host/Extension 的开发版本及消费约束；恢复统一 0.1.0 并同步锁，不改已发布 tag 或历史证据。
2. 固定一个候选，构建 Host、Worker、Extension Host、Desktop、SDK、多语言与所需外部 Extension 制品；记录来源、digest、兼容、许可和 SBOM/签名策略要求的证据。
3. 在无仓库源码、无本地依赖缓存的隔离环境安装，验证下载/校验/解包/原子切换、启动、升级、回滚、卸载。
4. 完成目标 OS/架构矩阵与 Windows native/Unity、Linux Host 的实际制品验证；用同一制品执行 P14A 恢复链。
5. 删除旧产物入口和硬编码开发路径，同步唯一安装/发布 Reference；缺签名/账号/平台时登记准确未验门，不伪造正式发布。

命令：`pnpm verify:extension-sdk-release`、`pnpm test:release:linux`、`pnpm verify:personal-server-full-install:linux`、`pnpm check:pr`，实际打包命令从各目标 package/scripts 核对并写入 commands。
完成门：版本事实一致、固定制品矩阵与安装恢复通过；构建候选不等于发布授权。
下一步：P01A。

## step-p01a

**20 / P01A：清空例外与最终护栏。** 目标为 `tools/repo-checks/`、CI、workspace 配置和已经迁完的 owner 公开面。

1. 对全部 legacy debt/白名单逐项找到原 consumer 与删除证据，删除已经失效的例外；未消除的真实依赖回到其 owner 修复。
2. 检查 Core→App/SDK/generated wire、扩展→Core 内部、循环依赖、非公开 import、重复契约源和旧路径残留。
3. 添加规则失败反例：反向依赖、循环、旧 owner、清单缺项/多项、错误命名、双源等必须失败；不扩大忽略范围使 final 通过。
4. 检查全仓根文件、配置、assets/profile、templates、测试、文档及构建入口与 files.json 的每一差距。
   按领域修复剩余实物；普通文件调整可按宪章同步清单，不能删除未实现目标来消除差距。
5. 启用最终架构/目录检查在 CI 的必需门；移除“迁移期间预期失败”对最终候选的豁免。

命令：`pnpm --filter @glimmer-cradle/repo-checks test`、`pnpm check:architecture`、`pnpm check:target-layout:final`、`pnpm check:docs`。
完成门：全部例外清空，final 零差距，故意违规的反例能失败。
下一步：P15A。

## step-p15a

**21 / P15A：最终成品验收。** 本步以固定候选的全部实物为输入，验收定义只引用 acceptance，不另立缩小版标准。

1. 将每个阶段的所有任务、目标文件和未关闭风险对账；文件存在但无实际行为/消费者的目标仍判未完成。
2. 对 B01–B08、D01–D04 逐行绑定真实入口、候选、环境和证据；补齐全链交互、两类语音、工具、长期承诺、Knowledge、具身与崩溃恢复。
3. 验证实际 UI/设备、独立 Extension、跨语言 wire、双节点切权、固定安装制品和备份恢复；历史有效证据可复用，明确输入未变依据。
4. 运行最终工程与物理门；修复发现后只重验失效证据并重新固定候选，不能用某次旧 PASS 接受新组合。
5. 核对 Current/Implementation/Reference/Guides 与最终实物一致；生成验收索引交给 P15B，未通过项保持 FAIL/BLOCKED/NOT-RUN。

命令：`pnpm check:pr`、`pnpm check:target-layout:final` 及验收矩阵尚无有效证据的命令/实际场景。
完成门：G0–G5/G7 的本步证据完整，全部必需风险已关闭；最终独立接受由 P15B 执行。
下一步：P15B。

## step-p15b

**22 / P15B：独立审查、完成与归档。** 输入为 P15A 固定候选及全部证据；审查者不修改被审查对象。

1. 按已有授权安排独立审查，核对领域/协议/生命周期/安全/数据/物理目录及证据充分性；没有授权或审查者时保留 verified，不能自称独立审查通过。
2. 执行 owner 修复 findings、重验受影响门、重新固定候选；审查者复核修复和新增风险，直至必需 finding 关闭。
3. 核对所有任务接受与阶段退出门；P15 阶段须等本任务接受后再标 accepted。所有任务接受时 nextTask 置 null，并生成 status。
4. 将稳定事实归入既有权威页，按文档治理把已结束 initiative 和证据归 History；同步导航、清单、生成器引用、摘要锁和检查规则。
   归档是有证据的最终操作，不能在前序门未过时提前执行。不得把归档理解为归档用户会话。
5. 对归档变更运行 docs/encoding/architecture、repo-checks 与 final；涉及可执行工具则补根 typecheck/build。
   保存归档前后路径映射和最终报告，不遗留仍指向已移动 execution.json 的工具。

完成门：G6 与全部 G7 条件满足；最终报告区分重构完成、提交/推送、正式发布和生产验收。
下一步：无。未授权的发布/生产操作保持未执行，不影响对已明确范围成果的真实描述。

## 例外与防漂移

| 观察到的情况 | 必须执行的动作 | 禁止动作 |
|---|---|---|
| 代码已具备本步能力 | 验证真实消费者与适用反例，复用有效证据，完成对应动作 | 为迁移次数重写相同能力 |
| 当前路径/命令因前序迁移变化 | 根据前序 mapping 查实际新入口，更新本步 mapping/commands 和唯一验收入口 | 重新选择领域归属或跳过该门 |
| 需要普通新增测试/实现文件 | 按原 owner 和命名规则登记清单、生成树和摘要；记录原因 | 擅自改变 Core/Host/Extension 边界 |
| 一个动作过大 | 保持 task ID，在 nextAction 保存本节子步骤；必要时用局部映射记录拆批 | 另造一套全局计划或只完成骨架就推进 |
| 测试失败 | 保留最小反例，区分产品/fixture/环境；两次同类无效尝试后换假设或缩小实验 | 降低断言、吞错、无限重复同一命令 |
| 缺真实设备/账号/外部仓库权限/审查者 | 写原因、缺少的具体门与解除条件；按固定次序寻找依赖已 accepted 的独立任务继续；无可执行项则 nextTask=null 并报告阻断 | 伪造 PASS、绕过依赖、以本地替身关闭整链 |
| 需要改变领域/进程/安全/数据语义 | 停下受影响分支，提供冲突事实与最小修订候选，按宪章取得必要决策 | 把个人偏好或新看到的项目当作重设计依据 |
| 发现已接受步骤回归 | 固定失败证据，按通用指南登记关联修复任务；暂缓依赖受损能力的后续接受 | 悄悄改历史证据、继续声称旧结论有效 |
| 用户停止或上下文中断 | 保存 last action、nextAction、HEAD/dirty 与进程句柄；恢复后只核对受影响事实 | 从 A00 重新开始或自动另开会话 |

本任务书固定目的、顺序、owner 和完成门；执行者仍需核对真实 API、修复失败与保护数据。
“按部就班”不代表忽略证据。没有出现上述例外，就按当前步骤实现、验证、记录并进入下一步。

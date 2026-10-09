# 架构重构验收矩阵

> 范围：任务、阶段与最终成品必须收集的证据；本文不保存 PASS 状态。
> 事实依据：v2.1 baseline §13–14、实际根 package scripts、执行宪章。
> 维护触发：行为不变量、测试命令、平台或制品边界变化。

## 目录

- [分层验收](#分层验收)
- [行为场景](#行为场景)
- [可运行命令](#可运行命令)
- [证据格式与最终关闭](#证据格式与最终关闭)

## 分层验收

| Gate | 必需产物 | 失败时如何处理 |
|---|---|---|
| G0 准备 | 精确文件映射、consumer、writer、数据样本、命令、退出门 | 继续 discovery，不能开始依赖未知布局的实现 |
| G1 契约 | 公开 API、唯一 Schema、生成/兼容/mapper 测试 | producer/consumer 成对修复，不保留第二源 |
| G2 行为 | 正常及失败场景，真实 owner 与端到端调用证据 | 固定最小反例修复 |
| G3 恢复 | 隔离旧数据、备份恢复、幂等、取消/切代、unknown 对账 | 保留旧数据，禁止提前删除/切换 |
| G4 删除 | 精确旧文件列表、consumer-zero 和目标文件实物 | 未达门保留有 owner/退出条件的迁移项 |
| G5 工程 | 类型、构建、架构、文档、编码，受影响 fixture/制品 | 不用跳过/降低断言制造通过 |
| G6 审查 | 高风险固定候选独立 findings 与关闭证据 | verified 不得提升 accepted |
| G7 成品 | 零物理差距、基线 §13 的全部八条链、平台/安装/恢复矩阵与全部阶段接受 | 外部阻断单列，整体保持未完成 |

## 行为场景

每个场景在实现卡绑定真实测试位置；“会补测试”不能作为接受证据。

| ID | 完整链与关键反例 | 主要阶段 |
|---|---|---|
| B01 | ingress→资产提交→Conversation Log→Turn→Cognition→Delivery；重复/乱序/提交失败不产生多份事实 | 3/4/5/12 |
| B02 | 流水线 ASR/TTS 与 Realtime 两条语音链分别验收；打断/晚帧/实际播放回执；Realtime 工具授权和交互事实持久旁路，提交失败终止或降级 | 4/8/9/10/12 |
| B03 | 原生 ToolCall→曝光→授权→执行 journal→真实 receipt→下一 Step；撤权、超时、未知副作用不重发 | 5/6/9 |
| B04 | 长期 Planning/Memory→Jobs→源业务接纳→状态 inbox→通知→实际回执→后继调度；取消/重启/fencing/ACK 丢失 | 5/7/12/13 |
| B05 | Extension 安装、加载、ready、崩溃、撤销和卸载；secret 不越界、超时/拒权/孤儿进程回收 | 9/10/12 |
| B06 | Local/Cloud/Hybrid handover；旧 authority 拒写、离线 proposal、回连冲突和降级 | 2/13/14 |
| B07 | Resource revision→Knowledge ingest/hash/transform/index→权限过滤→Context provenance；更新/ACL/删除使派生物失效 | 5/9/10 |
| B08 | Cognition/交互→Embodiment intent→Renderer Extension→真实 readiness/执行反馈→投影；缺 renderer 如实降级且稳定语义无厂商参数 | 8/9/10/12 |
| D01 | Content 引用闭包、配额、GC、旧 URI 与缺失媒体、备份恢复 | 3/14 |
| D02 | Persona 未授权修改拒绝；Memory 来源纠正；Knowledge revision/ACL/转换版本/删除失效 | 5/9/14 |
| D03 | Conversation Log 单写者、History 重建、持久 Turn/Planning/Loop 恢复，Checkpoint 不冒充事实日志 | 4/5/14 |
| D04 | 模型/工具预算、分页公平性、背压、关闭排空、日志/secret 脱敏 | 2/5/6/7/12 |

## 可运行命令

以下在仓库根执行；任务准备时核对 scripts 仍存在，若已迁移则同步此页。

| 改动面 | 命令 |
|---|---|
| 文档/目标 | `pnpm check:docs`；`pnpm check:encoding`；`pnpm check:architecture`；`pnpm check:target-layout` |
| 仓库工具 | `pnpm --filter @glimmer-cradle/repo-checks test` |
| Platform | `pnpm test:platform` |
| Content | `pnpm --filter @glimmer-cradle/content typecheck`；现行资产真实 consumer 测试为 `pnpm --filter @glimmer-cradle/kernel exec vitest run --threads false src/adapters/content/file-asset-store.test.ts src/adapters/content/staged-asset-uploads.test.ts src/adapters/surface/control-surface-audio-content.test.ts` |
| Conversation | `pnpm test:conversation` |
| Cognition/Worker | `pnpm test:cognition`；`pnpm test:cognition-worker` |
| Capabilities/Jobs/Host | `pnpm test:capabilities`；`pnpm test:jobs`；`pnpm test:host` |
| 跨边界 Schema | `pnpm contracts:generate`；`pnpm contracts:verify` |
| SDK/Extension Host | `pnpm --filter @glimmer-cradle/extension-sdk test`；`pnpm --filter @glimmer-cradle/extension-host test`；`pnpm verify:extension-sdk-release` |
| Audio | `pnpm test:audio` |
| Desktop/UI | `pnpm --filter @glimmer-cradle/desktop test`；`pnpm test:ui` |
| 现行 Kernel/Server | `pnpm --filter @glimmer-cradle/kernel test`；`pnpm --filter @glimmer-cradle/personal-server test` |
| C#/Unity/native | `pnpm avatar:doctor`；`pnpm avatar:projector:test`；`pnpm avatar:composition:build`；`pnpm avatar:build`，需真实 Windows/Unity 工具环境 |
| 源码交付基线 | `pnpm typecheck` 后运行 `pnpm build`，避免并行清理共同 dist |
| 最终本地候选 | `pnpm check:pr`；`pnpm check:target-layout:final` |
| Linux 安装恢复 | `pnpm test:release:linux`；`pnpm verify:personal-server-full-install:linux`，先准备隔离目标环境 |

发布/打包操作依据相关 Guide 和用户授权执行；上述命令不授予生产权限。
缺工具、账号、设备或环境时记录 blocked/not-run，并说明替身的覆盖边界。
不得通过修改版本/兼容基线或更新快照掩盖意外变化。当前版本策略差距按 R05 单独收束。

## 证据格式与最终关闭

每个 evidence 记录：ID、task ID、输入 commit/tree/dirty、时间、环境、命令/cwd、结果/exit、
必要日志路径、测试替身范围、未验项、审查 finding、证据失效条件。
状态有 PASS / FAIL / NOT-RUN / BLOCKED / REUSED；REUSED 必须说明相关输入为何未变。

最终 accepted 同时要求：全部任务/阶段接受；所有必需风险关闭；
final 无缺项/多项且无旧 owner；B01–B08 与 D01–D04 均有真实场景证据；
跨语言生成/构建、外部扩展、固定安装制品与备份恢复通过；高风险独立审查关闭；
Current/Implementation/Reference 与实物一致。
静态规格通过、dirty 测试通过、提交成功和生产验收分别陈述。

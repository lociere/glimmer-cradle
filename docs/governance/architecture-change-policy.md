# 架构变更与迁移宪章

> 范围：最终目标与文件级契约的权威顺序、维护和迁移纪律。
> 依据：用户采纳方案与补齐物理结构的授权、ADR-0023/0024；产品基线 v2.1，文档治理修订 docs-r1。
> 维护触发：架构决策、文件清单或验收机制变化。

## 权威顺序

用户最新明确决策 → [v2.1 蓝图](../architecture/target/baseline.md) →
[采用 ADR](../architecture/decisions/ADR-0023-最终目标蓝图与物理目录契约.md)及其[文档布局修订](../architecture/decisions/ADR-0024-文档职责与重构执行体系整合.md) → 本宪章 →
[执行要求](../roadmap/initiatives/architecture-v2/requirements.md) → [执行记录](../roadmap/initiatives/architecture-v2/README.md)。
Current、Implementation 继续描述实际实现。v2.0 归档后仅供追溯，不再拥有目标解释权。

蓝图主文拥有语义，[目录清单](../architecture/target/files.json) 拥有精确路径，
[物理目录规范](../architecture/target/physical-layout.md) 的树由清单生成，包约定在该规范正文说明。
如果语义与路径冲突，必须修正同一候选，不能选择有利的一份跳过另一份。
步骤见[切片执行指南](../guides/development/architecture-refactoring.md)，阶段与验收见对应 initiative。
任务进度、操作方法与目标不变量分别维护；ADR 的替代范围必须显式说明。

## 首要边界

按职责、变化原因、状态 owner 与生命周期划分，而非按依赖来源划分。
核心不得对某消息平台、模型供应商或具体 Renderer 特化。可独立安装、替换和演进的环境接入采用 Extension；
数据库驱动、React/Electron、OS API 等由领域私有 adapter 或 App/platform adapter 使用，不机械扩展化。
Extension 只使用正式 SDK；同仓/异仓与第一方/第三方身份都不改变这一契约。
不建立包含无关第三方业务的 `integrations/` 总包；未来新增模块先确认语义与消费者。

## 文件清单规则

1. `repositoryFiles` 列出完整首版目标中所有版本控制文件；父目录由这些精确路径推导并全部展示，不使用省略号或通配符代替手写源文件。
2. 模板本身在主仓库清单内；生成的新扩展项目不在主仓库内。使用模板时复制其完整文件集合并按 manifest 替换参数；厂商实现由外部项目维护。
3. 生成文件、安装产物和运行数据单独登记具体入口及受约束动态模式、producer、寿命和验收。用户内容和哈希文件名不能预先穷举，也不能据此省略手写文件。
4. 新增、拆分、删除或重命名普通实现文件，在同一切片更新清单、生成树、摘要锁和验证证据；不得仅改实物导致漂移，也不得冻结到永远不能增加测试。
5. 目录契约的普通文件调整无需重新询问已有范围内的用户授权。改变领域 owner、依赖方向、进程、安全/数据边界或可选能力的承载方式，才属于需明确决策的新架构变更。
6. 冻结是“变更有记录且同步验证”，不是声称预先设计永远无须改动。清单外新增文件在最终核对中失败，不能通过宽泛白名单逃避核对。

## 迁移纪律

每个切片执行 create → cut consumers → verify → delete old owner。禁止创建空模块以满足目录清单。
`contracts/` → `protocol/` 需要生成器、consumer、mapper、制品与兼容检查原子切换；切换前维持现行唯一源。
保留用户数据、稳定 ID、顺序、幂等、权限、readiness、中断和恢复语义；旧 owner 删除须 consumer-zero、数据保护和行为验证。
既有阶段完成证据保持真实；v2.1 新增要求形成待完成差距，不能追溯声称旧测试已经覆盖。
既有 C#/Unity/native 与发布/恢复链路必须逐项迁移，不能只交付 TS/Python。

## 检查与完成

`pnpm check:architecture` 检查冻结摘要和目录规范同步，迁移期间不因目标文件尚不存在而失败。
`pnpm check:target-layout` 独立检查目录清单与展示树；`pnpm check:target-layout:final` 对 Git 可见文件集合及所需文件实物逐一核对。
最终核对不扫描秘密内容、不把用户数据或 node_modules 当源代码，也不验证运行语义；动态制品和运行数据另按物理规范验收。
最终命令目前预期失败；只有产品迁移完成、旧 owner 删除并满足蓝图行为门后才可宣称架构完成。

源码/工具切片至少运行对应测试、根 typecheck/build、架构及编码检查。纯文档运行 docs/encoding，并核对事实和规则。
数据、权限、协议等高风险实现候选需要独立审查；文件存在和静态检查不能代替该审查。
不自动创建产品代码，不自动生产迁移、发布、推送或切换用户会话。

## 摘要锁维护

1. 确认变更属于已授权普通文件/文档调整，或具备新边界的用户决策与 accepted ADR。
2. 更新对应规范源、目标 files.json；先运行 `pnpm check:docs --write`，再运行
   `pnpm check:target-layout --write`，使两个生成视图均来自同一清单。
3. 对 baseline.lock.json 的 immutableSources 中每个文件按原始 UTF-8 字节计算 SHA-256，
   更新对应项；规范源增删必须同时更新其列表并说明治理原因。
4. 将同一 JSON 对象同步到 `tools/repo-checks/src/architecture/baseline-lock.mjs` 的 expectedLock，
   保持 targetRoots/coreModules/migrationPolicy 不变，除非已授权对应语义变更。
5. 审查源 diff 与锁 diff，运行 repo-checks 反例测试和 architecture 门。更新摘要本身不证明授权。

规范源包含蓝图、物理契约、治理宪章、采用 ADR、切片方法、项目计划、主执行任务书与验收要求。
execution.json、status.md、切片卡和 evidence 保存可变进度，不纳入冻结摘要；它们的文件路径仍精确登记。
新增进度文件会改变文件清单摘要，这是物理契约维护；更新已有任务状态无需修改冻结产品语义。

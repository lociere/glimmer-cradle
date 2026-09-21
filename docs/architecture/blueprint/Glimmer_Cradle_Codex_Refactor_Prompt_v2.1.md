# Glimmer Cradle v2.1 重构执行要求

> 范围：将冻结目标落实为最终实物的切片交付要求；不声明阶段已完成。
> 依据：[蓝图](./Glimmer_Cradle_Architecture_Baseline_v2.1_Frozen.md)、[执行宪章](./Architecture_Baseline_v2.1_执行宪章.md)。
> 维护触发：目标、依赖、切片验收或最终文件清单变化。

## 目录

- [实施输入](#实施输入)
- [交付阶段](#交付阶段)
- [逐文件对齐](#逐文件对齐)
- [行为验收](#行为验收)
- [数据与制品验收](#数据与制品验收)
- [结果报告](#结果报告)

## 实施输入

先读取蓝图、[物理目录规范](./Glimmer_Cradle_Target_Physical_Layout_v2.1.md)、当前迁移地图和执行记录。
不根据目标树假设当前 API 已存在。确认 writer、消费者、契约、测试、数据样本和可删除对象后实现。
在现有源代码事实源中演进，不先复制出第二套可消费契约或并行状态 owner。
命名遵循 [命名规范](../../guides/development/命名规范.md)；核心按稳定语义命名，特定环境转换局限于边缘。

## 交付阶段

阶段编号沿用 [执行记录](../../roadmap/architecture-v2-refactor.md)，新增条件并入相应阶段，不重置历史完成证据。

| 阶段 | 必需成果与新增完成条件 |
|---|---|
| 0 审计 | 当前到清单的逐文件映射，owner/消费者/数据/发布物/旧入口与风险证据 |
| 1 护栏 | 锁、目录契约、import/exports/依赖环、迁移例外及退出门 |
| 2 Platform | 生命周期、scope/identity、Clock、通信、安全、authority、配置机制及 observability |
| 3 Content | parts、资产提交、引用闭包、配额、GC、旧媒体迁移和恢复 |
| 4 Conversation | Log 单写者、History 投影、Turn 持久状态、Interaction、Delivery generation 与播放回执 |
| 5 Cognition | Persona/state、Memory、Knowledge 生命周期、Context 预算与信任、Inference、Planning、Loop checkpoint |
| 6 Capabilities | Tool/Skill/Resource/Speech 分工，Exposure，Execution journal、outbox、unknown 对账 |
| 7 Jobs | trigger/schedule、持久租约/fencing、handler、取消、恢复、retention 与跨库提交 |
| 8 Embodiment | TS 稳定语义、C# 行为等价迁移、Renderer 契约与真实 native/Unity 构建 |
| 9 SDK | manifest/贡献/权限/兼容，TS/Python/C# 公开消费面，独立模板安装/构建/加载/卸载 |
| 10 外部能力 | MCP 及平台/模型/语音/Renderer 按可替换性和生命周期外置；主仓库配置只引用制品 |
| 11 Protocol | 唯一 proto、owner-local Document schemas、生成器、mapper、旧 wire 兼容与制品原子切换 |
| 12 Apps | 共用 Host、Cognition Worker、Extension Host、Desktop，部署/监督/控制面与 UI |
| 13 Topology | local/cloud/hybrid 同构，authority handover、离线 proposal、冲突/分支与降级 |
| 14 数据 | 备份、恢复、旧样本、路径迁移、引用闭包、版本和安装事务 |
| 15 成品 | 清单完全匹配、无旧 owner、全部行为与制品门、独立审查和文档收束 |

相邻阶段可因依赖实施交叉切片，但必须在记录中说明；不得以阶段序号跳过所需 wire 或权限保障。

## 逐文件对齐

1. 从机器清单筛选本切片目标文件，记录旧路径到目标路径、是否新增、消费者切换和删除门。
2. README 说明 owner/public API/依赖/状态/测试；package exports 与 Python 包入口限定公开 API。
3. 创建真实实现、配置、schema、测试及构建入口；不创建无代码的 feature 目录，不复制模板作为运行模块。
4. 新增合理拆分或测试文件时同步修改清单和生成树，不用“辅助文件”绕过检查。
5. final 比较使用 Git 可见文件集合，既检查缺少的目标文件，也检查多出的旧文件；tracked generated 同样精确登记。
6. 文件核对通过后还需行为测试与实物 inventory，不能仅检查 `src/` 和 package.json 存在。

## 行为验收

必须覆盖蓝图第 13 节所有链路与第 14 节故障场景。测试应检验不变量和外部可观察结果，不能只验证自己的 helper。
至少包含：重复/乱序 ingress、持久提交失败、投影重建、中断晚帧、音频实际播放、模型/工具超时、撤权、扩展崩溃、未知副作用。
Knowledge 覆盖 source revision、权限改变、转换版本、删除和索引失效；Memory 覆盖来源纠正；Persona 覆盖未授权修改拒绝。
Jobs 覆盖租约失效/重复触发/重启；Hybrid 覆盖旧 authority 拒写和回连冲突。普通 Turn 重启恢复不强行变成 Job。
没有硬件或外部服务时报告测试替身覆盖和专项环境未验项，不把测试替身等同真实通过。

## 数据与制品验收

安装目录与数据目录分离；正式安装不得引用仓库路径、workspace symlink 或开发机依赖缓存。
每份 release 有入口、依赖闭包、哈希 inventory、SBOM、版本与迁移声明；安装/升级/回滚在固定制品上测试。
第三方资产和运行依赖遵循许可及分发约束，以锁定下载/投影流程获取，不伪造可再分发源文件。
Python/TS/C#/native/Unity 按实际平台执行构建；外部扩展独立仓库要输出自己的文件 inventory 和兼容证据。
先验证备份恢复再切换唯一 writer；保留旧数据映射，确认引用完整后删除旧路径。

## 结果报告

每切片记录成果、变更范围、writer、旧 owner 删除/未删除原因、验证输入及结果、剩余风险。
Current/Implementation 只同步本切片真实变化；新目标差距归 Roadmap。
最终报告分别给出：架构静态门、目录匹配、行为门、数据恢复、发行物与平台测试的结论。
完成定义是实物、行为、文档相符；不承诺“永远完善”，但所有剩余必需项必须关闭。

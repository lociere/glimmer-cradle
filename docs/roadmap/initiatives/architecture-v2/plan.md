# 架构重构阶段计划

> 范围：0–15 阶段的成果、依赖、可执行拆分与退出门；阶段状态唯一源为 execution.json。
> 事实依据：v2.1 基线、原执行要求、dc59181e 对应历史证据；不推断未读源码已经完成。
> 维护触发：差距、依赖、任务拆分、验收或目标发生变化。

## 执行方式

本计划定义最终应达到的成果，已有接受证据可按输入复用，不从阶段 0 重做全部实现。
精确任务顺序与依赖见[状态视图](status.md)。编号表达领域阶段，不代表严格瀑布；
跨阶段任务通过 stageIds 显式记录。本次建议顺序先完成当前 Planning/Jobs 连续链，
再闭合核心边界、SDK/外部能力、契约路径、产品入口、拓扑、数据与最终验收。

任务表的 dependsOn 是所选切片的开始依赖。增量 wire/权限修复在现行 contracts 立即完成，
不必等待 P11 的最终目录迁移。新发现可改变切片依赖，须同步任务表及理由，
验证无环并重新满足入口门；不得因此改变产品目标或略过安全保障。

所有 planned 任务先按本节和对应阶段做定向 discovery；存在具体卡、精确路径、真实消费者、
数据恢复与可运行命令后才能开始 implementation。后续任务不凭空假设 API 已存在。
准备门/实施/失败恢复/状态推进只在[通用指南](../../../guides/development/architecture-refactoring.md)维护。

## 阶段目录

- [P00 增量审计](#p00)
- [P01 架构护栏](#p01)
- [P02 Platform](#p02)
- [P03 Content](#p03)
- [P04 Conversation](#p04)
- [P05 Cognition](#p05)
- [P06 Capabilities](#p06)
- [P07 Jobs 与长期 Planning](#p07)
- [P08 Embodiment](#p08)
- [P09 SDK 与 Extension Host](#p09)
- [P10 外部能力](#p10)
- [P11 Contract Spine 原子迁移](#p11)
- [P12 Apps 与产品入口](#p12)
- [P13 Topology 与 authority](#p13)
- [P14 数据、版本与制品](#p14)
- [P15 最终收口](#p15)

## P00

**增量审计**

- 输入：有效基线、实际 HEAD、文件清单、现有 consumer 和历史最新证据。
- 实施顺序：核对新提交；仅补过期 owner/数据/制品映射；生成下一切片卡和删除门。
- 退出门：文件路径与消费者可查证；没有重复 writer/契约源；A00 接手结果 accepted。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P01

**架构护栏**

- 输入：P00 映射、现有 checker/CI 与有退出条件的 legacy debt。
- 实施顺序：清点依赖/exports/AST 环及例外；每次 owner 迁移同步缩减例外；最终切换严格规则。
- 退出门：新增违规、循环、过期例外、文件缺项/多项均有失败反例；不靠白名单屏蔽漂移。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P02

**Platform**

- 输入：P00/01、Kernel 剩余平台机制与业务策略区分。
- 实施顺序：提取有真实 consumer 的 primitive；App 保留业务策略；补 stop/observer 失败、租约、时钟、权限和关闭测试。
- 退出门：Core 不依赖 App/SDK；旧 primitive consumer-zero；ready/degraded 与停机如实。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P03

**Content**

- 输入：既有单写者、ingress mapper、引用样本、配额和回收规则。
- 实施顺序：对照 v2.1 目标补物理路径；核对旧 URI/不可恢复媒体；测试 commit/GC/引用闭包并保持一个 writer。
- 退出门：D01、输入去重、提交失败/恢复通过；不把短期 audio lease 当长期 AssetRef。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P04

**Conversation**

- 输入：Content、现有 Worker Log/Turn、Host Delivery 和旧消费者。
- 实施顺序：补齐 interaction/generation/播放回执；切真实消费者；重建 History；核对历史 identity 和持久 writer 关闭。
- 退出门：B01/B02/D03；重复/乱序/晚帧/缺半边历史/旧世代拒绝；旧 owner 物理删除。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P05

**Cognition**

- 输入：现有 native Loop/port、P04 交互身份和 P06 能力契约。
- 实施顺序：闭合未迁 IO/provider/helper；分开 Memory 与 Job/checkpoint；修正来源撤销/Persona 写入/Context 预算；验证 Planning 后继。
- 退出门：B03/B04/D02/D03；Core 不直接平台 IO；原生迭代和普通 Turn 恢复不依赖新 Job。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P06

**Capabilities**

- 输入：P05 消费方 port、Host 身份/permission、现有 journal/outbox。
- 实施顺序：核对真实 default caller；闭合授权二次检查、持久 Run 预算、撤销与 unknown 对账；删旧 Skill Plane owner。
- 退出门：B03/D04；未确认副作用不重发；去重身份不因重启变更；完整拒权/超时测试。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P07

**Jobs 与长期 Planning**

- 输入：P02/04/05/06 当前接口、dc59181e 证据、旧队列配置。
- 实施顺序：先后继调度/撤销，再产品源接纳/catalog/状态投影；演练旧队列到唯一 Jobs writer；补 retention 与恢复。
- 退出门：B04；重启不重复 attempt/model/send；ACK 丢失/旧租约/撤销/后继请求一致；停止旧队列消费。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P08

**Embodiment**

- 输入：稳定具身语义、现行 Avatar/C# 行为和真实 renderer 入口。
- 实施顺序：抽取 TS 语义；建立 C# 等价用例；Renderer 映射具体参数；迁 native 表面；按能力如实降级。
- 退出门：B02/B08；真实 C#/Unity/native 构建、透明合成/打断/缺 renderer；旧 Avatar owner consumer-zero。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P09

**SDK 与 Extension Host**

- 输入：现行 packages/SDK、hosts/extension-host、外部消费方版本与制品。
- 实施顺序：迁公开契约、manifest/贡献/权限/兼容；隔离 Core DTO；闭合 broker；原子迁 Host 与完整 TS/Python/C# 模板。
- 退出门：B05；独立项目安装/构建/加载/卸载与权限/崩溃/孤儿进程；外部消费者证据。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P10

**外部能力**

- 输入：P09 SDK 与已归一 Model/Speech/Channel/Renderer/Resource 契约。
- 实施顺序：按生命周期外置模型/语音/MCP/渠道/Renderer；主仓库配置引用制品；保留许可、校验、能力协商和缺失降级。
- 退出门：B02/B03/B05；真实扩展环境或明确未验；Core 无厂商 payload/类型；不机械扩展化普通库。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P11

**Contract Spine 原子迁移**

- 输入：完整 consumer/生成器/schema/mapper/制品/兼容 inventory。
- 实施顺序：先在现行源演进增量契约；最终一次移动 proto、owner-local Document、生成器和全部消费者到目标；删除旧源。
- 退出门：contracts verify、三语言 roundtrip、breaking/generated clean、打包入口一致；不存在双源过渡运行态。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P12

**Apps 与产品入口**

- 输入：稳定领域公开 API、P09/10 接入面、产品控制/认证/安装路径。
- 实施顺序：迁可信 ingress/接收审批/状态投影；共用 Host 装配；Desktop/控制面只读受控投影；迁入口、打包与监督；删除旧组合。
- 退出门：B01–B05；真实启动/断连/重连/撤权/停机/UI 与完整安装链；不保留第二 Server 业务 Host。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P13

**Topology 与 authority**

- 输入：P02/P07/P12 实际 owner，Conversation/Memory/Persona/Job/Config 权威矩阵。
- 实施顺序：逐 aggregate 定唯一 writer；实现跨机身份/租约交接、离线 proposal、冲突分支/重连；拒绝旧 token。
- 退出门：B06；网络分区和租约失效不双写；降级和冲突可解释且可恢复。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P14

**数据、版本与制品**

- 输入：P03–13 的 schema/路径/依赖闭包；生产权限另行确认。
- 实施顺序：在隔离数据副本做备份/迁移/重启/恢复；修复开发版本事实源；固定制品 inventory/SBOM/签名/安装事务；平台矩阵。
- 退出门：G3/G7；安装不依赖仓库/缓存；稳定 ID/引用闭包保留；历史 tag 不回写；恢复证据绑定固定制品。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## P15

**最终收口**

- 输入：全部阶段接受证据、无未解决必需风险、固定候选和独立审查。
- 实施顺序：收束所有旧路径/例外；跑 final/完整行为/恢复/平台矩阵；核对事实文档；关闭风险并归档项目。
- 退出门：G0–G7/B01–B08/D01–D04 满足；零目录差距；独立 findings 关闭；未验项不能包装成完整首版。
- 风险与恢复：进入实现前固定相关 ID/单写者/数据样本；失败保持原可恢复事实，禁止通过双写、重发或删除数据恢复测试。
- 验证：按[验收矩阵](acceptance.md)选择该 owner 的准确命令和场景，并在切片卡绑定测试位置；高风险先 verified 后独立接受。

## 完成与归档

阶段完成要核对该阶段全部任务、目标文件、行为/数据/制品门和未关闭风险；
历史某个阶段的局部 PASS 不能替代新增 v2.1 条件。
最终完成后依照文档架构归档 initiative，稳定事实仍留在 Architecture/Reference/Guides。
当前权限与未完成外部环境见[风险台账](risks.md)；任务接受证据见[evidence](evidence/README.md)。

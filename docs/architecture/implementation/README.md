# 组件与实现地图

本目录是一处维护的组件说明：解释组件的目的/概念、真实入口与 consumer、依赖、资源/数据所有权、运行及失败/恢复。
按具体任务组织必要内容，不要求每页固定章节。跨组件关系查[当前系统](../current/README.md)，目标要求查[v2.1](../target/README.md)。
源码/manifest/Schema 是当前事实依据，测试与环境决定已验范围；有代码不等于默认产品已经切换。
精确字段查[参考](../../reference/README.md)，完整操作查[指南](../../how-to/README.md)。

| 组件/问题 | 入口 |
|---|---|
| Host、Platform、Clock、生命周期、配置、监督 | [Platform 原语](Platform原语实现.md)、[Kernel/Runtime](Kernel与Runtime实现.md)，核对 `apps/host` 与产品 consumer |
| Conversation 身份/Log/History 与 Experience 消费 | [Conversation](Conversation实现.md) |
| Service、Document、公开 SDK、生成与语言消费 | [Protocol 契约](Protocol契约层实现.md) |
| persona、State、感知/注意、上下文、推理与单一循环 | [Cognition 主链](Cognition认知核实现.md) |
| Memory/Knowledge、证据/版本/巩固、持久化与删除传播 | [Memory 与 Knowledge](CognitionMemory与Knowledge实现.md) |
| 长期承诺、Planning/Jobs、源请求/回执和恢复 | [Planning](CognitionPlanning实现.md) |
| Electron、Presence、Unity/C#/Live2D、Native/首帧 | [Desktop 与 Avatar](Desktop与Avatar实现.md) |
| Audio 双 lane、provider/媒体租约、Native 当前能力 | [Engines 与 Native](Engines与Native实现.md) |
| SDK、安装/身份、Host/贡献、Policy/Gateway、MCP | [Extension 与产品 Skill Plane](Extension与SkillPlane实现.md) |
| 数据闭包、资产/交互事实、索引、日志/Trace/DLQ/清理 | [数据与可观测性](数据、记忆与可观测性实现.md) |
| 构建输入、固定制品、部署事务、供应链和 CI | [工程生命周期](工程生命周期实现.md) |

`core/content`、`core/jobs`、`core/capabilities` 的公开职责与局部 API 同时由各包 README/exports/tests 解释，
本地图连接其跨域消费，不复制每个包手册。精确当前物理入口见[拓扑](../current/10-当前物理拓扑.md)，迁移进度查原 initiative。

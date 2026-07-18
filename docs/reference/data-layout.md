# Data Layout Reference

> 范围：源码资产、用户状态、模型、缓存、运行产物、日志、备份和第三方包的目录事实。
> 事实依据：`assets/`、`data/`、路径 resolver、Cognition persistence、Engine resource catalog、Desktop/Avatar/Extension 实现。
> 维护触发：目录移动、owner 变化、迁移策略、模型缓存、备份规则、ignore 规则、打包投影或 resolver 变化。

Local Data Domain 由产品或部署环境持有：正式产品通过 `GLIMMER_CRADLE_DATA_ROOT` 注入唯一数据根，源码开发未设置时回落到仓库 `data/`。业务 YAML 不声明 `data_dir` 或 `log_dir`，日志、状态、缓存、模型、包与工作材料只能由统一 resolver 派生，避免同一进程树写入多个数据根。Desktop main 通过 `products/desktop/src/main/project-paths.ts` 解析 application/data/config/installed-extensions 根，并派生 `state/`、`packages/`、`observability/` 等语义路径。Control Center、Avatar 诊断、扩展配置和体验预览都必须走这条 resolver 主线，而不是在 Electron main 任意拼接 `process.cwd()` 或源码相对路径。

## 顶层域

| 域 | 示例 | Git | 语义 |
|---|---|---|---|
| 源码 | `core/`、`products/`、`protocol/`、`engines/`、`native/` | 是 | 主产品构建输入和代码事实；扩展源码属于独立仓库 |
| 只读默认资产 | `assets/` | 是 | 随应用发布的默认资源源 |
| 用户状态 | `data/state/` | 否 | 不可随意丢弃的用户连续性 |
| 模型 | `data/models/` | 否 | 本机模型、用户导入模型、模型缓存 |
| 缓存 | `data/cache/` | 否 | 可删除、可重建的性能材料 |
| 工作材料 | `data/work/` | 否 | ASR 输入、导出中间产物、单次任务暂存 |
| 短生命周期协调 | `data/run/` | 否 | 动态端点、锁、PID 与代际信息；停机后无保留契约 |
| 可观测数据 | `data/observability/` | 否 | 应用日志、event、trace、metric、audit、模型调用观测、index 与 bundle |
| 第三方包 | `data/packages/` | 否 | 可重装的 Extension、SDK 和外部工具，不存放第一方构建产物 |
| 备份 | `data/backups/` | 否 | 迁移前快照和用户主动备份 |
| 第一方构建输出 | `build/` | 否 | components、packages、staging、reports 与 build logs，可完全重建 |
| 最终分发物 | `dist/` | 否 | Desktop、Personal Server 与公开 Package 的最终可分发输出 |

## 用户状态与记忆

| 路径 | owner | 说明 |
|---|---|---|
| `data/state/cognition/experience/catalog.db` | Cognition / Experience | Ledger 全局 position、pack 范围与单写者目录 |
| `data/state/cognition/experience/packs/YYYY/YYYY-MM.experience.db` | Cognition / Experience | 月度不可变 Moment、来源、因果与检索索引 |
| `data/state/cognition/memory/memory.db` | Cognition | Memory、revision、evidence、relationship、intention、knowledge 与 embedding |
| `data/state/cognition/conversations/conversations.db` | Cognition / Conversation | 从 Ledger 可重建的消息、Chapter、Segment、Conversation State 与投影 checkpoint |
| `data/state/cognition/projections/episodes.db` | Cognition | 可从 Ledger 删除重建的 Episode 投影和巩固 checkpoint |
| `data/state/kernel/kernel.db` | Kernel | Kernel 基础设施库，只保存 Host/Extension 基础设施状态，不保存角色会话或认知记录 |
| `data/state/avatar/action-state.json` | Avatar/Desktop main | 手动动作的最后接受状态；唯一磁盘字段为 `active_action_ids: string[]`，Desktop 启动时读取，Avatar Host 上报后校正 |
| `data/state/desktop/avatar-presentation.json` | Desktop/Electron main | Avatar 模型选择、显示倍率和 Desktop Surface 呈现偏好 |
| `data/state/desktop/avatar-placement.json` | Desktop/UnityAvatarHost | Native Composition 窗口位置；由 Kernel 注入唯一状态路径 |
| `data/state/extensions/` | Extension Host/各扩展 | 扩展自己的状态域，不能写 Cognition 私有库 |
| `data/state/extensions/lociere.napcat-adapter/napcat/` | NapCat adapter | NapCat 工作目录；保存 NapCat 配置、日志、插件和 cache，程序包升级时不覆盖 |

Cognition 进程内 `ConversationWorkingSet` 是从 `conversations.db` 恢复的有界缓存，不拥有历史事实。长期聊天记录由 Experience Ledger 派生到 Conversation Store，Kernel 和 Renderer 都不维护平行对话事实源。Control Center 分开展示 Conversation 消息、Ledger Moment、Episode、活动 Memory、revision、evidence 和角色知识；Renderer 只消费 Desktop main 生成的只读投影。

Desktop main 从 `conversations.db` 读取最近会话记录，从月度 Ledger packs 聚合最近 Moment，从 Episode projection 读取分段状态，从 `memory.db` 读取当前 revision、evidence 与巩固结果统计。Control Center 必须区分待巩固、巩固完成但无长期记忆、巩固失败和活动记忆，也不能把预览结果解释为实际 Prompt 召回。

`data/state/desktop/` 只能保存 Desktop/Electron main 拥有的界面偏好，例如窗口、Avatar 呈现和用户可恢复的 UI 选择。它不得保存对话历史、会话摘要、线程状态、活动上下文、经历记录、长期记忆或 Avatar 动作事实。此类连续性数据必须由 Cognition、Kernel、Avatar 或 Extension owner 写入各自状态域，再通过受控 projection 提供给 Renderer 展示。

扩展运行健康不由 Renderer 推断。扩展如需暴露内部链路状态，必须通过 SDK `runtime` Host Port 上报 Capability Graph 节点、边、action intent 和 diagnostics，由 Host 合并成 `ExtensionRuntimeProjection` 后推送给 Desktop；`extension_storage` 只保存扩展私有 K/V，不再作为 Control Center 运行事实源。第三方包、外部进程、本地服务、设备和协议连接都必须通过 contribution point definition/registry 进入 Capability Graph；静态声明只能提供 owner、依赖和 readiness gate 输入，不能代替扩展内部的协议连接、登录态、管理面板等分段健康事实。

## 角色配置与知识

| 路径 | owner | 说明 |
|---|---|---|
| `configs/characters/<character-id>/character.manifest.yaml` | Cognition config | 角色包身份、最小名称锚点、persona mode 与目录声明 |
| `configs/characters/<character-id>/profile.yaml` | Cognition config | Character Package 作者种子，不进入 RAG，不写入向量库 |
| `configs/characters/<character-id>/dialogue.yaml` | Cognition config | 对话呈现策略，不承载人格事实 |
| `configs/characters/<character-id>/safety.yaml` | Cognition config | 红线和安全边界 |
| `configs/characters/<character-id>/voice.yaml` | Character voice | 稳定声音身份和 provider 声线绑定；不含密钥与系统路由 |
| `configs/characters/<character-id>/knowledge/index.yaml` | Cognition knowledge | Knowledge Vault 索引，正文来自同目录 `*.md` |

Character Package、Experience Ledger、Knowledge Vault、Memory Substrate 与 Vector Index 分工不同。Ledger 是经历事实源，`memory.db` 保存版本化认知状态，Episode/embedding 是可重建投影；任何一层都不能反向改写 `profile.yaml` 或 `dialogue.yaml`。

## 模型与官方 Engine

| 路径 | 说明 |
|---|---|
| `data/models/asr/funasr/` | FunASR/ModelScope 模型缓存 |
| `data/models/voice/` | TTS 模型、用户导入声线、训练整理副本 |
| `data/cache/audio/tts/` | TTS 合成缓存，可按文本/provider 复用 |
| `data/work/audio/asr/` | Control Center 上传或录制的 ASR 临时输入 |
| `data/packages/managed-resources/lociere.napcat-adapter/napcat/` | 本机托管 NapCat 程序包；可重装，不保存扩展连续性状态 |
| `data/packages/extensions/<id>/<version>/` | 已安装扩展发布物；版本可并存，由 active config 精确选择 |
| `engines/audio/src/glimmer_cradle/audio/resources.json` | 官方音频资源 catalog，不是用户模型目录 |

模型准备是能力 readiness 的一部分，不是第一次业务请求的副作用。模型缓存和第三方包不进入 Git；缺失时进入资源检查、下载、degraded 或失败诊断。Audio 模型与云端连接由 Audio Engine 自检并投影 provider 状态；Avatar、Native 的 Kernel 侧文件/目录资源仍走统一 resource resolver。

Extension 受管资源的 console 输出归 `data/observability/logs/application/extensions/<extension-id>/<resource-id>/`。该目录由 Host projection 暴露给 Control Center；Renderer 不通过扫描日志判断扩展是否 ready。

## Avatar 资产与投影

| 路径 | 说明 |
|---|---|
| `assets/avatar/avatar-packages/*/avatar-package.json` | Avatar Package 事实源，声明 character/model、backend、Live2D 资源、动作、行为和 presentation |
| `core/avatar/unity-host/Assets/StreamingAssets/avatar-package-registry.json` | 根据 Avatar Package 同步生成的 Unity 投影，不手改 |
| `core/avatar/unity-host/Assets/Resources/AvatarModels/` | Unity/Cubism 导入投影，不入 Git |
| `build/components/avatar/unity-host/` | UnityAvatarHost 第一方构建投影；打包时进入应用资源，不属于用户数据 |

私人模型、贴图、`.moc3`、prefab 和 SDK 导入产物不得进入提交。正式身体是否可用由 catalog、SDK、模型 driver 和首帧 ready 决定，不由文件是否存在单独决定。

## 可观测目录

| 路径 | 内容 |
|---|---|
| `data/observability/logs/application/` | 第一方应用日志和受管进程 stdout/stderr |
| `data/observability/logs/events/` | 结构化运行时事件 JSONL |
| `data/observability/traces/` | trace/span 文件或导出 |
| `data/observability/metrics/` | metrics snapshot/export |
| `data/observability/logs/audit/` | 高风险副作用审计记录 |
| `data/observability/model-invocations/records/` | 模型调用摘要记录 |
| `data/observability/model-invocations/captures/` | full 模式下受控、脱敏的完整模型输入输出 |
| `data/observability/index/` | 诊断查询索引，例如 `observability.db` |
| `data/observability/bundles/` | 诊断 bundle 导出目录 |

可观测数据不等于用户记忆。日志可以轮转和清理；记忆和经历需要显式迁移与备份。

未列出的无 owner 容器目录不属于当前契约。大对象必须由明确 owner 归入 `state/`、`models/`、`packages/` 或 `work/`；短生命周期协调信息只能进入 `run/`，短生命周期处理材料只能进入 `work/` 或操作系统临时目录。

开发态和便携部署默认使用 `data/run/`。正式 Desktop 可将 RunRoot 映射到应用用户域；Linux Personal Server 应优先映射到 `/run/glimmer-cradle/` 或 `$XDG_RUNTIME_DIR/glimmer-cradle/`。业务代码只依赖 `GLIMMER_CRADLE_RUN_ROOT`/RunRoot resolver，不硬编码具体操作系统路径。

## 迁移规则

1. 先识别不可再生状态：Cognition DB、用户导入模型、扩展状态、外观偏好、人工备份。
2. 迁移前写入 `data/backups/` 或用户指定备份位置。
3. 迁移必须把旧入口一次性转成当前 owner 的正式状态目录，完成后删除旧入口读取代码。
4. 完成后更新 resolver、ignore、Reference、Guide，并搜索旧路径。
5. 缓存可删除重建，但删除缓存不能代替状态迁移。

操作见 [数据迁移与恢复](../guides/operations/数据迁移与恢复.md)，部署映射见 [Packaging Layout Reference](./packaging-layout.md)。

Personal Server 将该备份域投影为宿主 `/var/lib/glimmer-cradle/backups/<UTC timestamp>/`。每个部署备份包含 `config.tar.gz`、`data.tar.gz`、`SHA256SUMS` 与事务元数据；`glimmer-cradle backup` 和 `restore` 是唯一受支持的宿主备份恢复入口，恢复不接受备份域外路径。

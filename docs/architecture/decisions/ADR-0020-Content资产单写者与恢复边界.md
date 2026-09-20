# ADR-0020：Content 资产单写者与恢复边界

- 状态：accepted
- 日期：2026-09-20

## Context

旧感知 `items` 只带 URI/MIME。远程 URI 会过期，本机路径不能成为跨进程或经历事实；把媒体字节直接存入 Moment 又会扩大 Ledger、破坏单一资产 owner。阶段三要保留历史读取，同时让新经历中的媒体可恢复。

## Decision

私有 `core/content` 只定义五类 `ContentPart`、不含路径的 `AssetRef` 与资产 Port。Kernel 是 `data/state/content/assets/` 唯一写者，按随机 ID 保存不可变原始字节及媒体类型、字节数、SHA-256；Cognition 通过只读适配器按 ID 复核摘要。资产 ID 只定位，不授予权限。

Extension 在 `PERCEPTION_WRITE` 下分块暂存到 `data/work/content/`，上传 token 只限所属扩展的一次感知注入。每块至多 1 MiB，单资产至多 256 MiB，暂存 30 分钟过期。`transient` 使用工作域租约，感知操作终态后释放；`experience` 和 `memory_candidate` 在投递前提交持久资产。上游 Adapter 提供远程字节；Core 不根据 URI 抓取。产品录音只在 ASR 成功后保存并注入音频引用与可信转写。

`contracts/proto/glimmer/content/v1/` 是唯一 wire source；Cognition `PerceptionContent.parts = 6` 接受新引用。Experience v5 Moment 只存引用与语义文本，v4 继续读取。旧 `items = 5` 的 URI-only 媒体只在兼容窗口当拍消费并标记不可保证恢复，不伪造引用。旧分支待阶段 9 消费方切换、阶段 14 旧样本与恢复验收后删除。已提交但未确认写入 Moment 的资产仅报告为待核查孤儿，不在未证明无引用前自动删除。`Message` owner 迁移留阶段四。

## Consequences

备份必须把 `data/state/content/assets/` 与 Cognition Experience 一起保护；只恢复 Ledger 会留下断引用，只恢复资产会留下待核查孤儿。Cognition 视觉适配器只把验证过的图片构造为临时 provider 输入；没有视频能力时明确降级，音频只消费可信语义，不交给视觉 provider。TTS cache 与 Audio Engine lease 不属于 Content 持久资产。

## Alternatives considered

- 持久保存 URI：过期或权限变化后不可恢复。
- 在 Moment 内联原始字节：扩大 Ledger 并产生第二写入策略。
- Core 自行下载远程媒体：越过上游 Adapter 的认证、限流与平台语义边界。

## Links

- Architecture：[Architecture Baseline v2.0](../blueprint/Glimmer_Cradle_Architecture_Baseline_v2.0_Frozen.md)
- Reference：[协议](../../reference/protocol.md)、[数据布局](../../reference/data-layout.md)
- 执行记录：[阶段三](../../roadmap/architecture-v2-refactor.md)

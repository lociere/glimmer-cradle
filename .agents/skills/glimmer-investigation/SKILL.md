---
name: glimmer-investigation
description: Investigate unclear Glimmer Cradle failures, cross-process races, regressions, performance or variants of a confirmed defect.
---

# 有界工程调查

从用户症状、复现输入、当前候选和预期结果开始，先找能区分根因的证据。
先查错误位置、相关 diff、真实入口与已知有效例；不因“所有 bug 都需要流程”重建整仓地图。
已知原因的直接修正可沿对应专项方法完成。

## 缩小问题

- 分开产品缺陷、测试/fixture 缺陷、旧构建、工具/平台条件和理解偏差。记录一到两个可证伪假设，
  用最小输入、可控 Clock/barrier、单条边界日志或真实回执判断；不堆 speculative fix。
- 跨进程沿同一 trace/correlation 和世代追踪接纳、派发、持久 ACK、投影与退出。
  查 [日志/Trace/DLQ 指南](../../../docs/how-to/日志、Trace与DLQ排障.md) 与 [观测 Reference](../../../docs/reference/observability.md)，
  不从端口/PID/成功返回推断业务 ready、数据提交或进程树已清空。
- 对竞态固定首次 await、取消、timeout、迟到、旧 epoch、重连与 owner 重试的时序，
  检查调用链的实际资源计数/写入/投影。fake timer 不能证明真实 Native/OS 资源已经释放。
- 已确认一处根因且需要查同类缺陷时，从能命中原例的最窄搜索逐项泛化，再追踪真实数据来源/接纳点排除误报。
  不把所有长得像的 API 当同一漏洞；没有种子缺陷时按实际请求调查，不自动开展变体扫库。

连续两次同类无效尝试后改变假设、事实源或实验范围。缺环境时完成可做的离线证据；
确需权限或产品决定才提出具体问题，不把不确定性本身作为停止理由。

## 性能与可观测性

性能先固定代表输入、数据量、候选、环境与基线，再测关键路径：模型/网络/排队/存储/渲染/资源准备分别看。
比较延迟分布、吞吐、资源占用或用户交互；单次 wall-clock 不推导稳定提升。
React 用 profile/bundle，SQLite 用真实查询/数据规模，音视频看帧/缓冲/端到端延迟，Native 看设备/句柄/GPU。
不跳过权限、校验或 readiness 来换指标。

新增观测只记录当前假设需要的字段并脱敏，限制采样/label cardinality、缓冲和 retention。
Conversation Log 是交互事实，观测日志是诊断；DLQ replay/resolve/cleanup 具有副作用，
先读 [工程 Reference](../../../docs/reference/engineering-lifecycle.md) 与实际命令边界，不自动清理失败记录。

## 形成结果

若请求包含修复，保留能使原缺陷失败的反例、在实际 owner 修正并重跑受影响链路；
调查报告则给已确认因果、证据、排除项与剩余假设。不要仅列可能原因或把测试通过写成所有环境已修复。
交付保留可复现命令、脱敏证据、候选/环境、实际成果与后续最小实验；
验证/审查使用 [共享方法](../../../docs/how-to/测试与验收.md)，长任务需要时使用 [恢复方法](../../../docs/how-to/长任务与恢复.md)。

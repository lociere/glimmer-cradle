# Cognition

适用任务：人格、情绪、记忆、经历、推理、反思、LLM provider、Cognition IPC 和认知循环。

## 判断

Cognition 负责“当前角色如何理解、记住、思考、决定和表达语义”。它不触碰平台 IO、窗口、剪贴板、扩展进程、Desktop 状态或外部平台原始 payload。

## 实施顺序

1. 从 inbound perception 追到 `CycleController`。
2. 明确 context、reasoning、memory、action、outbound 的 owner。
3. 跨 TS/Python payload 先改 Protocol。
4. 持久化改动先设计 migration、备份和失败恢复。
5. provider 改动区分密钥缺失、网络失败、模型失败、限流、超时和降级。

## 禁止项

不要恢复并行回复通路；不要让 Kernel 或 UI 解释人格语义；不要把工具结果直接写成事实；不要把缓存/摘要当原始经历。

验证：`cd core/cognition; uv run pytest -q`，并按风险补 provider mock、persistence、trace、DLQ、IPC 链路。

## 常见入口

先从 `core/cognition/src/glimmer_cradle/cognition/host/process.py`、`host/composition.py`、`cycle/controller.py`、`ports/kernel/`、`memory/`、`experience/` 定位。不要只看测试里某个 helper 就修改行为。

## 交付检查

是否同一感知只由一个主循环处理；是否区分空回复、沉默、取消、provider 失败和工具失败；是否保持 trace；是否把新记忆写入正确 repository；是否更新相关 Implementation/Reference。

## 数据与隐私

Cognition 日志和 DLQ 不记录完整 prompt、密钥或隐私大 payload。需要调试上下文时使用摘要、trace 和受控采样。写入记忆前确认这是当前角色应长期保留的语义，而不是临时工具结果或缓存。

## 何时升级架构

如果改动需要 Kernel 解释人格、需要 Renderer 推断情绪、需要 Extension 直接写记忆，说明边界错了。先回到蓝图和 Current，而不是在 Cognition 里加旁路。

涉及真实 provider、记忆写入或人格变化时，交付说明要写清未运行真实服务的原因和剩余风险。

如果修改测试 fixture，也要确认它没有把已废弃的旧认知链路重新合理化。

认知相关文档要区分理想蓝图、当前实现和候选增强，不要把未来的反思/记忆能力写成已落地事实。

涉及长期记忆的改动必须说明如何避免误写、重复写和不可恢复删除。

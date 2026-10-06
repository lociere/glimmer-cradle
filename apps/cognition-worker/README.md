# Cognition Worker

Cognition Worker 是 Python 进程装配边界：它承载 Cognition 与 Conversation 的持久 owner，
负责 Kernel RPC、启动恢复、readiness、drain 与停机，不把 App 生命周期逻辑放回 Core。

当前迁移切片已把旧 `core/cognition/.../host` 的生产 composition 与 RPC 进程入口移入本 App；
`adapters/` 已提供 capability/content/conversation/job/model/resource 的受控 mapper/client；真实 RPC 的感知、
Knowledge、Plan、Synthesis 与历史查询已调用 Cognition/Conversation mapper。感知在 operation 接纳前校验，
非法重复请求不会获得 accepted 确认。原生模型事件、幂等键、scope、revision 和 Content digest 均在边界验证。
后续切片把其余 client 接入真实 Host broker，
继续收束兼容 RPC service 的其余主体。生产 Host 已使用 `readiness.py` 的逐项业务 ready 条件和
`shutdown.py` 的有序幂等停机图；首条状态投影成功前不 ready，Shutdown ACK 后不再接纳新业务请求。

模型与云 Embedding HTTP 由 Worker 的异步 HTTPX adapter 承担；Core `ModelPort.generate`、
CloudReasoning、视觉专家、Plan/Synthesis 与 Memory 巩固均直接 await，不在线程中发网络请求。
取消传播到连接关闭，Embedding 的重试等待也可取消；错误不暴露响应正文或 URL，第三方 wire 日志
不输出请求地址。本地 sentence-transformers CPU 计算仍在线程执行，不属于网络取消链路。

```powershell
uv run --project apps/cognition-worker --extra dev pytest -q apps/cognition-worker/tests
python -m glimmer_cradle.cognition_worker --help
```

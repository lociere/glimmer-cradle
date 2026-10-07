# Cognition Worker

Cognition Worker 是 Python 进程装配边界：它承载 Cognition 与 Conversation 的持久 owner，
负责 Kernel RPC、启动恢复、readiness、drain 与停机，不把 App 生命周期逻辑放回 Core。

当前迁移切片已把旧 `core/cognition/.../host` 的生产 composition 与 RPC 进程入口移入本 App；
`adapters/` 已提供 capability/content/conversation/job/model/resource 的受控 mapper/client；真实 RPC 的感知、
Knowledge、Plan、Synthesis 与历史查询已调用 Cognition/Conversation mapper。感知在 operation 接纳前校验，
非法重复请求不会获得 accepted 确认。原生模型事件、幂等键、scope、revision 和 Content digest 均在边界验证。
ResourceClient 与 KernelGrpcClient 已消费独立 Knowledge 采集/证明复验 Service；Host 显式接纳及
双 grant 为前置，global 不伪造 Conversation，普通 Step snapshot 不获得采集权限。实际边界及
尚未接入的持久 Knowledge/Context 见
[采集实现](../../docs/architecture/implementation/Extension与SkillPlane实现.md#knowledge-显式资源采集边界)。
后续切片把其余 client 接入真实 Host broker，
继续收束兼容 RPC service 的其余主体。生产 Host 已使用 `readiness.py` 的逐项业务 ready 条件和
`shutdown.py` 的有序幂等停机图；首条状态投影成功前不 ready，Shutdown ACK 后不再接纳新业务请求。

受监督启动可显式传 `--memory-jobs-owner external`；生产 factory 不再固定创建旧巩固队列。
默认 `legacy` 仅用于尚未切换的产品入口，非法值在装配前拒绝。此参数需要重启，不是角色配置或热切换。
Worker 在建立 Conversation 单写者并连接 Memory 后、启动维护前绑定持久 dispatch：旧队列有非终态
任务时拒绝转交；external 绑定后拒绝 legacy 重启和旧队列写入。四个 Memory Jobs RPC 只在外部
装配开放。Memory schema 6 拒绝旧 v3/v4/v5 隐式升级，详见 [数据布局](../../docs/reference/data-layout.md)。
该切换窗口与旧 repository 的退出条件见 [执行记录](../../docs/roadmap/architecture-v2-refactor.md)；
生产 Host supervisor/config、旧数据迁移和队列删除门仍未完成，当前产品入口不自动切到 external。

模型与云 Embedding HTTP 由 Worker 的异步 HTTPX adapter 承担；Core `ModelPort.generate`、
CloudReasoning、视觉专家、Plan/Synthesis 与 Memory 巩固均直接 await，不在线程中发网络请求。
取消传播到连接关闭，Embedding 的重试等待也可取消；错误不暴露响应正文或 URL，第三方 wire 日志
不输出请求地址。本地 sentence-transformers CPU 计算仍在线程执行，不属于网络取消链路。

```powershell
uv run --project apps/cognition-worker --extra dev pytest -q apps/cognition-worker/tests
python -m glimmer_cradle.cognition_worker --help
```

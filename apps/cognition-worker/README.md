# Cognition Worker

Cognition Worker 是 Python 进程装配边界：它承载 Cognition 与 Conversation 的持久 owner，
负责 Kernel RPC、启动恢复、readiness、drain 与停机，不把 App 生命周期逻辑放回 Core。

当前迁移切片已把旧 `core/cognition/.../host` 的生产 composition 与 RPC 进程入口移入本 App；
`adapters/` 已提供 capability/content/conversation/job/model/resource 的受控 mapper/client，原生模型事件、
幂等键、scope、revision 和 Content digest 均在边界验证。后续切片把这些 client 接入真实 Host broker，
并继续从兼容 RPC service 收束 readiness/shutdown 主体。

```powershell
uv run --project apps/cognition-worker --extra dev pytest -q apps/cognition-worker/tests
python -m glimmer_cradle.cognition_worker --help
```

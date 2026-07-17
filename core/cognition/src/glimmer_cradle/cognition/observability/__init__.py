"""
可观测性层（Observability）—— 遥测三支柱统一门面。

支柱：
- ① Logs：``logger.py``（structlog）
- ② Metrics：``metrics.py``（事件流 → ``data/observability/metrics/*.jsonl``）
- ③ Traces：``tracer.py``（span ctxmgr → ``data/observability/traces/*.jsonl``）

trace 上下文（boot / trace / span 三层，蓝图 §6.2）：``trace_context.py``。

推荐入口：``from glimmer_cradle.cognition.observability import telemetry``，再调
``telemetry.span / telemetry.counter / telemetry.get_logger`` 等。
"""
from glimmer_cradle.cognition.observability import telemetry

__all__ = ["telemetry"]

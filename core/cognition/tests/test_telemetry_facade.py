"""Telemetry Facade 门面测试 —— 阶段 3.5。

仅验证「一个 import 就够」语义；底层行为各自由 test_metrics / test_tracer 覆盖。
"""
import json
from pathlib import Path

from glimmer_cradle.cognition.observability import telemetry
from glimmer_cradle.cognition.observability import trace_context as tc


def test_facade_reexports_log_metric_span() -> None:
    """门面应同时提供 log/metric/span 三支柱入口。"""
    assert callable(telemetry.get_logger)
    assert callable(telemetry.counter)
    assert callable(telemetry.gauge)
    assert callable(telemetry.histogram)
    assert callable(telemetry.span)
    assert callable(telemetry.with_remote_parent_span)
    # trace 上下文
    assert callable(telemetry.set_boot_id)
    assert callable(telemetry.new_boot_id)
    assert callable(telemetry.TraceContext)


def test_facade_logger_returns_usable_logger() -> None:
    log = telemetry.get_logger("facade-test")
    # 不抛即视为通过；structlog 内部已被全局初始化
    log.info("门面 logger OK", extra="ok")


async def test_facade_span_and_metric_e2e(tmp_path: Path) -> None:
    """走门面入口：start_metrics / start_tracer → 调用 → 落盘文件。"""
    tc._boot_id = None
    metrics_dir = tmp_path / "metrics"
    traces_dir = tmp_path / "traces"
    telemetry.set_boot_id(telemetry.new_boot_id())
    await telemetry.start_metrics(metrics_dir, proc="facade")
    await telemetry.start_tracer(traces_dir, proc="facade")
    try:
        with telemetry.TraceContext("trace-facade"):
            with telemetry.span("facade.op", attributes={"k": "v"}):
                telemetry.counter("facade.calls", 1)
                telemetry.gauge("facade.gauge", 0.5)
                telemetry.histogram("facade.hist", 12.3)
        await telemetry.stop_metrics()
        await telemetry.stop_tracer()
    finally:
        await telemetry.stop_metrics()
        await telemetry.stop_tracer()
        tc._boot_id = None

    metrics_file = metrics_dir / "facade.jsonl"
    spans_file = traces_dir / "facade.jsonl"
    assert metrics_file.exists()
    assert spans_file.exists()
    metric_lines = [json.loads(s) for s in metrics_file.read_text(encoding="utf-8").splitlines() if s.strip()]
    span_lines = [json.loads(s) for s in spans_file.read_text(encoding="utf-8").splitlines() if s.strip()]
    assert {m["name"] for m in metric_lines} == {"facade.calls", "facade.gauge", "facade.hist"}
    assert any(s["name"] == "facade.op" and s["trace_id"] == "trace-facade" for s in span_lines)

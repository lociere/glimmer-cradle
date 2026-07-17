"""metrics 支柱测试（阶段 3.3）—— 写入器、事件流、trace 标注、未启动兜底。"""
import json
from pathlib import Path

from glimmer_cradle.cognition.observability import metrics
from glimmer_cradle.cognition.observability import trace_context as tc


def test_metric_noop_when_not_started() -> None:
    """未启动时 metric() 为无操作，不抛异常。"""
    metrics.gauge("never.started", 1.0)
    metrics.counter("never.started.count")


async def test_metrics_written_to_jsonl(tmp_path: Path) -> None:
    await metrics.start_metrics(tmp_path, proc="test")
    try:
        metrics.counter("calls", 1)
        metrics.gauge("emotion.intensity", 0.7, labels={"emotion": "happy"})
        metrics.histogram("chat.duration_ms", 123.4)
        await metrics.stop_metrics()  # 落盘
    finally:
        await metrics.stop_metrics()  # 幂等

    path = tmp_path / "test.jsonl"
    assert path.exists()
    lines = [json.loads(s) for s in path.read_text(encoding="utf-8").splitlines() if s.strip()]
    assert len(lines) == 3
    by_name = {ln["name"]: ln for ln in lines}
    assert by_name["calls"]["kind"] == "counter"
    assert by_name["emotion.intensity"]["kind"] == "gauge"
    assert by_name["emotion.intensity"]["labels"] == {"emotion": "happy"}
    assert by_name["chat.duration_ms"]["kind"] == "histogram"
    assert by_name["chat.duration_ms"]["value"] == 123.4


async def test_metric_carries_trace_context(tmp_path: Path) -> None:
    tc.set_boot_id("boot-m")
    await metrics.start_metrics(tmp_path, proc="t2")
    try:
        with tc.TraceContext("trace-m"):
            metrics.gauge("g", 1.0)
        await metrics.stop_metrics()
    finally:
        await metrics.stop_metrics()
        tc._boot_id = None

    line = json.loads((tmp_path / "t2.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert line["trace_id"] == "trace-m"
    assert line["boot_id"] == "boot-m"
    # session_id / epoch_id 已彻底从遥测层退出（阶段 3.6 重构）
    assert "session_id" not in line
    assert "epoch_id" not in line


def test_metric_label_sanitization_drops_high_cardinality_keys() -> None:
    labels = metrics.sanitize_metric_labels("reasoning.request", {
        "tier": "cloud_allowed",
        "trace_id": "trace-1",
        "prompt_hash": "hash-1",
    })
    assert labels == {"tier": "cloud_allowed"}

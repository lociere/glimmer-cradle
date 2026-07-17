"""tracer (span 支柱) 测试 —— 阶段 3.4。"""
import json
from pathlib import Path

from glimmer_cradle.cognition.observability import tracer
from glimmer_cradle.cognition.observability import trace_context as tc


def _reset() -> None:
    tc._boot_id = None
    tc._synthetic_counters.clear()
    tc._boot_synthetic_counter = 0
    tc._span_id_var.set(None)
    tc._trace_id_var.set(None)


def test_span_noop_when_not_started() -> None:
    """未启动 tracer 时 span() 仍可用，仅缓冲被丢弃。"""
    _reset()
    with tracer.span("nothing"):
        pass


async def test_span_writes_jsonl_with_attributes(tmp_path: Path) -> None:
    _reset()
    tc.set_boot_id("boot-x")
    await tracer.start_tracer(tmp_path, proc="t")
    try:
        with tc.TraceContext("trace-1"):
            with tracer.span("op", attributes={"k": "v"}) as s:
                s.set_attribute("extra", 42)
        await tracer.stop_tracer()
    finally:
        await tracer.stop_tracer()
        tc._boot_id = None

    line = json.loads((tmp_path / "t.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert line["name"] == "op"
    assert line["trace_id"] == "trace-1"
    assert line["status"] == "ok"
    assert line["parent_span_id"] is None
    assert line["boot_id"] == "boot-x"
    assert line["attributes"] == {"k": "v", "extra": 42}
    assert line["duration_ms"] >= 0


async def test_span_nesting_records_parent(tmp_path: Path) -> None:
    _reset()
    await tracer.start_tracer(tmp_path, proc="nest")
    try:
        with tc.TraceContext("tr"):
            with tracer.span("outer") as outer:
                with tracer.span("inner") as inner:
                    pass
                outer_id = outer.span_id
                inner_id = inner.span_id
        await tracer.stop_tracer()
    finally:
        await tracer.stop_tracer()

    lines = [
        json.loads(s)
        for s in (tmp_path / "nest.jsonl").read_text(encoding="utf-8").splitlines()
        if s.strip()
    ]
    by_name = {ln["name"]: ln for ln in lines}
    # 子 span 的 parent 应指向 outer
    assert by_name["inner"]["parent_span_id"] == outer_id
    assert by_name["outer"]["parent_span_id"] is None
    assert by_name["inner"]["span_id"] == inner_id


async def test_span_marks_error_on_exception(tmp_path: Path) -> None:
    _reset()
    await tracer.start_tracer(tmp_path, proc="err")
    try:
        with tc.TraceContext("tr"):
            try:
                with tracer.span("boom"):
                    raise ValueError("explode")
            except ValueError:
                pass
        await tracer.stop_tracer()
    finally:
        await tracer.stop_tracer()

    line = json.loads((tmp_path / "err.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert line["status"] == "error"
    assert line["error"] == "ValueError"


async def test_remote_parent_span_attaches(tmp_path: Path) -> None:
    """IPC 入站：with_remote_parent_span 把信封里的 trace+span 建为父。"""
    _reset()
    await tracer.start_tracer(tmp_path, proc="remote")
    try:
        with tracer.with_remote_parent_span("remote-trace", "remote-span"):
            with tracer.span("child"):
                pass
        await tracer.stop_tracer()
    finally:
        await tracer.stop_tracer()

    line = json.loads((tmp_path / "remote.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert line["trace_id"] == "remote-trace"
    assert line["parent_span_id"] == "remote-span"


def test_span_restores_context_after_exit() -> None:
    """span 退出后 contextvar 必须还原（含异常路径）。"""
    _reset()
    assert tc.get_current_span_id() is None
    with tc.TraceContext("tr"):
        with tracer.span("outer"):
            assert tc.get_current_span_id() is not None
        # outer 退出后 span_id 应还原为 None（外层没有 span）
        assert tc.get_current_span_id() is None

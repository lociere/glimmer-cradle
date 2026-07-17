"""trace 上下文处理器测试（阶段 3.6 重构后：boot/trace/span 三层）。"""
from glimmer_cradle.cognition.observability import trace_context as tc


def _reset() -> None:
    """清空 trace 上下文模块级状态，隔离各用例。"""
    tc._boot_id = None
    tc._synthetic_counters.clear()
    tc._boot_synthetic_counter = 0
    tc._span_id_var.set(None)
    tc._trace_id_var.set(None)


def test_injects_three_layers() -> None:
    _reset()
    tc.set_boot_id("boot-1")
    tc.set_current_span_id("span-1")
    with tc.TraceContext("trace-1"):
        ev = tc.trace_context_processor(None, "info", {"event": "hi"})
    assert ev["boot_id"] == "boot-1"
    assert ev["trace_id"] == "trace-1"
    assert ev["span_id"] == "span-1"
    # epoch_id / session_id 已彻底退出 telemetry 层（蓝图 §6.2 重构）
    assert "epoch_id" not in ev
    assert "session_id" not in ev


def test_span_omitted_when_absent() -> None:
    _reset()
    tc.set_boot_id("b")
    with tc.TraceContext("t"):
        ev = tc.trace_context_processor(None, "info", {"event": "x"})
    assert "span_id" not in ev


def test_run_synthetic_when_boot_set() -> None:
    """boot 已确立、无上游 trace_id → 合成 run-{boot}-{n}。"""
    _reset()
    tc.set_boot_id("bootABC")
    ev1 = tc.trace_context_processor(None, "info", {"event": "x", "module": "app-root"})
    ev2 = tc.trace_context_processor(None, "info", {"event": "y", "module": "mem"})
    assert ev1["trace_id"] == "run-bootABC-1"
    assert ev2["trace_id"] == "run-bootABC-2"


def test_synthetic_module_when_no_boot() -> None:
    """boot 尚未确立 → 退回 synthetic-{module}-{n}。"""
    _reset()
    ev = tc.trace_context_processor(None, "info", {"event": "x", "module": "app-root"})
    assert ev["trace_id"] == "synthetic-app-root-1"


def test_explicit_trace_id_kept() -> None:
    """调用方显式传入的 trace_id 不被覆盖。"""
    _reset()
    tc.set_boot_id("b")
    with tc.TraceContext("ctx"):
        ev = tc.trace_context_processor(None, "info", {"event": "x", "trace_id": "explicit"})
    assert ev["trace_id"] == "explicit"

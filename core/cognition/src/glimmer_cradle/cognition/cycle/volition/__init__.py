"""
意志层（Volition）。

把"意识广播"翻译成"行动意愿"，再经仲裁选出本拍的胜出意图。

- ``willingness.py``  连续意愿值计算（蓝图 §4.7 加权公式）
- ``arbiter.py``      多意图仲裁（阈值 + proactive 闸 + 去重）

输出由 Protocol 生成的 Intent，并在 CycleController 中进入仲裁与 ActionEmitter。
"""
import uuid
from datetime import datetime, timezone

from glimmer_cradle.cognition.cycle.volition.willingness import (
    WillingnessConfig,
    WillingnessInputs,
    compute_willingness,
    threshold_for,
)
from glimmer_cradle.cognition.cycle.volition.arbiter import ArbitrationResult, arbitrate
from glimmer_cradle.cognition.protocol.generated.models.intent import Intent


def make_intent(
    *,
    type: str,
    initiative: str,
    willingness: float,
    payload: dict | None = None,
    causation_ids: list[str] | None = None,
) -> Intent:
    """构造 Intent —— 自动填 intent_id 与 created_at。"""
    created_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds") \
        .replace("+00:00", "Z")
    return Intent(
        intent_id=uuid.uuid4().hex,
        type=type,  # type: ignore[arg-type]
        initiative=initiative,  # type: ignore[arg-type]
        willingness=max(0.0, min(1.0, float(willingness))),
        payload=payload or {},
        causation_ids=list(causation_ids or []),
        created_at=created_at,
    )


__all__ = [
    "WillingnessConfig",
    "WillingnessInputs",
    "compute_willingness",
    "threshold_for",
    "ArbitrationResult",
    "arbitrate",
    "Intent",
    "make_intent",
]

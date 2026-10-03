"""待竞争的注意候选及确定性排序。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from glimmer_cradle.cognition.ports.clock_port import ClockPort
from glimmer_cradle.cognition.ports import IdGeneratorPort


class AttentionSource(StrEnum):
    PERCEPTION = "perception"
    AFFECT = "affect"
    MEMORY = "memory"
    DRIVE = "drive"
    SOCIAL = "social"


@dataclass(slots=True)
class Attention:
    attention_id: str
    source: AttentionSource
    content: dict[str, Any]
    salience: float
    created_at: str
    decay_at: str | None = None

    def __post_init__(self) -> None:
        self.source = AttentionSource(self.source)
        self.salience = max(0.0, min(1.0, float(self.salience)))


def now_iso_ms(clock: ClockPort) -> str:
    return clock.now_iso()


def make_attention(
    *,
    source: str,
    content: dict[str, Any],
    salience: float,
    decay_at: str | None = None,
    clock: ClockPort,
    ids: IdGeneratorPort,
) -> Attention:
    return Attention(
        attention_id=ids.new(),
        source=AttentionSource(source),
        content=content,
        salience=salience,
        created_at=now_iso_ms(clock),
        decay_at=decay_at,
    )


def parse_iso(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def is_expired(attention: Attention, now: datetime) -> bool:
    if not attention.decay_at:
        return False
    try:
        return parse_iso(attention.decay_at) <= now
    except (ValueError, TypeError):
        return False


def attention_rank(attention: Attention) -> tuple[float, int, float]:
    """显著度优先；同分时 direct 互动义务压过长驻内部 drive。"""

    if attention.source == AttentionSource.PERCEPTION:
        priority = 100 if attention.content.get("address_mode") == "direct" else 80
    else:
        priority = {
            AttentionSource.AFFECT: 70,
            AttentionSource.MEMORY: 60,
            AttentionSource.SOCIAL: 60,
            AttentionSource.DRIVE: 40,
        }.get(attention.source, 0)
    try:
        freshness = parse_iso(attention.created_at).timestamp() * 1000.0
    except (ValueError, TypeError, AttributeError):
        freshness = 0.0
    return (attention.salience, priority, freshness)

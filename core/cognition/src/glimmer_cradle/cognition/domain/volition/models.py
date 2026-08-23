"""意图领域模型。"""

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class IntentType(StrEnum):
    REPLY = "reply"
    SILENCE = "silence"
    THOUGHT = "thought"
    EMOTION = "emotion"
    ACTION = "action"


class Initiative(StrEnum):
    REACTIVE = "reactive"
    PROACTIVE = "proactive"


@dataclass(frozen=True, slots=True)
class Intent:
    intent_id: str
    type: IntentType
    initiative: Initiative
    willingness: float
    payload: dict[str, Any] | None = None
    causation_ids: list[str] = field(default_factory=list)
    created_at: str = ""

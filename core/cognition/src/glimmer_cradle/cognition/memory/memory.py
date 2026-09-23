"""长期记忆的类型与版本化记录。"""

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class MemoryKind(StrEnum):
    EPISODIC = "episodic"
    SEMANTIC = "semantic"
    SOCIAL = "social"
    AUTOBIOGRAPHICAL = "autobiographical"
    PROSPECTIVE = "prospective"
    PROCEDURAL = "procedural"


@dataclass(frozen=True, slots=True)
class MemoryRecord:
    memory_id: str
    revision_id: str
    kind: MemoryKind
    status: str
    content: str
    summary: str
    actor_id: str | None
    scene_id: str | None
    conversation_id: str | None
    continuity_id: str | None
    recall_scope: str
    disclosure_scope: str
    confidence: float
    salience: float
    valid_from: str
    updated_at: str
    attributes: dict[str, Any] = field(default_factory=dict)

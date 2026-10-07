"""进入 Cognition 前已映射为领域语义的 Observation。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Mapping

AddressMode = Literal["direct", "ambient"]
ResponsePolicy = Literal["reply_allowed", "observe_only"]
RetentionCeiling = Literal["transient", "experience", "memory_candidate"]


@dataclass(frozen=True, slots=True)
class Observation:
    scene_id: str
    conversation_id: str
    continuity_id: str
    thread_id: str
    recall_scope: str
    disclosure_scope: str
    address_mode: AddressMode
    familiarity: int
    text: str
    response_policy: ResponsePolicy = "reply_allowed"
    trace_id: str = ""
    actor_id: str | None = None
    actor_name: str | None = None
    model_input: Mapping[str, Any] | None = None
    origin: Mapping[str, Any] | None = None
    retention_ceiling: RetentionCeiling = "experience"
    interaction_id: str = ""
    payload_digest: str = ""
    source_provider_id: str = ""

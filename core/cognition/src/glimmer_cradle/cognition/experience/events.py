"""Experience Ledger 的不可变 Moment 领域模型。"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

SCHEMA_VERSION = 4


class MomentKind(str, Enum):
    PERCEPTION = "perception"
    EMOTION = "emotion"
    REPLY = "reply"
    ACTION = "action"
    ACTION_RESULT = "action_result"
    SILENCE = "silence"


def now_iso_ms() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class AffectSnapshot:
    valence: float
    arousal: float
    label: str = ""


@dataclass(frozen=True)
class SourceDescriptor:
    """一个事实如何进入 Cognition；Extension 只能提出证据，不能写记忆。"""

    provider_kind: str = "core"
    provider_id: str = "cognition"
    provider_version: str | None = None
    contribution_id: str | None = None
    source_event_id: str = ""
    schema_ref: str = "glimmer://cognition/moment/v4"
    content_hash: str | None = None
    trust_tier: str = "host_verified"
    privacy_class: str = "private"
    cognitive_effect: str = "observation"


@dataclass(frozen=True)
class Moment:
    seq: int
    moment_id: str
    occurred_at: str
    kind: str
    content: dict
    causation_ids: tuple[str, ...] = ()
    scene_id: str | None = None
    conversation_id: str = ""
    continuity_id: str = ""
    thread_id: str = "main"
    interaction_id: str = ""
    actor_id: str | None = None
    actor_name: str | None = None
    origin: SourceDescriptor = SourceDescriptor()
    retention_ceiling: str = "experience"
    recall_scope: str = "conversation_private"
    disclosure_scope: str = "conversation_private"
    affect: AffectSnapshot | None = None
    importance: float = 0.5
    trace_id: str = ""
    schema_version: int = SCHEMA_VERSION

    @staticmethod
    def create(
        seq: int,
        *,
        kind: MomentKind | str,
        content: dict,
        causation_ids: tuple[str, ...] | list[str] = (),
        scene_id: str | None = None,
        conversation_id: str = "",
        continuity_id: str = "",
        thread_id: str = "main",
        interaction_id: str = "",
        actor_id: str | None = None,
        actor_name: str | None = None,
        origin: SourceDescriptor | None = None,
        retention_ceiling: str = "experience",
        recall_scope: str = "conversation_private",
        disclosure_scope: str = "conversation_private",
        affect: AffectSnapshot | None = None,
        importance: float = 0.5,
        trace_id: str = "",
    ) -> "Moment":
        event_id = uuid.uuid4().hex
        try:
            kind_value = kind.value if isinstance(kind, MomentKind) else MomentKind(str(kind)).value
        except ValueError as error:
            raise ValueError(f"不支持的 Experience Moment kind: {kind}") from error
        return Moment(
            seq=seq,
            moment_id=event_id,
            occurred_at=now_iso_ms(),
            kind=kind_value,
            content=content,
            causation_ids=tuple(causation_ids),
            scene_id=scene_id,
            conversation_id=conversation_id or scene_id or "",
            continuity_id=continuity_id or actor_id or conversation_id or scene_id or "",
            thread_id=thread_id or "main",
            interaction_id=interaction_id or trace_id or event_id,
            actor_id=actor_id,
            actor_name=actor_name,
            origin=origin or SourceDescriptor(source_event_id=event_id),
            retention_ceiling=retention_ceiling,
            recall_scope=recall_scope,
            disclosure_scope=disclosure_scope,
            affect=affect,
            importance=max(0.0, min(1.0, importance)),
            trace_id=trace_id,
        )

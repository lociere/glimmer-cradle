"""从 Experience Moment 派生的 Episode 领域投影。"""

from __future__ import annotations

from dataclasses import dataclass

from glimmer_cradle.cognition.domain.experience.events import Moment


@dataclass(frozen=True, slots=True)
class Episode:
    episode_id: str
    version: int
    interaction_id: str
    scene_id: str
    conversation_id: str
    recall_scope: str
    disclosure_scope: str
    actor_id: str | None
    first_position: int
    last_position: int
    started_at: str
    ended_at: str
    boundary_reason: str
    salience: float
    moments: tuple[Moment, ...]

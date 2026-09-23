"""Cognition-owned semantic goal definitions."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Goal:
    """A normalized goal considered by the cognition planning boundary."""

    text: str
    scene_id: str = ""
    trace_id: str = ""

    @classmethod
    def normalize(cls, text: str, *, scene_id: str = "", trace_id: str = "") -> "Goal":
        return cls(text=text.strip(), scene_id=scene_id, trace_id=trace_id)

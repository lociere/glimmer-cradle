"""Knowledge source and entry models."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from glimmer_cradle.cognition.knowledge.transformation import content_digest
from pydantic import BaseModel, ConfigDict, Field


class KnowledgeSourceRecord(BaseModel):
    """进入 Knowledge owner 前的可审计来源记录。"""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    entry_id: str = Field(min_length=1)
    content: str = Field(min_length=1)
    priority: int = Field(ge=1)
    enabled: bool
    source: str = Field(min_length=1)
    revision: int = Field(ge=1)
    attributes: dict[str, Any] = Field(default_factory=dict)


@dataclass(slots=True)
class KnowledgeEntry:
    entry_id: str
    content: str
    priority: int = 1
    enabled: bool = True
    revision: int = 1
    source: str = "config"
    attributes: dict[str, Any] = field(default_factory=dict)
    content_digest: str = ""
    _embedding: np.ndarray | None = field(default=None, repr=False, compare=False)

    def __post_init__(self) -> None:
        actual_digest = content_digest(self.content)
        if self.content_digest and self.content_digest != actual_digest:
            raise ValueError("Knowledge 正文与摘要冲突")
        self.content_digest = actual_digest

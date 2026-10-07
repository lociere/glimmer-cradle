"""Knowledge source and entry models."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from glimmer_cradle.cognition.knowledge.transformation import content_digest
from glimmer_cradle.cognition.ports.resource_port import ResourceScope, ResourceSnapshot
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


@dataclass(frozen=True, slots=True)
class KnowledgeResourceSource:
    """明确登记的采集意图；它本身不是读取或长期保存授权。"""

    source_id: str
    resource_id: str
    definition_revision: str
    scope: ResourceScope
    priority: int = 1

    def __post_init__(self) -> None:
        for value in (self.source_id, self.resource_id, self.definition_revision):
            if not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > 4096:
                raise ValueError("Knowledge resource identity invalid")
        if not isinstance(self.scope, ResourceScope):
            raise ValueError("Knowledge resource scope invalid")
        values = (self.scope.source_provider_id, self.scope.scene_id, self.scope.conversation_id)
        if not all(value is None for value in values) and any(
            not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > 4096
            for value in values
        ):
            raise ValueError("Knowledge resource scope incomplete")
        if type(self.priority) is not int or not 1 <= self.priority <= 2**53 - 1:
            raise ValueError("Knowledge resource priority invalid")

    @property
    def entry_id(self) -> str:
        return f"resource:{self.source_id}"


@dataclass(frozen=True, slots=True)
class KnowledgeResourceCapture:
    """原始材料与实际转换版本；有效性必须由 live ResourcePort 判定。"""

    source: KnowledgeResourceSource
    snapshot: ResourceSnapshot
    content: str
    parser_version: str
    chunk_version: str


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

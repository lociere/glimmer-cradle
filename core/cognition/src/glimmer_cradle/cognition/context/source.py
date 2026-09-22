"""Context 候选、查询与来源边界。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Literal

ContextTrustTier = Literal["untrusted", "user_asserted", "host_verified", "authoritative"]
InstructionAuthority = Literal["data", "user", "system"]


@dataclass(frozen=True)
class ContextQuery:
    text: str
    scene_id: str | None = None
    conversation_id: str | None = None
    actor_id: str | None = None
    recall_scope: str = "global_safe"
    emotion_hint: str = ""
    focus_summary: str = ""

    @property
    def allowed_scopes(self) -> set[str]:
        return allowed_recall_scopes(self.recall_scope)


def allowed_recall_scopes(recall_scope: str) -> set[str]:
    common = {"global_safe", "public"}
    if recall_scope == "character_internal":
        return common | {"character_internal"}
    if recall_scope == "conversation_private":
        return common | {"conversation_private", "actor_private"}
    if recall_scope in {"actor_private", "space_local"}:
        return common | {recall_scope}
    return {"public"} if recall_scope == "public" else common


@dataclass(frozen=True)
class ContextItem:
    source: str
    content: str
    relevance: float
    recency: float = 0.5
    importance: float = 0.5
    token_estimate: int = 0
    trust_tier: ContextTrustTier = "untrusted"
    instruction_authority: InstructionAuthority = "data"
    metadata: dict[str, Any] = field(default_factory=dict)

    def score(
        self,
        *,
        w_recency: float = 0.2,
        w_importance: float = 0.3,
        w_relevance: float = 0.5,
    ) -> float:
        return (
            w_relevance * float(self.relevance)
            + w_importance * float(self.importance)
            + w_recency * float(self.recency)
        )


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 3)


class ContextSource(ABC):
    name: str = ""

    @abstractmethod
    async def activate(
        self, query: ContextQuery, *, max_items: int = 10
    ) -> list[ContextItem]: ...

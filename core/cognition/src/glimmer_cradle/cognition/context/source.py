"""Context 候选、查询与来源边界。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Protocol

from glimmer_cradle.conversation import ConversationRecorder, Moment, MomentKind
from glimmer_cradle.cognition.knowledge import KnowledgeIndex
from glimmer_cradle.cognition.memory import MemoryController, RelationshipRecord
from glimmer_cradle.cognition.ports.clock_port import ClockPort

ContextTrustTier = Literal["untrusted", "user_asserted", "host_verified", "authoritative"]
InstructionAuthority = Literal["data", "user", "system"]


class RelationshipReader(Protocol):
    """Context 消费关系投影所需的最小只读边界。"""

    async def get(self, actor_id: str) -> RelationshipRecord | None: ...


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


class EpisodicMemorySource(ContextSource):
    name = "episodic"

    def __init__(self, memory: MemoryController, *, clock: ClockPort) -> None:
        self._memory = memory
        self._clock = clock

    async def activate(self, query: ContextQuery, *, max_items: int = 10) -> list[ContextItem]:
        try:
            results = await self._memory.retrieve(
                query.text,
                actor_id=query.actor_id,
                scene_id=query.scene_id,
                conversation_id=query.conversation_id,
                allowed_scopes=query.allowed_scopes,
                limit=max_items,
            )
        except Exception:
            return []

        query_tokens = _context_tokens(query.text)
        now = self._clock.now()
        items: list[ContextItem] = []
        for mem in results:
            content = f"记忆：{mem.content}"
            memory_tokens = _context_tokens(f"{mem.summary} {mem.content}")
            relevance = (
                len(query_tokens & memory_tokens) / max(1, len(query_tokens))
                if query_tokens else 0.5
            )
            items.append(ContextItem(
                source=self.name,
                content=content,
                relevance=max(0.0, min(1.0, relevance)),
                recency=_iso_recency(mem.updated_at, now=now),
                importance=min(1.0, float(mem.salience)),
                token_estimate=estimate_tokens(content),
                trust_tier="host_verified",
                metadata={"memory_id": getattr(mem, "memory_id", "")},
            ))
        return items


class RecentExperienceSource(ContextSource):
    """近期经历源。只读取已经提交到 Conversation Log 的 Moment。"""

    name = "experience"

    def __init__(self, recorder: ConversationRecorder) -> None:
        self._recorder = recorder

    async def activate(self, query: ContextQuery, *, max_items: int = 10) -> list[ContextItem]:
        return self.items(
            query.text,
            scene_id=query.scene_id,
            conversation_id=query.conversation_id,
            actor_id=query.actor_id,
            allowed_scopes=query.allowed_scopes,
            max_items=max_items,
        )

    def digest(
        self, query: str, *, scene_id: str | None, conversation_id: str | None,
        actor_id: str | None, allowed_scopes: set[str],
        current_trace_id: str = "", max_items: int = 6,
    ) -> str:
        return "\n".join(
            item.content for item in self.items(
                query, scene_id=scene_id, conversation_id=conversation_id,
                actor_id=actor_id, allowed_scopes=allowed_scopes,
                current_trace_id=current_trace_id, max_items=max_items,
            )
        )

    def items(
        self, query: str, *, scene_id: str | None = None,
        conversation_id: str | None = None, actor_id: str | None = None,
        allowed_scopes: set[str] | None = None,
        current_trace_id: str = "", max_items: int = 6,
    ) -> list[ContextItem]:
        moments = self._recorder.recent_moments(
            limit=80,
            kinds={
                MomentKind.PERCEPTION.value,
                MomentKind.REPLY.value,
                MomentKind.SILENCE.value,
                MomentKind.ACTION_RESULT.value,
            },
            exclude_trace_id=current_trace_id or None,
        )
        if not moments:
            return []

        scored: list[tuple[float, float, float, Moment]] = []
        query_tokens = _context_tokens(query)
        for index, moment in enumerate(moments):
            if allowed_scopes is not None and not _moment_visible(
                moment, scene_id=scene_id, conversation_id=conversation_id,
                actor_id=actor_id, allowed_scopes=allowed_scopes,
            ):
                continue
            text = _moment_text(moment)
            if not text:
                continue
            scene_id = moment.scene_id or ""
            text_tokens = _context_tokens(f"{scene_id} {text}")
            overlap = len(query_tokens & text_tokens) if query_tokens else 0
            recency = (index + 1) / max(1, len(moments))
            importance = max(0.0, min(1.0, float(moment.importance)))
            relevance = min(1.0, overlap * 0.25 + 0.2)
            score = overlap * 0.45 + recency * 0.25 + importance * 0.2
            if score > 0.2:
                scored.append((score, relevance, recency, moment))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        selected = [item[1:] for item in scored[:max_items]]
        selected.sort(key=lambda item: item[2].seq)

        items: list[ContextItem] = []
        for relevance, recency, moment in selected:
            content = _format_experience_line(moment)
            items.append(ContextItem(
                source=self.name,
                content=content,
                relevance=relevance,
                recency=recency,
                importance=max(0.0, min(1.0, float(moment.importance))),
                token_estimate=estimate_tokens(content),
                trust_tier="host_verified",
                metadata={
                    "moment_id": moment.moment_id,
                    "scene_id": moment.scene_id,
                    "trace_id": moment.trace_id,
                    "kind": moment.kind,
                },
            ))
        return items


def _moment_visible(
    moment: Moment, *, scene_id: str | None, conversation_id: str | None,
    actor_id: str | None, allowed_scopes: set[str],
) -> bool:
    if moment.recall_scope not in allowed_scopes:
        return False
    if moment.recall_scope == "conversation_private":
        return bool(conversation_id) and moment.conversation_id == conversation_id
    if moment.recall_scope == "actor_private":
        return bool(actor_id) and moment.actor_id == actor_id
    if moment.recall_scope == "space_local":
        return bool(scene_id) and moment.scene_id == scene_id
    return True


def _context_tokens(text: str) -> set[str]:
    raw = "".join(ch.lower() if ch.isalnum() or "\u4e00" <= ch <= "\u9fff" else " "
                  for ch in text or "")
    parts = [part for part in raw.split() if part]
    tokens = set(parts)
    for part in parts:
        if any("\u4e00" <= ch <= "\u9fff" for ch in part):
            chars = [ch for ch in part if "\u4e00" <= ch <= "\u9fff"]
            tokens.update(chars)
            tokens.update(chars[i] + chars[i + 1] for i in range(len(chars) - 1))
    return tokens


def _iso_recency(value: str, *, now: datetime) -> float:
    """把 ISO 时间映射为按日平滑衰减的 [0,1] 近时度。"""
    try:
        occurred_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if occurred_at.tzinfo is None:
            occurred_at = occurred_at.replace(tzinfo=timezone.utc)
    except (AttributeError, TypeError, ValueError):
        return 0.0
    age_days = max(0.0, (now - occurred_at).total_seconds()) / 86400
    return 1 / (1 + age_days)


def _moment_text(moment: Moment) -> str:
    content = moment.content if isinstance(moment.content, dict) else {}
    text = content.get("text")
    if isinstance(text, str) and text.strip():
        return text.strip()
    if moment.kind == MomentKind.SILENCE.value:
        if content.get("reason") == "observe_only":
            return ""
        return "当前角色选择沉默或没有回复。"
    if moment.kind == MomentKind.ACTION_RESULT.value:
        return str(content.get("summary") or "外部能力返回了结果").strip()
    return ""


def _format_experience_line(moment: Moment) -> str:
    kind_label = {
        MomentKind.PERCEPTION.value: "感知",
        MomentKind.REPLY.value: "回复",
        MomentKind.SILENCE.value: "沉默",
        MomentKind.ACTION_RESULT.value: "行动结果",
    }.get(moment.kind, moment.kind)
    scene_id = moment.scene_id or "unknown-scene"
    text = _moment_text(moment)
    speaker = _moment_speaker(moment)
    if speaker and moment.kind == MomentKind.PERCEPTION.value and speaker not in text:
        text = f"{speaker}: {text}"
    return f"经历：[source=experience] [{moment.occurred_at}] [{scene_id}] {kind_label}：{text}"


def _moment_speaker(moment: Moment) -> str:
    content = moment.content if isinstance(moment.content, dict) else {}
    actor_name = moment.actor_name or content.get("actor_name")
    if isinstance(actor_name, str) and actor_name.strip():
        return actor_name.strip()
    actor_id = moment.actor_id or content.get("actor_id")
    if isinstance(actor_id, str) and actor_id.strip():
        return actor_id.strip()
    return ""


class KnowledgeSource(ContextSource):
    name = "knowledge"

    def __init__(self, knowledge_base: KnowledgeIndex) -> None:
        self._kb = knowledge_base

    async def activate(self, query: ContextQuery, *, max_items: int = 10) -> list[ContextItem]:
        try:
            entries = await self._kb.get_knowledge(query=query.text)
        except Exception:
            return []

        items: list[ContextItem] = []
        for entry in entries[:max_items]:
            content = f"知识：{entry.content}"
            priority = float(getattr(entry, "priority", 1))
            # priority 通常 1~5，归一到 [0,1]
            importance = min(1.0, priority / 5.0)
            items.append(ContextItem(
                source=self.name,
                content=content,
                relevance=0.6,  # KnowledgeIndex 命中即给中等相关度
                recency=0.5,    # 知识无时效性概念
                importance=importance,
                token_estimate=estimate_tokens(content),
                metadata={"entry_id": getattr(entry, "entry_id", "")},
            ))
        return items


class RelationshipSource(ContextSource):
    name = "relationship"

    def __init__(self, repository: RelationshipReader) -> None:
        self._repository = repository

    async def activate(self, query: ContextQuery, *, max_items: int = 10) -> list[ContextItem]:
        if not query.actor_id or "actor_private" not in query.allowed_scopes:
            return []
        record = await self._repository.get(query.actor_id)
        if record is None:
            return []
        content = (f"关系事实：与 {record.display_name or record.actor_id} 有 "
                   f"{record.direct_interactions} 次直接互动、{record.replies} 次回应。")
        if record.summary:
            content += f" 当前理解：{record.summary}"
        return [ContextItem(source=self.name, content=content, relevance=0.9,
                            recency=0.8, importance=max(0.4, record.confidence),
                            token_estimate=estimate_tokens(content), trust_tier="host_verified",
                            metadata={"actor_id": record.actor_id})]

"""角色的版本化时间记忆基底与本地有界召回。"""
from __future__ import annotations

import re
import numpy as np
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from glimmer_cradle.cognition.memory.storage.memory_repo import MemoryRepository
from glimmer_cradle.cognition.protocol.generated.enums.memory_kind import MemoryKind

_TOKEN_RE = re.compile(r"[a-zA-Z0-9_]+|[\u4e00-\u9fff]")


def _tokens(text: str) -> set[str]:
    parts = _TOKEN_RE.findall(text or "")
    result = {part.lower() for part in parts}
    result.update(parts[index] + parts[index + 1] for index in range(len(parts) - 1)
                  if len(parts[index]) == len(parts[index + 1]) == 1)
    return result


@dataclass(frozen=True)
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


class MemorySubstrate:
    """记忆业务 owner；repository 只负责事务，检索始终按 token 预算截断。"""

    def __init__(
        self, *, token_budget: int = 800, candidate_limit: int = 24, result_limit: int = 6
    ) -> None:
        self._repo: MemoryRepository | None = None
        self._records: dict[str, MemoryRecord] = {}
        self._token_budget = max(128, token_budget)
        self._candidate_limit = max(1, candidate_limit)
        self._result_limit = max(1, result_limit)
        self._vector_engine = None
        self._vector_repository = None
        self._vectors: dict[str, np.ndarray] = {}
        self._semantic_weight = 0.0

    def bind_repository(self, repository: MemoryRepository) -> None:
        self._repo = repository

    def bind_vector_search(self, *, engine, repository, semantic_weight: float) -> None:
        self._vector_engine = engine
        self._vector_repository = repository
        self._semantic_weight = max(0.0, min(1.0, float(semantic_weight)))

    async def load(self) -> None:
        if self._repo is None:
            return
        self._records = {row["memory_id"]: self._from_row(row)
                         for row in await self._repo.all_current()}
        await self._refresh_vectors()

    async def remember(self, *, kind: MemoryKind | str, content: str, summary: str = "",
                       status: str = "active", confidence: float = 0.7,
                       salience: float = 0.5, actor_id: str | None = None,
                       scene_id: str | None = None, attributes: dict[str, Any] | None = None,
                       conversation_id: str | None = None,
                       continuity_id: str | None = None,
                       recall_scope: str = "character_internal",
                       disclosure_scope: str = "conversation_private",
                       evidence: list[dict[str, Any]], consolidation_id: str,
                       memory_id: str | None = None, valid_from: str | None = None) -> str:
        result = await self.remember_batch([{
            "kind": kind,
            "content": content,
            "summary": summary,
            "status": status,
            "confidence": confidence,
            "salience": salience,
            "actor_id": actor_id,
            "scene_id": scene_id,
            "conversation_id": conversation_id,
            "continuity_id": continuity_id,
            "recall_scope": recall_scope,
            "disclosure_scope": disclosure_scope,
            "attributes": attributes or {},
            "evidence": evidence,
            "consolidation_id": consolidation_id,
            "memory_id": memory_id,
            "valid_from": valid_from,
        }])
        return result[0]

    async def remember_batch(self, drafts: list[dict[str, Any]]) -> list[str]:
        if self._repo is None:
            raise RuntimeError("MemorySubstrate 未绑定 repository")
        normalized: list[dict[str, Any]] = []
        for draft in drafts:
            evidence_by_id = {
                str(item.get("moment_id") or ""): item
                for item in draft.get("evidence", [])
                if str(item.get("moment_id") or "")
            }
            if not evidence_by_id:
                raise ValueError("记忆修订必须携带 Moment 证据")
            kind = draft["kind"]
            kind_value = kind.value if isinstance(kind, MemoryKind) else str(kind)
            content = str(draft["content"])
            normalized.append({
                **draft,
                "kind": kind_value,
                "content": content,
                "summary": str(draft.get("summary") or content),
                "status": str(draft.get("status") or "active"),
                "confidence": max(0.0, min(1.0, float(draft.get("confidence", 0.7)))),
                "salience": max(0.0, min(1.0, float(draft.get("salience", 0.5)))),
                "attributes": dict(draft.get("attributes") or {}),
                "recall_scope": str(draft.get("recall_scope") or "character_internal"),
                "disclosure_scope": str(draft.get("disclosure_scope") or "conversation_private"),
                "evidence": list(evidence_by_id.values()),
            })
        memory_ids = await self._repo.create_revisions(normalized)
        await self.load()
        return memory_ids

    async def retrieve(self, query: str, *, actor_id: str | None = None,
                       scene_id: str | None = None, limit: int | None = None,
                       conversation_id: str | None = None,
                       allowed_scopes: set[str] | None = None,
                       token_budget: int | None = None) -> list[MemoryRecord]:
        query_tokens = _tokens(query)
        query_vector = None
        if self._vector_ready and query.strip():
            query_vector = await self._vector_engine.encode_single(
                query, text_type="query"
            )
        now = datetime.now(timezone.utc)
        ranked: list[tuple[float, MemoryRecord]] = []
        for record in self._records.values():
            if record.status not in {"active", "disputed"}:
                continue
            if allowed_scopes is not None:
                if record.recall_scope not in allowed_scopes:
                    continue
                if record.recall_scope == "conversation_private" and record.conversation_id != conversation_id:
                    continue
                if record.recall_scope == "actor_private" and record.actor_id != actor_id:
                    continue
                if record.recall_scope == "space_local" and record.scene_id != scene_id:
                    continue
            tokens = _tokens(f"{record.summary} {record.content}")
            lexical = len(query_tokens & tokens) / max(1, len(query_tokens))
            actor_bonus = 0.18 if actor_id and record.actor_id == actor_id else 0.0
            scene_bonus = 0.08 if scene_id and record.scene_id == scene_id else 0.0
            try:
                updated = datetime.fromisoformat(record.updated_at.replace("Z", "+00:00"))
                recency = 1 / (1 + max(0.0, (now - updated).total_seconds()) / 86400)
            except ValueError:
                recency = 0.0
            semantic = 0.0
            vector = self._vectors.get(record.memory_id)
            if query_vector is not None and vector is not None:
                semantic = float(self._vector_engine.cosine_similarities(
                    query_vector, np.asarray([vector])
                )[0])
            lexical_weight = 0.5 * (1.0 - self._semantic_weight)
            score = lexical * lexical_weight + semantic * self._semantic_weight
            score += record.salience * 0.2 + record.confidence * 0.15
            score += recency * 0.07 + actor_bonus + scene_bonus
            if score > 0.12 or not query_tokens:
                ranked.append((score, record))
        ranked.sort(key=lambda item: item[0], reverse=True)
        result: list[MemoryRecord] = []
        used = 0
        budget = token_budget or self._token_budget
        result_limit = limit or self._result_limit
        for _, record in ranked[:self._candidate_limit]:
            if len(result) >= result_limit:
                break
            cost = max(1, len(record.summary or record.content) // 2)
            if result and used + cost > budget:
                break
            result.append(record)
            used += cost
        return result

    def all_current(self) -> list[MemoryRecord]:
        return list(self._records.values())

    def count(self) -> int:
        return sum(item.status in {"active", "disputed"} for item in self._records.values())

    @property
    def _vector_ready(self) -> bool:
        return bool(
            self._semantic_weight > 0
            and self._vector_engine is not None
            and self._vector_repository is not None
            and self._vector_engine.is_available()
        )

    async def _refresh_vectors(self) -> None:
        if not self._vector_ready:
            self._vectors = {}
            return
        model = self._vector_engine.model_id
        self._vectors = await self._vector_repository.get_vectors("memory", model)
        missing = [record for key, record in self._records.items() if key not in self._vectors]
        if not missing:
            return
        vectors = await self._vector_engine.encode(
            [f"{record.summary}\n{record.content}" for record in missing],
            text_type="document",
        )
        for record, vector in zip(missing, vectors):
            await self._vector_repository.upsert_vector(
                owner_kind="memory", owner_id=record.memory_id,
                model=model, vector=vector,
            )
            self._vectors[record.memory_id] = vector

    @staticmethod
    def _from_row(row: dict[str, Any]) -> MemoryRecord:
        return MemoryRecord(memory_id=row["memory_id"], revision_id=row["revision_id"],
                            kind=MemoryKind(row["kind"]), status=row["status"],
                            content=row["content"], summary=row["summary"],
                            actor_id=row["actor_id"], scene_id=row["scene_id"],
                            conversation_id=row["conversation_id"],
                            continuity_id=row["continuity_id"],
                            recall_scope=row["recall_scope"],
                            disclosure_scope=row["disclosure_scope"],
                            confidence=float(row["confidence"]), salience=float(row["salience"]),
                            valid_from=row["valid_from"], updated_at=row["updated_at"],
                            attributes=row["attributes"])

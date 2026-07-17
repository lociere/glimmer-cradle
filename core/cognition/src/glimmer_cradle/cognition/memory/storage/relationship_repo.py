"""可审计关系计数与证据化关系理解仓库。"""
from __future__ import annotations

import json
import math
import uuid
from dataclasses import dataclass, field

from glimmer_cradle.cognition.memory.storage.database import CognitionDatabase
from glimmer_cradle.cognition.memory.storage.memory_repo import now_iso


@dataclass(frozen=True)
class RelationshipRecord:
    actor_id: str
    display_name: str
    first_seen_at: str
    last_seen_at: str
    direct_interactions: int
    ambient_observations: int
    replies: int
    summary: str = ""
    attributes: dict = field(default_factory=dict)
    confidence: float = 0.0

    @property
    def familiarity(self) -> float:
        weighted = self.direct_interactions + self.replies * 0.5 + self.ambient_observations * 0.1
        return 1.0 - math.exp(-weighted / 20.0)


class RelationshipRepository:
    def __init__(self, database: CognitionDatabase) -> None:
        self._db = database

    async def observe(self, actor_id: str, *, kind: str,
                      evidence_moment_id: str,
                      display_name: str | None = None) -> RelationshipRecord:
        if kind not in {"direct", "ambient", "reply"}:
            raise ValueError(f"未知关系观察类型: {kind}")
        if not evidence_moment_id:
            raise ValueError("关系观察必须携带 Moment 证据")
        now = now_iso()
        direct, ambient, replies = (int(kind == "direct"), int(kind == "ambient"), int(kind == "reply"))
        conn = self._db.connection
        await conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = await conn.execute(
                "SELECT 1 FROM relationship_observations WHERE moment_id=?", (evidence_moment_id,))
            if await cursor.fetchone() is None:
                await conn.execute("""
                  INSERT INTO relationship_actors VALUES(?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(actor_id) DO UPDATE SET
                    display_name=CASE WHEN excluded.display_name='' THEN relationship_actors.display_name ELSE excluded.display_name END,
                    last_seen_at=excluded.last_seen_at,
                    direct_interactions=relationship_actors.direct_interactions+excluded.direct_interactions,
                    ambient_observations=relationship_actors.ambient_observations+excluded.ambient_observations,
                    replies=relationship_actors.replies+excluded.replies,
                    updated_at=excluded.updated_at
                """, (actor_id, display_name or "", now, now, direct, ambient, replies, None, now))
                await conn.execute("INSERT INTO relationship_observations VALUES(?,?,?,?)",
                                   (evidence_moment_id, actor_id, kind, now))
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise
        record = await self.get(actor_id)
        assert record is not None
        return record

    async def revise(self, actor_id: str, *, summary: str, attributes: dict,
                     confidence: float, evidence_moment_ids: list[str],
                     consolidation_id: str) -> str:
        if not evidence_moment_ids:
            raise ValueError("关系修订必须携带 Moment 证据")
        conn = self._db.connection
        revision_id = uuid.uuid4().hex
        now = now_iso()
        cursor = await conn.execute(
            "SELECT current_revision_id FROM relationship_actors WHERE actor_id=?", (actor_id,))
        row = await cursor.fetchone()
        if row is None:
            raise ValueError(f"关系 actor 尚未观察: {actor_id}")
        await conn.execute("BEGIN IMMEDIATE")
        try:
            if row[0]:
                await conn.execute("UPDATE relationship_revisions SET valid_to=? WHERE revision_id=?",
                                   (now, row[0]))
            await conn.execute("INSERT INTO relationship_revisions VALUES(?,?,?,?,?,?,?,?,?)",
                               (revision_id, actor_id, summary,
                                json.dumps(attributes, ensure_ascii=False), confidence,
                                now, None, consolidation_id, now))
            await conn.executemany("INSERT INTO relationship_evidence VALUES(?,?)",
                                   [(revision_id, item) for item in evidence_moment_ids])
            await conn.execute("UPDATE relationship_actors SET current_revision_id=?,updated_at=? WHERE actor_id=?",
                               (revision_id, now, actor_id))
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise
        return revision_id

    async def get(self, actor_id: str) -> RelationshipRecord | None:
        cursor = await self._db.connection.execute("""
          SELECT a.actor_id,a.display_name,a.first_seen_at,a.last_seen_at,
                 a.direct_interactions,a.ambient_observations,a.replies,
                 COALESCE(r.summary,''),COALESCE(r.attributes_json,'{}'),COALESCE(r.confidence,0)
          FROM relationship_actors a
          LEFT JOIN relationship_revisions r ON r.revision_id=a.current_revision_id
          WHERE a.actor_id=?
        """, (actor_id,))
        row = await cursor.fetchone()
        if row is None:
            return None
        return RelationshipRecord(row[0], row[1], row[2], row[3], int(row[4]), int(row[5]),
                                  int(row[6]), row[7], json.loads(row[8]), float(row[9]))

    async def all_recent(self, *, limit: int = 50) -> list[RelationshipRecord]:
        cursor = await self._db.connection.execute(
            "SELECT actor_id FROM relationship_actors ORDER BY last_seen_at DESC LIMIT ?", (limit,))
        result = []
        for row in await cursor.fetchall():
            record = await self.get(row[0])
            if record:
                result.append(record)
        return result

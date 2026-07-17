"""版本化时间记忆的持久化仓库。"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from glimmer_cradle.cognition.memory.storage.database import CognitionDatabase


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class MemoryRepository:
    def __init__(self, database: CognitionDatabase) -> None:
        self._db = database

    async def create_revision(self, *, memory_id: str | None, kind: str, content: str,
                              summary: str, status: str, confidence: float, salience: float,
                              actor_id: str | None, scene_id: str | None,
                              conversation_id: str | None, continuity_id: str | None,
                              recall_scope: str, disclosure_scope: str,
                              attributes: dict[str, Any], evidence: list[dict[str, Any]],
                              consolidation_id: str, valid_from: str | None = None) -> str:
        result = await self.create_revisions([{
            "memory_id": memory_id,
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
            "attributes": attributes,
            "evidence": evidence,
            "consolidation_id": consolidation_id,
            "valid_from": valid_from,
        }])
        return result[0]

    async def create_revisions(self, drafts: list[dict[str, Any]]) -> list[str]:
        conn = self._db.connection
        await conn.execute("BEGIN IMMEDIATE")
        try:
            result = [await self._create_revision(conn, draft) for draft in drafts]
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise
        return result

    @staticmethod
    async def _create_revision(conn, draft: dict[str, Any]) -> str:
        memory_id = draft.get("memory_id") or uuid.uuid4().hex
        consolidation_id = draft["consolidation_id"]
        cursor = await conn.execute(
            "SELECT revision_id FROM memory_revisions WHERE memory_id=? AND consolidation_id=?",
            (memory_id, consolidation_id))
        if await cursor.fetchone() is not None:
            return memory_id

        revision_id = uuid.uuid4().hex
        timestamp = now_iso()
        valid_from = draft.get("valid_from") or timestamp
        cursor = await conn.execute(
            "SELECT current_revision_id FROM memory_items WHERE memory_id=?", (memory_id,))
        row = await cursor.fetchone()
        previous = row[0] if row else None
        if row is None:
            await conn.execute(
                "INSERT INTO memory_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (memory_id, draft["kind"], draft["status"], draft.get("actor_id"),
                 draft.get("scene_id"), draft.get("conversation_id"),
                 draft.get("continuity_id"), draft["recall_scope"],
                 draft["disclosure_scope"], draft["confidence"], draft["salience"],
                 revision_id, timestamp, timestamp))
        else:
            await conn.execute(
                "UPDATE memory_revisions SET valid_to=? WHERE revision_id=? AND valid_to IS NULL",
                (valid_from, previous))
            await conn.execute("""
              UPDATE memory_items SET kind=?,status=?,actor_id=?,scene_id=?,conversation_id=?,
                continuity_id=?,recall_scope=?,disclosure_scope=?,confidence=?,salience=?,
                current_revision_id=?,updated_at=? WHERE memory_id=?
            """, (draft["kind"], draft["status"], draft.get("actor_id"),
                   draft.get("scene_id"), draft.get("conversation_id"),
                   draft.get("continuity_id"), draft["recall_scope"],
                   draft["disclosure_scope"], draft["confidence"], draft["salience"],
                   revision_id, timestamp, memory_id))
        await conn.execute(
            "INSERT INTO memory_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (revision_id, memory_id, draft["content"], draft["summary"],
             json.dumps(draft["attributes"], ensure_ascii=False), valid_from, None,
             timestamp, previous, consolidation_id, timestamp))
        await conn.executemany(
            "INSERT INTO memory_evidence VALUES(?,?,?,?)",
            [(revision_id, item["moment_id"], item.get("role", "support"),
              json.dumps(item.get("source", {}), ensure_ascii=False))
             for item in draft["evidence"]])
        return memory_id

    async def all_current(self) -> list[dict[str, Any]]:
        cursor = await self._db.connection.execute("""
          SELECT i.memory_id,i.kind,i.status,i.actor_id,i.scene_id,i.conversation_id,
                 i.continuity_id,i.recall_scope,i.disclosure_scope,i.confidence,i.salience,
                 i.created_at,i.updated_at,r.revision_id,r.content,r.summary,r.attributes_json,
                 r.valid_from,r.valid_to
          FROM memory_items i JOIN memory_revisions r ON r.revision_id=i.current_revision_id
          ORDER BY i.updated_at
        """)
        rows = await cursor.fetchall()
        return [self._row(row) for row in rows]

    async def count(self) -> int:
        cursor = await self._db.connection.execute(
            "SELECT COUNT(*) FROM memory_items WHERE status IN ('active','disputed')")
        row = await cursor.fetchone()
        return int(row[0]) if row else 0

    async def evidence_for(self, revision_id: str, *, limit: int = 3) -> list[dict[str, Any]]:
        cursor = await self._db.connection.execute(
            "SELECT moment_id,evidence_role,source_json FROM memory_evidence WHERE revision_id=? LIMIT ?",
            (revision_id, limit))
        return [{"moment_id": row[0], "role": row[1], "source": json.loads(row[2])}
                for row in await cursor.fetchall()]

    @staticmethod
    def _row(row: Any) -> dict[str, Any]:
        return {"memory_id": row[0], "kind": row[1], "status": row[2],
                "actor_id": row[3], "scene_id": row[4], "conversation_id": row[5],
                "continuity_id": row[6], "recall_scope": row[7],
                "disclosure_scope": row[8], "confidence": row[9],
                "salience": row[10], "created_at": row[11], "updated_at": row[12],
                "revision_id": row[13], "content": row[14], "summary": row[15],
                "attributes": json.loads(row[16]), "valid_from": row[17], "valid_to": row[18]}

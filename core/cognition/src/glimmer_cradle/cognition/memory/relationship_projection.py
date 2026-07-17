"""从 Experience Ledger 幂等派生关系互动计数。"""
from __future__ import annotations

from glimmer_cradle.cognition.experience.events import MomentKind
from glimmer_cradle.cognition.experience.recorder import ExperienceRecorder
from glimmer_cradle.cognition.memory.storage.database import CognitionDatabase
from glimmer_cradle.cognition.memory.storage.memory_repo import now_iso
from glimmer_cradle.cognition.memory.storage.relationship_repo import RelationshipRepository


class RelationshipProjection:
    def __init__(self, *, recorder: ExperienceRecorder,
                 repository: RelationshipRepository,
                 database: CognitionDatabase) -> None:
        self._recorder = recorder
        self._repository = repository
        self._database = database

    async def project_pending(self) -> int:
        await self._recorder.flush()
        cursor = await self._database.connection.execute(
            "SELECT position FROM projection_checkpoints WHERE projection_name='relationship'")
        row = await cursor.fetchone()
        checkpoint = int(row[0]) if row else 0
        moments = self._recorder.moments_after(checkpoint)
        for moment in moments:
            actor_id = moment.actor_id
            if actor_id and moment.kind == MomentKind.PERCEPTION.value:
                address_mode = str(moment.content.get("address_mode") or "ambient")
                await self._repository.observe(
                    actor_id,
                    kind="direct" if address_mode == "direct" else "ambient",
                    evidence_moment_id=moment.moment_id,
                    display_name=moment.actor_name,
                )
            elif actor_id and moment.kind == MomentKind.REPLY.value:
                await self._repository.observe(
                    actor_id,
                    kind="reply",
                    evidence_moment_id=moment.moment_id,
                    display_name=moment.actor_name,
                )
        if moments:
            await self._database.connection.execute("""
              INSERT INTO projection_checkpoints VALUES('relationship',?,?)
              ON CONFLICT(projection_name) DO UPDATE SET
                position=excluded.position,updated_at=excluded.updated_at
            """, (moments[-1].seq, now_iso()))
            await self._database.connection.commit()
        return len(moments)

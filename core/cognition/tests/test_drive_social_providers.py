from pathlib import Path
from datetime import timedelta

from glimmer_cradle.cognition.cycle.providers import DriveProvider, SocialProvider
from glimmer_cradle.cognition.cycle.workspace import make_item
from glimmer_cradle.cognition.memory.storage.database import CognitionDatabase
from glimmer_cradle.cognition.memory.storage.relationship_repo import RelationshipRepository


async def test_drive_accumulates_and_can_propose() -> None:
    provider = DriveProvider()
    await provider.propose([])
    provider._last_tick_at -= timedelta(seconds=7200)
    items = await provider.propose([])
    assert isinstance(items, list)


async def test_social_projects_deterministic_relationship(tmp_path: Path) -> None:
    database = CognitionDatabase(tmp_path / "memory.db")
    await database.connect()
    repository = RelationshipRepository(database)
    provider = SocialProvider(repository)
    focus = make_item(source="perception", content={"actor_id": "u1", "actor_name": "小林",
                                                     "address_mode": "direct", "text": "你好"},
                      salience=1)
    await repository.observe("u1", kind="direct", evidence_moment_id="m1", display_name="小林")
    first = (await provider.propose([focus]))[0]
    await repository.observe("u1", kind="direct", evidence_moment_id="m2", display_name="小林")
    second = (await provider.propose([focus]))[0]
    assert second.content["direct_interactions"] == 2
    assert second.content["familiarity"] > first.content["familiarity"]
    assert "intimacy" not in second.content
    await database.close()

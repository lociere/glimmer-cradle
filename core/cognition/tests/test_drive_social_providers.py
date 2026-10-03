from pathlib import Path
from datetime import timedelta

from glimmer_cradle.cognition.loop import DriveProvider, SocialProvider
from glimmer_cradle.cognition.attention import make_attention
from glimmer_cradle.cognition.adapters.persistence import (
    RelationshipRepository,
    SqliteMemoryStore,
)
from tests.conftest import CLOCK, IDS


async def test_drive_accumulates_and_can_propose() -> None:
    provider = DriveProvider(clock=CLOCK, ids=IDS)
    await provider.propose([])
    provider._last_tick_at -= timedelta(seconds=7200)
    items = await provider.propose([])
    assert isinstance(items, list)


async def test_social_projects_deterministic_relationship(tmp_path: Path) -> None:
    database = SqliteMemoryStore(tmp_path / "memory.db")
    await database.connect()
    repository = RelationshipRepository(database)
    provider = SocialProvider(repository, clock=CLOCK, ids=IDS)
    focus = make_attention(source="perception", content={"actor_id": "u1", "actor_name": "小林",
                                                     "address_mode": "direct", "text": "你好"},
                      salience=1, clock=CLOCK, ids=IDS)
    await repository.observe("u1", kind="direct", evidence_moment_id="m1", display_name="小林")
    first = (await provider.propose([focus]))[0]
    await repository.observe("u1", kind="direct", evidence_moment_id="m2", display_name="小林")
    second = (await provider.propose([focus]))[0]
    assert second.content["direct_interactions"] == 2
    assert second.content["familiarity"] > first.content["familiarity"]
    assert "intimacy" not in second.content
    await database.close()

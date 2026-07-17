from pathlib import Path
import asyncio
import json

import pytest

from glimmer_cradle.cognition.memory.substrate import MemorySubstrate
from glimmer_cradle.cognition.memory.consolidation import ConsolidationCoordinator
from glimmer_cradle.cognition.maintenance import MaintenanceScheduler
from glimmer_cradle.cognition.memory.relationship_projection import RelationshipProjection
from glimmer_cradle.cognition.experience import EpisodeProjection, ExperienceRecorder, Moment, MomentKind
from glimmer_cradle.cognition.memory.storage.database import CognitionDatabase
from glimmer_cradle.cognition.memory.storage.memory_repo import MemoryRepository
from glimmer_cradle.cognition.memory.storage.consolidation_job_repo import ConsolidationJobRepository
from glimmer_cradle.cognition.memory.storage.relationship_repo import RelationshipRepository
from glimmer_cradle.cognition.protocol.generated.enums.memory_kind import MemoryKind


@pytest.fixture
async def memory_stack(tmp_path: Path):
    database = CognitionDatabase(tmp_path / "memory" / "memory.db")
    await database.connect()
    repository = MemoryRepository(database)
    memory = MemorySubstrate(token_budget=128, result_limit=3)
    memory.bind_repository(repository)
    await memory.load()
    yield database, repository, memory
    await database.close()


async def test_memory_requires_evidence_and_keeps_revision_history(memory_stack) -> None:
    database, repository, memory = memory_stack
    with pytest.raises(ValueError):
        await memory.remember(kind=MemoryKind.SEMANTIC, content="月见喜欢雨天",
                              evidence=[], consolidation_id="run-empty")
    memory_id = await memory.remember(
        kind=MemoryKind.SEMANTIC, content="用户喜欢雨天", summary="用户偏好雨天",
        actor_id="user:1", evidence=[{"moment_id": "m1", "source": {"provider_kind": "user"}}],
        consolidation_id="run-1", attributes={"preference": True})
    await memory.remember(
        memory_id=memory_id, kind=MemoryKind.SEMANTIC, content="用户现在更喜欢晴天",
        summary="用户偏好晴天", actor_id="user:1",
        evidence=[{"moment_id": "m2", "source": {"provider_kind": "user"}}],
        consolidation_id="run-2", attributes={"preference": True})

    cursor = await database.connection.execute(
        "SELECT valid_to FROM memory_revisions WHERE memory_id=? ORDER BY created_at", (memory_id,))
    rows = await cursor.fetchall()
    assert len(rows) == 2 and rows[0][0] is not None and rows[1][0] is None
    assert (await memory.retrieve("晴天", actor_id="user:1"))[0].content == "用户现在更喜欢晴天"


async def test_memory_batch_is_atomic_and_retry_idempotent(memory_stack) -> None:
    database, _, memory = memory_stack
    valid = {
        "memory_id": "stable-memory",
        "kind": MemoryKind.SEMANTIC,
        "content": "可验证事实",
        "summary": "可验证",
        "evidence": [{"moment_id": "m1", "source": {"provider_kind": "user"}}],
        "consolidation_id": "batch-1",
    }
    with pytest.raises(ValueError):
        await memory.remember_batch([valid, {
            "kind": MemoryKind.SEMANTIC,
            "content": "无证据事实",
            "evidence": [],
            "consolidation_id": "batch-1",
        }])
    cursor = await database.connection.execute("SELECT COUNT(*) FROM memory_items")
    assert (await cursor.fetchone())[0] == 0

    assert await memory.remember_batch([valid]) == ["stable-memory"]
    assert await memory.remember_batch([valid]) == ["stable-memory"]
    cursor = await database.connection.execute(
        "SELECT COUNT(*) FROM memory_revisions WHERE memory_id='stable-memory'")
    assert (await cursor.fetchone())[0] == 1


async def test_relationship_counters_are_deterministic_and_summary_has_evidence(memory_stack) -> None:
    database, _, _ = memory_stack
    relationships = RelationshipRepository(database)
    first = await relationships.observe(
        "user:1", kind="direct", evidence_moment_id="m1", display_name="小林")
    duplicate = await relationships.observe(
        "user:1", kind="direct", evidence_moment_id="m1", display_name="小林")
    second = await relationships.observe("user:1", kind="reply", evidence_moment_id="m2")
    assert duplicate.direct_interactions == 1
    assert second.direct_interactions == 1 and second.replies == 1
    assert second.familiarity > first.familiarity
    with pytest.raises(ValueError):
        await relationships.revise("user:1", summary="熟悉的人", attributes={}, confidence=0.8,
                                   evidence_moment_ids=[], consolidation_id="run")
    await relationships.revise("user:1", summary="愿意直接表达需求",
                               attributes={"communication": "direct"}, confidence=0.8,
                               evidence_moment_ids=["m1"], consolidation_id="run")
    current = await relationships.get("user:1")
    assert current.summary == "愿意直接表达需求"


async def test_relationship_projection_is_idempotent_from_ledger(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    recorder.record(
        MomentKind.PERCEPTION,
        {"text": "你好", "address_mode": "direct"},
        interaction_id="turn-1",
        actor_id="user:1",
        actor_name="小林",
    )
    recorder.record(
        MomentKind.REPLY,
        {"text": "你好"},
        interaction_id="turn-1",
        actor_id="user:1",
        actor_name="小林",
    )
    database = CognitionDatabase(tmp_path / "memory" / "memory.db")
    await database.connect()
    relationships = RelationshipRepository(database)
    projection = RelationshipProjection(
        recorder=recorder, repository=relationships, database=database)

    assert await projection.project_pending() == 2
    assert await projection.project_pending() == 0
    record = await relationships.get("user:1")
    assert record is not None
    assert record.direct_interactions == 1 and record.replies == 1
    cursor = await database.connection.execute("SELECT COUNT(*) FROM relationship_observations")
    assert (await cursor.fetchone())[0] == 2
    await recorder.stop()
    await database.close()


class _ConsolidationLlm:
    def __init__(self, response: str) -> None:
        self.response = response
        self.requests = []

    def generate(self, request) -> str:
        self.requests.append(request)
        return self.response


class _SchedulingProjection:
    def __init__(self) -> None:
        self.project_calls: list[bool] = []
        self.pending_calls = 0

    async def project_pending(self, *, seal: bool = False) -> int:
        self.project_calls.append(seal)
        return 0

    def pending_consolidation(self, *, limit: int = 8) -> list:
        self.pending_calls += 1
        return []


class _SchedulingJobs:
    async def claim_due(self, *, limit: int, lease_seconds: int) -> list:
        return []


async def test_maintenance_scheduler_is_independent_and_quiescent_forces_seal() -> None:
    episodes = _SchedulingProjection()
    coordinator = ConsolidationCoordinator(
        episodes=episodes,
        memory=object(),
        jobs=_SchedulingJobs(),
        llm=None,
    )
    state = "engaged"
    scheduler = MaintenanceScheduler(
        consolidation=coordinator,
        activity_state_provider=lambda: state,
        interval_seconds=300,
    )

    assert await scheduler.run_once() == 0
    assert episodes.project_calls == [False]
    assert episodes.pending_calls == 1

    state = "quiescent"
    scheduler.notify_activity_transition()
    assert scheduler._force_seal_requested is True
    assert await scheduler.run_once(force_seal=True) == 0
    assert episodes.project_calls[-1] is True
    assert episodes.pending_calls == 2


async def test_terminal_moment_wakes_maintenance_without_forced_seal() -> None:
    episodes = _SchedulingProjection()
    coordinator = ConsolidationCoordinator(
        episodes=episodes,
        memory=object(),
        jobs=_SchedulingJobs(),
        llm=None,
    )
    scheduler = MaintenanceScheduler(
        consolidation=coordinator,
        activity_state_provider=lambda: "engaged",
        interval_seconds=300,
    )
    terminal = Moment.create(1, kind=MomentKind.REPLY, content={"text": "完成"})
    scheduler.notify_moment(terminal)

    assert scheduler._wake_event.is_set()
    assert scheduler._force_seal_requested is False
    assert scheduler._pending_reason == "interaction_completed"


async def test_running_scheduler_consolidates_semantic_boundary_without_shutdown(
    tmp_path: Path,
) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    database = CognitionDatabase(tmp_path / "memory" / "memory.db")
    await database.connect()
    memory = MemorySubstrate(token_budget=128, result_limit=3)
    memory.bind_repository(MemoryRepository(database))
    await memory.load()
    llm = _ConsolidationLlm('{"decisions":[]}')
    coordinator = ConsolidationCoordinator(
        episodes=EpisodeProjection(
            tmp_path / "projections" / "episodes.db",
            recorder,
        ),
        memory=memory,
        jobs=ConsolidationJobRepository(database),
        llm=llm,
        minimum_salience=0.1,
        debounce_seconds=0,
    )
    scheduler = MaintenanceScheduler(
        consolidation=coordinator,
        activity_state_provider=lambda: "engaged",
        interval_seconds=300,
    )
    recorder.on_recorded(scheduler.notify_moment)
    await scheduler.start()

    evidence = recorder.record(
        MomentKind.PERCEPTION,
        {"text": "本次验收代号是星潮十号"},
        scene_id="desktop",
        interaction_id="turn-live",
        actor_id="user:1",
        retention_ceiling="memory_candidate",
        importance=0.9,
    )
    llm.response = json.dumps({"decisions": [{
        "operation": "add",
        "kind": "semantic",
        "content": "本次验收代号是星潮十号",
        "summary": "验收代号为星潮十号",
        "confidence": 0.99,
        "salience": 0.9,
        "actor_id": "user:1",
        "attributes": {},
        "evidence_moment_ids": [evidence.moment_id],
    }]}, ensure_ascii=False)
    recorder.record(
        MomentKind.REPLY,
        {"text": "我记住了"},
        scene_id="desktop",
        interaction_id="turn-live",
        actor_id="user:1",
    )

    for _ in range(100):
        if await memory.retrieve("星潮十号", actor_id="user:1"):
            break
        await asyncio.sleep(0.02)

    recalled = await memory.retrieve("星潮十号", actor_id="user:1")
    assert recalled and recalled[0].content == "本次验收代号是星潮十号"
    await scheduler.stop()
    await recorder.stop()
    await database.close()


async def test_episode_consolidation_writes_evidence_backed_memory(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    moment = recorder.record(
        MomentKind.PERCEPTION,
        {"text": "用户说自己喜欢雨天"},
        scene_id="desktop",
        interaction_id="turn-1",
        actor_id="user:1",
        retention_ceiling="memory_candidate",
        importance=0.9,
    )
    episodes = EpisodeProjection(tmp_path / "projections" / "episodes.db", recorder)
    database = CognitionDatabase(tmp_path / "memory" / "memory.db")
    await database.connect()
    memory = MemorySubstrate(token_budget=128, result_limit=3)
    memory.bind_repository(MemoryRepository(database))
    await memory.load()
    llm = _ConsolidationLlm(json.dumps({"decisions": [{
        "operation": "add",
        "kind": "semantic",
        "content": "用户喜欢雨天",
        "summary": "用户偏好雨天",
        "confidence": 0.9,
        "salience": 0.8,
        "actor_id": "user:1",
        "attributes": {"preference": True},
        "evidence_moment_ids": [moment.moment_id],
    }]}, ensure_ascii=False))
    coordinator = ConsolidationCoordinator(
        episodes=episodes, memory=memory, jobs=ConsolidationJobRepository(database),
        llm=llm, minimum_salience=0.1, debounce_seconds=0)
    await coordinator.start()

    assert await coordinator.consolidate(force_seal=True) == 1
    assert (await memory.retrieve("雨天", actor_id="user:1"))[0].content == "用户喜欢雨天"
    cursor = await database.connection.execute("SELECT moment_id FROM memory_evidence")
    assert await cursor.fetchone() == (moment.moment_id,)
    assert episodes.pending_consolidation() == []
    await recorder.stop()
    await database.close()


async def test_invalid_consolidation_evidence_remains_retryable(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    recorder.record(MomentKind.PERCEPTION, {"text": "候选"}, interaction_id="turn-1",
                    retention_ceiling="memory_candidate", importance=0.9)
    episodes = EpisodeProjection(tmp_path / "projections" / "episodes.db", recorder)
    database = CognitionDatabase(tmp_path / "memory" / "memory.db")
    await database.connect()
    memory = MemorySubstrate(token_budget=128, result_limit=3)
    memory.bind_repository(MemoryRepository(database))
    await memory.load()
    llm = _ConsolidationLlm(
        '{"decisions":[{"operation":"add","kind":"semantic","content":"伪造事实","summary":"伪造",'
        '"confidence":0.9,"salience":0.8,"actor_id":null,'
        '"attributes":{},"evidence_moment_ids":["unknown"]}]}'
    )
    coordinator = ConsolidationCoordinator(
        episodes=episodes, memory=memory, jobs=ConsolidationJobRepository(database),
        llm=llm, minimum_salience=0.1, debounce_seconds=0)
    await coordinator.start()

    assert await coordinator.consolidate(force_seal=True) == 0
    assert len(episodes.pending_consolidation()) == 1
    cursor = await database.connection.execute("SELECT COUNT(*) FROM memory_items")
    assert (await cursor.fetchone())[0] == 0
    await recorder.stop()
    await database.close()


async def test_consolidation_batches_are_partitioned_by_permission_domain(
    tmp_path: Path,
) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    for interaction_id, conversation_id, scope in (
        ("private-turn", "conversation:private", "conversation_private"),
        ("group-turn", "conversation:group", "space_local"),
    ):
        recorder.record(
            MomentKind.PERCEPTION,
            {"text": f"{scope} 候选"},
            scene_id="scene:shared",
            conversation_id=conversation_id,
            interaction_id=interaction_id,
            actor_id="user:1",
            recall_scope=scope,
            disclosure_scope=scope,
            retention_ceiling="memory_candidate",
            importance=0.9,
        )
    episodes = EpisodeProjection(tmp_path / "projections" / "episodes.db", recorder)
    database = CognitionDatabase(tmp_path / "memory" / "memory.db")
    await database.connect()
    memory = MemorySubstrate(token_budget=128, result_limit=3)
    memory.bind_repository(MemoryRepository(database))
    await memory.load()
    llm = _ConsolidationLlm('{"decisions":[]}')
    coordinator = ConsolidationCoordinator(
        episodes=episodes,
        memory=memory,
        jobs=ConsolidationJobRepository(database),
        llm=llm,
        minimum_salience=0.1,
        debounce_seconds=0,
        batch_size=8,
    )
    await coordinator.start()

    assert await coordinator.consolidate(force_seal=True) == 0
    assert len(llm.requests) == 2
    await recorder.stop()
    await database.close()

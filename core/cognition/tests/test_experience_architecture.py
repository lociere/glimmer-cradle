from pathlib import Path
import sqlite3

from glimmer_cradle.cognition.observability import trace_context
from glimmer_cradle.cognition.experience import EpisodeProjection, ExperienceRecorder, MomentKind


async def test_ledger_restart_causation_and_episode_projection(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    with trace_context.TraceContext("trace-xyz"):
        perception = recorder.record(
            MomentKind.PERCEPTION, {"text": "你好"}, scene_id="scene",
            interaction_id="interaction", retention_ceiling="memory_candidate")
        recorder.record(MomentKind.REPLY, {"text": "嗯"}, scene_id="scene",
                        interaction_id="interaction", causation_ids=[perception.moment_id])
    await recorder.stop()

    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    third = recorder.record(MomentKind.EMOTION, {"emotion_type": "calm"})
    await recorder.flush()
    assert third.seq == 3
    assert recorder.verify() == {"ok": True, "moments": 3, "last_position": 3,
                                 "duplicate_ids": [], "position_gaps": []}
    moments = recorder.ledger.query()
    assert moments[0].trace_id == "trace-xyz"
    assert moments[1].causation_ids == (moments[0].moment_id,)

    projection = EpisodeProjection(tmp_path / "projections" / "episodes.db", recorder)
    await projection.start()
    assert await projection.project_pending(seal=True) == 3
    episodes = projection.pending_consolidation()
    assert sorted(len(item.moments) for item in episodes) == [1, 2]
    await recorder.stop()


async def test_disabled_recorder_has_no_physical_storage(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience", enabled=False)
    await recorder.start()
    assert recorder.record(MomentKind.PERCEPTION, {}) is None
    await recorder.stop()
    assert not (tmp_path / "experience").exists()


async def test_late_moment_starts_new_episode_after_boundary(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    recorder.record(MomentKind.PERCEPTION, {"text": "第一轮"}, scene_id="scene",
                    interaction_id="same-interaction")
    projection = EpisodeProjection(tmp_path / "projections" / "episodes.db", recorder)
    await projection.start()
    await projection.project_pending(seal=True)

    recorder.record(MomentKind.ACTION_RESULT, {"text": "迟到结果"}, scene_id="scene",
                    interaction_id="same-interaction")
    await projection.project_pending(seal=True)

    episodes = projection.list_episodes()
    assert len(episodes) == 2
    assert [tuple(moment.content["text"] for moment in episode.moments) for episode in episodes] == [
        ("第一轮",),
        ("迟到结果",),
    ]
    await recorder.stop()


async def test_terminal_moment_seals_episode_at_semantic_boundary(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    recorder.record(
        MomentKind.PERCEPTION,
        {"text": "请记住今天的约定"},
        scene_id="scene",
        interaction_id="turn-1",
    )
    recorder.record(
        MomentKind.REPLY,
        {"text": "我记住了"},
        scene_id="scene",
        interaction_id="turn-1",
    )
    projection = EpisodeProjection(tmp_path / "projections" / "episodes.db", recorder)
    await projection.start()

    assert await projection.project_pending() == 2
    pending = projection.pending_consolidation()
    assert len(pending) == 1
    assert pending[0].boundary_reason == "interaction_completed"
    await recorder.stop()


async def test_episode_never_crosses_conversation_permission_domain(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    recorder.record(
        MomentKind.PERCEPTION,
        {"text": "私聊事实"},
        scene_id="scene:shared",
        conversation_id="conversation:private",
        interaction_id="same-interaction",
        recall_scope="conversation_private",
        disclosure_scope="conversation_private",
    )
    recorder.record(
        MomentKind.PERCEPTION,
        {"text": "群聊事实"},
        scene_id="scene:shared",
        conversation_id="conversation:group",
        interaction_id="same-interaction",
        recall_scope="space_local",
        disclosure_scope="space_local",
    )
    projection = EpisodeProjection(tmp_path / "projections" / "episodes.db", recorder)
    await projection.start()
    await projection.project_pending(seal=True)

    episodes = projection.list_episodes()
    assert len(episodes) == 2
    assert {item.conversation_id for item in episodes} == {
        "conversation:private", "conversation:group",
    }
    assert {item.recall_scope for item in episodes} == {
        "conversation_private", "space_local",
    }
    await recorder.stop()


async def test_projection_restart_seals_interrupted_episode(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    recorder.record(
        MomentKind.PERCEPTION,
        {"text": "尚未完成的交互"},
        scene_id="scene",
        interaction_id="turn-1",
    )
    database_path = tmp_path / "projections" / "episodes.db"
    projection = EpisodeProjection(database_path, recorder)
    await projection.start()
    await projection.project_pending()

    restarted_projection = EpisodeProjection(database_path, recorder)
    await restarted_projection.start()
    await restarted_projection.project_pending()
    restarted_projection.recover_interrupted()
    pending = restarted_projection.pending_consolidation()
    assert len(pending) == 1
    assert pending[0].boundary_reason == "process_interrupted"
    await recorder.stop()


async def test_restart_projects_terminal_moment_before_interruption_recovery(
    tmp_path: Path,
) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    recorder.record(
        MomentKind.PERCEPTION,
        {"text": "先写入投影"},
        scene_id="scene",
        interaction_id="turn-1",
    )
    database_path = tmp_path / "projections" / "episodes.db"
    projection = EpisodeProjection(database_path, recorder)
    await projection.start()
    await projection.project_pending()

    recorder.record(
        MomentKind.REPLY,
        {"text": "已提交但尚未投影"},
        scene_id="scene",
        interaction_id="turn-1",
    )
    restarted_projection = EpisodeProjection(database_path, recorder)
    await restarted_projection.start()
    await restarted_projection.project_pending()
    restarted_projection.recover_interrupted()

    pending = restarted_projection.pending_consolidation()
    assert len(pending) == 1
    assert pending[0].boundary_reason == "interaction_completed"
    assert [moment.kind for moment in pending[0].moments] == [
        MomentKind.PERCEPTION.value,
        MomentKind.REPLY.value,
    ]
    await recorder.stop()


async def test_idle_episode_is_sealed_without_new_moments(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    recorder.record(
        MomentKind.PERCEPTION,
        {"text": "一段已经结束的互动"},
        scene_id="scene",
        interaction_id="idle-interaction",
    )
    database_path = tmp_path / "projections" / "episodes.db"
    projection = EpisodeProjection(
        database_path,
        recorder,
        idle_seconds=10,
    )
    await projection.start()
    await projection.project_pending()
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "UPDATE episodes SET ended_at='2000-01-01T00:00:00.000Z'"
        )
        connection.commit()

    assert await projection.project_pending() == 0
    episodes = projection.pending_consolidation()
    assert len(episodes) == 1
    assert episodes[0].boundary_reason == "idle_timeout"
    await recorder.stop()


async def test_ledger_rebuilds_catalog_from_packs(tmp_path: Path) -> None:
    base_dir = tmp_path / "experience"
    recorder = ExperienceRecorder(base_dir)
    await recorder.start()
    recorder.record(MomentKind.PERCEPTION, {"text": "保留在 pack"})
    await recorder.stop()
    (base_dir / "catalog.db").unlink()

    recorder = ExperienceRecorder(base_dir)
    await recorder.start()
    second = recorder.record(MomentKind.REPLY, {"text": "重建后继续"})
    await recorder.stop()

    assert second.seq == 2
    assert ExperienceRecorder(base_dir).ledger.query()[0].content["text"] == "保留在 pack"

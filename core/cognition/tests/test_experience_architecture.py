import sqlite3
from dataclasses import replace
from pathlib import Path

import glimmer_cradle.cognition_worker.rpc_service as trace_context
import pytest
from glimmer_cradle.cognition.adapters.persistence import EpisodeProjection
from glimmer_cradle.cognition.memory import MemoryConsolidationConflictError
from glimmer_cradle.cognition.memory.consolidation import consolidation_input
from glimmer_cradle.conversation.log import Moment, MomentKind, SourceDescriptor
from tests.conftest import build_experience_recorder


async def test_ledger_restart_causation_and_episode_projection(tmp_path: Path) -> None:
    recorder = build_experience_recorder(tmp_path / "experience")
    await recorder.start()
    with trace_context.TraceContext("trace-xyz"):
        perception = recorder.record(
            MomentKind.PERCEPTION, {"text": "你好"}, scene_id="scene",
            interaction_id="interaction", retention_ceiling="memory_candidate")
        recorder.record(MomentKind.REPLY, {"text": "嗯"}, scene_id="scene",
                        interaction_id="interaction", causation_ids=[perception.moment_id])
    await recorder.stop()

    recorder = build_experience_recorder(tmp_path / "experience")
    await recorder.start()
    third = recorder.record(MomentKind.EMOTION, {"emotion_type": "calm"})
    await recorder.flush()
    assert third.seq == 3
    assert recorder.verify() == {"ok": True, "moments": 3, "last_position": 3,
                                 "duplicate_ids": [], "position_gaps": []}
    moments = recorder.log.query()
    assert moments[0].trace_id == "trace-xyz"
    assert moments[1].causation_ids == (moments[0].moment_id,)

    projection = EpisodeProjection(tmp_path / "projections" / "episodes.db", recorder)
    await projection.start()
    assert await projection.project_pending(seal=True) == 3
    episodes = projection.pending_consolidation()
    assert sorted(len(item.moments) for item in episodes) == [1, 2]
    await recorder.stop()


async def test_disabled_recorder_has_no_physical_storage(tmp_path: Path) -> None:
    recorder = build_experience_recorder(tmp_path / "experience", enabled=False)
    await recorder.start()
    assert recorder.record(MomentKind.PERCEPTION, {}) is None
    await recorder.stop()
    assert not (tmp_path / "experience").exists()


async def test_late_moment_starts_new_episode_after_boundary(tmp_path: Path) -> None:
    recorder = build_experience_recorder(tmp_path / "experience")
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
    recorder = build_experience_recorder(tmp_path / "experience")
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
    recorder = build_experience_recorder(tmp_path / "experience")
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
    recorder = build_experience_recorder(tmp_path / "experience")
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
    recorder = build_experience_recorder(tmp_path / "experience")
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
    recorder = build_experience_recorder(tmp_path / "experience")
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
    recorder = build_experience_recorder(base_dir)
    await recorder.start()
    recorder.record(MomentKind.PERCEPTION, {"text": "保留在 pack"})
    await recorder.stop()
    (base_dir / "catalog.db").unlink()

    recorder = build_experience_recorder(base_dir)
    await recorder.start()
    second = recorder.record(MomentKind.REPLY, {"text": "重建后继续"})
    await recorder.stop()

    assert second.seq == 2
    assert build_experience_recorder(base_dir).log.query()[0].content["text"] == "保留在 pack"


async def test_v4_text_moment_reads_beside_v5_reference_and_transient_is_not_recorded(tmp_path: Path) -> None:
    recorder = build_experience_recorder(tmp_path / "experience")
    await recorder.start()
    old = replace(Moment.create(0, kind=MomentKind.PERCEPTION, content={"text": "历史纯文本"},
        moment_id="legacy-v4", occurred_at="2025-01-01T00:00:00Z"), schema_version=4,
        origin=SourceDescriptor(schema_ref="glimmer://cognition/moment/v4"))
    recorder.log.append(old)
    recorder.record(MomentKind.PERCEPTION, {"text": "临时"}, retention_ceiling="transient")
    recorder.record(MomentKind.PERCEPTION, {"text": "新媒体", "parts": [{"kind": "image", "asset": {
        "asset_id": "00000000-0000-4000-8000-000000000001", "media_type": "image/png",
        "size_bytes": "3", "sha256": "a" * 64}}]})
    await recorder.stop()
    moments = build_experience_recorder(tmp_path / "experience").log.query()
    assert len(moments) == 2
    assert moments[0].schema_version == 4 and moments[0].content["text"] == "历史纯文本"
    assert moments[1].schema_version == 5
    assert moments[1].content["parts"][0]["asset"]["asset_id"]


async def _request_projection(tmp_path: Path, *, seal: bool = True):
    recorder = build_experience_recorder(tmp_path / "request-log")
    await recorder.start()
    recorder.record(MomentKind.PERCEPTION, {"text": "需要保留的约定"},
                    interaction_id="request-turn", retention_ceiling="memory_candidate")
    projection = EpisodeProjection(tmp_path / "request-episodes.db", recorder)
    await projection.start()
    await projection.project_pending(seal=seal)
    return recorder, projection


async def test_memory_request_survives_restart_and_lost_acceptance_ack(tmp_path: Path) -> None:
    recorder, projection = await _request_projection(tmp_path)
    request, = projection.pending_job_requests()
    episode, = projection.pending_consolidation()
    assert request.input == consolidation_input(episode)
    await projection.project_pending(seal=True)
    restarted = EpisodeProjection(tmp_path / "request-episodes.db", recorder)
    await restarted.start()
    assert restarted.pending_job_requests() == [request]
    # 远端已接纳而本地没有 ACK 时，重放保留 request_id 与完全相同的输入。
    restarted.acknowledge_job_request(request, "accepted-job")
    assert restarted.pending_job_requests() == []
    assert len(restarted.pending_consolidation()) == 1  # 接纳不伪装业务完成。
    await restarted.start()
    restarted.acknowledge_job_request(request, "accepted-job")
    assert restarted.pending_job_requests() == []
    await recorder.stop()


async def test_memory_request_acceptance_rejects_identity_and_payload_conflicts(tmp_path: Path) -> None:
    recorder, projection = await _request_projection(tmp_path)
    request, = projection.pending_job_requests()
    for wrong in [replace(request, request_id="unseen"), replace(request, created_at="different"),
                  replace(request, input=replace(request.input, input_digest="different")),
                  replace(request, input=replace(request.input, scope_id="different")),
                  replace(request, input=replace(request.input, episode_version=999))]:
        with pytest.raises(MemoryConsolidationConflictError):
            projection.acknowledge_job_request(wrong, "job")
    for invalid in ["", " ", None]:
        with pytest.raises(MemoryConsolidationConflictError):
            projection.acknowledge_job_request(request, invalid)
    assert projection.pending_job_requests() == [request]
    projection.acknowledge_job_request(request, "job")
    with pytest.raises(MemoryConsolidationConflictError):
        projection.acknowledge_job_request(request, "different-job")
    await recorder.stop()


def _fail_request_insert(path: Path) -> None:
    with sqlite3.connect(path) as conn:
        conn.execute("""CREATE TRIGGER fail_request BEFORE INSERT ON memory_request_outbox
            BEGIN SELECT RAISE(ABORT,'injected request failure'); END""")


async def test_memory_request_failure_rolls_back_episode_and_projection_checkpoint(tmp_path: Path) -> None:
    recorder = build_experience_recorder(tmp_path / "request-log")
    await recorder.start()
    recorder.record(MomentKind.PERCEPTION, {"text": "原子提交"}, interaction_id="turn",
                    retention_ceiling="memory_candidate")
    recorder.record(MomentKind.REPLY, {"text": "确认"}, interaction_id="turn")
    path = tmp_path / "request-episodes.db"
    projection = EpisodeProjection(path, recorder)
    await projection.start()
    _fail_request_insert(path)
    with pytest.raises(sqlite3.IntegrityError):
        await projection.project_pending()
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM episodes").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM episode_moments").fetchone()[0] == 0
        assert conn.execute("SELECT value FROM projection_meta WHERE key='position'").fetchone() is None
        assert conn.execute("SELECT COUNT(*) FROM memory_request_outbox").fetchone()[0] == 0
        conn.execute("DROP TRIGGER fail_request")
    assert await projection.project_pending() == 2
    assert len(projection.pending_job_requests()) == 1
    await recorder.stop()


@pytest.mark.parametrize("boundary", ["forced", "idle", "interrupted"])
async def test_memory_request_failure_rolls_back_no_new_moment_sealing(tmp_path: Path, boundary: str) -> None:
    recorder, projection = await _request_projection(tmp_path, seal=False)
    path = tmp_path / "request-episodes.db"
    if boundary == "idle":
        with sqlite3.connect(path) as conn:
            conn.execute("UPDATE episodes SET ended_at='2000-01-01T00:00:00.000Z'")
    _fail_request_insert(path)
    with pytest.raises(sqlite3.IntegrityError):
        if boundary == "interrupted":
            projection.recover_interrupted()
        else:
            await projection.project_pending(seal=boundary == "forced")
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT status FROM episodes").fetchone()[0] == "open"
        assert conn.execute("SELECT value FROM projection_meta WHERE key='position'").fetchone()[0] == "1"
        conn.execute("DROP TRIGGER fail_request")
    if boundary == "interrupted":
        projection.recover_interrupted()
    else:
        await projection.project_pending(seal=boundary == "forced")
    assert len(projection.pending_job_requests()) == 1
    await recorder.stop()


async def test_memory_request_resolution_and_ack_remain_independent_and_protect_rebuild(tmp_path: Path) -> None:
    recorder, projection = await _request_projection(tmp_path)
    request, = projection.pending_job_requests()
    projection.mark_consolidated(request.input.episode_id, "2026-10-06T00:00:00Z")
    assert projection.pending_job_requests() == []
    # Memory 已落库后迟到的接纳 ACK 仍可绑定，但不能丢失源 identity。
    projection.acknowledge_job_request(request, "accepted-job")
    with pytest.raises(MemoryConsolidationConflictError):
        projection.rebuild()
    await projection.start()
    assert projection.get_episode(request.input.episode_id) is not None
    projection.acknowledge_job_request(request, "accepted-job")
    assert projection.pending_job_requests() == []
    await recorder.stop()


async def test_memory_request_upgrade_backfills_old_sealed_identity_without_rekey(tmp_path: Path) -> None:
    recorder, projection = await _request_projection(tmp_path)
    request, = projection.pending_job_requests()
    # 合成还没有源 outbox 的旧投影；仅测试目录，不触及用户数据库。
    with sqlite3.connect(tmp_path / "request-episodes.db") as conn:
        conn.execute("DROP TABLE memory_request_outbox")
    await projection.start()
    backfilled, = projection.pending_job_requests()
    assert backfilled.request_id == request.request_id
    assert backfilled.input == request.input
    assert projection.get_episode(request.input.episode_id) is not None
    await recorder.stop()


async def test_memory_request_missing_evidence_does_not_commit_checkpoint(tmp_path: Path, monkeypatch) -> None:
    recorder, projection = await _request_projection(tmp_path, seal=False)
    monkeypatch.setattr(recorder.log, "query", lambda **kwargs: [])
    with pytest.raises(MemoryConsolidationConflictError):
        await projection.project_pending(seal=True)
    assert projection.pending_job_requests() == []
    with sqlite3.connect(tmp_path / "request-episodes.db") as conn:
        assert conn.execute("SELECT status FROM episodes").fetchone()[0] == "open"
    await recorder.stop()


async def test_memory_request_non_candidate_allows_unpinned_projection_rebuild(tmp_path: Path) -> None:
    recorder = build_experience_recorder(tmp_path / "request-log")
    await recorder.start()
    recorder.record(MomentKind.PERCEPTION, {"text": "仅记录"}, retention_ceiling="ledger_only")
    projection = EpisodeProjection(tmp_path / "request-episodes.db", recorder)
    await projection.start()
    await projection.project_pending(seal=True)
    assert projection.pending_job_requests() == []
    projection.rebuild()
    assert await projection.project_pending(seal=True) == 1
    assert projection.pending_job_requests() == []
    await recorder.stop()


async def test_memory_request_late_moment_has_a_new_source_identity(tmp_path: Path) -> None:
    recorder, projection = await _request_projection(tmp_path)
    first, = projection.pending_job_requests()
    recorder.record(MomentKind.ACTION_RESULT, {"text": "迟到的证据"}, interaction_id="request-turn",
                    retention_ceiling="memory_candidate")
    await projection.project_pending(seal=True)
    requests = projection.pending_job_requests()
    assert len(requests) == 2
    assert len({item.request_id for item in requests}) == 2
    assert len({item.input.episode_id for item in requests}) == 2
    assert first in requests
    await recorder.stop()


async def test_memory_request_resolution_failure_rolls_back_consolidated_marker(tmp_path: Path) -> None:
    recorder, projection = await _request_projection(tmp_path)
    request, = projection.pending_job_requests()
    with sqlite3.connect(tmp_path / "request-episodes.db") as conn:
        conn.execute("""CREATE TRIGGER fail_resolution BEFORE UPDATE OF resolved_at ON memory_request_outbox
            BEGIN SELECT RAISE(ABORT,'injected resolution failure'); END""")
    with pytest.raises(sqlite3.IntegrityError):
        projection.mark_consolidated(request.input.episode_id, "2026-10-06T00:00:00Z")
    assert projection.pending_job_requests() == [request]
    assert len(projection.pending_consolidation()) == 1
    await recorder.stop()


async def test_memory_request_scan_rejects_unbounded_or_boolean_limit(tmp_path: Path) -> None:
    recorder, projection = await _request_projection(tmp_path)
    for invalid in [0, -1, 1001, True, "64"]:
        with pytest.raises(ValueError):
            projection.pending_job_requests(limit=invalid)
    assert len(projection.pending_job_requests(limit=1)) == 1
    await recorder.stop()

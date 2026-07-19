from pathlib import Path
from types import SimpleNamespace

from glimmer_cradle.cognition.conversation import ConversationController, ConversationStore
from glimmer_cradle.cognition.experience import ExperienceRecorder, Moment, MomentKind


def projection_config():
    return SimpleNamespace(
        segment_target_messages=4,
        chapter_idle_minutes=360,
        chapter_segment_limit=8,
        state_update_messages=2,
        history_candidate_limit=12,
        history_result_limit=4,
        summary_max_chars=2400,
    )


def working_config():
    return SimpleNamespace(
        max_messages_per_conversation=32,
        hydrate_recent_messages=32,
        context_message_limit=2,
    )


async def record_dialogue(recorder: ExperienceRecorder) -> None:
    common = {
        "scene_id": "scene:desktop:primary",
        "conversation_id": "conversation:desktop:primary",
        "continuity_id": "continuity:desktop:user",
        "thread_id": "main",
        "recall_scope": "conversation_private",
        "disclosure_scope": "conversation_private",
        "actor_id": "actor:desktop:user",
    }
    for index, (kind, text) in enumerate((
        (MomentKind.PERCEPTION, "我们以后把测试代号叫星潮"),
        (MomentKind.REPLY, "好，我记住星潮这个代号了"),
        (MomentKind.PERCEPTION, "下次继续讨论音频延迟"),
        (MomentKind.REPLY, "到时从首包延迟开始检查"),
        (MomentKind.PERCEPTION, "现在接着说星潮"),
    )):
        recorder.record(
            kind,
            {"text": text},
            interaction_id=f"turn-{index}",
            importance=0.8,
            **common,
        )
    await recorder.flush()


async def test_conversation_projection_rebuilds_from_experience(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    await record_dialogue(recorder)
    db_path = tmp_path / "conversation" / "conversation.db"

    controller = ConversationController(
        store=ConversationStore(db_path, config=projection_config()),
        recorder=recorder,
        working_config=working_config(),
    )
    await controller.connect()
    state, recent, history = await controller.prompt_context(
        "conversation:desktop:primary",
        "星潮是什么",
        allowed_scopes={"conversation_private", "global_safe", "public"},
    )
    assert "现在接着说星潮" in state
    assert "下次继续讨论音频延迟" not in recent
    assert "现在接着说星潮" in recent
    assert "星潮" in history
    await controller.close()

    db_path.unlink()
    rebuilt = ConversationController(
        store=ConversationStore(db_path, config=projection_config()),
        recorder=recorder,
        working_config=working_config(),
    )
    await rebuilt.connect()
    _, rebuilt_recent, rebuilt_history = await rebuilt.prompt_context(
        "conversation:desktop:primary",
        "星潮是什么",
        allowed_scopes={"conversation_private", "global_safe", "public"},
    )
    assert rebuilt_recent == recent
    assert rebuilt_history == history
    assert await rebuilt.project_pending() == 0
    await rebuilt.close()
    await recorder.stop()


async def test_conversation_projection_filters_before_prompt_assembly(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    await record_dialogue(recorder)
    controller = ConversationController(
        store=ConversationStore(
            tmp_path / "conversation" / "conversation.db",
            config=projection_config(),
        ),
        recorder=recorder,
        working_config=working_config(),
    )
    await controller.connect()
    state, recent, history = await controller.prompt_context(
        "conversation:desktop:primary",
        "星潮",
        allowed_scopes={"public"},
    )
    assert state == ""
    assert recent == ""
    assert history == ""
    await controller.close()
    await recorder.stop()


async def test_conversation_history_page_uses_stable_cursor_and_actor_scope(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    await record_dialogue(recorder)
    controller = ConversationController(
        store=ConversationStore(
            tmp_path / "conversation" / "conversation.db",
            config=projection_config(),
        ),
        recorder=recorder,
        working_config=working_config(),
    )
    await controller.connect()

    thread, first_page, next_cursor, has_more = await controller.history_page(
        "conversation:desktop:primary",
        allowed_scopes={"conversation_private"},
        cursor=None,
        limit=2,
        scene_id="scene:desktop:primary",
        actor_id="actor:desktop:user",
    )
    assert thread["conversation_id"] == "conversation:desktop:primary"
    assert [item.content for item in first_page] == [
        "下次继续讨论音频延迟",
        "到时从首包延迟开始检查",
    ]
    assert has_more is True
    assert next_cursor == "pos:4"

    _, second_page, tail_cursor, tail_has_more = await controller.history_page(
        "conversation:desktop:primary",
        allowed_scopes={"conversation_private"},
        cursor=next_cursor,
        limit=3,
        scene_id="scene:desktop:primary",
        actor_id="actor:desktop:user",
    )
    assert [item.content for item in second_page] == [
        "我们以后把测试代号叫星潮",
        "好，我记住星潮这个代号了",
    ]
    assert tail_cursor is None
    assert tail_has_more is False

    await controller.close()
    await recorder.stop()


async def test_conversation_projection_rejects_identity_or_scope_drift(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path / "experience")
    await recorder.start()
    common = {
        "scene_id": "scene:shared",
        "conversation_id": "conversation:stable",
        "continuity_id": "continuity:stable",
        "thread_id": "main",
        "recall_scope": "conversation_private",
        "disclosure_scope": "conversation_private",
        "actor_id": "actor:user",
    }
    recorder.record(MomentKind.PERCEPTION, {"text": "第一条"}, **common)
    recorder.record(
        MomentKind.REPLY,
        {"text": "不应跨域"},
        **{**common, "recall_scope": "space_local", "disclosure_scope": "space_local"},
    )
    controller = ConversationController(
        store=ConversationStore(
            tmp_path / "conversation" / "conversation.db",
            config=projection_config(),
        ),
        recorder=recorder,
        working_config=working_config(),
    )
    try:
        await controller.connect()
    except ValueError as error:
        assert "权限域不可" in str(error)
        await controller.close()
    else:
        raise AssertionError("同一 canonical Conversation 不得接纳漂移的权限域")
    await recorder.stop()


def test_experience_rejects_unknown_moment_kind() -> None:
    try:
        Moment.create(1, kind="thought", content={"text": "内部草稿"})
    except ValueError as error:
        assert "不支持的 Experience Moment kind" in str(error)
    else:
        raise AssertionError("内部推理草稿不得进入 Experience Ledger")

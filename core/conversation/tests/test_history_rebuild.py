from __future__ import annotations

from pathlib import Path

from glimmer_cradle.conversation import ConversationController, ConversationStore, MomentKind


async def test_new_projection_invalidates_hydrated_working_set(
    tmp_path: Path,
    recorder_factory,
    history_config,
    working_config,
) -> None:
    recorder = recorder_factory(tmp_path / "log")
    await recorder.start()
    common = {
        "scene_id": "scene:refresh",
        "conversation_id": "conversation:refresh",
        "continuity_id": "continuity:refresh",
        "thread_id": "main",
        "interaction_id": "interaction:refresh",
    }
    recorder.record(MomentKind.PERCEPTION, {"text": "第一条"}, **common)
    controller = ConversationController(
        store=ConversationStore(tmp_path / "history.db", config=history_config),
        recorder=recorder,
        working_config=working_config,
    )
    await controller.connect()
    initial = await controller.working_set("conversation:refresh", "main")
    assert [item.content for item in initial.messages] == ["第一条"]

    recorder.record(MomentKind.REPLY, {"text": "第二条"}, **common)
    refreshed = await controller.working_set("conversation:refresh", "main")
    assert refreshed is not initial
    assert [item.content for item in refreshed.messages] == ["第一条", "第二条"]

    await controller.close()
    await recorder.stop()

from pathlib import Path

from glimmer_cradle.cognition.adapters.persistence.sqlite_planning_store import (
    SqlitePlanningStore,
)
from glimmer_cradle.cognition.inference import InferenceResponse, ModelTier
from glimmer_cradle.cognition.planning import PlanningController
from tests.conftest import RecordingObservability


class _Reasoning:
    async def request(self, request, *, tier):
        assert tier == ModelTier.LOCAL_ONLY
        assert request.metadata["trace_id"] == "trace-1"
        return InferenceResponse(
            text=(
                '{"action":"skill_request","original_goal":"查天气",'
                '"goal":"查询上海天气","capability_kind":"realtime_lookup",'
                '"reason":"需要实时数据","confidence":0.91}'
            ),
            tier_used=ModelTier.LOCAL_ONLY,
        )


async def test_planning_decision_is_durable_and_recovers_by_trace(tmp_path: Path) -> None:
    path = tmp_path / "planning.sqlite"
    store = SqlitePlanningStore(path)
    await store.connect()
    controller = PlanningController(
        _Reasoning(), observability=RecordingObservability(), store=store
    )

    plan = await controller.plan(
        goal="  查天气  ",
        scene_id="scene-1",
        trace_id="trace-1",
        tier=ModelTier.LOCAL_ONLY,
    )
    assert plan.action == "skill_request"
    await store.close()

    reopened = SqlitePlanningStore(path)
    await reopened.connect()
    recovered = await reopened.latest(trace_id="trace-1")
    await reopened.close()

    assert recovered is not None
    goal, persisted = recovered
    assert goal.text == "查天气"
    assert goal.scene_id == "scene-1"
    assert persisted.goal == "查询上海天气"
    assert persisted.capability_kind == "realtime_lookup"


async def test_planning_fallback_is_also_journaled(tmp_path: Path) -> None:
    store = SqlitePlanningStore(tmp_path / "planning.sqlite")
    await store.connect()
    controller = PlanningController(
        None, observability=RecordingObservability(), store=store
    )

    plan = await controller.plan(
        goal="普通聊天",
        scene_id="scene-2",
        trace_id="trace-2",
        tier=ModelTier.LOCAL_ONLY,
    )
    recovered = await store.latest(trace_id="trace-2")
    await store.close()

    assert plan.action == "reply"
    assert recovered is not None
    assert recovered[1].reason == "推理服务不可用，降级为普通回复路径"

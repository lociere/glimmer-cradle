"""Loop 感知、注意力、意愿仲裁及原生工具迭代测试。"""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from glimmer_cradle.cognition.adapters.persistence import (
    RelationshipRepository,
    SqliteMemoryStore,
)
from glimmer_cradle.cognition.attention import (
    AttentionController,
    CognitiveAttentionLease,
    make_attention,
    now_iso_ms,
)
from glimmer_cradle.cognition.context import ContextItem
from glimmer_cradle.cognition.inference import (
    InferenceRequest,
    ModelEvent,
    ModelEventKind,
)
from glimmer_cradle.cognition.loop import (
    AffectProvider,
    DriveProvider,
    Intent,
    LoopController,
    MemoryProvider,
    PerceptionProvider,
    Provider,
    SocialProvider,
    StopPolicy,
    WillingnessConfig,
    WillingnessInputs,
    arbitrate,
    compute_willingness,
    salience_for_perception,
    threshold_for,
)
from glimmer_cradle.cognition.loop import (
    make_intent as domain_make_intent,
)
from glimmer_cradle.cognition.perception import (
    Observation,
    ObservationNormalizer,
    ObservationQueue,
)
from glimmer_cradle.cognition.ports import (
    CapabilityDescriptor,
    CapabilityExposure,
    CapabilityInvocation,
    CapabilityResult,
    ResourceDescriptor,
    SkillReference,
    SkillSummary,
)
from glimmer_cradle.cognition.ports.capability_port import LOAD_SKILL, READ_RESOURCE
from tests.conftest import CLOCK, IDS, OBSERVABILITY, build_experience_recorder

PROVIDER_CLASSES = (
    PerceptionProvider,
    AffectProvider,
    MemoryProvider,
    DriveProvider,
    SocialProvider,
)


def test_builtin_providers_implement_stable_sense_contract() -> None:
    assert all(issubclass(provider, Provider) for provider in PROVIDER_CLASSES)
    assert {provider.name for provider in PROVIDER_CLASSES} == {
        "perception",
        "affect",
        "memory",
        "drive",
        "social",
    }
    assert len(set(PROVIDER_CLASSES)) == 5
    assert PROVIDER_CLASSES == (
        PerceptionProvider,
        AffectProvider,
        MemoryProvider,
        DriveProvider,
        SocialProvider,
    )


def test_provider_contract_is_abstract() -> None:
    with pytest.raises(TypeError):
        Provider()  # type: ignore[abstract]


class _EmotionSource:
    def get_state(self):
        return {"emotion_type": "curious", "intensity": 0.8}


class _ContextAssembly:
    def __init__(self) -> None:
        self.query = None

    async def assemble(self, query, **_):
        self.query = query
        return type(
            "Result",
            (),
            {
                "items": [
                    ContextItem(
                        source="episodic",
                        content="记忆：曾聊过雨天",
                        relevance=0.9,
                        importance=0.7,
                        token_estimate=8,
                    )
                ]
            },
        )()


async def test_affect_and_memory_providers_project_current_sources() -> None:
    affect = await AffectProvider(_EmotionSource(), clock=CLOCK, ids=IDS).propose([])
    assert affect[0].content["emotion_type"] == "curious"

    assembly = _ContextAssembly()
    focus = make_attention(
        source="perception",
        content={"text": "雨天", "actor_id": "u1", "scene_id": "s1"},
        salience=1,
        clock=CLOCK,
        ids=IDS,
    )
    memory = await MemoryProvider(assembly, clock=CLOCK, ids=IDS).propose([focus])
    assert memory[0].content["source_kind"] == "episodic"
    assert (assembly.query.actor_id, assembly.query.scene_id) == ("u1", "s1")
    assert await MemoryProvider(assembly, clock=CLOCK, ids=IDS).propose([]) == []


async def test_drive_accumulates_and_social_uses_relationship_projection(
    tmp_path: Path,
) -> None:
    drive = DriveProvider(clock=CLOCK, ids=IDS)
    await drive.propose([])
    drive._last_tick_at -= timedelta(seconds=7200)
    assert isinstance(await drive.propose([]), list)

    database = SqliteMemoryStore(tmp_path / "memory.db")
    await database.connect()
    repository = RelationshipRepository(database)
    social = SocialProvider(repository, clock=CLOCK, ids=IDS)
    focus = make_attention(
        source="perception",
        content={
            "actor_id": "u1",
            "actor_name": "小林",
            "address_mode": "direct",
            "text": "你好",
        },
        salience=1,
        clock=CLOCK,
        ids=IDS,
    )
    await repository.observe(
        "u1", kind="direct", evidence_moment_id="m1", display_name="小林"
    )
    first = (await social.propose([focus]))[0]
    await repository.observe(
        "u1", kind="direct", evidence_moment_id="m2", display_name="小林"
    )
    second = (await social.propose([focus]))[0]
    assert second.content["direct_interactions"] == 2
    assert second.content["familiarity"] > first.content["familiarity"]
    assert "intimacy" not in second.content
    await database.close()


class NativeModel:
    def __init__(self, events: list[dict[str, object]]) -> None:
        self._events = events
        self.requests: list[InferenceRequest] = []

    async def events(self, request: InferenceRequest):
        self.requests.append(request)
        offset = 0 if len(self.requests) == 1 else 2
        for raw in self._events[offset : offset + 2]:
            yield ModelEvent(
                sequence=int(raw["sequence"]),
                kind=ModelEventKind(str(raw["kind"])),
                payload=dict(raw["payload"]),
            )

    async def cancel(self, session_id: str) -> None:
        return None


class Capabilities:
    def __init__(self) -> None:
        self.invocations: list[CapabilityInvocation] = []
        self.exposures: list[tuple[int, int]] = []

    async def expose(self, *, scope: str, run_id: str, step: int, remaining_calls: int) -> CapabilityExposure:
        assert scope == "conversation:test"
        self.exposures.append((step, remaining_calls))
        return CapabilityExposure(run_id, step, (
            CapabilityDescriptor(
                name="weather.lookup",
                description="Look up current weather",
                definition_id="weather.lookup",
                definition_revision=str(step),
                input_schema={"type": "object"},
            ),
        ))

    async def invoke(self, invocation: CapabilityInvocation) -> CapabilityResult:
        self.invocations.append(invocation)
        return CapabilityResult(
            call_id=invocation.call_id,
            name=invocation.name,
            status="succeeded",
            output={"condition": "sunny"},
        )


@pytest.mark.parametrize("failure", ["none", "unexposed", "wrong_kind", "bad_arguments", "foreign_tool", "budget"])
async def test_native_loads_independent_catalogs_with_original_history(tmp_path, failure):
    class Catalog(Capabilities):
        async def expose(self, *, scope, run_id, step, remaining_calls):
            return CapabilityExposure(run_id, step, (),
                (SkillSummary(SkillReference("method", f"m{step}"), "方法", "摘要"),),
                (ResourceDescriptor("资源", "摘要", "resource", f"r{step}"),))

    class Model:
        def __init__(self): self.requests = []
        async def events(self, request):
            self.requests.append(request)
            if len(self.requests) == 1:
                payload = {"call_id": "method-call", "name": LOAD_SKILL, "kind": "skill", "arguments": {"skill_id": "method", "arguments": {"topic": "上海"}}}
                if failure == "unexposed": payload["arguments"]["skill_id"] = "foreign"
                if failure == "wrong_kind": payload["kind"] = "tool"
                if failure == "bad_arguments": payload["arguments"]["arguments"] = []
                if failure == "foreign_tool": payload.update(name="foreign.send", kind="tool")
                yield ModelEvent(0, ModelEventKind.TOOL_CALL, payload)
                yield ModelEvent(1, ModelEventKind.TOOL_CALL, {"call_id": "resource-call", "name": READ_RESOURCE, "kind": "resource",
                    "arguments": {"resource_id": "resource", "arguments": {}}})
                yield ModelEvent(2, ModelEventKind.COMPLETED, {})
            else:
                yield ModelEvent(0, ModelEventKind.TEXT_DELTA, {"text": "完成"})
                yield ModelEvent(1, ModelEventKind.COMPLETED, {})

    recorder = build_experience_recorder(tmp_path / "conversation")
    await recorder.start()
    catalog, model = Catalog(), Model()
    controller = LoopController(workspace=AttentionController(capacity=3, clock=CLOCK), providers=[],
        experience_recorder=recorder, clock=CLOCK, ids=IDS, observability=OBSERVABILITY)
    try:
        run = await controller.run_native(InferenceRequest("", "读取"), model=model, capabilities=catalog, scope="conversation:test",
            stop_policy=StopPolicy(max_capability_calls=1 if failure == "budget" else 8))
        if failure == "none":
            assert run.status == "completed" and run.output == "完成"
            assert [(item.kind, item.definition_id, item.definition_revision, item.arguments) for item in catalog.invocations] == [
                ("skill", "method", "m1", {"topic": "上海"}), ("resource", "resource", "r1", {})]
            assert model.requests[1].history[0].tool_calls[0].arguments == {"skill_id": "method", "arguments": {"topic": "上海"}}
            assert model.requests[1].metadata["capabilities"] == ()
        else:
            assert run.status != "completed" and catalog.invocations == []
    finally:
        await recorder.stop()


async def test_native_loop_passes_tool_result_to_next_model_step(
    tmp_path: Path,
) -> None:
    events = json.loads(
        (Path(__file__).parent / "fixtures" / "model-events.json").read_text(
            encoding="utf-8"
        )
    )
    model = NativeModel(events)
    capabilities = Capabilities()
    recorder = build_experience_recorder(tmp_path / "conversation")
    await recorder.start()
    controller = LoopController(
        workspace=AttentionController(capacity=3, clock=CLOCK),
        providers=[],
        experience_recorder=recorder,
        clock=CLOCK,
        ids=IDS,
        observability=OBSERVABILITY,
    )

    run = await controller.run_native(
        InferenceRequest(system="system", user="weather"),
        model=model,
        capabilities=capabilities,
        scope="conversation:test",
    )
    await recorder.stop()

    assert run.status == "completed"
    assert run.step_count == 2
    assert run.output == "上海今天晴。"
    assert capabilities.invocations[0].idempotency_key.endswith(":call-weather-1")
    assert model.requests[1].metadata["capability_results"] == run.capability_results
    assert capabilities.exposures == [(1, 8), (2, 7)]
    assert capabilities.invocations[0].definition_revision == "1"
    assert model.requests[1].metadata["capabilities"][0].definition_revision == "2"


@pytest.mark.parametrize("failure", ["incomplete", "wrong_result", "wrong_exposure", "revoked"])
async def test_native_loop_rejects_invalid_step_and_result(tmp_path: Path, failure: str) -> None:
    class Model:
        async def events(self, request):
            yield ModelEvent(0, ModelEventKind.TOOL_CALL, {"call_id": "call-1", "name": "weather.lookup", "arguments": {}})
            if failure != "incomplete":
                yield ModelEvent(1, ModelEventKind.COMPLETED, {})

    class InvalidCapabilities(Capabilities):
        async def expose(self, **kwargs):
            snapshot = await super().expose(**kwargs)
            if failure == "wrong_exposure":
                return CapabilityExposure("wrong-run", snapshot.step, snapshot.tools)
            if failure == "revoked":
                return CapabilityExposure(snapshot.run_id, snapshot.step, ())
            return snapshot

        async def invoke(self, invocation):
            result = await super().invoke(invocation)
            if failure == "wrong_result":
                return CapabilityResult("other-call", result.name, "succeeded")
            return result

    recorder = build_experience_recorder(tmp_path / "conversation")
    await recorder.start()
    capabilities = InvalidCapabilities()
    controller = LoopController(workspace=AttentionController(clock=CLOCK), providers=[], experience_recorder=recorder,
        clock=CLOCK, ids=IDS, observability=OBSERVABILITY)
    try:
        if failure in {"wrong_result", "wrong_exposure"}:
            with pytest.raises(ValueError, match="capability"):
                await controller.run_native(InferenceRequest(system="", user=""), model=Model(), capabilities=capabilities, scope="conversation:test")
        else:
            run = await controller.run_native(InferenceRequest(system="", user=""), model=Model(), capabilities=capabilities, scope="conversation:test")
            assert run.stop_reason == ("model_stream_incomplete" if failure == "incomplete" else "capability_not_exposed")
            assert capabilities.invocations == []
    finally:
        await recorder.stop()


async def test_native_loop_stops_before_exceeding_capability_budget(
    tmp_path: Path,
) -> None:
    events = json.loads(
        (Path(__file__).parent / "fixtures" / "model-events.json").read_text(
            encoding="utf-8"
        )
    )
    recorder = build_experience_recorder(tmp_path / "conversation")
    await recorder.start()
    controller = LoopController(
        workspace=AttentionController(capacity=3, clock=CLOCK),
        providers=[],
        experience_recorder=recorder,
        clock=CLOCK,
        ids=IDS,
        observability=OBSERVABILITY,
    )
    capabilities = Capabilities()

    run = await controller.run_native(
        InferenceRequest(system="system", user="weather"),
        model=NativeModel(events),
        capabilities=capabilities,
        scope="conversation:test",
        stop_policy=StopPolicy(max_capability_calls=0),
    )
    await recorder.stop()

    assert run.status == "stopped"
    assert run.stop_reason == "capability_call_limit"
    assert capabilities.invocations == []


@pytest.mark.parametrize("failure", ["duplicate", "late_invalid", "over_budget", "nan", "oversize", "order"])
async def test_native_batch_is_validated_before_any_side_effect(tmp_path, failure):
    class Model:
        async def events(self, request):
            first = {"call_id": "one", "name": "weather.lookup", "arguments": {}}
            second = {**first, "call_id": "two"}
            if failure == "duplicate":
                second["call_id"] = "one"
            elif failure == "late_invalid":
                second["name"] = "not-exposed"
            elif failure == "nan":
                second["arguments"] = {"invalid": float("nan")}
            elif failure == "oversize":
                second["arguments"] = {"invalid": "a" * 65536}
            yield ModelEvent(0, ModelEventKind.TOOL_CALL, first)
            yield ModelEvent(0 if failure == "order" else 1, ModelEventKind.TOOL_CALL, second)
            yield ModelEvent(2, ModelEventKind.COMPLETED, {})

    capabilities = Capabilities()
    controller = LoopController(workspace=AttentionController(clock=CLOCK), providers=[],
        experience_recorder=build_experience_recorder(tmp_path), clock=CLOCK, ids=IDS, observability=OBSERVABILITY)
    if failure == "order":
        with pytest.raises(ValueError, match="order"):
            await controller.run_native(InferenceRequest("", ""), model=Model(), capabilities=capabilities, scope="conversation:test")
    else:
        run = await controller.run_native(InferenceRequest("", ""), model=Model(), capabilities=capabilities,
            scope="conversation:test", stop_policy=StopPolicy(max_capability_calls=1 if failure == "over_budget" else 8))
        assert run.status in {"failed", "stopped"}
    assert capabilities.invocations == []


async def test_native_loop_preserves_history_but_only_final_step_is_reply(tmp_path):
    class Model:
        def __init__(self): self.requests = []
        async def events(self, request):
            self.requests.append(request)
            yield ModelEvent(0, ModelEventKind.TEXT_DELTA, {"text": "最终回复" if request.history else "中间说明"})
            if not request.history:
                yield ModelEvent(1, ModelEventKind.TOOL_CALL,
                    {"call_id": "call", "name": "weather.lookup", "arguments": {"city": "上海"}})
            yield ModelEvent(2, ModelEventKind.COMPLETED, {})

    model, capabilities = Model(), Capabilities()
    controller = LoopController(workspace=AttentionController(clock=CLOCK), providers=[],
        experience_recorder=build_experience_recorder(tmp_path), clock=CLOCK, ids=IDS, observability=OBSERVABILITY)
    run = await controller.run_native(InferenceRequest("", ""), model=model, capabilities=capabilities, scope="conversation:test")
    assert run.output == "最终回复"
    step = model.requests[1].history[0]
    assert step.text == "中间说明" and step.tool_calls[0].arguments == {"city": "上海"}
    assert step.results == run.capability_results


@pytest.mark.parametrize("failure", ["revoked", "unknown", "deadline", "output"])
async def test_native_loop_revocation_recovery_deadline_and_stream_close(tmp_path, failure):
    closed = []
    allowed = True
    class Model:
        async def events(self, request):
            nonlocal allowed
            try:
                if failure == "deadline":
                    await asyncio.Event().wait()
                if failure == "output":
                    yield ModelEvent(0, ModelEventKind.TEXT_DELTA, {"text": "abcd"})
                else:
                    yield ModelEvent(0, ModelEventKind.TOOL_CALL,
                        {"call_id": "call", "name": "weather.lookup", "arguments": {}})
                if failure == "revoked": allowed = False
                yield ModelEvent(1, ModelEventKind.COMPLETED, {})
            finally:
                closed.append(True)
    class Capability(Capabilities):
        async def invoke(self, invocation):
            self.invocations.append(invocation)
            return CapabilityResult(invocation.call_id, invocation.name, "unknown")
    async def is_allowed(): return allowed
    capabilities = Capability()
    controller = LoopController(workspace=AttentionController(clock=CLOCK), providers=[],
        experience_recorder=build_experience_recorder(tmp_path), clock=CLOCK, ids=IDS, observability=OBSERVABILITY)
    coroutine = controller.run_native(InferenceRequest("", ""), model=Model(), capabilities=capabilities,
        scope="conversation:test", invocation_allowed=is_allowed,
        stop_policy=StopPolicy(max_output_chars=3, max_duration_seconds=0.02 if failure == "deadline" else 1))
    if failure == "deadline":
        with pytest.raises(TimeoutError): await coroutine
    else:
        run = await coroutine
        assert run.stop_reason == {"revoked": "volition_denied", "unknown": "recovery_required", "output": "output_limit"}[failure]
    assert closed == [True]
    assert len(capabilities.invocations) == (1 if failure == "unknown" else 0)


@pytest.mark.parametrize("at", ["before_exposure", "after_exposure", "next_step"])
async def test_native_model_tier_is_rechecked_before_every_inference(tmp_path, at):
    allowed = at != "before_exposure"
    class Capability(Capabilities):
        async def expose(self, **kwargs):
            nonlocal allowed
            result = await super().expose(**kwargs)
            if at == "after_exposure": allowed = False
            return result
        async def invoke(self, invocation):
            nonlocal allowed
            allowed = False
            return await super().invoke(invocation)
    class Model:
        calls = 0
        async def events(self, request):
            self.calls += 1
            yield ModelEvent(0, ModelEventKind.TOOL_CALL,
                {"call_id": "call", "name": "weather.lookup", "arguments": {}})
            yield ModelEvent(1, ModelEventKind.COMPLETED, {})
    model, capabilities = Model(), Capability()
    controller = LoopController(workspace=AttentionController(clock=CLOCK), providers=[],
        experience_recorder=build_experience_recorder(tmp_path), clock=CLOCK, ids=IDS, observability=OBSERVABILITY)
    run = await controller.run_native(InferenceRequest("", ""), model=model, capabilities=capabilities,
        scope="conversation:test", inference_allowed=lambda: allowed)
    assert run.stop_reason == "model_tier_denied" and model.calls == (1 if at == "next_step" else 0)


def _item(
    source: str,
    salience: float,
    *,
    decay_in_seconds: float | None = None,
    content: dict | None = None,
):
    decay_at = None
    if decay_in_seconds is not None:
        decay_at = (
            (datetime.now(UTC) + timedelta(seconds=decay_in_seconds))
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )
    return make_attention(
        source=source,
        content=content or {"v": source},
        salience=salience,
        decay_at=decay_at,
        clock=CLOCK,
        ids=IDS,
    )


async def test_propose_under_capacity_accepts() -> None:
    ws = AttentionController(capacity=3, clock=CLOCK)
    assert await ws.propose(_item("perception", 0.5)) is True
    assert await ws.size() == 1


async def test_multiple_propose_fills_to_capacity() -> None:
    ws = AttentionController(capacity=3, clock=CLOCK)
    for s in [0.1, 0.5, 0.9]:
        assert await ws.propose(_item("memory", s)) is True
    assert await ws.size() == 3


async def test_propose_at_capacity_evicts_lowest() -> None:
    ws = AttentionController(capacity=3, clock=CLOCK)
    await ws.propose(_item("memory", 0.1))
    await ws.propose(_item("memory", 0.5))
    await ws.propose(_item("memory", 0.9))
    # 新项 0.6 > 现存最低 0.1 → 接纳
    assert await ws.propose(_item("drive", 0.6)) is True
    snap = await ws.snapshot()
    saliences = sorted(it.salience for it in snap)
    assert saliences == [0.5, 0.6, 0.9]  # 0.1 被淘汰


async def test_propose_rejected_when_weaker_than_lowest() -> None:
    ws = AttentionController(capacity=2, clock=CLOCK)
    await ws.propose(_item("memory", 0.7))
    await ws.propose(_item("memory", 0.8))
    # 新项 0.3 < 现存最低 0.7 → 拒收
    assert await ws.propose(_item("drive", 0.3)) is False
    snap = await ws.snapshot()
    assert sorted(it.salience for it in snap) == [0.7, 0.8]


async def test_direct_perception_replaces_equal_drive_at_capacity() -> None:
    """直接对话是互动义务：同等 salience 下应压过长驻 drive。"""
    ws = AttentionController(capacity=2, clock=CLOCK)
    await ws.propose(_item("drive", 1.0, content={"drive": "curiosity"}))
    await ws.propose(_item("drive", 1.0, content={"drive": "companionship"}))

    accepted = await ws.propose(
        _item(
            "perception",
            1.0,
            content={
                "text": "你好",
                "address_mode": "direct",
                "scene_id": "desktop-ui:user",
            },
        )
    )

    assert accepted is True
    snap = await ws.snapshot()
    assert any(it.source == "perception" for it in snap)
    assert len(snap) == 2


async def test_broadcast_empty_returns_none() -> None:
    ws = AttentionController(clock=CLOCK)
    assert await ws.focus() is None


async def test_broadcast_returns_highest_salience() -> None:
    ws = AttentionController(capacity=5, clock=CLOCK)
    await ws.propose(_item("memory", 0.3, content={"v": "memo"}))
    await ws.propose(_item("affect", 0.7, content={"v": "feel"}))
    await ws.propose(_item("drive", 0.5, content={"v": "drive"}))
    top = await ws.focus()
    assert top is not None
    assert top.salience == 0.7
    assert top.source == "affect"


async def test_broadcast_tie_prefers_direct_perception_over_drive() -> None:
    ws = AttentionController(capacity=5, clock=CLOCK)
    await ws.propose(_item("drive", 1.0, content={"drive": "companionship"}))
    await ws.propose(
        _item(
            "perception",
            1.0,
            content={
                "text": "在吗",
                "address_mode": "direct",
                "scene_id": "desktop-ui:user",
            },
        )
    )

    top = await ws.focus()

    assert top is not None
    assert top.source == "perception"
    assert top.content["text"] == "在吗"


async def test_expired_items_pruned_on_access() -> None:
    ws = AttentionController(capacity=5, clock=CLOCK)
    await ws.propose(_item("memory", 0.9, decay_in_seconds=-1))  # 已过期
    await ws.propose(_item("memory", 0.4))  # 未过期
    # broadcast 会先 prune
    top = await ws.focus()
    assert top is not None
    assert top.salience == 0.4  # 0.9 已过期


async def test_prune_expired_returns_count() -> None:
    import asyncio

    ws = AttentionController(capacity=5, clock=CLOCK)
    # 投放时尚未过期，propose 不会剪掉；之后小睡使其过期，再显式 prune
    await ws.propose(_item("memory", 0.1, decay_in_seconds=0.05))
    await ws.propose(_item("affect", 0.2, decay_in_seconds=0.05))
    await ws.propose(_item("drive", 0.3))  # 永久
    await asyncio.sleep(0.1)
    pruned = await ws.prune_expired()
    assert pruned == 2
    assert await ws.size() == 1


async def test_snapshot_returns_copy() -> None:
    ws = AttentionController(capacity=3, clock=CLOCK)
    await ws.propose(_item("memory", 0.5))
    snap = await ws.snapshot()
    snap.clear()  # 修改 snapshot 不影响 workspace
    assert await ws.size() == 1


async def test_clear_empties_workspace() -> None:
    ws = AttentionController(capacity=3, clock=CLOCK)
    await ws.propose(_item("memory", 0.5))
    await ws.propose(_item("memory", 0.5))
    await ws.clear()
    assert await ws.size() == 0


def test_invalid_capacity_raises() -> None:
    with pytest.raises(ValueError):
        AttentionController(capacity=0, clock=CLOCK)


def test_make_attention_fills_id_and_created_at() -> None:
    it = make_attention(
        source="perception", content={"text": "hi"}, salience=0.5, clock=CLOCK, ids=IDS
    )
    assert it.attention_id
    assert it.created_at.endswith("Z")
    assert it.salience == 0.5
    assert it.source == "perception"


def test_now_iso_ms_format() -> None:
    s = now_iso_ms(CLOCK)
    assert s.endswith("Z") and "T" in s


async def test_focus_lease_holds_candidate_until_release() -> None:
    controller = AttentionController(capacity=3, lease_seconds=30, clock=CLOCK)
    first = _item("memory", 0.5)
    await controller.propose(first)
    assert await controller.focus() is first
    assert controller.lease is not None

    higher = _item("affect", 0.9)
    await controller.propose(higher)
    assert await controller.focus() is first

    assert await controller.remove(first.attention_id)
    assert controller.lease is None
    assert await controller.focus() is higher


async def test_eviction_releases_focused_candidate() -> None:
    controller = AttentionController(capacity=1, lease_seconds=30, clock=CLOCK)
    first = _item("drive", 0.2)
    await controller.propose(first)
    await controller.focus()

    replacement = _item("perception", 1.0, content={"address_mode": "direct"})
    accepted, evicted = await controller.propose_with_eviction(replacement)

    assert accepted
    assert evicted is first
    assert controller.lease is None
    assert await controller.focus() is replacement


def test_cognitive_attention_lease_expires_at_boundary() -> None:
    now = datetime(2026, 1, 2, tzinfo=UTC)
    lease = CognitiveAttentionLease.acquire("attention-1", now=now, duration_seconds=5)

    assert lease.is_valid(now + timedelta(seconds=4.999))
    assert not lease.is_valid(now + timedelta(seconds=5))


def _entry(
    *,
    address_mode="direct",
    familiarity=5,
    text="hi",
    scene_id="napcat:group:1",
    trace_id="t1",
    actor_id=None,
    actor_name=None,
    response_policy="reply_allowed",
    interaction_id="interaction:1",
    payload_digest="sha256:payload",
) -> Observation:
    return Observation(
        scene_id=scene_id,
        conversation_id=f"conversation:{scene_id}",
        continuity_id="continuity:test-user",
        thread_id="main",
        recall_scope="conversation_private",
        disclosure_scope="conversation_private",
        address_mode=address_mode,
        familiarity=familiarity,
        response_policy=response_policy,
        text=text,
        trace_id=trace_id,
        actor_id=actor_id,
        actor_name=actor_name,
        interaction_id=interaction_id,
        payload_digest=payload_digest,
    )


def test_queue_put_and_drain_fifo() -> None:
    q = ObservationQueue(max_size=10)
    q.put(_entry(text="A"))
    q.put(_entry(text="B"))
    q.put(_entry(text="C"))
    drained = q.drain(max_items=10)
    assert [e.text for e in drained] == ["A", "B", "C"]
    assert q.size() == 0


def test_queue_drain_partial() -> None:
    q = ObservationQueue(max_size=10)
    for i in range(5):
        q.put(_entry(text=f"e{i}"))
    drained = q.drain(max_items=2)
    assert len(drained) == 2
    assert q.size() == 3
    # 剩下的还能再 drain
    remaining = q.drain(max_items=10)
    assert len(remaining) == 3


def test_queue_max_size_drops_oldest() -> None:
    q = ObservationQueue(max_size=3)
    for i in range(5):
        q.put(_entry(text=f"e{i}"))
    assert q.size() == 3
    drained = q.drain(max_items=10)
    # 最旧的 e0, e1 被挤掉；留 e2, e3, e4
    assert [e.text for e in drained] == ["e2", "e3", "e4"]


def test_queue_drain_empty_returns_empty() -> None:
    q = ObservationQueue()
    assert q.drain() == []


def test_queue_invalid_max_size() -> None:
    with pytest.raises(ValueError):
        ObservationQueue(max_size=0)


def test_queue_clear() -> None:
    q = ObservationQueue()
    q.put(_entry())
    q.put(_entry())
    q.clear()
    assert q.size() == 0


def test_observation_normalizer_clamps_familiarity_and_trims_identity() -> None:
    normalized = ObservationNormalizer().normalize(
        _entry(familiarity=99, text="  hello  ", actor_name=" Alice ")
    )
    assert normalized.familiarity == 10
    assert normalized.text == "hello"
    assert normalized.actor_name == "Alice"


def test_observation_normalizer_rejects_unbound_payload() -> None:
    with pytest.raises(ValueError, match="payload_digest"):
        ObservationNormalizer().normalize(_entry(payload_digest=" "))


def test_salience_direct_with_high_familiarity() -> None:
    assert salience_for_perception(address_mode="direct", familiarity=10) == 1.0


def test_salience_direct_always_caps_attention() -> None:
    assert salience_for_perception(address_mode="direct", familiarity=-5) == 1.0
    assert salience_for_perception(address_mode="direct", familiarity=5) == 1.0


def test_salience_ambient_with_zero_familiarity() -> None:
    # 0.4 + 0 = 0.4
    assert salience_for_perception(
        address_mode="ambient", familiarity=0
    ) == pytest.approx(0.4)


def test_salience_direct_dominates_ambient() -> None:
    direct = salience_for_perception(address_mode="direct", familiarity=5)
    ambient = salience_for_perception(address_mode="ambient", familiarity=5)
    assert direct > ambient


def test_salience_familiarity_clipped() -> None:
    # ambient familiarity 越界（>10）也按 10 算
    assert salience_for_perception(
        address_mode="ambient", familiarity=99
    ) == pytest.approx(0.7)
    assert salience_for_perception(
        address_mode="ambient", familiarity=-5
    ) == pytest.approx(0.4)


def test_salience_floor_at_point_one() -> None:
    # 即使 base 极小（未来若改公式），下限 0.1
    assert salience_for_perception(address_mode="weird", familiarity=0) >= 0.1


async def test_provider_empty_queue_returns_empty() -> None:
    q = ObservationQueue()
    p = PerceptionProvider(q, clock=CLOCK, ids=IDS)
    assert await p.propose([]) == []


async def test_provider_drains_and_proposes() -> None:
    q = ObservationQueue()
    q.put(_entry(text="你好", address_mode="direct", familiarity=8))
    q.put(_entry(text="哈喽", address_mode="ambient", familiarity=2))
    p = PerceptionProvider(q, clock=CLOCK, ids=IDS)
    items = await p.propose([])
    assert len(items) == 2
    assert all(it.source == "perception" for it in items)
    assert items[0].content["text"] == "你好"
    assert items[0].content["address_mode"] == "direct"
    assert items[0].content["response_policy"] == "reply_allowed"
    assert items[0].salience == 1.0
    # ambient + familiarity=2 → 0.4 + 0.06 = 0.46
    assert items[1].salience == pytest.approx(0.46)
    assert q.size() == 0  # 已 drain


async def test_provider_carries_response_policy() -> None:
    q = ObservationQueue()
    q.put(_entry(address_mode="ambient", response_policy="observe_only"))
    p = PerceptionProvider(q, clock=CLOCK, ids=IDS)
    items = await p.propose([])
    assert items[0].content["response_policy"] == "observe_only"


async def test_provider_max_items_per_tick_caps_drain() -> None:
    q = ObservationQueue()
    for i in range(10):
        q.put(_entry(text=f"e{i}"))
    p = PerceptionProvider(q, max_items_per_tick=3, clock=CLOCK, ids=IDS)
    items = await p.propose([])
    assert len(items) == 3
    assert q.size() == 7  # 留 7 个等下一拍


async def test_provider_carries_actor_info_when_present() -> None:
    q = ObservationQueue()
    q.put(_entry(actor_id="napcat:user:U_1", actor_name="Alice"))
    p = PerceptionProvider(q, clock=CLOCK, ids=IDS)
    items = await p.propose([])
    assert items[0].content["actor_id"] == "napcat:user:U_1"
    assert items[0].content["actor_name"] == "Alice"


async def test_provider_omits_actor_fields_when_absent() -> None:
    q = ObservationQueue()
    q.put(_entry(actor_id=None, actor_name=None))
    p = PerceptionProvider(q, clock=CLOCK, ids=IDS)
    items = await p.propose([])
    assert "actor_id" not in items[0].content
    assert "actor_name" not in items[0].content


def make_intent(**values) -> Intent:
    return domain_make_intent(**values, intent_id=IDS.new(), created_at=CLOCK.now_iso())


def test_willingness_zero_inputs_returns_default_persona_only() -> None:
    # 全零 + default extraversion 0.5；只有 persona 项贡献 0.5*0.1 = 0.05
    w = compute_willingness(WillingnessInputs())
    assert w == pytest.approx(0.05)


def test_willingness_direct_address_dominates_over_ambient() -> None:
    direct = compute_willingness(WillingnessInputs(address_mode="direct"))
    ambient = compute_willingness(WillingnessInputs(address_mode="ambient"))
    assert direct > ambient


def test_willingness_strong_emotion_increases() -> None:
    base = compute_willingness(WillingnessInputs())
    strong = compute_willingness(WillingnessInputs(emotion_intensity=0.9))
    assert strong > base


def test_willingness_high_intimacy_increases() -> None:
    base = compute_willingness(WillingnessInputs())
    high = compute_willingness(WillingnessInputs(relationship_intimacy=1.0))
    assert high > base


def test_willingness_silence_normalized() -> None:
    # silence_seconds 等于 normalize_s → silence_score = 1.0
    cfg = WillingnessConfig(silence_normalize_s=300.0)
    w_short = compute_willingness(WillingnessInputs(silence_seconds=10.0), cfg)
    w_long = compute_willingness(WillingnessInputs(silence_seconds=300.0), cfg)
    w_very_long = compute_willingness(WillingnessInputs(silence_seconds=10000.0), cfg)
    assert w_short < w_long
    assert w_very_long == w_long  # 已 clip 到 1.0


def test_willingness_extraversion_override() -> None:
    # 显式 extraversion=1.0 > default 0.5
    w_default = compute_willingness(WillingnessInputs())
    w_extra = compute_willingness(WillingnessInputs(persona_extraversion=1.0))
    assert w_extra > w_default


def test_willingness_capped_at_one() -> None:
    # 全部最大
    w = compute_willingness(
        WillingnessInputs(
            address_mode="direct",
            emotion_intensity=1.0,
            relationship_intimacy=1.0,
            drive_companionship=1.0,
            silence_seconds=10000.0,
            persona_extraversion=1.0,
        )
    )
    assert w == 1.0  # 默认权重 sum = 1.0


def test_willingness_unknown_address_mode_zero_address_score() -> None:
    # address_mode 是空串 → address_score = 0
    w1 = compute_willingness(WillingnessInputs(address_mode=""))
    w2 = compute_willingness(WillingnessInputs(address_mode="weird"))
    assert w1 == w2


def test_threshold_by_activity_state() -> None:
    cfg = WillingnessConfig()
    assert threshold_for("engaged", cfg) < threshold_for("ambient", cfg)
    assert threshold_for("ambient", cfg) < threshold_for("quiescent", cfg)
    assert threshold_for("quiescent", cfg) > 1.0  # 永远不达


def test_threshold_unknown_state_default() -> None:
    assert threshold_for("alien", WillingnessConfig()) == 0.5


def test_make_intent_fills_id_and_timestamp() -> None:
    intent = make_intent(
        type="reply", initiative="reactive", willingness=0.7, payload={"text": "嗯"}
    )
    assert intent.intent_id and len(intent.intent_id) == 32
    assert intent.created_at.endswith("Z")
    assert intent.willingness == 0.7
    assert intent.type.value == "reply"
    assert intent.initiative.value == "reactive"


def test_make_intent_willingness_clipped() -> None:
    intent = make_intent(type="thought", initiative="proactive", willingness=2.5)
    assert intent.willingness == 1.0
    intent2 = make_intent(type="thought", initiative="proactive", willingness=-0.5)
    assert intent2.willingness == 0.0


def test_make_intent_default_payload_empty_dict() -> None:
    intent = make_intent(type="silence", initiative="reactive", willingness=0.3)
    assert intent.payload == {}


def _intent(type: str, willingness: float, initiative: str = "proactive") -> Intent:
    return make_intent(type=type, initiative=initiative, willingness=willingness)


def test_arbitrate_below_threshold_suppressed() -> None:
    intents = [_intent("reply", 0.3)]
    result = arbitrate(intents, threshold=0.5, allows_proactive=True)
    assert result.accepted == []
    assert len(result.suppressed) == 1
    assert result.suppressed[0][1] == "below_threshold"


def test_arbitrate_proactive_blocked_when_disallowed() -> None:
    intents = [
        _intent("reply", 0.9),
        _intent("thought", 0.8),
        _intent("emotion", 0.7, initiative="reactive"),  # 响应性情绪外显，放过
    ]
    result = arbitrate(intents, threshold=0.5, allows_proactive=False)
    accepted_types = {it.type.value for it in result.accepted}
    assert accepted_types == {"emotion"}
    blocked_reasons = [r for _, r in result.suppressed]
    assert blocked_reasons.count("proactive_blocked") == 2


def test_arbitrate_reactive_action_bypasses_proactive_willingness_gate() -> None:
    intent = _intent("action", 0.1, initiative="reactive")
    result = arbitrate([intent], threshold=1.1, allows_proactive=False)
    assert result.accepted == [intent]
    assert result.suppressed == []


def test_arbitrate_reply_uniqueness_highest_wins() -> None:
    intents = [
        _intent("reply", 0.6),
        _intent("reply", 0.9),  # 应胜出
        _intent("reply", 0.7),
        _intent("thought", 0.8),
    ]
    result = arbitrate(intents, threshold=0.5, allows_proactive=True)
    # 1 个 reply（最高）+ 1 个 thought
    assert len(result.accepted) == 2
    reply_in_accepted = [it for it in result.accepted if it.type.value == "reply"]
    assert len(reply_in_accepted) == 1
    assert reply_in_accepted[0].willingness == 0.9
    # 2 个 reply 被压
    duplicate_count = sum(1 for _, r in result.suppressed if r == "reply_duplicate")
    assert duplicate_count == 2


def test_arbitrate_accepted_sorted_by_willingness_desc() -> None:
    intents = [
        _intent("thought", 0.6),
        _intent("emotion", 0.9),
        _intent("action", 0.7),
    ]
    result = arbitrate(intents, threshold=0.5, allows_proactive=True)
    willingness = [it.willingness for it in result.accepted]
    assert willingness == sorted(willingness, reverse=True)


def test_arbitrate_empty_input() -> None:
    result = arbitrate([], threshold=0.5, allows_proactive=True)
    assert result.accepted == []
    assert result.suppressed == []


def test_arbitrate_threshold_exact_match_accepted() -> None:
    """willingness == threshold 按"达阈"算（不严格大于）。"""
    intent = _intent("reply", 0.5)
    result = arbitrate([intent], threshold=0.5, allows_proactive=True)
    assert len(result.accepted) == 1


def test_arbitrate_proactive_blocked_dormant_scenario() -> None:
    """Quiescent 状态：阈值 1.1 + allows_proactive=False。"""
    intents = [_intent("reply", 0.99)]
    threshold = threshold_for("quiescent", WillingnessConfig())
    result = arbitrate(intents, threshold=threshold, allows_proactive=False)
    assert result.accepted == []
    # 被先 below_threshold 压住，根本到不了 proactive 检查
    assert any(r == "below_threshold" for _, r in result.suppressed)


async def test_loop_intend_with_perception_creates_reply_intent(tmp_path) -> None:
    """LoopController 接 Volition 后：perception 广播 → reply intent。"""
    from glimmer_cradle.cognition.attention import AttentionController, make_attention
    from glimmer_cradle.cognition.loop import Provider
    from tests.test_cycle_controller import _CloudActivity, _EmptyCapabilities

    class _Fixed(Provider):
        name = "perception"

        async def propose(self, snap):
            return [
                make_attention(
                    source="perception",
                    content={
                        "text": "你好",
                        "address_mode": "direct",
                        "familiarity": 8,
                        "scene_id": "s",
                        "conversation_id": "conversation:s",
                        "continuity_id": "continuity:user",
                        "trace_id": "trace-native-volition",
                    },
                    salience=0.9,
                    clock=CLOCK,
                    ids=IDS,
                )
            ]

    class _TextModel:
        async def events(self, req):
            yield ModelEvent(0, ModelEventKind.TEXT_DELTA, {"text": "你好呀"})
            yield ModelEvent(1, ModelEventKind.COMPLETED)

    ws = AttentionController(capacity=3, clock=CLOCK)
    recorder = build_experience_recorder(tmp_path)
    await recorder.start()
    try:
        # 默认 awake 阈值 0.4；纯 direct address（0.3）+ 默认外向（0.05）= 0.35
        # 不达阈。用低阈值 config 测试链路：确认 perception → reply intent 这条
        # wiring 在阈值过得去时正确工作（默认参数下"光被叫不够回应"是合理策略）。
        cfg = WillingnessConfig(threshold_by_activity={"engaged": 0.2})
        loop = LoopController(
            workspace=ws,
            providers=[_Fixed()],
            experience_recorder=recorder,
            willingness_config=cfg,
            native_model=_TextModel(),
            capability_factory=lambda _: _EmptyCapabilities(),
            activity_controller=_CloudActivity(),
            clock=CLOCK,
            ids=IDS,
            observability=OBSERVABILITY,
        )  # 阶段 7.2 生成回复
        await loop.tick_once()
        result = loop.last_arbitration
        assert result is not None
        assert len(result.accepted) == 1
        intent = result.accepted[0]
        assert intent.type.value == "reply"
        # 阶段 7.2：回复文本来自 Deliberate 生成（非回显用户的"你好"）
        assert intent.payload["text"] == "你好呀"
        assert intent.willingness > 0  # direct + ... 应过阈
    finally:
        await recorder.stop()


async def test_loop_intend_no_broadcast_no_intent(tmp_path) -> None:
    """无广播（providers 全空）→ 无意图。"""
    from glimmer_cradle.cognition.attention import AttentionController

    ws = AttentionController(clock=CLOCK)
    recorder = build_experience_recorder(tmp_path)
    await recorder.start()
    try:
        loop = LoopController(
            workspace=ws,
            providers=[],
            experience_recorder=recorder,
            clock=CLOCK,
            ids=IDS,
            observability=OBSERVABILITY,
        )
        await loop.tick_once()
        result = loop.last_arbitration
        assert result is not None
        assert result.accepted == []
        assert result.suppressed == []
    finally:
        await recorder.stop()


async def test_loop_intend_drive_source_creates_thought(tmp_path) -> None:
    """drive(curiosity) 广播 → thought intent；不是 reply。"""
    from glimmer_cradle.cognition.attention import AttentionController, make_attention
    from glimmer_cradle.cognition.loop import Provider

    class _Fixed(Provider):
        name = "drive"

        async def propose(self, snap):
            return [
                make_attention(
                    source="drive",
                    content={
                        "drive": "curiosity",
                        "level": 0.8,
                        "all_levels": {
                            "curiosity": 0.8,
                            "companionship": 0.2,
                            "rest": 0.1,
                        },
                    },
                    salience=0.8,
                    clock=CLOCK,
                    ids=IDS,
                )
            ]

    ws = AttentionController(capacity=3, clock=CLOCK)
    recorder = build_experience_recorder(tmp_path)
    await recorder.start()
    try:
        loop = LoopController(
            workspace=ws,
            providers=[_Fixed()],
            experience_recorder=recorder,
            willingness_config=WillingnessConfig(
                threshold_by_activity={"engaged": 0.0},  # 直放
            ),
            clock=CLOCK,
            ids=IDS,
            observability=OBSERVABILITY,
        )
        await loop.tick_once()
        result = loop.last_arbitration
        assert result is not None
        # 默认无 activity → state="engaged"；threshold 0.0 直放
        assert len(result.accepted) == 1
        assert result.accepted[0].type.value == "thought"
    finally:
        await recorder.stop()

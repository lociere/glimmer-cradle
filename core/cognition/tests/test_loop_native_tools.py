import json
from datetime import timedelta
from pathlib import Path

import pytest

from glimmer_cradle.cognition.adapters.persistence import (
    RelationshipRepository,
    SqliteMemoryStore,
)
from glimmer_cradle.cognition.attention import AttentionController, make_attention
from glimmer_cradle.cognition.context import ContextItem
from glimmer_cradle.cognition.inference import InferenceRequest, ModelEvent, ModelEventKind
from glimmer_cradle.cognition.loop import (
    AffectProvider,
    DriveProvider,
    LoopController,
    MemoryProvider,
    PerceptionProvider,
    Provider,
    SocialProvider,
    StopPolicy,
)
from glimmer_cradle.cognition.ports import (
    CapabilityDescriptor,
    CapabilityInvocation,
    CapabilityResult,
)
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
        "perception", "affect", "memory", "drive", "social"
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
        return type("Result", (), {"items": [ContextItem(
            source="episodic", content="记忆：曾聊过雨天", relevance=0.9,
            importance=0.7, token_estimate=8,
        )]})()


async def test_affect_and_memory_providers_project_current_sources() -> None:
    affect = await AffectProvider(
        _EmotionSource(), clock=CLOCK, ids=IDS
    ).propose([])
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
        content={"actor_id": "u1", "actor_name": "小林", "address_mode": "direct", "text": "你好"},
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

    async def expose(self, *, scope: str) -> tuple[CapabilityDescriptor, ...]:
        assert scope == "conversation:test"
        return (
            CapabilityDescriptor(
                name="weather.lookup",
                description="Look up current weather",
                input_schema={"type": "object"},
            ),
        )

    async def invoke(self, invocation: CapabilityInvocation) -> CapabilityResult:
        self.invocations.append(invocation)
        return CapabilityResult(
            call_id=invocation.call_id,
            name=invocation.name,
            status="succeeded",
            output={"condition": "sunny"},
        )


async def test_native_loop_passes_tool_result_to_next_model_step(tmp_path: Path) -> None:
    events = json.loads(
        (Path(__file__).parent / "fixtures" / "model-events.json").read_text(encoding="utf-8")
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


async def test_native_loop_stops_before_exceeding_capability_budget(tmp_path: Path) -> None:
    events = json.loads(
        (Path(__file__).parent / "fixtures" / "model-events.json").read_text(encoding="utf-8")
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

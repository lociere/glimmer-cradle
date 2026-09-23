import json
from pathlib import Path

from glimmer_cradle.cognition.attention import AttentionController
from glimmer_cradle.cognition.inference import InferenceRequest, ModelEvent, ModelEventKind
from glimmer_cradle.cognition.loop import LoopController, StopPolicy
from glimmer_cradle.cognition.ports import (
    CapabilityDescriptor,
    CapabilityInvocation,
    CapabilityResult,
)
from tests.support import CLOCK, IDS, OBSERVABILITY, build_experience_recorder


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

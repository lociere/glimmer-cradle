import pytest

from glimmer_cradle.cognition.inference import (
    InferenceController,
    InferenceRequest,
    InferenceResponse,
    InferenceUnavailable,
    ModelEvent,
    ModelEventKind,
    ModelTier,
    RealtimeSession,
    RealtimeState,
)
from tests.conftest import OBSERVABILITY


def test_current_generation_cancellation_is_terminal() -> None:
    session = RealtimeSession(session_id="session-1", generation=3)
    session.accept(ModelEvent(0, ModelEventKind.TEXT_DELTA, {"text": "你"}))

    assert session.cancel(3)
    assert session.state == RealtimeState.CANCELLED
    with pytest.raises(RuntimeError, match="terminal"):
        session.accept(ModelEvent(1, ModelEventKind.AUDIO_DELTA, {"bytes": 4}))


def test_stale_generation_cannot_cancel_current_session() -> None:
    session = RealtimeSession(session_id="session-1", generation=4)
    assert not session.cancel(3)
    assert session.state == RealtimeState.ACTIVE


def test_realtime_events_require_monotonic_sequence() -> None:
    session = RealtimeSession(session_id="session-1", generation=1)
    session.accept(ModelEvent(2, ModelEventKind.TEXT_DELTA, {"text": "好"}))
    with pytest.raises(ValueError, match="sequence"):
        session.accept(ModelEvent(2, ModelEventKind.TEXT_DELTA, {"text": "重复"}))


def test_terminal_model_event_closes_session() -> None:
    session = RealtimeSession(session_id="session-1", generation=1)
    session.accept(ModelEvent(0, ModelEventKind.COMPLETED))
    assert session.state == RealtimeState.COMPLETED


class _Backend:
    def __init__(self, tier: ModelTier, *, available: bool = True) -> None:
        self.tier = tier
        self.available = available
        self.call_count = 0

    async def generate(self, _request: InferenceRequest) -> InferenceResponse:
        self.call_count += 1
        if not self.available:
            raise RuntimeError("simulated outage")
        return InferenceResponse(text=self.tier.value, tier_used=self.tier)


def _request() -> InferenceRequest:
    return InferenceRequest(system="你是月见。", user="你好")


async def test_inference_none_and_missing_local_fail_closed() -> None:
    cloud = _Backend(ModelTier.CLOUD_ALLOWED)
    local = _Backend(ModelTier.LOCAL_ONLY)
    controller = InferenceController(
        cloud=cloud, local=local, observability=OBSERVABILITY
    )
    with pytest.raises(InferenceUnavailable):
        await controller.request(_request(), tier=ModelTier.NONE)
    with pytest.raises(InferenceUnavailable):
        await InferenceController(
            cloud=cloud, local=None, observability=OBSERVABILITY
        ).request(_request(), tier=ModelTier.LOCAL_ONLY)


async def test_local_only_never_calls_cloud_and_propagates_local_failure() -> None:
    cloud = _Backend(ModelTier.CLOUD_ALLOWED)
    local = _Backend(ModelTier.LOCAL_ONLY)
    response = await InferenceController(
        cloud=cloud, local=local, observability=OBSERVABILITY
    ).request(_request(), tier=ModelTier.LOCAL_ONLY)
    assert response.tier_used == ModelTier.LOCAL_ONLY
    assert cloud.call_count == 0

    with pytest.raises(InferenceUnavailable):
        await InferenceController(
            cloud=cloud,
            local=_Backend(ModelTier.LOCAL_ONLY, available=False),
            observability=OBSERVABILITY,
        ).request(_request(), tier=ModelTier.LOCAL_ONLY)


async def test_cloud_allowed_prefers_cloud_then_falls_back_to_local() -> None:
    cloud = _Backend(ModelTier.CLOUD_ALLOWED)
    local = _Backend(ModelTier.LOCAL_ONLY)
    response = await InferenceController(
        cloud=cloud, local=local, observability=OBSERVABILITY
    ).request(_request(), tier=ModelTier.CLOUD_ALLOWED)
    assert response.tier_used == ModelTier.CLOUD_ALLOWED
    assert local.call_count == 0

    fallback = await InferenceController(
        cloud=_Backend(ModelTier.CLOUD_ALLOWED, available=False),
        local=local,
        observability=OBSERVABILITY,
    ).request(_request(), tier=ModelTier.CLOUD_ALLOWED)
    assert fallback.tier_used == ModelTier.LOCAL_ONLY


async def test_cloud_allowed_fails_when_every_backend_is_unavailable() -> None:
    controller = InferenceController(
        cloud=_Backend(ModelTier.CLOUD_ALLOWED, available=False),
        local=_Backend(ModelTier.LOCAL_ONLY, available=False),
        observability=OBSERVABILITY,
    )
    with pytest.raises(InferenceUnavailable):
        await controller.request(_request(), tier=ModelTier.CLOUD_ALLOWED)


def test_inference_request_and_tier_public_defaults_are_stable() -> None:
    request = _request()
    assert (request.max_tokens, request.temperature) == (512, 0.7)
    assert [tier.value for tier in ModelTier] == [
        "none", "local_only", "cloud_allowed"
    ]

import pytest

from glimmer_cradle.cognition.inference import (
    ModelEvent,
    ModelEventKind,
    RealtimeSession,
    RealtimeState,
)


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

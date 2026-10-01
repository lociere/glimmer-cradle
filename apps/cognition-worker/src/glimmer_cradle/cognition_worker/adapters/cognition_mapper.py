"""Provider-neutral Cognition model/event wire mapping."""

from __future__ import annotations

from glimmer_cradle.cognition.inference import InferenceRequest, ModelEvent, ModelEventKind


def inference_request_to_wire(request: InferenceRequest) -> dict[str, object]:
    return {
        "system": request.system,
        "user": request.user,
        "max_tokens": request.max_tokens,
        "temperature": request.temperature,
        "metadata": request.metadata,
        "vision": [list(item) for item in request.vision],
        "provider_key": request.provider_key,
    }


def model_event_from_wire(value: dict[str, object]) -> ModelEvent:
    sequence = value.get("sequence")
    kind = value.get("kind")
    payload = value.get("payload", {})
    if not isinstance(sequence, int) or sequence < 0:
        raise ValueError("model event sequence must be a non-negative integer")
    if not isinstance(kind, str):
        raise ValueError("model event kind must be a string")
    if not isinstance(payload, dict):
        raise ValueError("model event payload must be an object")
    return ModelEvent(sequence=sequence, kind=ModelEventKind(kind), payload=payload)

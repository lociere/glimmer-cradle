import hashlib

import pytest

from glimmer_cradle.cognition.inference import InferenceRequest, ModelEventKind
from glimmer_cradle.cognition.ports import CapabilityInvocation, ContentReference, JobRequest
from glimmer_cradle.cognition_worker.adapters import (
    CapabilityClient,
    ContentClient,
    JobClient,
    ModelClient,
)


class RequestTransport:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    async def request(self, method: str, payload: dict[str, object]) -> dict[str, object]:
        self.calls.append((method, payload))
        if method == "capability.expose":
            return {"capabilities": [{
                "name": "weather.lookup", "description": "weather", "input_schema": {},
            }]}
        if method == "capability.invoke":
            return {"status": "succeeded", "output": {"condition": "sunny"}}
        if method == "job.request":
            return {"job_id": "job-1", "status": "accepted", "revision": 1}
        raise AssertionError(method)


class ModelTransport:
    async def stream(self, payload: dict[str, object]):
        assert payload["user"] == "weather"
        yield {"sequence": 0, "kind": "text_delta", "payload": {"text": "sunny"}}
        yield {"sequence": 1, "kind": "completed", "payload": {}}

    async def cancel(self, session_id: str) -> None:
        return None


class ContentTransport:
    def __init__(self, content: bytes) -> None:
        self.content = content

    async def read(self, asset_id: str, *, max_bytes: int) -> bytes:
        return self.content


async def test_clients_preserve_ids_scopes_and_native_model_events() -> None:
    transport = RequestTransport()
    capabilities = CapabilityClient(transport)
    exposed = await capabilities.expose(scope="conversation:test")
    result = await capabilities.invoke(CapabilityInvocation(
        run_id="run-1", step=1, call_id="call-1", name=exposed[0].name,
        arguments={"city": "Shanghai"}, idempotency_key="run-1:call-1",
    ))
    receipt = await JobClient(transport).request(JobRequest(
        request_id="request-1", goal_id="goal-1", kind="reminder",
        idempotency_key="goal-1:request-1",
    ))
    events = [event async for event in ModelClient(ModelTransport()).events(
        InferenceRequest(system="system", user="weather")
    )]

    assert result.call_id == "call-1" and result.status == "succeeded"
    assert receipt.job_id == "job-1" and receipt.revision == 1
    assert [event.kind for event in events] == [
        ModelEventKind.TEXT_DELTA, ModelEventKind.COMPLETED,
    ]
    assert transport.calls[1][1]["idempotency_key"] == "run-1:call-1"


async def test_content_client_rejects_digest_mismatch() -> None:
    content = b"verified"
    valid = ContentReference(
        asset_id="asset-1", media_type="text/plain", size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
    )
    client = ContentClient(ContentTransport(content))
    assert await client.read(valid, max_bytes=100) == content

    invalid = ContentReference(
        asset_id="asset-1", media_type="text/plain", size_bytes=len(content),
        sha256="0" * 64,
    )
    with pytest.raises(ValueError, match="digest"):
        await client.read(invalid, max_bytes=100)

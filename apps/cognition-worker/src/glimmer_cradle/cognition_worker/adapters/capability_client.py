"""Capability broker client implementing Cognition's CapabilityPort."""

from __future__ import annotations

from typing import Protocol

from glimmer_cradle.cognition.ports import (
    CapabilityDescriptor,
    CapabilityInvocation,
    CapabilityResult,
)


class RequestTransport(Protocol):
    async def request(self, method: str, payload: dict[str, object]) -> dict[str, object]: ...


class CapabilityClient:
    def __init__(self, transport: RequestTransport) -> None:
        self._transport = transport

    async def expose(self, *, scope: str) -> tuple[CapabilityDescriptor, ...]:
        response = await self._transport.request("capability.expose", {"scope": scope})
        raw_items = response.get("capabilities", [])
        if not isinstance(raw_items, list):
            raise ValueError("capability exposure must be a list")
        items: list[CapabilityDescriptor] = []
        for raw in raw_items:
            if not isinstance(raw, dict):
                raise ValueError("capability descriptor must be an object")
            name, description = raw.get("name"), raw.get("description")
            schema = raw.get("input_schema", {})
            if not isinstance(name, str) or not name or not isinstance(description, str):
                raise ValueError("invalid capability descriptor")
            if not isinstance(schema, dict):
                raise ValueError("capability input schema must be an object")
            items.append(CapabilityDescriptor(name, description, schema))
        return tuple(items)

    async def invoke(self, invocation: CapabilityInvocation) -> CapabilityResult:
        response = await self._transport.request(
            "capability.invoke",
            {
                "run_id": invocation.run_id,
                "step": invocation.step,
                "call_id": invocation.call_id,
                "name": invocation.name,
                "arguments": invocation.arguments,
                "idempotency_key": invocation.idempotency_key,
            },
        )
        status = response.get("status")
        if status not in {"succeeded", "failed", "unknown"}:
            raise ValueError("invalid capability result status")
        error = response.get("error")
        return CapabilityResult(
            call_id=invocation.call_id,
            name=invocation.name,
            status=status,  # type: ignore[arg-type]
            output=response.get("output"),
            error=error if isinstance(error, str) else None,
        )

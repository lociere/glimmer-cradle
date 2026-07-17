from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .generated.audio_engine_command import AudioEngineCommand
from .generated.audio_engine_response import AudioEngineResponse


@dataclass(frozen=True)
class EngineCommand:
    id: str
    command: str
    payload: dict[str, Any]


def ok(command_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    return AudioEngineResponse(
        id=command_id,
        status="success",
        payload=payload or {},
    ).model_dump(mode="json", exclude_none=True)


def error(command_id: str, message: str, code: str = "engine_error") -> dict[str, Any]:
    return AudioEngineResponse(
        id=command_id,
        status="error",
        error={"code": code, "message": message},
    ).model_dump(mode="json", exclude_none=True)


def parse_command(raw: dict[str, Any]) -> EngineCommand:
    parsed = AudioEngineCommand.model_validate(raw)
    command = (
        parsed.command.value
        if hasattr(parsed.command, "value")
        else str(parsed.command)
    )
    return EngineCommand(id=parsed.id, command=command, payload=dict(parsed.payload))

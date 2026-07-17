from __future__ import annotations

from typing import Any, Protocol


class TTSProvider(Protocol):
    provider_id: str
    execution: str

    def available(self) -> tuple[bool, str | None]: ...

    def warmup(self) -> None: ...

    def config_snapshot(self) -> dict[str, Any]: ...

    def synthesize_to_file(self, text: str, output_path: str) -> str: ...

    def close(self) -> None: ...

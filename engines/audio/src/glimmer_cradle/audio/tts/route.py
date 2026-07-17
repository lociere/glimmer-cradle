from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from .provider import TTSProvider


ProviderFactory = Callable[[], TTSProvider]


@dataclass
class ProviderState:
    failures: int = 0
    circuit_open_until: float = 0.0
    last_error: str | None = None
    warmed: bool = False


class TTSRoute:
    """Audio Engine 内唯一的 TTS 路由 owner。"""

    def __init__(
        self,
        *,
        primary: str,
        fallbacks: list[str],
        provider_factories: dict[str, ProviderFactory],
        failure_threshold: int = 3,
        recovery_timeout_ms: int = 30000,
    ) -> None:
        ordered = [primary, *fallbacks]
        if len(set(ordered)) != len(ordered):
            raise ValueError("TTS route 不能重复声明 provider")
        missing = [
            provider_id
            for provider_id in ordered
            if provider_id not in provider_factories
        ]
        if missing:
            raise ValueError(f"TTS route 引用了未声明 provider: {', '.join(missing)}")
        self.primary = primary
        self.provider_ids = ordered
        self._factories = provider_factories
        self._providers: dict[str, TTSProvider] = {}
        self._states = {provider_id: ProviderState() for provider_id in ordered}
        self._failure_threshold = failure_threshold
        self._recovery_timeout_seconds = recovery_timeout_ms / 1000
        self.active_provider: str | None = None

    def warmup(self) -> dict[str, Any]:
        for provider_id in self.provider_ids:
            provider = self._provider(provider_id)
            available, reason = provider.available()
            if not available:
                self._states[provider_id].last_error = reason or "provider unavailable"
                continue
            try:
                provider.warmup()
                self._record_success(provider_id)
                self.active_provider = provider_id
                return self.snapshot()
            except Exception as exc:
                self._record_failure(provider_id, exc)
        raise RuntimeError(self._unavailable_message())

    def synthesize_to_file(self, text: str, output_path: str) -> dict[str, Any]:
        if not text.strip():
            raise ValueError("text is required")
        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        attempts = 0
        errors: list[str] = []

        for provider_id in self.provider_ids:
            state = self._states[provider_id]
            if self._circuit_is_open(state):
                errors.append(f"{provider_id}: circuit open")
                continue
            provider = self._provider(provider_id)
            available, reason = provider.available()
            if not available:
                state.last_error = reason or "provider unavailable"
                errors.append(f"{provider_id}: {state.last_error}")
                continue

            attempts += 1
            temp = output.with_name(f"{output.name}.{uuid4().hex}.partial")
            started = time.monotonic()
            try:
                provider.synthesize_to_file(text, str(temp))
                if not temp.exists() or temp.stat().st_size == 0:
                    raise RuntimeError("provider 未产生音频数据")
                temp.replace(output)
                self._record_success(provider_id)
                self.active_provider = provider_id
                return {
                    "output_path": str(output),
                    "provider_id": provider_id,
                    "fallback_used": provider_id != self.primary,
                    "attempts": attempts,
                    "duration_ms": round((time.monotonic() - started) * 1000, 2),
                }
            except Exception as exc:
                temp.unlink(missing_ok=True)
                self._record_failure(provider_id, exc)
                errors.append(f"{provider_id}: {exc}")

        raise RuntimeError("TTS route unavailable; " + "; ".join(errors))

    def snapshot(self) -> dict[str, Any]:
        providers: list[dict[str, Any]] = []
        now = time.monotonic()
        for index, provider_id in enumerate(self.provider_ids):
            provider = self._provider(provider_id)
            state = self._states[provider_id]
            available, reason = provider.available()
            if state.circuit_open_until > now:
                status = "circuit_open"
                message = state.last_error or "circuit open"
            elif self.active_provider == provider_id:
                status = "ready"
                message = None
            elif not available:
                status = "unavailable"
                message = reason or state.last_error
            elif state.last_error:
                status = "degraded"
                message = state.last_error
            else:
                status = "unknown"
                message = "等待路由预热"
            providers.append(
                {
                    "provider_id": provider_id,
                    "role": "primary" if index == 0 else "fallback",
                    "execution": provider.execution,
                    "status": status,
                    **({"message": message} if message else {}),
                }
            )

        route_state = "unavailable"
        if self.active_provider == self.primary:
            route_state = "ready"
        elif self.active_provider:
            route_state = "degraded"
        return {
            "route_state": route_state,
            "active_provider": self.active_provider,
            "providers": providers,
        }

    def close(self) -> None:
        for provider in self._providers.values():
            provider.close()

    def _provider(self, provider_id: str) -> TTSProvider:
        provider = self._providers.get(provider_id)
        if provider is None:
            provider = self._factories[provider_id]()
            self._providers[provider_id] = provider
        return provider

    def _record_success(self, provider_id: str) -> None:
        state = self._states[provider_id]
        state.failures = 0
        state.circuit_open_until = 0
        state.last_error = None
        state.warmed = True

    def _record_failure(self, provider_id: str, error: Exception) -> None:
        state = self._states[provider_id]
        state.failures += 1
        state.last_error = str(error)
        if state.failures >= self._failure_threshold:
            state.circuit_open_until = time.monotonic() + self._recovery_timeout_seconds

    @staticmethod
    def _circuit_is_open(state: ProviderState) -> bool:
        if state.circuit_open_until <= time.monotonic():
            state.circuit_open_until = 0
            return False
        return True

    def _unavailable_message(self) -> str:
        details = [
            f"{provider_id}: {self._states[provider_id].last_error or 'unavailable'}"
            for provider_id in self.provider_ids
        ]
        return "TTS route warmup failed; " + "; ".join(details)

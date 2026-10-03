"""Model tier selection and explicit fallback policy."""

from __future__ import annotations

from glimmer_cradle.cognition.inference.event import InferenceResponse
from glimmer_cradle.cognition.inference.model_descriptor import ModelTier
from glimmer_cradle.cognition.inference.model_port import InferenceBackendPort
from glimmer_cradle.cognition.inference.request import InferenceRequest
from glimmer_cradle.cognition.ports import ObservabilityPort


class InferenceUnavailable(Exception):
    pass


class InferenceController:
    def __init__(
        self,
        *,
        cloud: InferenceBackendPort | None = None,
        local: InferenceBackendPort | None = None,
        observability: ObservabilityPort,
    ) -> None:
        self._cloud = cloud
        self._local = local
        self._observability = observability
        self._logger = observability.logger("inference_controller")

    async def request(
        self,
        request: InferenceRequest,
        *,
        tier: ModelTier,
    ) -> InferenceResponse:
        with self._observability.span("inference", attributes={"tier": tier.value}) as span:
            self._observability.counter("inference.request", 1, labels={"tier": tier.value})
            if tier == ModelTier.NONE:
                self._unavailable("tier_none")
                raise InferenceUnavailable("当前活动策略禁止推理")
            if tier == ModelTier.LOCAL_ONLY:
                return await self._call_local(request, span)
            if self._cloud is not None:
                try:
                    response = await self._cloud.generate(request)
                    self._observe(response, "cloud", span)
                    return response
                except Exception as exc:
                    self._logger.warning(
                        "Cloud 推理失败", error=str(exc), has_local=self._local is not None
                    )
                    self._observability.counter("inference.cloud_failed", 1)
                    span.set_attribute("cloud_failed", True)
            return await self._call_local(request, span)

    async def _call_local(self, request: InferenceRequest, span) -> InferenceResponse:
        if self._local is None:
            self._unavailable("no_local_backend")
            raise InferenceUnavailable("未配置可用的本地推理后端")
        try:
            response = await self._local.generate(request)
            self._observe(response, "local", span)
            return response
        except Exception as exc:
            self._observability.counter("inference.local_failed", 1)
            self._logger.error("Local 推理失败", error=str(exc), exc_info=True)
            raise InferenceUnavailable(f"本地推理失败: {exc}") from exc

    def _unavailable(self, reason: str) -> None:
        self._observability.counter("inference.unavailable", 1, labels={"reason": reason})

    def _observe(self, response: InferenceResponse, backend: str, span) -> None:
        self._observability.histogram(
            "inference.duration_ms", response.duration_ms, labels={"backend": backend}
        )
        span.set_attribute("backend", backend)

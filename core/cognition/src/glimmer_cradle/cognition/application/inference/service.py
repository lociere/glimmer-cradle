"""按认知活动策略选择已接入推理后端的门面。

ModelTier（来自 CognitiveActivityPolicy）:
- NONE          quiescent：完全不允许推理（任何调用 → ReasoningUnavailable）
- LOCAL_ONLY    ambient：仅本地小模型
- CLOUD_ALLOWED engaged：云优先，云失败降级本地
"""
from __future__ import annotations

from glimmer_cradle.cognition.ports.observability import ObservabilityPort
from glimmer_cradle.cognition.domain.activity.models import ModelTier as ModelTierEnum
from glimmer_cradle.cognition.ports.inference import (
    ReasoningBackendPort,
    ReasoningRequest,
    ReasoningResponse,
)

class ReasoningUnavailable(Exception):
    """推理在当前档位（NONE）下不可用，或所有后端都失败。"""


class ReasoningService:
    """按 tier 选择已真实接入的推理后端；不存在模拟降级。"""

    def __init__(
        self,
        *,
        cloud: ReasoningBackendPort | None = None,
        local: ReasoningBackendPort | None = None,
        observability: ObservabilityPort,
    ) -> None:
        self._cloud = cloud
        self._local = local
        self._observability = observability
        self._logger = observability.logger("reasoning_service")

    async def request(
        self,
        req: ReasoningRequest,
        *,
        tier: ModelTierEnum,
    ) -> ReasoningResponse:
        """根据 tier 选后端并执行。"""
        with self._observability.span("reasoning", attributes={"tier": tier.value}) as s:
            self._observability.counter("reasoning.request", 1, labels={"tier": tier.value})

            if tier == ModelTierEnum.NONE:
                self._observability.counter("reasoning.unavailable", 1, labels={"reason": "tier_none"})
                raise ReasoningUnavailable("当前活动策略禁止推理")

            if tier == ModelTierEnum.LOCAL_ONLY:
                return await self._call_local(req, s)

            # CLOUD_ALLOWED：云优先，失败降级本地
            if self._cloud is not None:
                try:
                    resp = await self._cloud.generate(req)
                    self._observability.histogram("reasoning.duration_ms", resp.duration_ms,
                              labels={"backend": "cloud"})
                    s.set_attribute("backend", "cloud")
                    return resp
                except Exception as e:
                    self._logger.warning("Cloud 推理失败", error=str(e), has_local=self._local is not None)
                    self._observability.counter("reasoning.cloud_failed", 1)
                    s.set_attribute("cloud_failed", True)
            return await self._call_local(req, s)

    async def _call_local(self, req: ReasoningRequest, parent_span) -> ReasoningResponse:
        if self._local is None:
            self._observability.counter("reasoning.unavailable", 1, labels={"reason": "no_local_backend"})
            raise ReasoningUnavailable("未配置可用的本地推理后端")
        try:
            resp = await self._local.generate(req)
            self._observability.histogram("reasoning.duration_ms", resp.duration_ms,
                      labels={"backend": "local"})
            parent_span.set_attribute("backend", "local")
            return resp
        except Exception as e:
            self._observability.counter("reasoning.local_failed", 1)
            self._logger.error("Local 推理失败", error=str(e), exc_info=True)
            raise ReasoningUnavailable(f"本地推理失败: {e}") from e

"""按认知活动策略选择已接入推理后端的门面。

ModelTier（来自 CognitiveActivityPolicy）:
- NONE          quiescent：完全不允许推理（任何调用 → ReasoningUnavailable）
- LOCAL_ONLY    ambient：仅本地小模型
- CLOUD_ALLOWED engaged：云优先，云失败降级本地
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.metrics import counter, histogram
from glimmer_cradle.cognition.observability.tracer import span
from glimmer_cradle.cognition.protocol.generated.models.cognitive_activity_policy import ModelTier as ModelTierEnum

logger = get_logger("reasoning_service")


class ReasoningUnavailable(Exception):
    """推理在当前档位（NONE）下不可用，或所有后端都失败。"""


@dataclass(frozen=True)
class ReasoningRequest:
    """包含文本、可选视觉输入和 provider 选择的推理请求。"""

    system: str
    user: str
    max_tokens: int = 512
    temperature: float = 0.7
    metadata: dict = field(default_factory=dict)
    # 视觉消息采用 (prompt, uri, mime)；空元组表示纯文本。
    vision: tuple[tuple[str, str, str], ...] = ()
    # 指定推理提供商（core_direct 时用 multimodal.core_model；None → 默认）
    provider_key: str | None = None


@dataclass(frozen=True)
class ReasoningResponse:
    """推理响应。"""

    text: str
    tier_used: ModelTierEnum
    duration_ms: float = 0.0
    metadata: dict = field(default_factory=dict)


class ReasoningBackend(Protocol):
    async def generate(self, req: ReasoningRequest) -> ReasoningResponse: ...


class ReasoningService:
    """按 tier 选择已真实接入的推理后端；不存在模拟降级。"""

    def __init__(
        self,
        *,
        cloud: ReasoningBackend | None = None,
        local: ReasoningBackend | None = None,
    ) -> None:
        self._cloud = cloud
        self._local = local

    async def request(
        self,
        req: ReasoningRequest,
        *,
        tier: ModelTierEnum,
    ) -> ReasoningResponse:
        """根据 tier 选后端并执行。"""
        with span("reasoning", attributes={"tier": tier.value}) as s:
            counter("reasoning.request", 1, labels={"tier": tier.value})

            if tier == ModelTierEnum.NONE:
                counter("reasoning.unavailable", 1, labels={"reason": "tier_none"})
                raise ReasoningUnavailable("当前活动策略禁止推理")

            if tier == ModelTierEnum.LOCAL_ONLY:
                return await self._call_local(req, s)

            # CLOUD_ALLOWED：云优先，失败降级本地
            if self._cloud is not None:
                try:
                    resp = await self._cloud.generate(req)
                    histogram("reasoning.duration_ms", resp.duration_ms,
                              labels={"backend": "cloud"})
                    s.set_attribute("backend", "cloud")
                    return resp
                except Exception as e:
                    logger.warning("Cloud 推理失败", error=str(e), has_local=self._local is not None)
                    counter("reasoning.cloud_failed", 1)
                    s.set_attribute("cloud_failed", True)
            return await self._call_local(req, s)

    async def _call_local(self, req: ReasoningRequest, parent_span) -> ReasoningResponse:
        if self._local is None:
            counter("reasoning.unavailable", 1, labels={"reason": "no_local_backend"})
            raise ReasoningUnavailable("未配置可用的本地推理后端")
        try:
            resp = await self._local.generate(req)
            histogram("reasoning.duration_ms", resp.duration_ms,
                      labels={"backend": "local"})
            parent_span.set_attribute("backend", "local")
            return resp
        except Exception as e:
            counter("reasoning.local_failed", 1)
            logger.error("Local 推理失败", error=str(e), exc_info=True)
            raise ReasoningUnavailable(f"本地推理失败: {e}") from e

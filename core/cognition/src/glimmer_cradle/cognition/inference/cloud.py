"""包装 LLMEngine 的云端推理后端。"""
from __future__ import annotations

import asyncio
import time

from glimmer_cradle.cognition.inference.gateway import LLMEngine, LLMMessage, LLMRequest
from glimmer_cradle.cognition.inference.service import (
    ModelTierEnum,
    ReasoningRequest,
    ReasoningResponse,
)


class CloudReasoning:
    """包装现有 LLMEngine.generate（同步）为 async 接口。

    LLMEngine.generate 是同步阻塞调用（HTTP 请求 LLM API），用
    ``asyncio.to_thread`` 卸到线程池，不阻塞事件循环。
    """

    def __init__(self, llm_engine: LLMEngine) -> None:
        self._llm = llm_engine

    async def generate(self, req: ReasoningRequest) -> ReasoningResponse:
        messages = [LLMMessage(role="system", content=req.system)]
        # 视觉消息先于用户文本发送，保持 provider 的多模态消息顺序。
        for prompt, uri, mime in req.vision:
            messages.append(LLMMessage(
                role="user", content=prompt, vision_url=uri, vision_mime=mime,
            ))
        messages.append(LLMMessage(role="user", content=req.user))
        llm_req = LLMRequest(messages=messages, metadata=dict(req.metadata))
        started = time.monotonic()
        text = await asyncio.to_thread(self._llm.generate, llm_req, req.provider_key)
        duration_ms = (time.monotonic() - started) * 1000.0
        return ReasoningResponse(
            text=text,
            tier_used=ModelTierEnum.CLOUD_ALLOWED,
            duration_ms=duration_ms,
        )

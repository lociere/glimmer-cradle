"""
文件名称：kernel_ingress_cortex.py
所属层级：适配器层-入站 Cortex
核心作用：负责把内核原始消息解析为标准类型，向应用层输出纯净输入模型。
"""

from __future__ import annotations

from glimmer_cradle.cognition.application.agent_plan_use_case import AgentPlanInput
from glimmer_cradle.cognition.application.agent_synthesis_use_case import AgentSynthesisInput
from glimmer_cradle.cognition.ports.kernel.inbound.parsed_perception import ParsedPerception
# 入站契约单一事实源：protocol/src/schemas/ipc/ + models/，
# 由 sync:contracts codegen（Protocol 契约铁律 1）。
from glimmer_cradle.cognition.protocol.generated.ipc.kernel_message_envelope import (
    KernelMessageEnvelope,
)
from glimmer_cradle.cognition.protocol.generated.ipc.agent_plan_payload import (
    AgentPlanPayload,
)
from glimmer_cradle.cognition.protocol.generated.ipc.agent_synthesis_payload import (
    AgentSynthesisPayload,
)
from glimmer_cradle.cognition.protocol.generated.ipc.knowledge_init_payload import (
    KnowledgeBaseInitPayload,
    KnowledgeInitPayload,
)
from glimmer_cradle.cognition.protocol.generated.models.perception_event import (
    PerceptionEvent,
)


class KernelIngressCortex:
    """内核入站消息解析器。"""

    def parse_perception_message(self, message: dict) -> ParsedPerception:
        envelope = KernelMessageEnvelope.model_validate(message)
        payload = PerceptionEvent.model_validate(envelope.payload)
        conversation = payload.conversation
        return ParsedPerception(
            model_input=payload.content.model_dump(),
            scene_id=conversation.scene_id,
            conversation_id=conversation.conversation_id,
            continuity_id=conversation.continuity_id,
            thread_id=conversation.thread_id,
            recall_scope=conversation.recall_scope.value,
            disclosure_scope=conversation.disclosure_scope.value,
            familiarity=payload.familiarity,
            address_mode=payload.address_mode,
            response_policy=payload.response_policy or "reply_allowed",
            trace_id=envelope.trace_id,
            origin=payload.origin.model_dump(mode="json"),
            retention_ceiling=payload.retention_ceiling.value,
            interaction_id=conversation.interaction_id,
        )

    def parse_knowledge_init(self, message: dict) -> KnowledgeBaseInitPayload:
        envelope = KernelMessageEnvelope.model_validate(message)
        payload = KnowledgeInitPayload.model_validate(envelope.payload)
        return payload.knowledge_base

    def parse_agent_plan(self, message: dict) -> AgentPlanInput:
        envelope = KernelMessageEnvelope.model_validate(message)
        payload = AgentPlanPayload.model_validate(envelope.payload)
        return AgentPlanInput(
            user_goal=payload.user_goal,
            scene_id=payload.scene_id,
            available_tools=payload.available_tools,
            trace_id=envelope.trace_id,
        )

    def parse_agent_synthesis(self, message: dict) -> AgentSynthesisInput:
        envelope = KernelMessageEnvelope.model_validate(message)
        payload = AgentSynthesisPayload.model_validate(envelope.payload)
        return AgentSynthesisInput(
            original_goal=payload.original_goal,
            scene_id=payload.scene_id,
            conversation=payload.conversation.model_dump(mode="json"),
            tool_results=[r.model_dump() for r in payload.tool_results],
            trace_id=envelope.trace_id,
        )

"""把 Cognition Service DTO 路由至应用用例。"""

from glimmer_cradle.cognition.application.agent_plan_use_case import AgentPlanInput, AgentPlanOutput, AgentPlanUseCase
from glimmer_cradle.cognition.application.agent_synthesis_use_case import AgentSynthesisInput, AgentSynthesisOutput, AgentSynthesisUseCase
from glimmer_cradle.cognition.application.conversation.controller import ConversationController
from glimmer_cradle.cognition.domain.identity.self_entity import SelfEntity
from glimmer_cradle.cognition.adapters.observability.logger import get_logger
from glimmer_cradle.cognition.ports.kernel.inbound.kernel_request_port import KernelRequestPort
from glimmer_cradle.cognition.ports.kernel.models import (
    ConversationHistoryEntry,
    ConversationHistoryQuery,
    ConversationHistoryResult,
    KnowledgeInitialization,
)

logger = get_logger("inbound_adapter")


class KernelEventInboundAdapter(KernelRequestPort):
    def __init__(
        self,
        self_entity: SelfEntity,
        agent_plan_use_case: AgentPlanUseCase,
        agent_synthesis_use_case: AgentSynthesisUseCase,
        conversation_controller: ConversationController,
    ) -> None:
        self.self_entity = self_entity
        self.agent_plan_use_case = agent_plan_use_case
        self.agent_synthesis_use_case = agent_synthesis_use_case
        self.conversation_controller = conversation_controller

    async def on_knowledge_init(self, knowledge_base: KnowledgeInitialization) -> None:
        logger.info("收到内核知识库注入", version=knowledge_base.version, entry_count=len(knowledge_base.entries))
        await self.self_entity.knowledge_base.init_from_kernel(knowledge_base)

    async def on_agent_plan(self, input_data: AgentPlanInput) -> AgentPlanOutput:
        return await self.agent_plan_use_case.execute(input_data, input_data.trace_id)

    async def on_agent_synthesis(self, input_data: AgentSynthesisInput) -> AgentSynthesisOutput:
        return await self.agent_synthesis_use_case.execute(input_data, input_data.trace_id)

    async def on_conversation_history(self, payload: ConversationHistoryQuery) -> ConversationHistoryResult:
        thread, messages, next_cursor, has_more = await self.conversation_controller.history_page(
            payload.conversation_id,
            allowed_scopes=set(payload.allowed_scopes),
            cursor=payload.cursor,
            limit=payload.limit,
            scene_id=payload.scene_id,
            actor_id=payload.actor_id,
        )
        items = [
            ConversationHistoryEntry(
                entry_id=f"conversation:{message.position}:{message.role}",
                source_kind="conversation",
                role=message.role,
                status="committed",
                text=message.content,
                occurred_at=message.occurred_at,
                trace_id=message.interaction_id,
                interaction_id=message.interaction_id,
                moment_id=message.moment_id,
                position=message.position,
                conversation_id=message.conversation_id,
                scene_id=message.scene_id,
                thread_id=message.thread_id,
                actor_id=message.actor_id,
                actor_name=message.actor_name,
                recall_scope=message.recall_scope,
                disclosure_scope=message.disclosure_scope,
            )
            for message in messages
        ]
        fallback_scope = payload.allowed_scopes[0]
        return ConversationHistoryResult(
            request_id=payload.request_id,
            status="success",
            conversation={
                "source_provider_id": payload.source_provider_id,
                "scene_id": thread.get("scene_id", payload.scene_id),
                "conversation_id": thread.get("conversation_id", payload.conversation_id),
                "thread_id": thread.get("thread_id", payload.thread_id),
                "actor_id": payload.actor_id or "",
                "actor_name": payload.actor_name or "",
                "recall_scope": thread.get("recall_scope", fallback_scope),
                "disclosure_scope": thread.get("disclosure_scope", fallback_scope),
            },
            items=items,
            next_cursor=next_cursor,
            has_more=has_more,
        )

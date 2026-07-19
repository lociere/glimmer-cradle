"""
文件名称：kernel_event_adapter.py
所属层级：适配器层-入站适配器
核心作用：实现入站端口的抽象接口，处理内核传入的信号，调用对应的用例
设计原则：
1. 仅做协议转换，不碰业务逻辑
2. 把内核传入的原始消息，转换为应用层能处理的标准化输入
3. 不做任何流程编排，仅做路由转发
"""
from glimmer_cradle.cognition.ports.kernel.inbound.kernel_request_port import KernelRequestPort
from glimmer_cradle.cognition.application.agent_plan_use_case import AgentPlanUseCase, AgentPlanInput, AgentPlanOutput
from glimmer_cradle.cognition.application.agent_synthesis_use_case import AgentSynthesisUseCase, AgentSynthesisInput, AgentSynthesisOutput
from glimmer_cradle.cognition.conversation.controller import ConversationController
from glimmer_cradle.cognition.protocol.generated.ipc.conversation_history_payload import ConversationHistoryPayload
from glimmer_cradle.cognition.protocol.generated.models.conversation_history_entry import ConversationHistoryEntry
from glimmer_cradle.cognition.protocol.generated.models.conversation_history_result import ConversationHistoryResult
from glimmer_cradle.cognition.protocol.generated.ipc.knowledge_init_payload import KnowledgeBaseInitPayload
from glimmer_cradle.cognition.identity.self_entity import SelfEntity
from glimmer_cradle.cognition.observability.logger import get_logger

# 初始化模块日志器
logger = get_logger("inbound_adapter")


class KernelEventInboundAdapter(KernelRequestPort):
    """
    内核事件入站适配器
    核心作用：接收内核传入的IPC消息，转换为标准化输入，调用对应的用例
    设计规范：仅做协议转换和路由，不碰任何业务逻辑

    ``perception_message`` 由 Composition 注册的唯一感知 handler 写入
    PerceptionEventQueue；本适配器处理其余请求型入站用例。
    """
    def __init__(
        self,
        self_entity: SelfEntity,
        agent_plan_use_case: AgentPlanUseCase,
        agent_synthesis_use_case: AgentSynthesisUseCase,
        conversation_controller: ConversationController,
    ):
        self.self_entity = self_entity
        self.agent_plan_use_case = agent_plan_use_case
        self.agent_synthesis_use_case = agent_synthesis_use_case
        self.conversation_controller = conversation_controller
        logger.info("内核入站适配器初始化完成")

    async def on_knowledge_init(
        self,
        knowledge_base: KnowledgeBaseInitPayload,
    ) -> None:
        """接收内核注入的知识库。KnowledgeInitPayload 只承载知识条目。"""
        logger.info(
            "收到内核知识库注入",
            version=knowledge_base.version,
            entry_count=len(knowledge_base.entries),
        )

        # Knowledge 条目进入 Cognition 的知识 Repository。
        await self.self_entity.knowledge_base.init_from_kernel(knowledge_base)

    async def on_agent_plan(self, input_data: AgentPlanInput) -> AgentPlanOutput:
        """接收内核的 Agent 规划请求，仅返回思考建议。"""
        logger.info("收到 Agent 规划请求", trace_id=input_data.trace_id, scene_id=input_data.scene_id)
        return await self.agent_plan_use_case.execute(input_data, input_data.trace_id)

    async def on_agent_synthesis(self, input_data: AgentSynthesisInput) -> AgentSynthesisOutput:
        """接收工具执行结果，由 LLM 合成最终回复。"""
        logger.info("收到 Agent 工具合成请求", trace_id=input_data.trace_id, scene_id=input_data.scene_id)
        return await self.agent_synthesis_use_case.execute(input_data, input_data.trace_id)

    async def on_conversation_history(
        self,
        payload: ConversationHistoryPayload,
    ) -> ConversationHistoryResult:
        logger.info(
            "收到 Conversation 历史查询请求",
            request_id=payload.request_id,
            conversation_id=payload.conversation_id,
        )
        thread, messages, next_cursor, has_more = await self.conversation_controller.history_page(
            payload.conversation_id,
            allowed_scopes={str(scope) for scope in payload.allowed_scopes},
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
        return ConversationHistoryResult(
            request_id=payload.request_id,
            status="success",
            conversation={
                "source_provider_id": payload.source_provider_id,
                "scene_id": thread.get("scene_id", payload.scene_id),
                "conversation_id": thread.get("conversation_id", payload.conversation_id),
                "thread_id": thread.get("thread_id", payload.thread_id),
                "actor_id": payload.actor_id,
                "actor_name": payload.actor_name,
                "recall_scope": thread.get("recall_scope", payload.allowed_scopes[0]),
                "disclosure_scope": thread.get("disclosure_scope", payload.allowed_scopes[0]),
            },
            items=items,
            next_cursor=next_cursor,
            has_more=has_more,
        )

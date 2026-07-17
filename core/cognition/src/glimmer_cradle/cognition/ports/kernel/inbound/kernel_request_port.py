"""Kernel 请求型入站消息的应用端口。"""
from abc import ABC, abstractmethod
from glimmer_cradle.cognition.application.agent_plan_use_case import AgentPlanInput, AgentPlanOutput
from glimmer_cradle.cognition.application.agent_synthesis_use_case import AgentSynthesisInput, AgentSynthesisOutput
from glimmer_cradle.cognition.protocol.generated.ipc.knowledge_init_payload import KnowledgeBaseInitPayload


class KernelRequestPort(ABC):
    """定义 knowledge、agent planning/synthesis 的请求契约。

    持续感知通过 PerceptionEventQueue 进入 CycleController，不混入请求/响应用例。
    """

    @abstractmethod
    async def on_knowledge_init(
        self,
        knowledge_base: KnowledgeBaseInitPayload,
    ) -> None:
        """
        接收内核注入的知识库
        参数：
            knowledge_base: 知识库完整载荷
        """
        pass

    @abstractmethod
    async def on_agent_plan(self, input_data: AgentPlanInput) -> AgentPlanOutput:
        """
        接收任务规划请求（MCP），仅返回思考与工具建议，不执行任务。
        """
        pass

    @abstractmethod
    async def on_agent_synthesis(self, input_data: AgentSynthesisInput) -> AgentSynthesisOutput:
        """
        接收 MCP 工具执行结果，通过 LLM 合成为角色自然语言回复。
        """
        pass

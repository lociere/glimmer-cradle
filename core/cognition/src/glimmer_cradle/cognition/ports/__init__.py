"""Cognition consumer-owned ports."""

from abc import ABC, abstractmethod
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from glimmer_cradle.cognition.ports.capability_port import (
    LOAD_SKILL,
    READ_RESOURCE,
    CapabilityDescriptor,
    CapabilityExposure,
    CapabilityInvocation,
    CapabilityPort,
    CapabilityResult,
    CapabilityResultStatus,
    ResourceDescriptor,
    SkillMaterial,
    SkillReference,
    SkillSummary,
)
from glimmer_cradle.cognition.ports.clock_port import ClockPort
from glimmer_cradle.cognition.ports.content_port import ContentPort, ContentReference
from glimmer_cradle.cognition.ports.conversation_port import ConversationPort
from glimmer_cradle.cognition.ports.job_port import (
    JobPort,
    JobReceipt,
    JobRequest,
    JobRequestStatus,
)
from glimmer_cradle.cognition.ports.resource_port import (
    ResourceAccess,
    ResourcePort,
    ResourceScope,
    ResourceSnapshot,
)
from pydantic import BaseModel, ConfigDict, Field


class IdGeneratorPort(Protocol):
    """生成不透明运行时标识和稳定派生标识。"""

    def new(self) -> str: ...
    def stable(self, namespace: str, value: str) -> str: ...


class LoggerPort(Protocol):
    def debug(self, event: str, **values: Any) -> Any: ...
    def info(self, event: str, **values: Any) -> Any: ...
    def warning(self, event: str, **values: Any) -> Any: ...
    def error(self, event: str, **values: Any) -> Any: ...
    def critical(self, event: str, **values: Any) -> Any: ...


class SpanPort(Protocol):
    def set_attribute(self, name: str, value: Any) -> None: ...
    def add_event(self, name: str, attributes: dict | None = None) -> None: ...


class ObservabilityPort(Protocol):
    """由 Worker composition 创建并注入，不保存 process-global binding。"""

    def logger(self, module_name: str) -> LoggerPort: ...
    def counter(
        self, name: str, value: float = 1, labels: dict | None = None
    ) -> None: ...
    def gauge(self, name: str, value: float, labels: dict | None = None) -> None: ...
    def histogram(self, name: str, value: float, labels: dict | None = None) -> None: ...
    def span(
        self, name: str, *, attributes: dict | None = None
    ) -> AbstractContextManager[SpanPort]: ...
    def trace_context(self, trace_id: str) -> AbstractContextManager[Any]: ...
    def new_trace_id(self) -> str: ...
    def current_trace_id(self) -> str | None: ...


class SkillToolDescriptor(BaseModel):
    skill_id: str
    tool_name: str
    description: str = ""
    parameters: dict[str, Any] = Field(default_factory=dict)


class SkillToolSuggestion(BaseModel):
    skill_id: str
    tool_name: str
    purpose: str
    confidence: float = Field(ge=0.0, le=1.0)
    arguments_hint: dict[str, Any] = Field(default_factory=dict)


class AgentPlanResult(BaseModel):
    summary: str
    reasoning: str
    suggestions: list[SkillToolSuggestion]
    trace_id: str
    selected_skills: list[SkillReference] = Field(default_factory=list)


@dataclass
class AgentPlanInput:
    user_goal: str
    scene_id: str = ""
    available_tools: list[SkillToolDescriptor] = field(default_factory=list)
    trace_id: str = ""
    available_skills: list[SkillSummary] = field(default_factory=list)
    skill_materials: list[SkillMaterial] = field(default_factory=list)


AgentPlanOutput = AgentPlanResult


@dataclass
class AgentSynthesisInput:
    original_goal: str
    scene_id: str = ""
    conversation: dict = field(default_factory=dict)
    tool_results: list[dict] = field(default_factory=list)
    trace_id: str = ""


@dataclass
class AgentSynthesisOutput:
    reply_content: str
    emotion_state: dict
    trace_id: str


class KnowledgeRetrievalInput(BaseModel):
    mode: str = "full_injection"
    top_k: int = 5
    min_score: float = 0.3
    semantic_weight: float = 0.6


class KnowledgeEntryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entry_id: str
    scope: Literal["knowledge"]
    content: str
    enabled: bool = True
    priority: int = 1


class KnowledgeInitialization(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str
    retrieval: KnowledgeRetrievalInput
    entries: list[KnowledgeEntryInput]


class ConversationHistoryQuery(BaseModel):
    request_id: str
    conversation_id: str
    scene_id: str
    thread_id: str
    actor_id: str | None = None
    actor_name: str | None = None
    source_provider_id: str
    cursor: str | None = None
    limit: int = 50
    allowed_scopes: list[str]


class ConversationHistoryEntry(BaseModel):
    entry_id: str
    source_kind: str
    role: str
    status: str
    text: str
    title: str | None = None
    occurred_at: str
    trace_id: str | None = None
    interaction_id: str | None = None
    moment_id: str | None = None
    position: int | None = None
    conversation_id: str
    scene_id: str
    thread_id: str
    actor_id: str | None = None
    actor_name: str | None = None
    recall_scope: str
    disclosure_scope: str


class ConversationHistoryResult(BaseModel):
    request_id: str
    status: str
    conversation: dict[str, Any] | None = None
    items: list[ConversationHistoryEntry]
    next_cursor: str | None = None
    has_more: bool
    message: str | None = None


class KernelRequestPort(ABC):
    """定义 knowledge、agent planning/synthesis 的请求契约。

    持续感知通过规范化 ObservationQueue 进入 LoopController，不混入请求/响应用例。
    """

    @abstractmethod
    async def on_knowledge_init(
        self,
        knowledge_base: KnowledgeInitialization,
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

    @abstractmethod
    async def on_conversation_history(
        self,
        payload: ConversationHistoryQuery,
    ) -> ConversationHistoryResult:
        """读取可重建 Conversation 投影的历史页。"""
        pass


class KernelEventPort(ABC):
    """
    内核事件出站端口抽象接口
    核心作用：定义AI层能发送给内核的所有事件，完全屏蔽底层通信细节
    真人逻辑对齐：对应人脑的动作输出接口，仅定义能发送什么信号，不关心信号到哪里去
    """

    @abstractmethod
    async def send_state_sync(self, state: dict) -> None:
        """
        发送状态同步事件给内核，同步给渲染层
        参数：
            state: 当前角色状态字典
        """
        pass

    @abstractmethod
    async def send_log(self, level: str, message: str, extra: dict = None) -> None:
        """
        发送日志事件给内核，统一日志管理
        参数：
            level: 日志级别
            message: 日志内容
            extra: 额外参数
        """
        pass

    @abstractmethod
    async def send_action_command(self, command: dict) -> None:
        """
        发送 ActionCommand 给 Kernel。

        LoopController 的 Act 阶段决定开口时，把 reply intent 转成 ActionCommand
        经此推送给内核（Python → 内核单向，非 RPC）。内核侧映射为 ChannelReplyEvent
        走现有适配器回传链路。

        参数：
            command: ActionCommand dict（与 schemas/models/ActionCommand 对齐：
                     trace_id / action_type / target / payload / emotion_state）
        """
        pass

__all__ = [
    "LOAD_SKILL",
    "READ_RESOURCE",
    "CapabilityExposure",
    "ResourceDescriptor",
    "SkillReference",
    "SkillSummary",
    "SkillMaterial",
    "CapabilityDescriptor",
    "CapabilityInvocation",
    "CapabilityPort",
    "CapabilityResult",
    "CapabilityResultStatus",
    "ClockPort",
    "ContentPort",
    "ContentReference",
    "ConversationPort",
    "JobPort",
    "JobReceipt",
    "JobRequest",
    "JobRequestStatus",
    "KernelRequestPort",
    "KernelEventPort",
    "AgentPlanInput",
    "AgentPlanOutput",
    "AgentPlanResult",
    "AgentSynthesisInput",
    "AgentSynthesisOutput",
    "ConversationHistoryEntry",
    "ConversationHistoryQuery",
    "ConversationHistoryResult",
    "KnowledgeEntryInput",
    "KnowledgeInitialization",
    "KnowledgeRetrievalInput",
    "SkillToolDescriptor",
    "SkillToolSuggestion",
    "IdGeneratorPort",
    "LoggerPort",
    "ObservabilityPort",
    "ResourcePort",
    "ResourceAccess",
    "ResourceScope",
    "ResourceSnapshot",
    "SpanPort",
]

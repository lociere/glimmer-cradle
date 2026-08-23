"""Kernel Service Adapter 与 Cognition 应用层之间的纯内部模型。"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


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

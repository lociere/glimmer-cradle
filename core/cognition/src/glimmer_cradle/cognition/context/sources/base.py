"""
ContextSource 基类 + ContextItem / ContextQuery 数据结构（蓝图 §4.6）。

每个 ContextSource 拿一个 ``ContextQuery`` → 返回 ``list[ContextItem]``。
评分维度：``recency`` · ``importance`` · ``relevance`` —— 三者由 source 自己产出，
ContextAssembly 负责汇总打分与预算裁剪。

设计约束：
- ContextSource 不感知"总预算"；预算裁剪在 Assembly 层做
- token_estimate 由 source 给（最了解自己内容的格式）；Assembly 累加裁
- activate 是异步：常见实现要 await 向量检索 / 数据库读
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ContextQuery:
    """触发上下文激活的查询。

    通常来自当前工作区焦点 / perception 文本 / 对话对象。
    """

    text: str
    scene_id: str | None = None
    conversation_id: str | None = None
    actor_id: str | None = None
    recall_scope: str = "global_safe"
    emotion_hint: str = ""
    # 工作区当前焦点（可选）：让 source 按"她在想什么"激活
    focus_summary: str = ""

    @property
    def allowed_scopes(self) -> set[str]:
        return allowed_recall_scopes(self.recall_scope)


def allowed_recall_scopes(recall_scope: str) -> set[str]:
    common = {"global_safe", "public"}
    if recall_scope == "character_internal":
        return common | {"character_internal"}
    if recall_scope == "conversation_private":
        return common | {"conversation_private", "actor_private"}
    if recall_scope in {"actor_private", "space_local"}:
        return common | {recall_scope}
    return {"public"} if recall_scope == "public" else common


@dataclass(frozen=True)
class ContextItem:
    """一条候选上下文项。

    Attributes:
        source:         产此项的 source 名（"episodic" / "knowledge" / "relationship" ...）
        content:        文本内容（直接可拼进 prompt）
        relevance:      与 query 的相关度 [0,1]
        recency:        近时度 [0,1]，1=最新，0=最旧；不适用时填 0.5
        importance:     重要度 [0,1]，由源自评（如长期记忆权重、知识库 priority）
        token_estimate: 大致 token 数（粗估即可，用 ≈ len/3 给中英文混合）
        metadata:       原数据引用（如 memory_id、entry_id），便于追溯
    """

    source: str
    content: str
    relevance: float
    recency: float = 0.5
    importance: float = 0.5
    token_estimate: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    def score(self, *, w_recency: float = 0.2, w_importance: float = 0.3,
              w_relevance: float = 0.5) -> float:
        """加权综合分。默认 relevance > importance > recency。"""
        return (
            w_relevance * float(self.relevance)
            + w_importance * float(self.importance)
            + w_recency * float(self.recency)
        )


def estimate_tokens(text: str) -> int:
    """粗略 token 估计：中英文混合按 ≈ len/3。"""
    return max(1, len(text) // 3)


class ContextSource(ABC):
    """上下文源基类。子类必须实现 ``name`` 与 ``activate()``。"""

    #: source 名（与 ContextItem.source 对应）
    name: str = ""

    @abstractmethod
    async def activate(self, query: ContextQuery, *, max_items: int = 10) -> list[ContextItem]:
        """根据 query 激活候选。

        Args:
            query:     当前上下文查询
            max_items: 期望最多返回多少项（source 可少不可多）

        Returns:
            候选上下文项列表（空列表 = 本次激活无命中）
        """
        ...

"""
知识库源（蓝图 §4.6）—— 包装 KnowledgeBase.get_knowledge。

激活规则：关键词 / 向量 / 常驻（由 KnowledgeBase 内部 mode 决定）。
"""
from __future__ import annotations

from glimmer_cradle.cognition.context.sources.base import (
    ContextItem,
    ContextQuery,
    ContextSource,
    estimate_tokens,
)
from glimmer_cradle.cognition.memory.knowledge_base import KnowledgeBase


class KnowledgeSource(ContextSource):
    name = "knowledge"

    def __init__(self, knowledge_base: KnowledgeBase) -> None:
        self._kb = knowledge_base

    async def activate(self, query: ContextQuery, *, max_items: int = 10) -> list[ContextItem]:
        try:
            entries = await self._kb.get_knowledge(query=query.text)
        except Exception:
            return []

        items: list[ContextItem] = []
        for entry in entries[:max_items]:
            content = f"知识：{entry.content}"
            priority = float(getattr(entry, "priority", 1))
            # priority 通常 1~5，归一到 [0,1]
            importance = min(1.0, priority / 5.0)
            items.append(ContextItem(
                source=self.name,
                content=content,
                relevance=0.6,  # KnowledgeBase 命中即给中等相关度
                recency=0.5,    # 知识无时效性概念
                importance=importance,
                token_estimate=estimate_tokens(content),
                metadata={"entry_id": getattr(entry, "entry_id", "")},
            ))
        return items

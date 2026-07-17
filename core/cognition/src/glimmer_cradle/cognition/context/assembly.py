"""
ContextAssembly —— 统一拉取所有上下文源、综合打分并按认知活动预算裁剪。

流程：
1. 并发 ``activate`` 所有源
2. 异常隔离（单个源崩不影响他人）
3. 按综合分（recency·importance·relevance 加权）排序
4. 按认知活动策略 ``context_budget_factor`` 缩放 token 预算 → 累加裁剪
5. 输出 ``AssembledContext`` —— 带 source 标签的上下文项列表 + 元信息
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Sequence

from glimmer_cradle.cognition.context.sources.base import ContextItem, ContextQuery, ContextSource
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.metrics import counter, gauge, histogram
from glimmer_cradle.cognition.observability.tracer import span

logger = get_logger("context_assembly")


@dataclass
class AssembledContext:
    """装配结果。"""

    items: list[ContextItem] = field(default_factory=list)
    total_tokens: int = 0
    budget_tokens: int = 0
    was_truncated: bool = False
    sources_called: int = 0
    sources_failed: int = 0

    def grouped_by_source(self) -> dict[str, list[ContextItem]]:
        """按 source 名分组（便于按"我记得 / 我知道 / ..."拼 prompt）。"""
        groups: dict[str, list[ContextItem]] = {}
        for it in self.items:
            groups.setdefault(it.source, []).append(it)
        return groups

    def total_count(self) -> int:
        return len(self.items)


class ContextAssembly:
    """装配器。"""

    def __init__(
        self,
        sources: Sequence[ContextSource],
        *,
        base_budget_tokens: int = 2000,
        weights: tuple[float, float, float] = (0.2, 0.3, 0.5),  # (recency, importance, relevance)
    ) -> None:
        self._sources: list[ContextSource] = list(sources)
        self._base_budget = max(0, int(base_budget_tokens))
        self._w_recency, self._w_importance, self._w_relevance = weights

    @property
    def sources(self) -> list[ContextSource]:
        return list(self._sources)

    async def assemble(
        self,
        query: ContextQuery,
        *,
        budget_factor: float = 1.0,
        per_source_limit: int = 10,
    ) -> AssembledContext:
        """装配一次。

        Args:
            query:           上下文查询
            budget_factor:   认知活动预算因子 [0,1]
            per_source_limit: 每个源最多返回多少候选
        """
        budget = max(0, int(self._base_budget * max(0.0, min(1.0, float(budget_factor)))))

        with span("context_assembly", attributes={"budget_tokens": budget}) as s:
            # 1. 并发拉所有源（异常隔离）
            results = await asyncio.gather(
                *(self._safe_activate(src, query, per_source_limit) for src in self._sources),
                return_exceptions=False,
            )
            called = len(results)
            failed = sum(1 for r in results if r is None)
            all_items: list[ContextItem] = []
            for r in results:
                if r:
                    all_items.extend(r)
            counter("context.sources_called", called)
            counter("context.sources_failed", failed)
            gauge("context.candidates_raw", float(len(all_items)))

            # 2. 综合打分排序
            all_items.sort(
                key=lambda it: it.score(
                    w_recency=self._w_recency,
                    w_importance=self._w_importance,
                    w_relevance=self._w_relevance,
                ),
                reverse=True,
            )

            # 3. 预算裁剪
            picked: list[ContextItem] = []
            used = 0
            for it in all_items:
                if used + it.token_estimate > budget:
                    continue  # 跳过这条尝试下一条（允许"挑小的"凑数）
                picked.append(it)
                used += it.token_estimate
            was_truncated = len(picked) < len(all_items)

            histogram("context.tokens_used", float(used))
            s.set_attribute("candidates_total", len(all_items))
            s.set_attribute("picked", len(picked))
            s.set_attribute("was_truncated", was_truncated)

            return AssembledContext(
                items=picked,
                total_tokens=used,
                budget_tokens=budget,
                was_truncated=was_truncated,
                sources_called=called,
                sources_failed=failed,
            )

    async def _safe_activate(
        self, src: ContextSource, query: ContextQuery, max_items: int
    ) -> list[ContextItem] | None:
        try:
            return await src.activate(query, max_items=max_items)
        except Exception as e:
            logger.error(
                "ContextSource activate 异常",
                source=src.name,
                error=str(e),
                exc_info=True,
            )
            return None

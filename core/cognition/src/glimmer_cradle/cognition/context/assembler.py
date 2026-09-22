"""Context 来源激活、信任归一、排序、压缩与预算选择。"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Sequence

from glimmer_cradle.cognition.context.budget import ContextBudget
from glimmer_cradle.cognition.context.compaction import ContextCompactor
from glimmer_cradle.cognition.context.source import ContextItem, ContextQuery, ContextSource
from glimmer_cradle.cognition.context.trust import ContextTrustPolicy
from glimmer_cradle.cognition.ports.observability import ObservabilityPort


@dataclass
class AssembledContext:
    items: list[ContextItem] = field(default_factory=list)
    total_tokens: int = 0
    budget_tokens: int = 0
    was_truncated: bool = False
    sources_called: int = 0
    sources_failed: int = 0

    def grouped_by_source(self) -> dict[str, list[ContextItem]]:
        groups: dict[str, list[ContextItem]] = {}
        for item in self.items:
            groups.setdefault(item.source, []).append(item)
        return groups

    def total_count(self) -> int:
        return len(self.items)


class ContextAssembler:
    def __init__(
        self,
        sources: Sequence[ContextSource],
        *,
        base_budget_tokens: int = 2000,
        weights: tuple[float, float, float] = (0.2, 0.3, 0.5),
        observability: ObservabilityPort,
        trust_policy: ContextTrustPolicy | None = None,
        compactor: ContextCompactor | None = None,
    ) -> None:
        self._sources = list(sources)
        self._budget = ContextBudget(base_budget_tokens)
        self._w_recency, self._w_importance, self._w_relevance = weights
        self._observability = observability
        self._logger = observability.logger("context_assembly")
        self._trust = trust_policy or ContextTrustPolicy()
        self._compactor = compactor or ContextCompactor()

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
        budget = self._budget.limit(budget_factor)
        with self._observability.span(
            "context_assembly", attributes={"budget_tokens": budget}
        ) as span:
            results = await asyncio.gather(
                *(self._safe_activate(source, query, per_source_limit) for source in self._sources),
                return_exceptions=False,
            )
            failed = sum(1 for result in results if result is None)
            all_items = [
                self._trust.enforce(item)
                for result in results
                if result
                for item in result
            ]
            self._observability.counter("context.sources_called", len(results))
            self._observability.counter("context.sources_failed", failed)
            self._observability.gauge("context.candidates_raw", float(len(all_items)))
            all_items.sort(
                key=lambda item: item.score(
                    w_recency=self._w_recency,
                    w_importance=self._w_importance,
                    w_relevance=self._w_relevance,
                ),
                reverse=True,
            )
            selected = self._budget.select(all_items, factor=budget_factor)
            picked = list(selected.items)
            if not picked and all_items and budget > 0:
                compacted = self._compactor.compact(all_items[0], max_tokens=budget)
                if compacted is not None:
                    picked = [compacted]
            used = sum(item.token_estimate for item in picked)
            was_truncated = len(picked) < len(all_items) or any(
                item.metadata.get("compacted") is True for item in picked
            )
            self._observability.histogram("context.tokens_used", float(used))
            span.set_attribute("candidates_total", len(all_items))
            span.set_attribute("picked", len(picked))
            span.set_attribute("was_truncated", was_truncated)
            return AssembledContext(
                items=picked,
                total_tokens=used,
                budget_tokens=budget,
                was_truncated=was_truncated,
                sources_called=len(results),
                sources_failed=failed,
            )

    async def _safe_activate(
        self, source: ContextSource, query: ContextQuery, max_items: int
    ) -> list[ContextItem] | None:
        try:
            return await source.activate(query, max_items=max_items)
        except Exception as error:
            self._logger.error(
                "ContextSource activate 异常",
                source=source.name,
                error=str(error),
                exc_info=True,
            )
            return None

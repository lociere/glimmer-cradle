"""Context retrieval 的显式预算与选择结果。"""

from __future__ import annotations

from dataclasses import dataclass

from glimmer_cradle.cognition.context.source import ContextItem


@dataclass(frozen=True, slots=True)
class ContextBudgetResult:
    items: tuple[ContextItem, ...]
    used_tokens: int
    limit_tokens: int
    truncated: bool


@dataclass(frozen=True, slots=True)
class ContextBudget:
    """只拥有 retrieval 配额；模型输出与 tool result 预留由 Loop 总预算拥有。"""

    base_tokens: int

    def limit(self, factor: float) -> int:
        normalized = max(0.0, min(1.0, float(factor)))
        return max(0, int(max(0, self.base_tokens) * normalized))

    def select(self, items: list[ContextItem], *, factor: float) -> ContextBudgetResult:
        limit = self.limit(factor)
        picked: list[ContextItem] = []
        used = 0
        for item in items:
            if item.token_estimate < 0:
                raise ValueError("Context token_estimate 不得为负")
            if used + item.token_estimate > limit:
                continue
            picked.append(item)
            used += item.token_estimate
        return ContextBudgetResult(
            items=tuple(picked),
            used_tokens=used,
            limit_tokens=limit,
            truncated=len(picked) < len(items),
        )

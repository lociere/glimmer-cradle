"""Context 预算耗尽时的确定性、可追溯压缩。"""

from __future__ import annotations

from dataclasses import replace

from glimmer_cradle.cognition.context.source import ContextItem, estimate_tokens


class ContextCompactor:
    def compact(self, item: ContextItem, *, max_tokens: int) -> ContextItem | None:
        if max_tokens <= 0:
            return None
        if item.token_estimate <= max_tokens:
            return item
        content = item.content[: max_tokens * 3].rstrip()
        if not content:
            return None
        metadata = dict(item.metadata)
        metadata.update({
            "compacted": True,
            "original_token_estimate": item.token_estimate,
        })
        return replace(
            item,
            content=content,
            token_estimate=min(max_tokens, estimate_tokens(content)),
            metadata=metadata,
        )

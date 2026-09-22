"""数据可信度与 instruction authority 的独立判定。"""

from __future__ import annotations

from dataclasses import replace

from glimmer_cradle.cognition.context.source import ContextItem


class ContextTrustPolicy:
    """不让网页、扩展输出或记忆文本自行升级为 user/system 指令。"""

    def enforce(self, item: ContextItem) -> ContextItem:
        allowed = (
            item.instruction_authority == "data"
            or (
                item.instruction_authority == "user"
                and item.trust_tier in {"user_asserted", "host_verified", "authoritative"}
            )
            or (
                item.instruction_authority == "system"
                and item.trust_tier == "authoritative"
            )
        )
        if allowed:
            return item
        metadata = dict(item.metadata)
        metadata.update({
            "instruction_authority_downgraded_from": item.instruction_authority,
        })
        return replace(item, instruction_authority="data", metadata=metadata)

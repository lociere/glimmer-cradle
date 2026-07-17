"""
MemoryProvider 是 Context Assembly 进入 Global Workspace 的记忆专家入口。

按当前工作区焦点形成查询，由 ContextAssembly 在 episodic Memory、Knowledge、
Relationship 与近期 Ledger Moment 中按预算召回候选。

设计要点：
- **反应型**：工作区空时不投放（无焦点 → 无查询 → 跳过）
- **预算挂钩活动策略**：调 ContextAssembly 时传 ``policy.context_budget_factor``
- **数量上限**：默认每拍最多投 3 条（避免占满工作区）
- **salience**：统一使用 ContextItem.score()
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from glimmer_cradle.cognition.cycle.providers.base import Provider
from glimmer_cradle.cognition.cycle.workspace import WorkspaceItem, make_item
from glimmer_cradle.cognition.context import ContextAssembly, ContextQuery

if TYPE_CHECKING:
    from glimmer_cradle.cognition.activity import CognitiveActivityController


def _extract_query_text(item: WorkspaceItem) -> str:
    """从工作区项抽取查询文本。"""
    content = item.content if isinstance(item.content, dict) else {}
    for key in ("text", "query", "broadcast"):
        v = content.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, dict):
            inner = v.get("text") or v.get("content")
            if isinstance(inner, str) and inner.strip():
                return inner.strip()
    return str(item.content)[:200]


class MemoryProvider(Provider):
    name = "memory"

    def __init__(
        self,
        context_assembly: ContextAssembly,
        *,
        activity_controller: "CognitiveActivityController | None" = None,
        max_items_per_tick: int = 3,
    ) -> None:
        self._asm = context_assembly
        self._activity = activity_controller
        self._max_items = max(1, int(max_items_per_tick))

    async def propose(self, workspace_snapshot: list[WorkspaceItem]) -> list[WorkspaceItem]:
        if not workspace_snapshot:
            return []  # 无焦点 → 不主动检索

        # 取当前工作区 top-salience 项作为 focus
        focus = max(workspace_snapshot, key=lambda it: it.salience)
        query_text = _extract_query_text(focus)
        if not query_text:
            return []

        return await self._retrieve_from_assembly(query_text, focus)

    async def _retrieve_from_assembly(
        self, query_text: str, focus: WorkspaceItem,
    ) -> list[WorkspaceItem]:
        """通过 ContextAssembly 执行唯一召回路径。"""
        # 无活动策略时按 1.0 满预算。
        budget_factor = 1.0
        if self._activity is not None:
            try:
                state = self._activity.get_state()
                bf = state.get("policy", {}).get("context_budget_factor")
                if isinstance(bf, (int, float)):
                    budget_factor = float(bf)
            except Exception:
                pass

        # 提取场景 / 对话对象（如果焦点项是 perception，metadata 可能带 scene_id）
        focus_content = focus.content if isinstance(focus.content, dict) else {}
        query = ContextQuery(
            text=query_text,
            scene_id=focus_content.get("scene_id"),
            conversation_id=focus_content.get("conversation_id"),
            actor_id=focus_content.get("actor_id"),
            recall_scope=focus_content.get("recall_scope", "global_safe"),
            focus_summary=query_text[:80],
        )

        try:
            assembled = await self._asm.assemble(query, budget_factor=budget_factor,
                                                  per_source_limit=self._max_items)
        except Exception:
            return []

        # 取前 max_items 条按综合分排序的 ContextItem → WorkspaceItem
        picks = assembled.items[: self._max_items]
        return [
            make_item(
                source=self.name,
                content={
                    "text": ci.content,
                    "source_kind": ci.source,  # episodic / knowledge / relationship
                    "metadata": ci.metadata,
                },
                salience=min(1.0, max(0.05, ci.score())),
            )
            for ci in picks
        ]

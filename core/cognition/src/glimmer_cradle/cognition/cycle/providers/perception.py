"""
PerceptionProvider —— 感知专家。

每拍 drain PerceptionEventQueue（IPC 入站写入的近期感知事件），把每条事件转为
一个 WorkspaceItem(source=perception)。direct 表示外部互动义务，必须进入本拍
竞争的最高显著度；ambient 仍由 familiarity 调整显著度。

即时觉醒由 Cognition 入站边界负责；本 Provider 只在 Sense 相位 drain 队列并产出
WorkspaceItem，避免把跨层调度副作用塞进专家投放逻辑。
"""
from __future__ import annotations

from glimmer_cradle.cognition.cycle.perception_queue import PerceptionEntry, PerceptionEventQueue
from glimmer_cradle.cognition.cycle.providers.base import Provider
from glimmer_cradle.cognition.cycle.workspace import WorkspaceItem, make_item


def salience_for_perception(*, address_mode: str, familiarity: int) -> float:
    """感知 salience 公式（设计 §3.3 + §3.7）。

    direct：1.0，表示有人明确叫她，不能被长驻 drive 抢走广播权。
    ambient/其他：0.4 + familiarity / 10 × 0.3，clip 到 [0.1, 1.0]。
    """
    if address_mode == "direct":
        return 1.0
    base = 0.4
    bonus = max(0, min(10, int(familiarity))) / 10.0 * 0.3
    return max(0.1, min(1.0, base + bonus))


class PerceptionProvider(Provider):
    name = "perception"

    def __init__(
        self,
        queue: PerceptionEventQueue,
        *,
        max_items_per_tick: int = 5,
    ) -> None:
        self._queue = queue
        self._max_items = max(1, int(max_items_per_tick))

    async def propose(self, workspace_snapshot: list[WorkspaceItem]) -> list[WorkspaceItem]:
        entries: list[PerceptionEntry] = self._queue.drain(max_items=self._max_items)
        if not entries:
            return []

        # 触发觉醒（蓝图挂钩 ①）
        items: list[WorkspaceItem] = []
        for e in entries:
            content = {
                "text": e.text,
                "scene_id": e.scene_id,
                "conversation_id": e.conversation_id,
                "continuity_id": e.continuity_id,
                "thread_id": e.thread_id,
                "recall_scope": e.recall_scope,
                "disclosure_scope": e.disclosure_scope,
                "address_mode": e.address_mode,
                "response_policy": e.response_policy,
                "familiarity": e.familiarity,
                "trace_id": e.trace_id,
                "origin": e.origin,
                "retention_ceiling": e.retention_ceiling,
                "interaction_id": e.interaction_id,
            }
            if e.actor_id:
                content["actor_id"] = e.actor_id
            if e.actor_name:
                content["actor_name"] = e.actor_name
            # 携带规范化多模态输入，供 PerceptionAppraiser 单次路由。
            if e.model_input is not None:
                content["model_input"] = e.model_input
            items.append(make_item(
                source=self.name,
                content=content,
                salience=salience_for_perception(
                    address_mode=e.address_mode,
                    familiarity=e.familiarity,
                ),
            ))
        return items

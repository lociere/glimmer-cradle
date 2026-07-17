"""
SocialProvider 只把已经投影的关系状态带入 Global Workspace，不修改关系事实。
"""
from __future__ import annotations

from glimmer_cradle.cognition.cycle.providers.base import Provider
from glimmer_cradle.cognition.cycle.workspace import WorkspaceItem, make_item
from glimmer_cradle.cognition.memory.storage.relationship_repo import RelationshipRepository


def _extract_actor_info(item: WorkspaceItem) -> tuple[str | None, str | None, str]:
    """从工作区项抽取 (actor_id, display_name, kind)。

    kind: 'direct' (perception.address_mode=direct) / 'ambient'（其它）。
    """
    content = item.content if isinstance(item.content, dict) else {}
    actor_id = content.get("actor_id") or content.get("actor", {}).get("actor_id") \
        if isinstance(content.get("actor"), dict) else content.get("actor_id")
    if not actor_id:
        return None, None, "ambient"
    display_name = content.get("actor_name") or content.get("display_name") or ""
    address_mode = content.get("address_mode", "ambient")
    kind = "direct" if address_mode == "direct" else "ambient"
    return actor_id, (display_name or None), kind


class SocialProvider(Provider):
    name = "social"

    def __init__(
        self,
        relationship_repo: RelationshipRepository,
    ) -> None:
        self._repo = relationship_repo

    async def propose(self, workspace_snapshot: list[WorkspaceItem]) -> list[WorkspaceItem]:
        if not workspace_snapshot:
            return []

        # 取 top-salience 项作焦点
        focus = max(workspace_snapshot, key=lambda it: it.salience)
        # 只对 perception 类焦点做关系记录（其他 source 不带 actor 语义）
        if focus.source != "perception":
            # 即使非 perception 但 content 显式带 actor_id 也处理
            content = focus.content if isinstance(focus.content, dict) else {}
            if not content.get("actor_id"):
                return []

        actor_id, _, _ = _extract_actor_info(focus)
        if not actor_id:
            return []

        try:
            record = await self._repo.get(actor_id)
        except Exception:
            return []
        if record is None:
            return []

        salience = min(1.0, 0.3 + record.familiarity * 0.5)
        return [make_item(
            source=self.name,
            content={
                "actor_id": record.actor_id,
                "display_name": record.display_name,
                "familiarity": record.familiarity,
                "direct_interactions": record.direct_interactions,
                "ambient_observations": record.ambient_observations,
                "replies": record.replies,
                "relationship_summary": record.summary,
                "relationship_attributes": record.attributes,
            },
            salience=salience,
        )]

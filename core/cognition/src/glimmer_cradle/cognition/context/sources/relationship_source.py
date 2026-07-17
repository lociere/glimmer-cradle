"""从关系事实与当前证据化修订中激活对话上下文。"""
from glimmer_cradle.cognition.context.sources.base import ContextItem, ContextQuery, ContextSource, estimate_tokens
from glimmer_cradle.cognition.memory.storage.relationship_repo import RelationshipRepository


class RelationshipSource(ContextSource):
    name = "relationship"

    def __init__(self, repository: RelationshipRepository) -> None:
        self._repository = repository

    async def activate(self, query: ContextQuery, *, max_items: int = 10) -> list[ContextItem]:
        if not query.actor_id or "actor_private" not in query.allowed_scopes:
            return []
        record = await self._repository.get(query.actor_id)
        if record is None:
            return []
        content = (f"关系事实：与 {record.display_name or record.actor_id} 有 "
                   f"{record.direct_interactions} 次直接互动、{record.replies} 次回应。")
        if record.summary:
            content += f" 当前理解：{record.summary}"
        return [ContextItem(source=self.name, content=content, relevance=0.9,
                            recency=0.8, importance=max(0.4, record.confidence),
                            token_estimate=estimate_tokens(content),
                            metadata={"actor_id": record.actor_id})]

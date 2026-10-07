"""Cognition 长期承诺接纳与 Jobs 投递；不预分类本拍工具调用。"""

from __future__ import annotations

from glimmer_cradle.cognition.planning.commitment import Commitment
from glimmer_cradle.cognition.planning.plan import PlanVersion
from glimmer_cradle.cognition.planning.planning_store import PlanningStore
from glimmer_cradle.cognition.ports import JobPort


class PlanningController:
    """显式接纳长期计划；接纳和投递都以持久回执为准。"""

    def __init__(self, *, store: PlanningStore) -> None:
        self._store = store

    async def accept_commitment(
        self, commitment_id: str, plan: PlanVersion, *, due_at: int
    ) -> Commitment:
        """普通模型回复或工具调用不会自动升级为长期承诺。"""
        return await self._store.accept_commitment(commitment_id, plan, due_at=due_at)

    async def deliver_jobs(self, jobs: JobPort, *, limit: int = 64) -> int:
        """先获得实际 Jobs 持久接纳再 ACK；不跨 await 持有 Planning 事务。"""
        delivered = 0
        for request in await self._store.pending_job_requests(limit=limit):
            receipt = await jobs.request(request)
            await self._store.acknowledge_job_request(request, receipt)
            delivered += 1
        return delivered

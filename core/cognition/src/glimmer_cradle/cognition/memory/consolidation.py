"""基于持久任务、批量对账与证据修订的长期记忆巩固。"""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import asdict
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from glimmer_cradle.cognition.experience.episodes import Episode, EpisodeProjection
from glimmer_cradle.cognition.inference.gateway import LLMEngine, LLMMessage, LLMRequest
from glimmer_cradle.cognition.memory.relationship_projection import RelationshipProjection
from glimmer_cradle.cognition.memory.storage.consolidation_job_repo import (
    ConsolidationJob,
    ConsolidationJobRepository,
)
from glimmer_cradle.cognition.memory.storage.memory_repo import now_iso
from glimmer_cradle.cognition.memory.substrate import MemoryRecord, MemorySubstrate
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.protocol.generated.enums.memory_kind import MemoryKind

logger = get_logger("memory_consolidation")


class MemoryDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: Literal["add", "update", "supersede", "dispute", "noop"]
    target_memory_id: str | None = None
    kind: MemoryKind | None = None
    content: str | None = Field(default=None, max_length=2000)
    summary: str | None = Field(default=None, max_length=300)
    confidence: float = Field(default=0.7, ge=0, le=1)
    salience: float = Field(default=0.5, ge=0, le=1)
    actor_id: str | None = None
    attributes: dict = Field(default_factory=dict)
    evidence_moment_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_operation(self) -> "MemoryDecision":
        if self.operation == "noop":
            return self
        if not self.kind or not self.content or not self.summary or not self.evidence_moment_ids:
            raise ValueError("非 NOOP 决策必须包含完整记忆内容与证据")
        if self.operation != "add" and not self.target_memory_id:
            raise ValueError("修订决策必须指定 target_memory_id")
        return self


class ConsolidationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decisions: list[MemoryDecision] = Field(default_factory=list, max_length=16)


class ConsolidationCoordinator:
    """将 sealed Episode 转为可重试任务，并以一次调用完成批量记忆对账。"""

    def __init__(
        self, *, episodes: EpisodeProjection, memory: MemorySubstrate,
        jobs: ConsolidationJobRepository, llm: LLMEngine | None,
        relationship_projection: RelationshipProjection | None = None,
        enabled: bool = True, batch_size: int = 8, max_batch_moments: int = 64,
        debounce_seconds: int = 120, max_wait_seconds: int = 900,
        lease_seconds: int = 180, retry_base_seconds: int = 30,
        minimum_salience: float = 0.45,
        autobiographical_evidence_threshold: int = 3,
    ) -> None:
        self._episodes = episodes
        self._memory = memory
        self._jobs = jobs
        self._llm = llm
        self._relationship_projection = relationship_projection
        self._enabled = enabled
        self._batch_size = batch_size
        self._max_batch_moments = max_batch_moments
        self._debounce_seconds = debounce_seconds
        self._max_wait_seconds = max_wait_seconds
        self._lease_seconds = lease_seconds
        self._retry_base_seconds = retry_base_seconds
        self._minimum_salience = minimum_salience
        self._autobiographical_evidence_threshold = autobiographical_evidence_threshold
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        await self._episodes.start()
        await self._episodes.project_pending()
        self._episodes.recover_interrupted()
        await self._jobs.recover_expired()
        if self._relationship_projection is not None:
            await self._relationship_projection.project_pending()

    async def stop(self) -> None:
        """只封口和入队，不在停机关键路径执行模型推理。"""
        await self._episodes.project_pending(seal=True)
        await self._enqueue_pending()
        if self._relationship_projection is not None:
            await self._relationship_projection.project_pending()

    async def consolidate(self, *, force_seal: bool = False) -> int:
        if not self._enabled:
            return 0
        async with self._lock:
            await self._episodes.project_pending(seal=force_seal)
            if self._relationship_projection is not None:
                await self._relationship_projection.project_pending()
            await self._enqueue_pending()
            jobs = await self._jobs.claim_due(
                limit=self._batch_size, lease_seconds=self._lease_seconds
            )
            created = 0
            for partition in self._partition_jobs(jobs):
                created += await self._consolidate_batch(partition)
            return created

    def _partition_jobs(self, jobs: list[ConsolidationJob]) -> list[list[ConsolidationJob]]:
        partitions: dict[tuple[str, ...], list[ConsolidationJob]] = {}
        for job in jobs:
            episode = self._episodes.get_episode(job.episode_id)
            eligible = [
                item for item in episode.moments
                if item.retention_ceiling == "memory_candidate"
            ] if episode is not None else []
            if not eligible:
                key = ("missing", job.job_id)
            else:
                domains = {self._moment_domain_key(item) for item in eligible}
                key = next(iter(domains)) if len(domains) == 1 else ("mixed", job.job_id)
            partitions.setdefault(key, []).append(job)
        return list(partitions.values())

    async def _enqueue_pending(self) -> None:
        for episode in self._episodes.pending_consolidation(limit=self._batch_size * 8):
            eligible = [
                item for item in episode.moments
                if item.retention_ceiling == "memory_candidate"
            ]
            if episode.salience < self._minimum_salience or not eligible:
                self._episodes.mark_consolidated(episode.episode_id, now_iso())
                continue
            await self._jobs.enqueue(
                episode,
                debounce_seconds=self._debounce_seconds,
                max_wait_seconds=self._max_wait_seconds,
            )

    async def _consolidate_batch(self, jobs: list[ConsolidationJob]) -> int:
        if self._llm is None:
            await self._jobs.fail(
                jobs, error_code="provider_unavailable",
                retry_base_seconds=self._retry_base_seconds,
            )
            return 0
        episodes = [self._episodes.get_episode(job.episode_id) for job in jobs]
        valid_episodes = [episode for episode in episodes if episode is not None]
        if len(valid_episodes) != len(jobs):
            await self._jobs.fail(
                jobs, error_code="episode_missing",
                retry_base_seconds=self._retry_base_seconds,
            )
            return 0
        eligible = [
            moment
            for episode in valid_episodes
            for moment in episode.moments
            if moment.retention_ceiling == "memory_candidate"
        ][-self._max_batch_moments:]
        if len({self._moment_domain_key(item) for item in eligible}) > 1:
            await self._jobs.fail(
                jobs, error_code="mixed_permission_domain",
                retry_base_seconds=self._retry_base_seconds,
            )
            return 0
        allowed = {item.moment_id: item for item in eligible}
        if not allowed:
            await self._finish_jobs(jobs)
            return 0
        query = "\n".join(str(item.content) for item in eligible)
        domain = eligible[-1]
        existing = await self._memory.retrieve(
            query,
            actor_id=domain.actor_id,
            scene_id=domain.scene_id,
            conversation_id=domain.conversation_id,
            allowed_scopes={domain.recall_scope},
            limit=12,
            token_budget=1400,
        )
        batch_id = uuid.uuid5(
            uuid.NAMESPACE_URL,
            "glimmer:memory-batch:" + ":".join(sorted(job.job_id for job in jobs)),
        ).hex
        try:
            output = await self._infer(valid_episodes, eligible, existing)
            drafts = self._build_drafts(
                output, existing=existing, allowed=allowed,
                consolidation_id=batch_id,
            )
            if drafts:
                await self._memory.remember_batch(drafts)
            await self._finish_jobs(jobs)
            return len(drafts)
        except Exception as exc:
            logger.warning(
                "长期记忆批量巩固失败，任务等待重试",
                jobs=[job.job_id for job in jobs], error=str(exc),
            )
            await self._jobs.fail(
                jobs, error_code=type(exc).__name__,
                retry_base_seconds=self._retry_base_seconds,
            )
            return 0

    def _build_drafts(
        self, output: ConsolidationOutput, *, existing: list[MemoryRecord],
        allowed: dict, consolidation_id: str,
    ) -> list[dict]:
        existing_by_id = {item.memory_id: item for item in existing}
        drafts: list[dict] = []
        for index, decision in enumerate(output.decisions):
            if decision.operation == "noop":
                continue
            evidence_ids = list(dict.fromkeys(decision.evidence_moment_ids))
            if not evidence_ids or any(item not in allowed for item in evidence_ids):
                raise ValueError("巩固输出引用了不允许的 Moment 证据")
            if (
                decision.kind == MemoryKind.AUTOBIOGRAPHICAL
                and len(evidence_ids) < self._autobiographical_evidence_threshold
            ):
                raise ValueError("自传记忆证据数量不足")
            target = existing_by_id.get(decision.target_memory_id or "")
            if decision.operation != "add" and target is None:
                raise ValueError("巩固输出引用了候选集合之外的记忆")
            evidence = [
                {
                    "moment_id": item,
                    "role": "support",
                    "source": asdict(allowed[item].origin),
                }
                for item in evidence_ids
            ]
            scene_id = next((allowed[item].scene_id for item in evidence_ids if allowed[item].scene_id), None)
            conversation_id = next((
                allowed[item].conversation_id for item in evidence_ids
                if allowed[item].conversation_id
            ), None)
            continuity_id = next((
                allowed[item].continuity_id for item in evidence_ids
                if allowed[item].continuity_id
            ), None)
            resolved_actor_id = decision.actor_id or next((
                allowed[item].actor_id for item in evidence_ids if allowed[item].actor_id
            ), None)
            recall_scopes = {allowed[item].recall_scope for item in evidence_ids}
            disclosure_scopes = {allowed[item].disclosure_scope for item in evidence_ids}
            if len(recall_scopes) != 1 or len(disclosure_scopes) != 1:
                raise ValueError("单条长期记忆的证据不得跨越不同权限域")
            recall_scope = next(iter(recall_scopes))
            disclosure_scope = next(iter(disclosure_scopes))
            if target is not None and not self._same_memory_domain(
                target,
                recall_scope=recall_scope,
                conversation_id=conversation_id,
                actor_id=resolved_actor_id,
                scene_id=scene_id,
            ):
                raise ValueError("巩固修订目标不属于当前权限域")
            base = {
                "kind": decision.kind,
                "content": decision.content,
                "summary": decision.summary,
                "status": "disputed" if decision.operation == "dispute" else "active",
                "confidence": decision.confidence,
                "salience": decision.salience,
                "actor_id": resolved_actor_id,
                "scene_id": scene_id,
                "conversation_id": conversation_id,
                "continuity_id": continuity_id,
                "recall_scope": recall_scope,
                "disclosure_scope": disclosure_scope,
                "attributes": {**decision.attributes, "reconciliation": decision.operation},
                "evidence": evidence,
                "consolidation_id": consolidation_id,
                "valid_from": min(allowed[item].occurred_at for item in evidence_ids),
            }
            if decision.operation == "add":
                drafts.append({
                    **base,
                    "memory_id": uuid.uuid5(
                        uuid.NAMESPACE_URL,
                        f"glimmer:memory:{consolidation_id}:{index}",
                    ).hex,
                })
            elif decision.operation == "supersede":
                drafts.append({
                    **base,
                    "memory_id": target.memory_id,
                    "content": target.content,
                    "summary": target.summary,
                    "kind": target.kind,
                    "status": "superseded",
                    "attributes": {**target.attributes, "superseded_by_batch": consolidation_id},
                })
                drafts.append({
                    **base,
                    "memory_id": uuid.uuid5(
                        uuid.NAMESPACE_URL,
                        f"glimmer:memory:{consolidation_id}:{index}:replacement",
                    ).hex,
                    "attributes": {**base["attributes"], "supersedes_memory_id": target.memory_id},
                })
            else:
                drafts.append({**base, "memory_id": target.memory_id})
        return drafts

    @staticmethod
    def _moment_domain_key(item) -> tuple[str, ...]:
        owner = {
            "conversation_private": item.conversation_id,
            "actor_private": item.actor_id or "",
            "space_local": item.scene_id or "",
            "character_internal": item.continuity_id,
        }.get(item.recall_scope, item.recall_scope)
        return item.recall_scope, item.disclosure_scope, owner

    @staticmethod
    def _same_memory_domain(
        target: MemoryRecord, *, recall_scope: str,
        conversation_id: str | None, actor_id: str | None, scene_id: str | None,
    ) -> bool:
        if target.recall_scope != recall_scope:
            return False
        if recall_scope == "conversation_private":
            return target.conversation_id == conversation_id
        if recall_scope == "actor_private":
            return bool(actor_id) and target.actor_id == actor_id
        if recall_scope == "space_local":
            return target.scene_id == scene_id
        return True

    async def _infer(
        self, episodes: list[Episode], moments: list, existing: list[MemoryRecord]
    ) -> ConsolidationOutput:
        payload = {
            "episodes": [
                {
                    "episode_id": episode.episode_id,
                    "scene_id": episode.scene_id,
                    "started_at": episode.started_at,
                    "ended_at": episode.ended_at,
                }
                for episode in episodes
            ],
            "moments": [
                {
                    "moment_id": item.moment_id, "kind": item.kind,
                    "occurred_at": item.occurred_at, "actor_id": item.actor_id,
                    "content": item.content, "importance": item.importance,
                }
                for item in moments
            ],
            "existing_memories": [
                {
                    "memory_id": item.memory_id, "kind": item.kind.value,
                    "status": item.status, "content": item.content,
                    "summary": item.summary, "actor_id": item.actor_id,
                }
                for item in existing
            ],
        }
        system = (
            "你是微光摇篮的长期记忆对账器。一次处理整批 Episode，只保留未来确有价值的事实。"
            "新事实用 add；补充同一事实用 update；新事实取代旧事实用 supersede；证据冲突用 dispute；"
            "不值得写入或已被现有记忆覆盖用 noop。不得补造信息，target_memory_id 只能引用候选。"
            "输出严格 JSON：{\"decisions\":[{\"operation\":\"add|update|supersede|dispute|noop\","
            "\"target_memory_id\":null,\"kind\":\"episodic|semantic|social|autobiographical|prospective|procedural\","
            "\"content\":\"...\",\"summary\":\"...\",\"confidence\":0.0,\"salience\":0.0,"
            "\"actor_id\":null,\"attributes\":{},\"evidence_moment_ids\":[\"...\"]}]}。"
        )
        request = LLMRequest(
            messages=[
                LLMMessage(role="system", content=system),
                LLMMessage(role="user", content=json.dumps(payload, ensure_ascii=False)),
            ],
            metadata={
                "purpose": "memory_consolidation",
                "capture_category": "memory",
                "episode_ids": [item.episode_id for item in episodes],
            },
        )
        text = (await asyncio.to_thread(self._llm.generate, request)).strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        try:
            return ConsolidationOutput.model_validate_json(text)
        except ValidationError as exc:
            raise ValueError("巩固输出不符合结构契约") from exc

    async def _finish_jobs(self, jobs: list[ConsolidationJob]) -> None:
        await self._jobs.complete(jobs)
        timestamp = now_iso()
        for job in jobs:
            self._episodes.mark_consolidated(job.episode_id, timestamp)

"""基于持久任务、批量对账与证据修订的长期记忆巩固。"""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Callable
from dataclasses import asdict
from typing import Literal

from glimmer_cradle.cognition.inference import ModelMessage, ModelPort, ModelRequest
from glimmer_cradle.cognition.memory.memory import Episode, MemoryKind, MemoryRecord
from glimmer_cradle.cognition.memory.memory_controller import MemoryController
from glimmer_cradle.cognition.memory.memory_store import (
    ConsolidationJob,
    ConsolidationJobStore,
    EpisodeProjectionStore,
    MemoryConsolidationConflictError,
    MemoryConsolidationInput,
    MemoryConsolidationReceipt,
    MemoryConsolidationRequest,
    MemoryJobIdentity,
    MemoryJobResult,
    RelationshipProjectionStore,
)
from glimmer_cradle.cognition.ports import IdGeneratorPort, ObservabilityPort
from glimmer_cradle.cognition.ports.clock_port import ClockPort
from glimmer_cradle.conversation import Moment, MomentKind
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


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
        self, *, episodes: EpisodeProjectionStore, memory: MemoryController,
        jobs: ConsolidationJobStore | None, llm: ModelPort | None,
        clock: ClockPort,
        ids: IdGeneratorPort,
        observability: ObservabilityPort,
        relationship_projection: RelationshipProjectionStore | None = None,
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
        self._clock = clock
        self._ids = ids
        self._logger = observability.logger("memory_consolidation")
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
        if self._jobs is not None:
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
            if self._jobs is None:
                return 0
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
            key: tuple[str, ...]
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
                self._episodes.mark_consolidated(episode.episode_id, self._clock.now_iso())
                continue
            receipt = await self._memory.find_consolidation(self._receipt_input(episode))
            if receipt is not None:
                self._episodes.mark_consolidated(episode.episode_id, receipt.committed_at)
                continue
            if self._jobs is not None:
                await self._jobs.enqueue(
                    episode,
                    debounce_seconds=self._debounce_seconds,
                    max_wait_seconds=self._max_wait_seconds,
                )

    @property
    def uses_external_jobs(self) -> bool:
        return self._jobs is None

    async def source_job_requests(self, *, limit: int) -> list[MemoryConsolidationRequest]:
        if not self.uses_external_jobs:
            raise MemoryConsolidationConflictError("旧巩固队列尚未切换；禁止双消费")
        if not self._enabled:
            return []
        requests = self._episodes.pending_job_requests(limit=limit)
        eligible = []
        for request in requests:
            episode = self._episodes.get_episode(request.input.episode_id)
            if episode is None or consolidation_input(episode) != request.input:
                raise MemoryConsolidationConflictError("Memory 源请求原证据冲突")
            if episode.salience < self._minimum_salience:
                self._episodes.mark_consolidated(episode.episode_id, self._clock.now_iso())
                continue
            receipt = await self._memory.find_consolidation(request.input)
            if receipt is not None:
                self._episodes.mark_consolidated(episode.episode_id, receipt.committed_at)
                continue
            eligible.append(request)
        return eligible

    def acknowledge_job_request(self, request: MemoryConsolidationRequest, job_id: str) -> None:
        if not self.uses_external_jobs:
            raise MemoryConsolidationConflictError("旧巩固队列尚未切换；禁止双消费")
        self._episodes.acknowledge_job_request(request, job_id)

    async def _consolidate_batch(self, jobs: list[ConsolidationJob]) -> int:
        assert self._jobs is not None
        episodes = [self._episodes.get_episode(job.episode_id) for job in jobs]
        valid_episodes = [episode for episode in episodes if episode is not None]
        if len(valid_episodes) != len(jobs):
            await self._jobs.fail(
                jobs, error_code="episode_missing",
                retry_base_seconds=self._retry_base_seconds,
            )
            return 0
        if any(job.episode_version != episode.version for job, episode in zip(jobs, valid_episodes, strict=True)):
            await self._jobs.fail(jobs, error_code="episode_version_conflict", retry_base_seconds=self._retry_base_seconds)
            return 0
        try:
            inputs = tuple(self._receipt_input(episode) for episode in valid_episodes)
            receipts = [await self._memory.find_consolidation(item) for item in inputs]
            recovered = [job for job, receipt in zip(jobs, receipts, strict=True) if receipt is not None]
            if recovered:
                await self._memory.load()
                await self._finish_jobs(recovered)
            remaining = [(job, episode, item) for job, episode, item, receipt in
                         zip(jobs, valid_episodes, inputs, receipts, strict=True) if receipt is None]
            if not remaining:
                return 0
            return await self._infer_and_commit(
                [item[0] for item in remaining], [item[1] for item in remaining], tuple(item[2] for item in remaining)
            )
        except Exception:
            # 不输出模型原文、输入 JSON 或底层异常文本；失败后先查询持久结果。
            self._logger.warning("长期记忆批量巩固失败，等待持久结果对账", jobs=[job.job_id for job in jobs],
                                 error_code="consolidation_failed")
            await self._jobs.fail(jobs, error_code="consolidation_failed", retry_base_seconds=self._retry_base_seconds)
            return 0

    async def _infer_and_commit(
        self, jobs: list[ConsolidationJob], episodes: list[Episode], inputs: tuple[MemoryConsolidationInput, ...]
    ) -> int:
        assert self._jobs is not None
        batch_id = self._ids.stable("memory-batch", ":".join(sorted(job.job_id for job in jobs)))
        if self._llm is None and any(moment.retention_ceiling == "memory_candidate" for episode in episodes for moment in episode.moments):
            await self._jobs.fail(jobs, error_code="provider_unavailable", retry_base_seconds=self._retry_base_seconds)
            return 0
        receipt = await self._infer_memory_result(batch_id, episodes, inputs)
        await self._finish_jobs(jobs)
        return 0 if receipt.duplicate else len(receipt.memory_ids)

    async def execute_job(self, identity: MemoryJobIdentity, item: MemoryConsolidationInput) -> MemoryConsolidationReceipt:
        episode = self._episodes.get_episode(item.episode_id)
        if episode is None or self._receipt_input(episode) != item or identity.scope_id != item.scope_id:
            raise MemoryConsolidationConflictError("Memory Job Episode/version/scope/digest 冲突")
        operation_id = self._ids.stable("memory-job-result", identity.job_id)
        # 登记先于推理锁，新的 fencing 必须能立即使正在推理的旧 attempt 失效。
        receipt = await self._memory.prepare_job(identity, operation_id, (item,))
        if receipt is not None:
            await self._memory.load()
            self._episodes.mark_consolidated(item.episode_id, receipt.committed_at)
            return receipt
        async with self._lock:
            receipt = await self._memory.prepare_job(identity, operation_id, (item,))
            if receipt is None:
                receipt = await self._infer_memory_result(operation_id, [episode], (item,), execution=identity)
            self._episodes.mark_consolidated(item.episode_id, receipt.committed_at)
            return receipt

    async def reconcile_job(self, identity: MemoryJobIdentity) -> MemoryJobResult:
        # 不取推理锁：封口必须能与在途模型并发，并在提交锁上决定先后。
        return await self._memory.reconcile_job(identity)

    async def _infer_memory_result(
        self, operation_id: str, episodes: list[Episode], inputs: tuple[MemoryConsolidationInput, ...],
        *, execution: MemoryJobIdentity | None = None,
    ) -> MemoryConsolidationReceipt:
        eligible = [
            moment
            for episode in episodes
            for moment in episode.moments
            if moment.retention_ceiling == "memory_candidate"
        ][-self._max_batch_moments:]
        if len({self._moment_domain_key(item) for item in eligible}) > 1:
            raise MemoryConsolidationConflictError("Memory Job 不得跨权限域推理")
        allowed = {item.moment_id: item for item in eligible}
        if not allowed:
            return await self._memory.commit_consolidation(operation_id, inputs, [], execution=execution)
        if self._llm is None:
            raise MemoryConsolidationConflictError("Memory Job 推理 provider 不可用")
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
        output = await self._infer(episodes, eligible, existing)
        drafts = self._build_drafts(
            output, existing=existing, allowed=allowed, consolidation_id=operation_id,
        )
        return await self._memory.commit_consolidation(operation_id, inputs, drafts, execution=execution)

    def _receipt_input(self, episode: Episode) -> MemoryConsolidationInput:
        return consolidation_input(episode)

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
                    "memory_id": self._ids.stable(
                        "memory", f"{consolidation_id}:{index}"
                    ),
                })
                continue
            assert target is not None
            if decision.operation == "supersede":
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
                    "memory_id": self._ids.stable(
                        "memory", f"{consolidation_id}:{index}:replacement"
                    ),
                    "attributes": {**base["attributes"], "supersedes_memory_id": target.memory_id},
                })
            else:
                drafts.append({**base, "memory_id": target.memory_id})
        return drafts

    @staticmethod
    def _moment_domain_key(item) -> tuple[str, ...]:
        return moment_domain_key(item)

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
        request = ModelRequest(
            messages=[
                ModelMessage(role="system", content=system),
                ModelMessage(role="user", content=json.dumps(payload, ensure_ascii=False)),
            ],
            metadata={
                "purpose": "memory_consolidation",
                "capture_category": "memory",
                "episode_ids": [item.episode_id for item in episodes],
            },
        )
        llm = self._llm
        assert llm is not None
        text = (await llm.generate(request)).strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        try:
            return ConsolidationOutput.model_validate_json(text)
        except ValidationError as exc:
            raise ValueError("巩固输出不符合结构契约") from exc

    async def _finish_jobs(self, jobs: list[ConsolidationJob]) -> None:
        assert self._jobs is not None
        await self._jobs.complete(jobs)
        timestamp = self._clock.now_iso()
        for job in jobs:
            self._episodes.mark_consolidated(job.episode_id, timestamp)


def moment_domain_key(item: Moment) -> tuple[str, ...]:
    owner = {
        "conversation_private": item.conversation_id,
        "actor_private": item.actor_id or "",
        "space_local": item.scene_id or "",
        "character_internal": item.continuity_id,
    }.get(item.recall_scope, item.recall_scope)
    return item.recall_scope, item.disclosure_scope, owner


def consolidation_input(episode: Episode) -> MemoryConsolidationInput:
    """源请求与接收校验共用不可变证据摘要；不包含可修复的封口原因。"""
    if not episode.moments or len(episode.moments) != episode.version:
        raise MemoryConsolidationConflictError("Memory 巩固 Episode 证据不完整")
    eligible = [moment for moment in episode.moments if moment.retention_ceiling == "memory_candidate"]
    domains = {moment_domain_key(moment) for moment in eligible or episode.moments}
    if len(domains) != 1:
        raise MemoryConsolidationConflictError("Memory 巩固 Episode 权限域不唯一或证据丢失")
    scope_id = hashlib.sha256(json.dumps(next(iter(domains)), separators=(",", ":")).encode("utf-8")).hexdigest()
    document = {"episode_id": episode.episode_id, "version": episode.version, "scope_id": scope_id,
                "moments": [asdict(moment) for moment in episode.moments]}
    digest = hashlib.sha256(json.dumps(document, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
                                     allow_nan=False).encode("utf-8")).hexdigest()
    return MemoryConsolidationInput(episode.episode_id, episode.version, scope_id, digest)


class MaintenanceScheduler:
    """按独立节拍维护 Episode 与 Memory；活动态只提供封口提示。"""

    def __init__(
        self,
        *,
        consolidation: ConsolidationCoordinator,
        activity_state_provider: Callable[[], str],
        interval_seconds: float = 300,
        observability: ObservabilityPort,
    ) -> None:
        self._consolidation = consolidation
        self._activity_state_provider = activity_state_provider
        self._interval_seconds = max(10.0, interval_seconds)
        self._observability = observability
        self._logger = observability.logger("maintenance_scheduler")
        self._wake_event = asyncio.Event()
        self._force_seal_requested = False
        self._pending_reason = "scheduled"
        self._running = False
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._running:
            return
        await self._consolidation.start()
        self._running = True
        if self._activity_state_provider() == "quiescent":
            self._force_seal_requested = True
            self._pending_reason = "quiescent_boundary"
        self._wake_event.set()
        self._task = asyncio.create_task(self._run_loop())
        self._observability.gauge("cognition.maintenance.running", 1.0)
        self._logger.info(
            "认知维护调度器已启动",
            interval_seconds=self._interval_seconds,
        )

    async def stop(self) -> None:
        self._running = False
        self._wake_event.set()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self._consolidation.stop()
        self._observability.gauge("cognition.maintenance.running", 0.0)
        self._logger.info("认知维护调度器已停止")

    def notify_activity_transition(self) -> None:
        """静息只触发一次 Episode 封口，不改变维护任务的 owner 或节拍。"""
        if self._activity_state_provider() != "quiescent":
            return
        self._force_seal_requested = True
        self._pending_reason = "quiescent_boundary"
        self._wake_event.set()

    def notify_moment(self, moment: Moment) -> None:
        """终结 Moment 只负责唤醒；sealed Episode 才是可恢复工作项。"""
        if moment.kind not in {MomentKind.REPLY.value, MomentKind.SILENCE.value}:
            return
        if not self._force_seal_requested:
            self._pending_reason = "interaction_completed"
        self._wake_event.set()

    async def run_once(
        self,
        *,
        force_seal: bool = False,
        reason: str = "scheduled",
    ) -> int:
        with self._observability.span(
            "cognition_maintenance",
            attributes={"force_seal": force_seal, "reason": reason},
        ) as task_span:
            created = await self._consolidation.consolidate(force_seal=force_seal)
            task_span.set_attribute("memories_created", created)
            self._observability.counter(
                "cognition.maintenance.run",
                labels={
                    "status": "success",
                    "reason": reason,
                },
            )
            self._observability.counter("cognition.memories_consolidated", created)
            return created

    async def _run_loop(self) -> None:
        while self._running:
            try:
                try:
                    await asyncio.wait_for(
                        self._wake_event.wait(),
                        timeout=self._interval_seconds,
                    )
                except asyncio.TimeoutError:
                    pass
                self._wake_event.clear()
                force_seal = self._force_seal_requested
                reason = self._pending_reason
                self._force_seal_requested = False
                self._pending_reason = "scheduled"
                await self.run_once(force_seal=force_seal, reason=reason)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self._observability.counter(
                    "cognition.maintenance.run",
                    labels={"status": "error", "reason": "scheduled"},
                )
                self._logger.error(
                    "认知维护任务失败，等待下一次调度",
                    error=str(exc),
                    exc_info=True,
                )

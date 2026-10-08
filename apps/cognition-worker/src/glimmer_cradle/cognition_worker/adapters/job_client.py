"""Durable Jobs client implementing Cognition's JobPort."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import asdict
from typing import Protocol

from glimmer.cognition.v1 import cognition_service_pb2 as cognition_pb
from glimmer.jobs.v1 import jobs_pb2 as jobs_pb
from glimmer_cradle.cognition.inference import ModelPort, ModelRequest
from glimmer_cradle.cognition.knowledge import KnowledgeIndex, KnowledgeRevision
from glimmer_cradle.cognition.planning import (
    GoalVersion,
    PlanningJobIdentity,
    PlanningJobResult,
)
from glimmer_cradle.cognition.ports import (
    JobReceipt,
    JobRequest,
    PlanningEvidence,
    PlanningEvidenceReference,
    ResourceScope,
)
from glimmer_cradle.conversation import ConversationRecorder, Moment, MomentKind


class JobRequestTransport(Protocol):
    async def request(
        self, method: str, payload: dict[str, object]
    ) -> dict[str, object]: ...


class JobClient:
    def __init__(self, transport: JobRequestTransport) -> None:
        self._transport = transport

    async def request(self, request: JobRequest) -> JobReceipt:
        response = await self._transport.request(
            "job.request",
            {
                "request_id": request.request_id,
                "goal_id": request.goal_id,
                "kind": request.kind,
                "payload": request.payload,
                "idempotency_key": request.idempotency_key,
                "scope_id": request.scope_id,
                "due_at": request.due_at,
            },
        )
        return self._receipt(response)

    async def cancel(self, job_id: str, *, expected_revision: int) -> JobReceipt:
        return self._receipt(
            await self._transport.request(
                "job.cancel", {"job_id": job_id, "expected_revision": expected_revision}
            )
        )

    @staticmethod
    def _receipt(response: dict[str, object]) -> JobReceipt:
        job_id, status, revision = (
            response.get("job_id"),
            response.get("status"),
            response.get("revision"),
        )
        if not isinstance(job_id, str) or status not in {
            "accepted",
            "duplicate",
            "rejected",
        }:
            raise ValueError("invalid job receipt")
        if not isinstance(revision, int) or revision < 0:
            raise ValueError("invalid job revision")
        return JobReceipt(job_id, status, revision)  # type: ignore[arg-type]


def planning_source_from_wire(
    source: cognition_pb.PlanningJobSourceRequest,
) -> JobRequest:
    """映射唯一 DTO 到消费方请求；不向 Core 泄漏 generated。"""
    identity = json.dumps(
        [
            "planning.evaluate",
            source.commitment_id,
            source.plan_id,
            source.plan_version,
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    if (
        source.ByteSize() > 65536
        or any(
            not value.strip()
            for value in (
                source.commitment_id,
                source.plan_id,
                source.goal_id,
                source.scope_id,
            )
        )
        or not all(
            1 <= value <= 9007199254740991
            for value in (source.plan_version, source.goal_version)
        )
        or not 0 <= source.due_at_ms <= 9007199254740991
        or source.request_id != hashlib.sha256(identity.encode("utf-8")).hexdigest()
    ):
        raise ValueError("Planning 源请求 identity/版本/due 无效")
    return JobRequest(
        request_id=source.request_id,
        goal_id=source.goal_id,
        kind="planning.evaluate",
        payload={
            "commitment_id": source.commitment_id,
            "plan_id": source.plan_id,
            "plan_version": source.plan_version,
            "goal_version": source.goal_version,
        },
        idempotency_key=source.request_id,
        scope_id=source.scope_id,
        due_at=source.due_at_ms,
    )


def planning_source_to_wire(
    request: JobRequest,
) -> cognition_pb.PlanningJobSourceRequest:
    payload = request.payload
    if (
        set(payload) != {"commitment_id", "plan_id", "plan_version", "goal_version"}
        or not all(
            type(payload.get(key)) is int for key in ("plan_version", "goal_version")
        )
        or not all(
            isinstance(payload.get(key), str) for key in ("commitment_id", "plan_id")
        )
    ):
        raise ValueError("Planning 持久源内容无效")
    source = cognition_pb.PlanningJobSourceRequest(
        request_id=request.request_id,
        goal_id=request.goal_id,
        commitment_id=payload["commitment_id"],
        plan_id=payload["plan_id"],
        plan_version=payload["plan_version"],
        goal_version=payload["goal_version"],
        scope_id=request.scope_id,
        due_at_ms=request.due_at,
    )
    if planning_source_from_wire(source) != request:
        raise ValueError("Planning 持久源 kind/去重身份无效")
    return source


def planning_identity_from_wire(identity: jobs_pb.JobExecutionIdentity) -> PlanningJobIdentity:
    return PlanningJobIdentity(identity.job_id, identity.scope_id, identity.attempt,
                               identity.authority_epoch, identity.fencing_token,
                               identity.owner_id, identity.lease_until_ms)


def planning_identity_to_wire(identity: PlanningJobIdentity) -> jobs_pb.JobExecutionIdentity:
    return jobs_pb.JobExecutionIdentity(job_id=identity.job_id, scope_id=identity.scope_id,
        attempt=identity.attempt, authority_epoch=identity.authority_epoch,
        fencing_token=identity.fencing_token, owner_id=identity.owner_id,
        lease_until_ms=identity.lease_until)


def planning_result_to_wire(result: PlanningJobResult, request_id: str) -> cognition_pb.PlanningJobResult:
    """原查询 identity 与真实提交 identity 分开；新 attempt 不篡改旧业务 receipt。"""
    identity, receipt = result.identity, result.receipt
    resolution = "applied" if receipt is not None else "not_applied"
    document = ["planning-reconciliation.v1", identity.job_id, identity.scope_id,
        identity.attempt, identity.authority_epoch, identity.fencing_token, identity.owner_id,
        identity.lease_until, request_id, resolution, receipt.receipt_id if receipt else "sealed", result.observed_at]
    wire = cognition_pb.PlanningJobResult(identity=planning_identity_to_wire(identity),
        request_id=request_id, resolution=cognition_pb.PLANNING_JOB_RESOLUTION_APPLIED if receipt else cognition_pb.PLANNING_JOB_RESOLUTION_NOT_APPLIED,
        source_id="cognition.planning", receiver_fenced=result.receiver_fenced,
        evidence_id=hashlib.sha256(json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest(),
        observed_at_ms=result.observed_at)
    if receipt is not None:
        wire.receipt.CopyFrom(cognition_pb.PlanningEvaluationReceipt(receipt_id=receipt.receipt_id,
            identity=planning_identity_to_wire(receipt.identity), request_id=receipt.request_id,
            commitment_id=receipt.commitment_id, commitment_revision=receipt.commitment_revision,
            completed=receipt.assessment.completed, evidence_ids=receipt.assessment.evidence_ids,
            reason=receipt.assessment.reason, evidence=[cognition_pb.PlanningEvidenceReference(
                evidence_id=item.evidence_id, source_owner=item.source_owner, scope_id=item.scope_id,
                revision=item.revision, content_digest=item.content_digest) for item in receipt.evidence],
            committed_at_ms=receipt.committed_at))
    if wire.ByteSize() > 65_536:
        raise ValueError("Planning 对账响应超过预算")
    return wire


def _moment_document(moment: Moment) -> str:
    return json.dumps(asdict(moment), ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def planning_source_digest(moment: Moment) -> str:
    return hashlib.sha256(_moment_document(moment).encode("utf-8")).hexdigest()


def _source_context(moment: Moment) -> tuple[str, ...]:
    provider = moment.content.get("source_provider_id")
    values = (provider, moment.scene_id, moment.conversation_id, moment.continuity_id, moment.thread_id)
    if any(not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > 4096 for value in values):
        raise PermissionError("Planning 实际来源缺少完整 Conversation context")
    if moment.retention_ceiling not in {"experience", "memory_candidate"}:
        raise PermissionError("Planning 来源不允许持久保留")
    if moment.origin.privacy_class not in {"public", "private", "sensitive"}:
        raise PermissionError("Planning 来源隐私分类无效")
    owners = {"public": "public", "conversation_private": moment.conversation_id, "actor_private": moment.actor_id,
              "space_local": moment.scene_id, "character_internal": moment.continuity_id}
    if any(scope not in owners or not owners[scope] for scope in (moment.recall_scope, moment.disclosure_scope)):
        raise PermissionError("Planning 来源隐私域不完整或未支持")
    return (*values, moment.recall_scope, str(owners[moment.recall_scope]),
            moment.disclosure_scope, str(owners[moment.disclosure_scope]), moment.origin.privacy_class)


class PlanningEvidenceAdapter:
    """每次执行独占的材料接线；来源锚与 live owner 核验，缓存不充当授权。"""

    def __init__(self, recorder: ConversationRecorder, knowledge: KnowledgeIndex,
                 activity: Callable[[], dict[str, object]]) -> None:
        self._recorder, self._knowledge, self._activity = recorder, knowledge, activity
        self._source_id: str | None = None
        self._source_digest: str | None = None
        self._scope_id: str | None = None
        self._model_tier: str | None = None
        self._knowledge_references: dict[str, KnowledgeRevision] = {}

    async def bind_goal(self, *, goal_id: str, version: int, text: str,
                        completion_condition: str, source_moment_id: str, accepted_tier: str | None = None) -> GoalVersion:
        await self._recorder.flush()
        source = self._recorder.log.get_moment(source_moment_id)
        if source is None or source.kind != MomentKind.PERCEPTION.value or not self._recorder.enabled:
            raise PermissionError("Planning 接纳缺少实际持久 Perception")
        _source_context(source)
        policy = self._activity().get("policy")
        tier = accepted_tier if accepted_tier is not None else policy.get("model_tier") if isinstance(policy, dict) else None
        if tier not in {"local_only", "cloud_allowed"} or source.origin.privacy_class == "sensitive" and tier == "cloud_allowed":
            raise PermissionError("Planning 接纳没有适用的推理政策")
        return GoalVersion(goal_id, source.conversation_id, version, text, completion_condition,
                           source.moment_id, planning_source_digest(source), tier)

    def assert_model_policy(self) -> None:
        source = self._source()
        policy = self._activity().get("policy")
        tier = policy.get("model_tier") if isinstance(policy, dict) else None
        # 当前生产装配只有云 ModelPort；local_only/none 不升级为云，也不提供假本地 fallback。
        if self._model_tier != "cloud_allowed" or tier != "cloud_allowed" or source.origin.privacy_class == "sensitive":
            raise PermissionError("Planning 当前或接受时推理政策不允许已装配模型")

    def _source(self) -> Moment:
        if not self._recorder.enabled or self._source_id is None:
            raise PermissionError("Planning 目标未绑定实际来源")
        source = self._recorder.log.get_moment(self._source_id)
        if source is None or source.kind != MomentKind.PERCEPTION.value or source.conversation_id != self._scope_id \
                or planning_source_digest(source) != self._source_digest:
            raise PermissionError("Planning 原来源已缺失、修订或越域")
        _source_context(source)
        return source

    def _resource_scope(self) -> ResourceScope:
        source = self._source()
        return ResourceScope(source.content["source_provider_id"], source.scene_id, source.conversation_id)

    async def collect(self, *, goal_id: str, goal_version: int, scope_id: str, completion_condition: str,
                      source_moment_id: str | None = None, source_digest: str | None = None,
                      model_tier: str | None = None) -> tuple[PlanningEvidence, ...]:
        # Core 提供不可变 goal 绑定；不从 scope_id 猜 Actor/Provider 或创建第二个权限 registry。
        self._source_id, self._source_digest, self._scope_id, self._model_tier = source_moment_id, source_digest, scope_id, model_tier
        self._knowledge_references.clear()
        self.assert_model_policy()
        source = self._source()
        domain = _source_context(source)
        await self._recorder.flush()
        materials: list[PlanningEvidence] = []
        budget = 0
        for moment in reversed(self._recorder.log.recent(limit=128, scene_id=source.scene_id)):
            if moment.kind not in {MomentKind.PERCEPTION.value, MomentKind.ACTION_RESULT.value}:
                continue
            try:
                if _source_context(moment) != domain:
                    continue
            except PermissionError:
                continue
            text = _moment_document(moment)
            size = len(text.encode("utf-8"))
            if size > 16_384 or budget + size > 24_576 or len(materials) >= 48:
                continue
            reference = PlanningEvidenceReference(f"conversation:{moment.moment_id}", "conversation", scope_id,
                int(moment.seq), hashlib.sha256(text.encode("utf-8")).hexdigest())
            materials.append(PlanningEvidence(reference, text))
            budget += size
        for entry in await self._knowledge.get_knowledge(completion_condition, scope=self._resource_scope()):
            if entry.source not in {"config", "resource"}:
                continue
            text = entry.content.strip()
            size = len(text.encode("utf-8"))
            if size > 16_384 or budget + size > 24_576 or len(materials) >= 64:
                continue
            evidence_id = f"knowledge:{entry.entry_id}"
            reference = PlanningEvidenceReference(evidence_id, "knowledge", scope_id, entry.revision, entry.content_digest)
            self._knowledge_references[evidence_id] = KnowledgeRevision(entry.entry_id, entry.revision, entry.source, entry.content_digest)
            materials.append(PlanningEvidence(reference, text))
            budget += size
        self.assert_model_policy()
        return tuple(materials)

    async def is_current(self, reference: PlanningEvidenceReference) -> bool:
        self.assert_model_policy()
        if reference.scope_id != self._scope_id:
            return False
        if reference.source_owner == "conversation" and reference.evidence_id.startswith("conversation:"):
            moment = self._recorder.log.get_moment(reference.evidence_id.removeprefix("conversation:"))
            if moment is None or moment.kind not in {MomentKind.PERCEPTION.value, MomentKind.ACTION_RESULT.value}:
                return False
            try:
                return (_source_context(moment) == _source_context(self._source()) and int(moment.seq) == reference.revision
                        and planning_source_digest(moment) == reference.content_digest)
            except PermissionError:
                return False
        if reference.source_owner == "knowledge":
            actual = self._knowledge_references.get(reference.evidence_id)
            if actual is None or (actual.revision, actual.content_digest) != (reference.revision, reference.content_digest):
                return False
            return await self._knowledge.is_context_current((actual,), scope=self._resource_scope())
        return False


class PlanningModelAdapter:
    """同一真实 ModelPort 的政策闸；即使没有材料，也在实际 provider 调用前后复验。"""

    def __init__(self, model: ModelPort, evidence: PlanningEvidenceAdapter) -> None:
        self._model, self._evidence = model, evidence

    async def generate(self, request: ModelRequest, provider_key: str | None = None) -> str:
        if provider_key is not None:
            raise PermissionError("Planning 不允许调用方切换未绑定 provider")
        self._evidence.assert_model_policy()
        result = await self._model.generate(request)
        self._evidence.assert_model_policy()
        return result

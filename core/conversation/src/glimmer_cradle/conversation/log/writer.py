"""Conversation Log 的唯一写入用例与组装入口。"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import uuid
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path
from typing import Any, Protocol

from glimmer_cradle.conversation.log.record import (
    AffectSnapshot,
    ExecutionResultFact,
    Moment,
    MomentKind,
    SourceDescriptor,
)


class ConversationLogPort(Protocol):
    @property
    def base_dir(self) -> object: ...

    async def start(self) -> None: ...

    async def stop(self) -> None: ...

    async def flush(self) -> None: ...

    def append(self, moment: Moment) -> Moment: ...

    def append_idempotent(self, moment: Moment) -> Moment: ...

    def get_moment(self, moment_id: str) -> Moment | None: ...

    def query(
        self, *, after_position: int = 0, limit: int | None = None
    ) -> list[Moment]: ...

    def recent(
        self,
        *,
        limit: int,
        kinds: set[str] | None = None,
        scene_id: str | None = None,
        exclude_trace_id: str | None = None,
    ) -> list[Moment]: ...

    def verify(self) -> dict[str, object]: ...


class ClockPort(Protocol):
    def now_iso(self) -> str: ...

    async def wait(self, seconds: float) -> None: ...


class IdGeneratorPort(Protocol):
    def new(self) -> str: ...


class LoggerPort(Protocol):
    def info(self, event: str, **values: Any) -> Any: ...

    def warning(self, event: str, **values: Any) -> Any: ...

    def error(self, event: str, **values: Any) -> Any: ...


class ObservabilityPort(Protocol):
    def logger(self, module_name: str) -> LoggerPort: ...

    def current_trace_id(self) -> str | None: ...

class ConversationRecorder:
    def __init__(self, log: ConversationLogPort, *, clock: ClockPort,
                 ids: IdGeneratorPort,
                 observability: ObservabilityPort,
                 enabled: bool = True,
                 flush_interval_ms: int = 500,
                 flush_max_buffer: int = 64) -> None:
        self._enabled = enabled
        self._clock = clock
        self._ids = ids
        self._observability = observability
        self._logger = observability.logger("conversation_recorder")
        self._flush_interval = max(50, flush_interval_ms) / 1000
        self._flush_max_buffer = max(1, flush_max_buffer)
        self._log = log
        self._flush_task: asyncio.Task | None = None
        self._threshold_flush_task: asyncio.Task | None = None
        self._running = False
        self._since_flush = 0
        self._recorded_listeners: list[Callable[[Moment], None]] = []

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def accepts_execution_results(self) -> bool:
        return self._enabled and self._running

    @property
    def log(self) -> ConversationLogPort:
        return self._log

    async def start(self) -> None:
        if not self._enabled:
            return
        if self._running:
            return
        await self._log.start()
        self._running = True
        self._flush_task = asyncio.create_task(self._flush_loop())
        self._logger.info("Conversation Log 已启动", base_dir=str(self._log.base_dir))

    async def stop(self) -> None:
        self._running = False
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
            self._flush_task = None
        threshold_task = self._threshold_flush_task
        if threshold_task is not None and threshold_task is not asyncio.current_task():
            await threshold_task
        if self._enabled:
            await self._log.stop()

    def record(self, kind: MomentKind | str, content: dict, *,
               causation_ids: tuple[str, ...] | list[str] = (),
               scene_id: str | None = None, interaction_id: str = "",
               conversation_id: str = "", continuity_id: str = "",
               thread_id: str = "main",
               actor_id: str | None = None, actor_name: str | None = None,
               origin: SourceDescriptor | None = None,
               retention_ceiling: str = "experience",
               recall_scope: str = "conversation_private",
               disclosure_scope: str = "conversation_private",
               affect: AffectSnapshot | None = None, importance: float = 0.5,
               trace_id: str | None = None,
               idempotency_key: str | None = None) -> Moment | None:
        if not self._enabled or retention_ceiling == "transient":
            return None
        if not self._running:
            raise RuntimeError("ConversationRecorder 未处于可写状态")
        resolved_trace = trace_id or self._observability.current_trace_id() or ""
        moment_id = (
            uuid.uuid5(uuid.NAMESPACE_URL, f"glimmer:conversation-fact:{idempotency_key}").hex
            if idempotency_key
            else self._ids.new()
        )
        candidate = Moment.create(
            0, kind=kind, content=content, causation_ids=causation_ids,
            scene_id=scene_id, interaction_id=interaction_id,
            conversation_id=conversation_id, continuity_id=continuity_id,
            thread_id=thread_id,
            actor_id=actor_id, actor_name=actor_name, origin=origin,
            retention_ceiling=retention_ceiling, affect=affect,
            recall_scope=recall_scope, disclosure_scope=disclosure_scope,
            importance=importance, trace_id=resolved_trace,
            moment_id=moment_id, occurred_at=self._clock.now_iso())
        moment = (
            self._log.append_idempotent(candidate)
            if idempotency_key
            else self._log.append(candidate)
        )
        self._since_flush += 1
        if self._since_flush >= self._flush_max_buffer:
            self._schedule_flush()
        for listener in tuple(self._recorded_listeners):
            try:
                listener(moment)
            except Exception as exc:
                self._logger.warning("Conversation Moment 通知失败", error=str(exc), exc_info=True)
        return moment

    def on_recorded(self, listener: Callable[[Moment], None]) -> None:
        """订阅进程内提示；Log 仍是可恢复事实源，监听器不是可靠队列。"""
        self._recorded_listeners.append(listener)

    async def flush(self) -> None:
        if self._enabled:
            await self._log.flush()
            self._since_flush = 0

    def execution_result(self, event_id: str) -> Moment | None:
        return self.recorded_fact(f"execution-result:{event_id}")

    def recorded_fact(self, idempotency_key: str) -> Moment | None:
        moment_id = uuid.uuid5(uuid.NAMESPACE_URL, f"glimmer:conversation-fact:{idempotency_key}").hex
        return self._log.get_moment(moment_id)

    async def accept_execution_result(self, fact: ExecutionResultFact) -> Moment:
        """同一 result identity 接纳同一交互事实；未跨过 durable barrier 不返回 receipt。"""
        if not self._enabled or not self._running:
            raise RuntimeError("Conversation 结果接收 owner 未 ready")
        for value in (fact.invocation_id, fact.scope_id, fact.conversation_id, fact.source_fact_id,
                      fact.executor_id, fact.capability_id, fact.definition_revision):
            if not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > 4096:
                raise ValueError("Execution 结果 identity 无效")
        if not isinstance(fact.revision, int) or isinstance(fact.revision, bool) or not 1 <= fact.revision <= 9007199254740991:
            raise ValueError("Execution revision 无效")
        identity = json.dumps([fact.invocation_id, fact.revision], ensure_ascii=False, separators=(",", ":"))
        if fact.event_id != hashlib.sha256(identity.encode("utf-8")).hexdigest() or not isinstance(fact.request_digest, str) or not re.fullmatch(r"[a-f0-9]{64}", fact.request_digest):
            raise ValueError("Execution 结果摘要无效")
        if fact.scope_id != fact.conversation_id or not isinstance(fact.attempt, int) or fact.attempt not in (0, 1) or isinstance(fact.attempt, bool):
            raise ValueError("Execution 交互/attempt 无效")
        if fact.state not in {"succeeded", "failed", "unknown"} or fact.side_effects not in {"none", "confirmed", "unknown"}:
            raise ValueError("Execution 状态无效")
        if (fact.state == "succeeded" and (fact.attempt != 1 or fact.side_effects == "unknown" or fact.error_code)) \
                or (fact.state == "unknown" and (fact.attempt != 1 or fact.side_effects != "unknown")) \
                or (fact.state == "failed" and fact.side_effects != "none"):
            raise ValueError("Execution 结果证据组合无效")
        if fact.state != "succeeded" and (fact.result is not None or not re.fullmatch(r"[a-z][a-z0-9_.:-]{0,127}", fact.error_code)):
            raise ValueError("Execution 未确认状态不能携带成功结果")
        if not isinstance(fact.updated_at_ms, int) or isinstance(fact.updated_at_ms, bool) or not 0 <= fact.updated_at_ms <= 253402300799999:
            raise ValueError("Execution UTC 时间无效")
        content = asdict(fact)
        if len(json.dumps(content, ensure_ascii=False, allow_nan=False).encode("utf-8")) > 128 * 1024:
            raise ValueError("Execution 结果超过接收上限")
        source = self._log.get_moment(fact.source_fact_id)
        if source is None or source.kind != MomentKind.ACTION.value or source.conversation_id != fact.conversation_id:
            raise RuntimeError("Execution 原 ACTION 交互引用缺失或冲突")
        # 保留原 ACTION 的 canonical provider；不能以 executor/provider_id 猜 IO 权限域。
        if "source_provider_id" in source.content:
            content["source_provider_id"] = source.content["source_provider_id"]
        # 记录“接收了外部输出”，不把输出变成 Knowledge/Memory 的权威断言。
        moment = self.record(MomentKind.ACTION_RESULT, content, causation_ids=(source.moment_id,),
            scene_id=source.scene_id, conversation_id=source.conversation_id, continuity_id=source.continuity_id,
            thread_id=source.thread_id, interaction_id=source.interaction_id, trace_id=source.trace_id,
            actor_id=source.actor_id, actor_name=source.actor_name,
            recall_scope=source.recall_scope, disclosure_scope=source.disclosure_scope,
            retention_ceiling="experience", importance=0.4,
            origin=SourceDescriptor(provider_kind="capability", provider_id=fact.executor_id,
                source_event_id=fact.event_id, schema_ref="glimmer://capabilities/execution-result/v1",
                trust_tier="untrusted", privacy_class=source.origin.privacy_class, cognitive_effect="action_result"),
            idempotency_key=f"execution-result:{fact.event_id}")
        if moment is None:
            raise RuntimeError("Conversation 未接纳持久结果")
        await self.flush()
        return moment

    def iter_moments_since(self, since_iso: str | None = None) -> list[Moment]:
        moments = self._log.query()
        if not since_iso:
            return moments
        return [item for item in moments if item.occurred_at > since_iso]

    def moments_after(self, position: int) -> list[Moment]:
        return self._log.query(after_position=position)

    def recent_moments(self, *, limit: int = 20, kinds: set[str] | None = None,
                       scene_id: str | None = None,
                       exclude_trace_id: str | None = None) -> list[Moment]:
        if not self._enabled or limit <= 0:
            return []
        return self._log.recent(limit=limit, kinds=kinds, scene_id=scene_id,
                                   exclude_trace_id=exclude_trace_id)

    def verify(self) -> dict[str, object]:
        return self._log.verify()

    def _schedule_flush(self) -> None:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return
        if self._threshold_flush_task is not None and not self._threshold_flush_task.done():
            return
        self._threshold_flush_task = asyncio.create_task(self._threshold_flush())

    async def _threshold_flush(self) -> None:
        try:
            await self.flush()
        except Exception as exc:
            self._logger.error(
                "Conversation Log 阈值刷盘失败",
                error=str(exc),
                exc_info=True,
            )
        finally:
            self._threshold_flush_task = None

    async def _flush_loop(self) -> None:
        while self._running:
            try:
                await self._clock.wait(self._flush_interval)
                await self.flush()
            except asyncio.CancelledError:
                return
            except Exception as exc:
                self._logger.error("Conversation Log 刷盘失败", error=str(exc), exc_info=True)


def build_conversation_recorder(
    base_dir: Path,
    *,
    enabled: bool = True,
    pack_max_size_mb: int = 256,
    flush_interval_ms: int = 500,
    flush_max_buffer: int = 64,
    clock: ClockPort,
    ids: IdGeneratorPort,
    observability: ObservabilityPort,
) -> ConversationRecorder:
    from glimmer_cradle.conversation.adapters.persistence.log_store import (
        ConversationLog,
    )

    log = ConversationLog(base_dir, pack_max_size_mb=pack_max_size_mb)
    return ConversationRecorder(
        log,
        clock=clock,
        ids=ids,
        observability=observability,
        enabled=enabled,
        flush_interval_ms=flush_interval_ms,
        flush_max_buffer=flush_max_buffer,
    )


__all__ = [
    "ClockPort",
    "ConversationLogPort",
    "ConversationRecorder",
    "IdGeneratorPort",
    "ObservabilityPort",
    "build_conversation_recorder",
]

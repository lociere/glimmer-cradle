"""Cognition 向 Experience Ledger 写入 Moment 的唯一门面。"""
from __future__ import annotations

import asyncio
from collections.abc import Callable
from pathlib import Path

from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.trace_context import get_current_trace_id
from glimmer_cradle.cognition.experience.events import AffectSnapshot, Moment, MomentKind, SourceDescriptor
from glimmer_cradle.cognition.experience.ledger import ExperienceLedger

logger = get_logger("experience_recorder")


class ExperienceRecorder:
    def __init__(self, base_dir: Path, *, enabled: bool = True,
                 pack_max_size_mb: int = 256, flush_interval_ms: int = 500,
                 flush_max_buffer: int = 64) -> None:
        self._enabled = enabled
        self._flush_interval = max(50, flush_interval_ms) / 1000
        self._flush_max_buffer = max(1, flush_max_buffer)
        self._ledger = ExperienceLedger(base_dir, pack_max_size_mb=pack_max_size_mb)
        self._flush_task: asyncio.Task | None = None
        self._running = False
        self._since_flush = 0
        self._recorded_listeners: list[Callable[[Moment], None]] = []

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def ledger(self) -> ExperienceLedger:
        return self._ledger

    async def start(self) -> None:
        if not self._enabled:
            return
        await self._ledger.start()
        self._running = True
        self._flush_task = asyncio.create_task(self._flush_loop())
        logger.info("Experience Ledger 已启动", base_dir=str(self._ledger.base_dir))

    async def stop(self) -> None:
        self._running = False
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
        if self._enabled:
            await self._ledger.stop()

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
               trace_id: str | None = None) -> Moment | None:
        if not self._enabled:
            return None
        resolved_trace = trace_id or get_current_trace_id() or ""
        moment = self._ledger.append(Moment.create(
            0, kind=kind, content=content, causation_ids=causation_ids,
            scene_id=scene_id, interaction_id=interaction_id,
            conversation_id=conversation_id, continuity_id=continuity_id,
            thread_id=thread_id,
            actor_id=actor_id, actor_name=actor_name, origin=origin,
            retention_ceiling=retention_ceiling, affect=affect,
            recall_scope=recall_scope, disclosure_scope=disclosure_scope,
            importance=importance, trace_id=resolved_trace))
        self._since_flush += 1
        if self._since_flush >= self._flush_max_buffer:
            self._schedule_flush()
        for listener in tuple(self._recorded_listeners):
            try:
                listener(moment)
            except Exception as exc:
                logger.warning("Experience Moment 通知失败", error=str(exc), exc_info=True)
        return moment

    def on_recorded(self, listener: Callable[[Moment], None]) -> None:
        """订阅进程内提示；Ledger 仍是可恢复事实源，监听器不是可靠队列。"""
        self._recorded_listeners.append(listener)

    async def flush(self) -> None:
        if self._enabled:
            await self._ledger.flush()
            self._since_flush = 0

    def iter_moments_since(self, since_iso: str | None = None) -> list[Moment]:
        moments = self._ledger.query()
        if not since_iso:
            return moments
        return [item for item in moments if item.occurred_at > since_iso]

    def moments_after(self, position: int) -> list[Moment]:
        return self._ledger.query(after_position=position)

    def recent_moments(self, *, limit: int = 20, kinds: set[str] | None = None,
                       scene_id: str | None = None,
                       exclude_trace_id: str | None = None) -> list[Moment]:
        if not self._enabled or limit <= 0:
            return []
        return self._ledger.recent(limit=limit, kinds=kinds, scene_id=scene_id,
                                   exclude_trace_id=exclude_trace_id)

    def verify(self) -> dict[str, object]:
        return self._ledger.verify()

    def _schedule_flush(self) -> None:
        try:
            asyncio.get_running_loop().create_task(self.flush())
        except RuntimeError:
            pass

    async def _flush_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(self._flush_interval)
                await self.flush()
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.error("Experience Ledger 刷盘失败", error=str(exc), exc_info=True)

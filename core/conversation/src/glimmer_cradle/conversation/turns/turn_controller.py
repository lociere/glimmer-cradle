"""Turn 接纳、转换和恢复的唯一应用入口。"""

from __future__ import annotations

import hashlib
import re
from dataclasses import replace
from typing import Protocol

from glimmer_cradle.conversation.log.record import (
    Moment,
    MomentKind,
    NotificationReplyFact,
)
from glimmer_cradle.conversation.turns.turn import ConversationTurn, TurnStatus
from glimmer_cradle.conversation.turns.turn_store_port import (
    TurnConflictError,
    TurnStorePort,
    TurnTransitionError,
)


class ClockPort(Protocol):
    def now_iso(self) -> str: ...


class NotificationReplyRecorderPort(Protocol):
    async def accept_notification_reply(self, fact: NotificationReplyFact) -> Moment: ...

    def recorded_fact(self, idempotency_key: str) -> Moment | None: ...

_TRANSITIONS: dict[TurnStatus, frozenset[TurnStatus]] = {
    "accepted": frozenset({"running", "completed", "interrupted", "failed"}),
    "running": frozenset({"completed", "interrupted", "failed"}),
    "completed": frozenset(),
    "interrupted": frozenset(),
    "failed": frozenset(),
}


class TurnController:
    def __init__(self, store: TurnStorePort, *, clock: ClockPort) -> None:
        self._store = store
        self._clock = clock
        self._connected = False

    async def connect(self) -> int:
        if self._connected:
            return 0
        await self._store.connect()
        self._connected = True
        try:
            return await self._store.recover_active(
                interrupted_at=self._clock.now_iso(),
                reason="process_restarted",
            )
        except BaseException:
            try:
                await self._store.close()
            finally:
                self._connected = False
            raise

    async def close(self) -> None:
        if self._connected:
            try:
                await self._store.close()
            finally:
                self._connected = False

    async def accept(self, candidate: ConversationTurn) -> ConversationTurn:
        self._require_connected()
        self._validate_identity(candidate)
        existing = await self._store.load(candidate.turn_id)
        if existing is not None:
            self._ensure_same_context(existing, candidate)
            return existing
        return await self._store.create(candidate.accepted(self._clock.now_iso()))

    async def start(self, turn_id: str, *, expected_revision: int) -> ConversationTurn:
        return await self._transition(turn_id, "running", expected_revision=expected_revision)

    async def accept_notification_reply(
        self, fact: NotificationReplyFact, *, recorder: NotificationReplyRecorderPort,
    ) -> tuple[ConversationTurn, Moment]:
        self._require_connected()
        if not isinstance(fact, NotificationReplyFact) or not isinstance(fact.notification_id, str):
            raise TurnConflictError("Conversation 通知类型/身份无效")
        turn_id = hashlib.sha256(f"conversation-notification-turn.v1:{fact.notification_id}".encode()).hexdigest()
        existing = await self._store.load(turn_id)
        if existing is not None and (existing.status != "completed" or existing.revision != 2
            or existing.payload_digest != fact.input_digest
            or recorder.recorded_fact(f"notification-reply:{fact.notification_id}") is None):
            raise TurnConflictError("Conversation 通知不能覆盖原 Turn 或补造原 Reply")
        reply = await recorder.accept_notification_reply(fact)
        return await self._accept_recorded_notification(reply), reply

    async def _accept_recorded_notification(self, reply: Moment) -> ConversationTurn:
        """从已 flush 的通知 Reply 接纳已结束的内部 Turn；不确认外部送达。

        调用 owner 必须先越过 Recorder barrier。无 active Turn 的崩溃窗口只留下可重投的 Reply，
        重试沿同一事实补接纳，不复活 interrupted/failed 或覆盖既有普通输入 Turn。
        """
        self._require_connected()
        reference = reply.content.get("notification")
        if (reply.kind != MomentKind.REPLY.value or reply.seq <= 0 or not isinstance(reference, dict)
            or not isinstance(reference.get("notification_id"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", reference["notification_id"])
            or not isinstance(reference.get("input_digest"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", reference["input_digest"])
            or reply.origin.source_event_id != reference["notification_id"]
            or reply.interaction_id != hashlib.sha256(
                f"conversation-notification-turn.v1:{reference['notification_id']}".encode()).hexdigest()):
            raise TurnConflictError("Conversation 通知 Turn 没有对应的真实 Reply 绑定")
        candidate = ConversationTurn(turn_id=reply.interaction_id, scene_id=reply.scene_id,
            conversation_id=reply.conversation_id, continuity_id=reply.continuity_id, thread_id=reply.thread_id,
            recall_scope=reply.recall_scope, disclosure_scope=reply.disclosure_scope,
            payload_digest=reference["input_digest"])
        self._validate_identity(candidate)
        completed = replace(candidate.accepted(reply.occurred_at), status="completed", revision=2)
        existing = await self._store.load(candidate.turn_id)
        if existing is not None:
            if existing != completed:
                raise TurnConflictError("Conversation 已有 Turn 与已提交通知 Reply 冲突")
            return existing
        return await self._store.create(completed)

    async def complete(self, turn_id: str, *, expected_revision: int) -> ConversationTurn:
        return await self._transition(turn_id, "completed", expected_revision=expected_revision)

    async def interrupt(
        self, turn_id: str, *, expected_revision: int, reason: str
    ) -> ConversationTurn:
        return await self._transition(
            turn_id, "interrupted", expected_revision=expected_revision, reason=reason
        )

    async def fail(
        self, turn_id: str, *, expected_revision: int, reason: str
    ) -> ConversationTurn:
        return await self._transition(
            turn_id, "failed", expected_revision=expected_revision, reason=reason
        )

    async def load(self, turn_id: str) -> ConversationTurn | None:
        self._require_connected()
        return await self._store.load(turn_id)

    async def _transition(
        self,
        turn_id: str,
        to_status: TurnStatus,
        *,
        expected_revision: int,
        reason: str | None = None,
    ) -> ConversationTurn:
        self._require_connected()
        current = await self._store.load(turn_id)
        if current is None:
            raise KeyError(f"Conversation Turn 不存在: {turn_id}")
        if current.status == to_status:
            if current.revision != expected_revision:
                raise TurnConflictError(f"Conversation Turn 修订冲突: {turn_id}")
            return current
        if to_status not in _TRANSITIONS[current.status]:
            raise TurnTransitionError(
                f"Conversation Turn 非法转换: {current.status} -> {to_status}"
            )
        terminal_reason = reason.strip() if reason and reason.strip() else None
        if to_status in {"interrupted", "failed"} and terminal_reason is None:
            raise ValueError(f"{to_status} Turn 必须提供 reason")
        return await self._store.transition(
            turn_id,
            expected_revision=expected_revision,
            from_statuses=frozenset({current.status}),
            to_status=to_status,
            updated_at=self._clock.now_iso(),
            terminal_reason=terminal_reason,
        )

    def _require_connected(self) -> None:
        if not self._connected:
            raise RuntimeError("TurnController 尚未连接")

    @staticmethod
    def _validate_identity(turn: ConversationTurn) -> None:
        for field_name in (
            "turn_id",
            "scene_id",
            "conversation_id",
            "continuity_id",
            "thread_id",
            "recall_scope",
            "disclosure_scope",
            "payload_digest",
        ):
            value = getattr(turn, field_name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"Conversation Turn {field_name} 不得为空")
        if turn.status != "accepted" or turn.revision != 0:
            raise ValueError("新 Conversation Turn 必须处于未持久化的 accepted/revision=0 状态")

    @staticmethod
    def _ensure_same_context(existing: ConversationTurn, candidate: ConversationTurn) -> None:
        fields = (
            "scene_id",
            "conversation_id",
            "continuity_id",
            "thread_id",
            "recall_scope",
            "disclosure_scope",
            "payload_digest",
        )
        if any(getattr(existing, field) != getattr(candidate, field) for field in fields):
            raise TurnConflictError(
                f"Conversation Turn identity 已绑定不同上下文: {candidate.turn_id}"
            )

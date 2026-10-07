"""Native loop run outcome."""

from dataclasses import dataclass, field
from typing import Any

from glimmer_cradle.cognition.loop.step import (
    ArbitrationResult,
    Intent,
    build_reply_messages,
    normalize_reply_text,
)
from glimmer_cradle.cognition.ports import ObservabilityPort
from glimmer_cradle.cognition.ports.capability_port import CapabilityResult
from glimmer_cradle.conversation import MomentKind


@dataclass(frozen=True, slots=True)
class LoopRun:
    run_id: str
    status: str
    step_count: int = 0
    output: str = ""
    stop_reason: str = ""
    capability_results: tuple[CapabilityResult, ...] = field(default_factory=tuple)


class ActionEmitter:
    """将已仲裁意图映射为受控 ActionCommand 并推向进程边界。"""

    def __init__(self, *, sink=None, emotion_system=None, observability: ObservabilityPort) -> None:
        self._sink = sink
        self._emotion = emotion_system
        self._observability = observability
        self._logger = observability.logger("cognition_action_emitter")

    async def emit(self, arbitration: ArbitrationResult | None) -> int:
        if self._sink is None or arbitration is None:
            return 0
        emitted = 0
        for intent in arbitration.accepted:
            command = self.to_command(intent)
            if command is None:
                continue
            try:
                await self._sink(command)
                emitted += 1
            except Exception as exc:
                self._logger.error(
                    "ActionCommand 推送失败（已隔离）", error=str(exc), exc_info=True
                )
                self._observability.counter("cognition.action_emit_error", 1)
        return emitted

    def to_command(self, intent: Intent) -> dict | None:
        payload = intent.payload if isinstance(intent.payload, dict) else {}
        if intent.type.value != "reply":
            return None
        text = payload.get("text", "")
        if not isinstance(text, str):
            return None
        text = normalize_reply_text(text)
        if not text:
            return None
        command: dict = {
            "trace_id": payload.get("trace_id", ""),
            "action_type": "reply",
            "target": {"scene_id": payload.get("scene_id", "")},
            "payload": {"text": text, "messages": build_reply_messages(text)},
        }
        emotion = self._emotion_snapshot()
        if emotion is not None:
            command["emotion_state"] = emotion
        return command

    def _emotion_snapshot(self) -> dict | None:
        if self._emotion is None:
            return None
        try:
            state = self._emotion.get_state()
        except Exception:
            return None
        if not isinstance(state, dict):
            return None
        return {
            "emotion_type": state.get("emotion_type", ""),
            "intensity": float(state.get("intensity", 0.0)),
        }


class CycleContinuity:
    """在行动仲裁完成后，将真实发生的结果写入唯一事实源。"""

    def __init__(self, *, recorder) -> None:
        self._recorder = recorder

    async def commit(self, turn: Any) -> None:
        self._write_outcome(turn)
        # Turn 完成必须晚于真实 Log 提交，缓冲 append 不能充当 durable receipt。
        await self._recorder.flush()

    def _write_outcome(self, turn: Any) -> str | None:
        causation = tuple(
            moment_id
            for moment_id in (*turn.perception_moment_ids, turn.emotion_moment_id, *turn.native_result_fact_ids)
            if moment_id
        )
        accepted = turn.arbitration.accepted if turn.arbitration is not None else ()
        reply = next((intent for intent in accepted if intent.type.value == "reply"), None)
        if reply is not None:
            payload = reply.payload if isinstance(reply.payload, dict) else {}
            text = payload.get("text", "")
            if isinstance(text, str) and text.strip():
                clean = normalize_reply_text(text)
                moment = self._recorder.record(
                    MomentKind.REPLY,
                    content={"text": clean, "length": len(clean)},
                    scene_id=(payload.get("scene_id") or turn.turn.scene_id) or None,
                    conversation_id=turn.turn.conversation_id,
                    continuity_id=turn.turn.continuity_id,
                    thread_id=turn.turn.thread_id,
                    interaction_id=turn.turn.turn_id,
                    actor_id=payload.get("actor_id"),
                    actor_name=payload.get("actor_name"),
                    trace_id=turn.turn.turn_id or None,
                    causation_ids=causation,
                    recall_scope=turn.turn.recall_scope,
                    disclosure_scope=turn.turn.disclosure_scope,
                    importance=0.6,
                )
                return moment.moment_id if moment is not None else None
        if not turn.perception_moment_ids:
            return None
        observe_only = bool(turn.response_policies) and all(
            policy == "observe_only" for policy in turn.response_policies
        )
        content: dict[str, object] = {
            "scene_id": turn.turn.scene_id,
            "reason": "observe_only" if observe_only else "no_reply",
            "response_policy": "observe_only" if observe_only else "reply_allowed",
        }
        self._recorder.record(
            MomentKind.SILENCE,
            content=content,
            scene_id=turn.turn.scene_id or None,
            conversation_id=turn.turn.conversation_id,
            continuity_id=turn.turn.continuity_id,
            thread_id=turn.turn.thread_id,
            interaction_id=turn.turn.turn_id,
            trace_id=turn.turn.turn_id or None,
            causation_ids=tuple(turn.perception_moment_ids),
            recall_scope=turn.turn.recall_scope,
            disclosure_scope=turn.turn.disclosure_scope,
            importance=0.3,
        )
        return None

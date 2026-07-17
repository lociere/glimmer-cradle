"""认知意图到 Kernel 行动命令的出站适配。"""

from __future__ import annotations

from glimmer_cradle.cognition.cycle.reply_text import build_reply_messages, normalize_reply_text
from glimmer_cradle.cognition.cycle.volition import ArbitrationResult, Intent
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.metrics import counter

logger = get_logger("cognition_action_emitter")


class ActionEmitter:
    """将已仲裁意图映射为受控 ActionCommand 并推向 Kernel。"""

    def __init__(self, *, sink=None, emotion_system=None) -> None:
        self._sink = sink
        self._emotion = emotion_system

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
                logger.error("ActionCommand 推送失败（已隔离）", error=str(exc), exc_info=True)
                counter("cognition.action_emit_error", 1)
        return emitted

    def to_command(self, intent: Intent) -> dict | None:
        payload = intent.payload if isinstance(intent.payload, dict) else {}
        if intent.type.value == "action" and payload.get("action_type") == "skill_request":
            scene_id = payload.get("scene_id", "")
            goal = payload.get("original_goal", "")
            if not isinstance(scene_id, str) or not scene_id:
                return None
            if not isinstance(goal, str) or not goal.strip():
                return None
            return {
                "trace_id": payload.get("trace_id", ""),
                "action_type": "skill_request",
                "target": {"scene_id": scene_id},
                "payload": {
                    "skill_request": {
                        "original_goal": goal,
                        "reason": payload.get("reason"),
                        "capability_kind": payload.get("capability_kind"),
                        "confidence": payload.get("confidence"),
                        "planning_hint": payload.get("planning_hint"),
                        "conversation": {
                            "scene_id": scene_id,
                            "conversation_id": payload.get("conversation_id", ""),
                            "continuity_id": payload.get("continuity_id", ""),
                            "thread_id": payload.get("thread_id", "main"),
                            "interaction_id": payload.get("trace_id", ""),
                            "recall_scope": payload.get("recall_scope", "conversation_private"),
                            "disclosure_scope": payload.get("disclosure_scope", "conversation_private"),
                        },
                    },
                },
            }
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

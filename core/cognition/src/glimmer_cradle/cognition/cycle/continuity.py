"""一拍结束后只提交 Experience 事实；会话历史由投影异步重建。"""

from __future__ import annotations

from glimmer_cradle.cognition.cycle.reply_text import normalize_reply_text
from glimmer_cradle.cognition.cycle.turn import CycleTurn
from glimmer_cradle.cognition.experience.events import MomentKind
from glimmer_cradle.cognition.observability.logger import get_logger

logger = get_logger("cognition_continuity")


class CycleContinuity:
    """在行动仲裁完成后，将真实发生的结果写入唯一事实源。"""

    def __init__(self, *, recorder) -> None:
        self._recorder = recorder

    async def commit(self, turn: CycleTurn) -> None:
        self._write_outcome(turn)

    def _write_outcome(self, turn: CycleTurn) -> str | None:
        causation = tuple(
            moment_id
            for moment_id in (*turn.perception_moment_ids, turn.emotion_moment_id)
            if moment_id
        )
        accepted = turn.arbitration.accepted if turn.arbitration is not None else ()
        reply = next((intent for intent in accepted if intent.type.value == "reply"), None)
        action = next((intent for intent in accepted if intent.type.value == "action"), None)
        if reply is not None:
            payload = reply.payload if isinstance(reply.payload, dict) else {}
            text = payload.get("text", "")
            if isinstance(text, str) and text.strip():
                clean = normalize_reply_text(text)
                moment = self._recorder.record(
                    MomentKind.REPLY,
                    content={"text": clean, "length": len(clean)},
                    scene_id=(payload.get("scene_id") or turn.scene_id) or None,
                    conversation_id=turn.conversation_id,
                    continuity_id=turn.continuity_id,
                    thread_id=turn.thread_id,
                    interaction_id=turn.trace_id,
                    actor_id=payload.get("actor_id"),
                    actor_name=payload.get("actor_name"),
                    trace_id=turn.trace_id or None,
                    causation_ids=causation,
                    recall_scope=turn.recall_scope,
                    disclosure_scope=turn.disclosure_scope,
                    importance=0.6,
                )
                return moment.moment_id if moment is not None else None
        if action is not None:
            payload = action.payload if isinstance(action.payload, dict) else {}
            self._recorder.record(
                MomentKind.ACTION,
                content={
                    "action_type": payload.get("action_type", ""),
                    "scene_id": payload.get("scene_id") or turn.scene_id,
                    "reason": payload.get("reason"),
                },
                scene_id=(payload.get("scene_id") or turn.scene_id) or None,
                conversation_id=turn.conversation_id,
                continuity_id=turn.continuity_id,
                thread_id=turn.thread_id,
                interaction_id=turn.trace_id,
                trace_id=turn.trace_id or None,
                causation_ids=causation,
                recall_scope=turn.recall_scope,
                disclosure_scope=turn.disclosure_scope,
                importance=0.55,
            )
            return None
        if not turn.perception_moment_ids:
            return None
        observe_only = bool(turn.response_policies) and all(
            policy == "observe_only" for policy in turn.response_policies
        )
        content = {
            "scene_id": turn.scene_id,
            "reason": "observe_only" if observe_only else "no_reply",
            "response_policy": "observe_only" if observe_only else "reply_allowed",
        }
        if turn.action_plan is not None and turn.action_plan.action == "noop" and not observe_only:
            content.update({
                "reason": "action_plan_noop",
                "action_plan_reason": turn.action_plan.reason,
                "confidence": turn.action_plan.confidence,
            })
        self._recorder.record(
            MomentKind.SILENCE,
            content=content,
            scene_id=turn.scene_id or None,
            conversation_id=turn.conversation_id,
            continuity_id=turn.continuity_id,
            thread_id=turn.thread_id,
            interaction_id=turn.trace_id,
            trace_id=turn.trace_id or None,
            causation_ids=tuple(turn.perception_moment_ids),
            recall_scope=turn.recall_scope,
            disclosure_scope=turn.disclosure_scope,
            importance=0.3,
        )
        return None

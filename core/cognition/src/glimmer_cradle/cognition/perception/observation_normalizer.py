"""Observation 不变量归一；wire DTO 的解释仍留在 Adapter edge。"""

from __future__ import annotations

from dataclasses import replace

from glimmer_cradle.cognition.perception.observation import Observation


class ObservationNormalizer:
    def normalize(self, observation: Observation) -> Observation:
        for field_name in (
            "scene_id",
            "conversation_id",
            "continuity_id",
            "thread_id",
            "recall_scope",
            "disclosure_scope",
            "trace_id",
            "interaction_id",
            "payload_digest",
        ):
            value = getattr(observation, field_name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"Observation {field_name} 不得为空")
        if observation.address_mode not in {"direct", "ambient"}:
            raise ValueError("Observation address_mode 非法")
        if observation.response_policy not in {"reply_allowed", "observe_only"}:
            raise ValueError("Observation response_policy 非法")
        if observation.retention_ceiling not in {
            "transient", "experience", "memory_candidate"
        }:
            raise ValueError("Observation retention_ceiling 非法")
        return replace(
            observation,
            scene_id=observation.scene_id.strip(),
            conversation_id=observation.conversation_id.strip(),
            continuity_id=observation.continuity_id.strip(),
            thread_id=observation.thread_id.strip(),
            recall_scope=observation.recall_scope.strip(),
            disclosure_scope=observation.disclosure_scope.strip(),
            trace_id=observation.trace_id.strip(),
            interaction_id=observation.interaction_id.strip(),
            payload_digest=observation.payload_digest.strip(),
            familiarity=max(0, min(10, int(observation.familiarity))),
            text=observation.text.strip(),
            actor_id=observation.actor_id.strip() if observation.actor_id else None,
            actor_name=observation.actor_name.strip() if observation.actor_name else None,
            model_input=dict(observation.model_input or {}),
            origin=dict(observation.origin or {}),
        )

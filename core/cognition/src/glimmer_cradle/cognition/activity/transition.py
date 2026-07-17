"""认知活动状态的无副作用转换函数。"""

from __future__ import annotations

from dataclasses import dataclass

from glimmer_cradle.cognition.activity.policy import (
    ActivityTransitionConfig,
    CognitiveActivityState,
)


@dataclass(frozen=True)
class ActivityTransition:
    state: CognitiveActivityState
    changed: bool
    reason: str


def evaluate_transition(
    current: CognitiveActivityState,
    *,
    direct_idle_seconds: float,
    observed_idle_seconds: float,
    state_elapsed_seconds: float,
    affect_activation: float,
    engage_requested: bool,
    observed_activity_requested: bool,
    config: ActivityTransitionConfig,
) -> ActivityTransition:
    """将活动信号映射为下一状态；不写 Experience 或其他外部状态。"""
    if engage_requested:
        if current != CognitiveActivityState.ENGAGED:
            return ActivityTransition(
                CognitiveActivityState.ENGAGED, True, "direct_interaction"
            )
        return ActivityTransition(current, False, "direct_interaction_held")

    if observed_activity_requested:
        if current == CognitiveActivityState.QUIESCENT:
            return ActivityTransition(
                CognitiveActivityState.AMBIENT, True, "ambient_observation"
            )
        return ActivityTransition(current, False, "ambient_observation_held")

    holding = affect_activation > config.affect_activation_hold_threshold
    resident = state_elapsed_seconds >= config.minimum_residence_s

    if current == CognitiveActivityState.ENGAGED:
        if (
            resident
            and direct_idle_seconds >= config.engaged_to_ambient_idle_s
            and not holding
        ):
            return ActivityTransition(
                CognitiveActivityState.AMBIENT, True, "engagement_decayed"
            )
        return ActivityTransition(
            current, False, "affect_activation_hold" if holding else "engaged"
        )

    if current == CognitiveActivityState.AMBIENT:
        if (
            resident
            and observed_idle_seconds >= config.ambient_to_quiescent_idle_s
            and not holding
        ):
            return ActivityTransition(
                CognitiveActivityState.QUIESCENT, True, "ambient_decayed"
            )
        return ActivityTransition(
            current, False, "affect_activation_hold" if holding else "ambient"
        )

    return ActivityTransition(CognitiveActivityState.QUIESCENT, False, "quiescent")

"""Pure affect decay and cognitive activity transition policy."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from glimmer_cradle.cognition.state.cognitive_state import CognitiveActivityState


@dataclass(frozen=True)
class EmotionTriggerRule:
    emotion_type: str
    keywords: tuple[str, ...]
    intensity_delta: float = 0.3


EMOTION_TRIGGER_RULES: Final[tuple[EmotionTriggerRule, ...]] = (
    EmotionTriggerRule("happy", ("喜欢", "爱你", "真棒", "辛苦", "谢谢", "好耶"), 0.30),
    EmotionTriggerRule("shy", ("害羞", "脸红", "笨蛋", "讨厌啦", "不要", "亲密"), 0.28),
    EmotionTriggerRule("angry", ("气死", "烦", "滚", "离谱", "讨厌"), 0.32),
    EmotionTriggerRule("sulky", ("哼", "不理你", "随便", "你自己看着办"), 0.25),
    EmotionTriggerRule("curious", ("什么", "怎么", "为啥", "看看", "新的"), 0.22),
    EmotionTriggerRule("sad", ("难过", "委屈", "哭了", "孤单"), 0.35),
)
DEFAULT_INTENSITY_DECAY_ON_NEUTRAL: Final[float] = -0.05


def infer_emotion_by_input(user_input: str) -> tuple[str, float] | None:
    content = user_input.strip()
    if not content:
        return None
    for rule in EMOTION_TRIGGER_RULES:
        if any(keyword in content for keyword in rule.keywords):
            return rule.emotion_type, rule.intensity_delta
    return None


def decay_intensity(
    intensity: float,
    *,
    elapsed_seconds: float,
    decay_rate: float = 0.001,
    floor: float = 0.1,
) -> float:
    """Decay affect without reading time or mutating state."""

    elapsed = max(0.0, elapsed_seconds)
    return max(floor, intensity * max(floor, 1 - elapsed * decay_rate))


@dataclass(frozen=True)
class ActivityTransitionConfig:
    engaged_to_ambient_idle_s: float = 120.0
    ambient_to_quiescent_idle_s: float = 600.0
    minimum_residence_s: float = 10.0
    affect_activation_hold_threshold: float = 0.8


DEFAULT_ACTIVITY_TRANSITION_CONFIG: Final[ActivityTransitionConfig] = (
    ActivityTransitionConfig()
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
    if engage_requested:
        if current != CognitiveActivityState.ENGAGED:
            return ActivityTransition(CognitiveActivityState.ENGAGED, True, "direct_interaction")
        return ActivityTransition(current, False, "direct_interaction_held")
    if observed_activity_requested:
        if current == CognitiveActivityState.QUIESCENT:
            return ActivityTransition(CognitiveActivityState.AMBIENT, True, "ambient_observation")
        return ActivityTransition(current, False, "ambient_observation_held")

    holding = affect_activation > config.affect_activation_hold_threshold
    resident = state_elapsed_seconds >= config.minimum_residence_s
    if current == CognitiveActivityState.ENGAGED:
        if resident and direct_idle_seconds >= config.engaged_to_ambient_idle_s and not holding:
            return ActivityTransition(CognitiveActivityState.AMBIENT, True, "engagement_decayed")
        return ActivityTransition(current, False, "affect_activation_hold" if holding else "engaged")
    if current == CognitiveActivityState.AMBIENT:
        if resident and observed_idle_seconds >= config.ambient_to_quiescent_idle_s and not holding:
            return ActivityTransition(CognitiveActivityState.QUIESCENT, True, "ambient_decayed")
        return ActivityTransition(current, False, "affect_activation_hold" if holding else "ambient")
    return ActivityTransition(CognitiveActivityState.QUIESCENT, False, "quiescent")

"""情绪规则：集中管理关键词触发与默认强度。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class EmotionTriggerRule:
	"""关键词触发规则。"""

	emotion_type: str
	keywords: tuple[str, ...]
	intensity_delta: float = 0.3


EMOTION_TRIGGER_RULES: tuple[EmotionTriggerRule, ...] = (
	EmotionTriggerRule("happy", ("喜欢", "爱你", "真棒", "辛苦", "谢谢", "好耶"), 0.30),
	EmotionTriggerRule("shy", ("害羞", "脸红", "笨蛋", "讨厌啦", "不要", "亲密"), 0.28),
	EmotionTriggerRule("angry", ("气死", "烦", "滚", "离谱", "讨厌"), 0.32),
	EmotionTriggerRule("sulky", ("哼", "不理你", "随便", "你自己看着办"), 0.25),
	EmotionTriggerRule("curious", ("什么", "怎么", "为啥", "看看", "新的"), 0.22),
	EmotionTriggerRule("sad", ("难过", "委屈", "哭了", "孤单"), 0.35),
)


def infer_emotion_by_input(user_input: str) -> Optional[tuple[str, float]]:
	"""根据输入命中规则，返回 (emotion_type, intensity_delta)。"""

	content = user_input.strip()
	if not content:
		return None

	for rule in EMOTION_TRIGGER_RULES:
		if any(keyword in content for keyword in rule.keywords):
			return rule.emotion_type, rule.intensity_delta
	return None


DEFAULT_INTENSITY_DECAY_ON_NEUTRAL: float = -0.05

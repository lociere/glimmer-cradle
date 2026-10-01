"""认知循环单拍状态。"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from glimmer_cradle.conversation import ConversationTurn
from glimmer_cradle.cognition.application.cycle.providers.base import Provider
from glimmer_cradle.cognition.attention import Attention, make_attention
from glimmer_cradle.cognition.planning import ActionPlan
from glimmer_cradle.cognition.domain.volition import ArbitrationResult
from glimmer_cradle.cognition.ports.clock_port import ClockPort
from glimmer_cradle.cognition.ports.identity import IdGeneratorPort
from glimmer_cradle.cognition.state import EmotionSystem


_EMOTION_LABEL_WORDS = (
    r"平静|开心|疑惑|撒娇|严肃|害羞|生气|委屈|思考"
    r"|高兴|愉快|愤怒|难过|傲娇|好奇|冷静|激动|无奈|担心|兴奋"
    r"|calm|happy|curious|coy|tsundere|shy|angry|aggrieved|thinking"
    r"|joyful|pleased|furious|sad|peaceful|worried|excited|sulky"
)
_EMOTION_TAG_RE = re.compile(
    r"[\[\(（【《<]\s*(?:emotion|情绪)?\s*[:：\-]?\s*(?:"
    + _EMOTION_LABEL_WORDS
    + r")\s*[\]\)）】》>]",
    re.IGNORECASE,
)
_EMOTION_PREFIX_RE = re.compile(
    r"^(?:emotion|情绪)\s*[:：]\s*(?:" + _EMOTION_LABEL_WORDS + r")\s*",
    re.IGNORECASE,
)
_STAGE_DIRECTION_RE = re.compile(r"[\(（]\s*([^()（）\n]{1,24})\s*[\)）]")
_CODE_FENCE_RE = re.compile(r"```[\s\S]*?```")
_ACTION_CUES = (
    "笑", "叹", "看", "望", "摸", "抱", "拍", "揉", "眨", "歪", "点头", "摇头",
    "挥手", "低头", "抬头", "皱眉", "托腮", "捂脸", "扶额", "耸肩", "靠近",
    "凑近", "退后", "递", "坐", "站", "走", "伸手", "收手", "拉", "推",
    "摊手", "眯眼", "抿嘴", "咳", "沉默", "停顿", "轻声", "小声", "脸红",
)


@dataclass(slots=True)
class LoopStep:
    """只在一拍内有效的感知、规划与仲裁状态。"""

    perception_moment_ids: list[str] = field(default_factory=list)
    perception_moment_ids_by_trace: dict[str, list[str]] = field(default_factory=dict)
    emotion_moment_id: str | None = None
    pending_emotion_state: dict | None = None
    turn: ConversationTurn = field(default_factory=ConversationTurn)
    turns_by_trace: dict[str, ConversationTurn] = field(default_factory=dict)
    response_policies: list[str] = field(default_factory=list)
    response_policy_by_trace: dict[str, list[str]] = field(default_factory=dict)
    routes: dict[str, dict] = field(default_factory=dict)
    reply: str | None = None
    skill_request: dict | None = None
    action_plan: ActionPlan | None = None
    arbitration: ArbitrationResult | None = None
    action_moment_id: str | None = None


class AffectProvider(Provider):
    """把当前情绪状态投影为本拍 Attention 候选。"""

    name = "affect"

    def __init__(
        self,
        emotion_system: EmotionSystem,
        *,
        clock: ClockPort,
        ids: IdGeneratorPort,
    ) -> None:
        self._emotion = emotion_system
        self._clock = clock
        self._ids = ids

    async def propose(self, workspace_snapshot: list[Attention]) -> list[Attention]:
        try:
            state = self._emotion.get_state()
        except Exception:
            return []
        intensity = float(state.get("intensity", 0.0))
        if intensity <= 0.05:
            return []
        return [
            make_attention(
                source=self.name,
                content={
                    "emotion_type": state.get("emotion_type", ""),
                    "intensity": intensity,
                    "trigger": state.get("trigger", ""),
                },
                salience=min(1.0, intensity),
                clock=self._clock,
                ids=self._ids,
            )
        ]


@dataclass(frozen=True)
class DriveConfig:
    curiosity_rise_per_s: float = 0.005
    companionship_rise_per_s: float = 0.003
    rest_rise_per_s: float = 0.002
    curiosity_satisfaction: float = 0.4
    companionship_satisfaction: float = 0.5
    rest_satisfaction: float = 0.7
    propose_threshold: float = 0.6
    activity_boost: dict[str, float] = field(
        default_factory=lambda: {
            "engaged": 1.5,
            "ambient": 1.0,
            "quiescent": 0.0,
        }
    )
    emotion_strong_threshold: float = 0.7
    emotion_strong_rest_multiplier: float = 2.0


class DriveProvider(Provider):
    """按单调时钟累积内在动机，并投放最高过阈候选。"""

    name = "drive"
    DRIVES = ("curiosity", "companionship", "rest")

    def __init__(
        self,
        *,
        activity_controller=None,
        emotion_system=None,
        config: DriveConfig | None = None,
        clock: ClockPort,
        ids: IdGeneratorPort,
    ) -> None:
        self._cfg = config or DriveConfig()
        self._activity = activity_controller
        self._emotion = emotion_system
        self._clock = clock
        self._ids = ids
        self._levels: dict[str, float] = {drive: 0.0 for drive in self.DRIVES}
        self._last_tick_at: datetime | None = None
        self._pending_satisfaction: set[str] = set()

    def signal_satisfied(self, drive: str) -> None:
        if drive in self._levels:
            self._pending_satisfaction.add(drive)

    @property
    def levels(self) -> dict[str, float]:
        return dict(self._levels)

    async def propose(self, workspace_snapshot: list[Attention]) -> list[Attention]:
        now = self._clock.now()
        tick_seconds = (
            0.0
            if self._last_tick_at is None
            else max(0.0, (now - self._last_tick_at).total_seconds())
        )
        self._last_tick_at = now
        boost = self._compute_activity_boost()
        self._levels["curiosity"] = min(
            1.0,
            self._levels["curiosity"]
            + self._cfg.curiosity_rise_per_s * tick_seconds * boost,
        )
        self._levels["companionship"] = min(
            1.0,
            self._levels["companionship"]
            + self._cfg.companionship_rise_per_s * tick_seconds * boost,
        )
        rest_multiplier = (
            self._cfg.emotion_strong_rest_multiplier
            if self._compute_emotion_strong()
            else 1.0
        )
        self._levels["rest"] = min(
            1.0,
            self._levels["rest"]
            + self._cfg.rest_rise_per_s * tick_seconds * rest_multiplier,
        )
        satisfaction = {
            "curiosity": self._cfg.curiosity_satisfaction,
            "companionship": self._cfg.companionship_satisfaction,
            "rest": self._cfg.rest_satisfaction,
        }
        for drive in self._pending_satisfaction:
            self._levels[drive] = max(0.0, self._levels[drive] - satisfaction[drive])
        self._pending_satisfaction.clear()
        top_drive = max(self._levels, key=self._levels.__getitem__)
        top_level = self._levels[top_drive]
        if top_level < self._cfg.propose_threshold:
            return []
        return [
            make_attention(
                source=self.name,
                content={
                    "drive": top_drive,
                    "level": top_level,
                    "all_levels": dict(self._levels),
                },
                salience=top_level,
                clock=self._clock,
                ids=self._ids,
            )
        ]

    def _compute_activity_boost(self) -> float:
        if self._activity is None:
            return 1.0
        try:
            state = self._activity.get_state().get("state", "")
        except Exception:
            return 1.0
        return float(self._cfg.activity_boost.get(state, 1.0))

    def _compute_emotion_strong(self) -> bool:
        if self._emotion is None:
            return False
        try:
            intensity = float(self._emotion.get_state().get("intensity", 0.0))
        except Exception:
            return False
        return intensity > self._cfg.emotion_strong_threshold


def strip_emotion_tags(text: str) -> str:
    """剥除模型回复中的情绪标签，避免污染历史与出站正文。"""
    value = _EMOTION_TAG_RE.sub("", text).strip()
    value = _EMOTION_PREFIX_RE.sub("", value).strip()
    return re.sub(r" {2,}", " ", value).strip()


def normalize_reply_text(text: str) -> str:
    """把模型回复归一化成用户可见正文。"""
    value = strip_emotion_tags(text)
    value = _remove_stage_directions(value)
    value = re.sub(r"[ \t]{2,}", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def build_reply_messages(text: str) -> list[dict[str, Any]]:
    """将自然聊天正文分段，结构化内容保持单条以便复制。"""
    value = normalize_reply_text(text)
    if not value:
        return []
    if _is_structured_output(value):
        return [{"sequence": 0, "content_type": "text", "text": value}]
    return [
        {"sequence": index, "content_type": "text", "text": chunk}
        for index, chunk in enumerate(_split_conversational_text(value))
    ]


def _remove_stage_directions(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        inner = match.group(1).strip()
        return "" if _looks_like_stage_direction(inner) else match.group(0)

    value = _STAGE_DIRECTION_RE.sub(replace, text)
    return re.sub(r"[ \t]{2,}", " ", value).strip()


def _looks_like_stage_direction(inner: str) -> bool:
    if not inner or any(ch.isascii() and ch.isalnum() for ch in inner):
        return False
    compact = re.sub(r"[\s，,。.!！?？、~～…]+", "", inner)
    return bool(compact) and any(cue in compact for cue in _ACTION_CUES)


def _is_structured_output(text: str) -> bool:
    if _CODE_FENCE_RE.search(text):
        return True
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return any(line.startswith(("- ", "* ", "> ", "|", "#")) for line in lines) or any(
        re.match(r"^\d+[.)、]\s+", line) for line in lines
    )


def _split_conversational_text(text: str, *, max_chars: int = 42) -> list[str]:
    pieces: list[str] = []
    for paragraph in (part.strip() for part in text.splitlines() if part.strip()):
        pieces.extend(_split_paragraph(paragraph, max_chars=max_chars))
    return pieces or [text]


def _split_paragraph(paragraph: str, *, max_chars: int) -> list[str]:
    raw_parts = re.findall(r"[^。！？!?；;，,\n]{1,80}[。！？!?；;，,]?", paragraph) or [paragraph]
    chunks: list[str] = []
    current = ""
    for raw in raw_parts:
        part = raw.strip()
        if not part:
            continue
        if len(part) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            chunks.extend(_hard_wrap(part, max_chars=max_chars))
        elif not current:
            current = part
        elif len(current) + len(part) <= max_chars:
            current += part
        else:
            chunks.append(current)
            current = part
    if current:
        chunks.append(current)
    return chunks


def _hard_wrap(text: str, *, max_chars: int) -> list[str]:
    return [
        text[index:index + max_chars].strip()
        for index in range(0, len(text), max_chars)
        if text[index:index + max_chars].strip()
    ]

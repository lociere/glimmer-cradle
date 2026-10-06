"""认知循环单拍状态。"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from glimmer_cradle.cognition.attention import Attention, make_attention
from glimmer_cradle.cognition.context import (
    ContextAssembler,
    ContextQuery,
    RelationshipReader,
    ReplyContextBuilder,
)
from glimmer_cradle.cognition.inference import (
    InferenceController,
    InferenceRequest,
    InferenceUnavailable,
    ModelTier,
)
from glimmer_cradle.cognition.planning import ActionPlan, PlanningController
from glimmer_cradle.cognition.ports import IdGeneratorPort, ObservabilityPort
from glimmer_cradle.cognition.ports.clock_port import ClockPort
from glimmer_cradle.cognition.state import EmotionSystem
from glimmer_cradle.conversation import (
    ConversationTurn,
    MomentKind,
    SourceDescriptor,
)

if TYPE_CHECKING:
    from glimmer_cradle.cognition.state import CognitiveActivityController


class IntentType(StrEnum):
    """Loop 单拍可产生的意图类型。"""

    REPLY = "reply"
    SILENCE = "silence"
    THOUGHT = "thought"
    EMOTION = "emotion"
    ACTION = "action"


class Initiative(StrEnum):
    """意图由外部刺激响应还是由角色主动发起。"""

    REACTIVE = "reactive"
    PROACTIVE = "proactive"


@dataclass(frozen=True, slots=True)
class Intent:
    """Loop 单拍内参与仲裁的候选意图。"""

    intent_id: str
    type: IntentType
    initiative: Initiative
    willingness: float
    payload: dict[str, Any] | None = None
    causation_ids: list[str] = field(default_factory=list)
    created_at: str = ""


@dataclass(frozen=True)
class WillingnessConfig:
    """连续意愿公式权重与认知活动态阈值。"""

    weight_address: float = 0.30
    weight_emotion: float = 0.20
    weight_intimacy: float = 0.15
    weight_drive: float = 0.15
    weight_silence: float = 0.10
    weight_persona: float = 0.10
    threshold_by_activity: dict[str, float] = field(default_factory=lambda: {
        "engaged": 0.40,
        "ambient": 0.70,
        "quiescent": 1.10,
    })
    default_extraversion: float = 0.5
    silence_normalize_s: float = 600.0


@dataclass(frozen=True)
class WillingnessInputs:
    """连续意愿公式的归一化输入。"""

    address_mode: str = ""
    emotion_intensity: float = 0.0
    relationship_intimacy: float = 0.0
    drive_companionship: float = 0.0
    silence_seconds: float = 0.0
    persona_extraversion: float | None = None


@dataclass(frozen=True)
class ArbitrationResult:
    """单拍意图仲裁结果。"""

    accepted: list[Intent] = field(default_factory=list)
    suppressed: list[tuple[Intent, str]] = field(default_factory=list)


def _clip01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _address_score(mode: str) -> float:
    if mode == "direct":
        return 1.0
    if mode == "ambient":
        return 0.5
    return 0.0


def compute_willingness(
    inputs: WillingnessInputs,
    config: WillingnessConfig | None = None,
) -> float:
    """按权重计算并裁剪本拍行动意愿。"""
    cfg = config or WillingnessConfig()
    extraversion = (
        cfg.default_extraversion
        if inputs.persona_extraversion is None
        else inputs.persona_extraversion
    )
    silence_score = _clip01(inputs.silence_seconds / cfg.silence_normalize_s)
    raw = (
        cfg.weight_address * _address_score(inputs.address_mode)
        + cfg.weight_emotion * _clip01(inputs.emotion_intensity)
        + cfg.weight_intimacy * _clip01(inputs.relationship_intimacy)
        + cfg.weight_drive * _clip01(inputs.drive_companionship)
        + cfg.weight_silence * silence_score
        + cfg.weight_persona * _clip01(extraversion)
    )
    return _clip01(raw)


def threshold_for(activity_state: str, config: WillingnessConfig | None = None) -> float:
    """返回当前认知活动态的行动意愿阈值。"""
    cfg = config or WillingnessConfig()
    return float(cfg.threshold_by_activity.get(activity_state, 0.5))


def arbitrate(
    intents: list[Intent],
    *,
    threshold: float,
    allows_proactive: bool,
) -> ArbitrationResult:
    """按主动性闸、阈值与回复唯一性仲裁本拍候选。"""
    accepted: list[Intent] = []
    suppressed: list[tuple[Intent, str]] = []
    above: list[Intent] = []
    for intent in intents:
        initiative = (
            intent.initiative.value
            if hasattr(intent.initiative, "value")
            else str(intent.initiative)
        )
        if initiative == "proactive" and float(intent.willingness) < threshold:
            suppressed.append((intent, "below_threshold"))
        else:
            above.append(intent)

    if not allows_proactive:
        passable: list[Intent] = []
        for intent in above:
            initiative = (
                intent.initiative.value
                if hasattr(intent.initiative, "value")
                else str(intent.initiative)
            )
            if initiative == "proactive":
                suppressed.append((intent, "proactive_blocked"))
            else:
                passable.append(intent)
        above = passable

    replies: list[Intent] = []
    others: list[Intent] = []
    for intent in above:
        intent_type = intent.type.value if hasattr(intent.type, "value") else str(intent.type)
        if intent_type == "reply":
            replies.append(intent)
        else:
            others.append(intent)

    if replies:
        replies.sort(key=lambda item: float(item.willingness), reverse=True)
        accepted.append(replies[0])
        for reply in replies[1:]:
            suppressed.append((reply, "reply_duplicate"))
    accepted.extend(others)
    accepted.sort(key=lambda item: float(item.willingness), reverse=True)
    return ArbitrationResult(accepted=accepted, suppressed=suppressed)


def make_intent(
    *,
    type: str,
    initiative: str,
    willingness: float,
    payload: dict | None = None,
    causation_ids: list[str] | None = None,
    intent_id: str,
    created_at: str,
) -> Intent:
    """使用边界注入的 ID 与时间构造单拍意图。"""
    return Intent(
        intent_id=intent_id,
        type=IntentType(type),
        initiative=Initiative(initiative),
        willingness=_clip01(willingness),
        payload=payload or {},
        causation_ids=list(causation_ids or []),
        created_at=created_at,
    )


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


class Provider(ABC):
    """Loop Sense 阶段候选来源的统一契约。"""

    name: str = ""

    @abstractmethod
    async def propose(self, workspace_snapshot: list[Attention]) -> list[Attention]:
        """读取工作区快照并返回本拍候选，不直接修改工作区。"""
        ...


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


def _extract_query_text(item: Attention) -> str:
    content = item.content if isinstance(item.content, dict) else {}
    for key in ("text", "query", "broadcast"):
        value = content.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, dict):
            inner = value.get("text") or value.get("content")
            if isinstance(inner, str) and inner.strip():
                return inner.strip()
    return str(item.content)[:200]


class MemoryProvider(Provider):
    """按当前焦点通过 ContextAssembler 召回有界上下文候选。"""

    name = "memory"

    def __init__(
        self,
        context_assembly: ContextAssembler,
        *,
        activity_controller: "CognitiveActivityController | None" = None,
        max_items_per_tick: int = 3,
        clock: ClockPort,
        ids: IdGeneratorPort,
    ) -> None:
        self._assembler = context_assembly
        self._activity = activity_controller
        self._max_items = max(1, int(max_items_per_tick))
        self._clock = clock
        self._ids = ids

    async def propose(self, workspace_snapshot: list[Attention]) -> list[Attention]:
        if not workspace_snapshot:
            return []
        focus = max(workspace_snapshot, key=lambda item: item.salience)
        query_text = _extract_query_text(focus)
        if not query_text:
            return []
        budget_factor = 1.0
        if self._activity is not None:
            try:
                value = self._activity.get_state().get("policy", {}).get(
                    "context_budget_factor"
                )
                if isinstance(value, (int, float)):
                    budget_factor = float(value)
            except Exception:
                pass
        content = focus.content if isinstance(focus.content, dict) else {}
        query = ContextQuery(
            text=query_text,
            scene_id=content.get("scene_id"),
            conversation_id=content.get("conversation_id"),
            actor_id=content.get("actor_id"),
            recall_scope=content.get("recall_scope", "global_safe"),
            focus_summary=query_text[:80],
        )
        try:
            assembled = await self._assembler.assemble(
                query,
                budget_factor=budget_factor,
                per_source_limit=self._max_items,
            )
        except Exception:
            return []
        return [
            make_attention(
                source=self.name,
                content={
                    "text": item.content,
                    "source_kind": item.source,
                    "trust_tier": item.trust_tier,
                    "instruction_authority": item.instruction_authority,
                    "metadata": item.metadata,
                },
                salience=min(1.0, max(0.05, item.score())),
                clock=self._clock,
                ids=self._ids,
            )
            for item in assembled.items[: self._max_items]
        ]


def _extract_actor_id(item: Attention) -> str | None:
    content = item.content if isinstance(item.content, dict) else {}
    actor = content.get("actor")
    actor_id = content.get("actor_id")
    if not actor_id and isinstance(actor, dict):
        actor_id = actor.get("actor_id")
    return actor_id if isinstance(actor_id, str) and actor_id else None


class SocialProvider(Provider):
    """把已投影的关系状态只读映射为 Attention 候选。"""

    name = "social"

    def __init__(
        self,
        relationship_repo: RelationshipReader,
        *,
        clock: ClockPort,
        ids: IdGeneratorPort,
    ) -> None:
        self._repo = relationship_repo
        self._clock = clock
        self._ids = ids

    async def propose(self, workspace_snapshot: list[Attention]) -> list[Attention]:
        if not workspace_snapshot:
            return []
        focus = max(workspace_snapshot, key=lambda item: item.salience)
        actor_id = _extract_actor_id(focus)
        if not actor_id:
            return []
        try:
            record = await self._repo.get(actor_id)
        except Exception:
            return []
        if record is None:
            return []
        return [
            make_attention(
                source=self.name,
                content={
                    "actor_id": record.actor_id,
                    "display_name": record.display_name,
                    "familiarity": record.familiarity,
                    "direct_interactions": record.direct_interactions,
                    "ambient_observations": record.ambient_observations,
                    "replies": record.replies,
                    "relationship_summary": record.summary,
                    "relationship_attributes": record.attributes,
                },
                salience=min(1.0, 0.3 + record.familiarity * 0.5),
                clock=self._clock,
                ids=self._ids,
            )
        ]


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


class PerceptionAppraiser:
    """将本拍感知统一解释为多模态路由、情绪变化和 Moment。"""

    def __init__(self, *, recorder, emotion_system=None, multimodal_router=None,
                 multimodal_core_model: str = "", observability: ObservabilityPort) -> None:
        self._recorder = recorder
        self._emotion = emotion_system
        self._router = multimodal_router
        self._multimodal_core_model = multimodal_core_model
        self._observability = observability
        self._logger = observability.logger("perception_appraisal")

    async def appraise(
        self, sense_results: list[list[Attention]], turn: Any
    ) -> None:
        perceptions = [
            item
            for items in sense_results
            for item in items
            if item.source == "perception" and isinstance(item.content, dict)
        ]
        if not perceptions:
            return

        emotion_inputs: list[str] = []
        for item in perceptions:
            content = item.content
            trace_id = str(content.get("trace_id") or item.attention_id)
            scene_id = content.get("scene_id", "")
            conversation_id = content.get("conversation_id", "")
            continuity_id = content.get("continuity_id", "")
            thread_id = content.get("thread_id", "main")
            recall_scope = content.get("recall_scope", "conversation_private")
            disclosure_scope = content.get("disclosure_scope", "conversation_private")
            text, semantic_text, vision, provider_key = await self._route(content)
            if trace_id:
                turn.routes[trace_id] = {
                    "user_text": text,
                    "multimodal_text": semantic_text,
                    "vision": vision,
                    "provider_key": provider_key,
                }
            emotion_input = "\n".join(
                part for part in [text, semantic_text] if part
            ).strip()
            if emotion_input:
                emotion_inputs.append(emotion_input)
            candidate_turn = ConversationTurn(
                turn_id=str(content.get("interaction_id") or trace_id),
                scene_id=scene_id,
                conversation_id=conversation_id,
                continuity_id=continuity_id,
                thread_id=thread_id,
                recall_scope=recall_scope,
                disclosure_scope=disclosure_scope,
                payload_digest=str(content.get("payload_digest") or ""),
            )
            existing_turn = turn.turns_by_trace.get(trace_id)
            if existing_turn is not None and existing_turn != candidate_turn:
                raise ValueError("同一 perception trace 不得跨 Conversation 或权限域")
            turn.turns_by_trace[trace_id] = candidate_turn
            response_policy = content.get("response_policy", "reply_allowed")
            if not isinstance(response_policy, str):
                response_policy = "reply_allowed"
            turn.response_policies.append(response_policy)
            turn.response_policy_by_trace.setdefault(trace_id, []).append(response_policy)
            moment = self._recorder.record(
                MomentKind.PERCEPTION,
                content={
                    "text": text,
                    "semantic_text": semantic_text,
                    "parts": self._moment_parts(content.get("model_input")),
                    "legacy_media_unrecoverable": self._legacy_media_unrecoverable(content.get("model_input")),
                    "address_mode": content.get("address_mode", "direct"),
                    "response_policy": response_policy,
                    "familiarity": content.get("familiarity", 0),
                    "has_multimodal": bool(semantic_text or vision),
                    "actor_id": content.get("actor_id"),
                    "actor_name": content.get("actor_name"),
                },
                scene_id=scene_id or None,
                conversation_id=conversation_id,
                continuity_id=continuity_id,
                thread_id=thread_id,
                interaction_id=str(content.get("interaction_id") or trace_id or ""),
                actor_id=content.get("actor_id"),
                actor_name=content.get("actor_name"),
                origin=(
                    SourceDescriptor(**content["origin"])
                    if isinstance(content.get("origin"), dict)
                    else None
                ),
                retention_ceiling=str(content.get("retention_ceiling") or "experience"),
                recall_scope=recall_scope,
                disclosure_scope=disclosure_scope,
                trace_id=trace_id or None,
                importance=0.5,
            )
            if moment is not None:
                turn.perception_moment_ids.append(moment.moment_id)
                turn.perception_moment_ids_by_trace.setdefault(trace_id, []).append(moment.moment_id)
                content["experience_moment_id"] = moment.moment_id
        self._update_emotion(emotion_inputs, turn)

    @staticmethod
    def _moment_parts(model_input: object) -> list[dict]:
        if not isinstance(model_input, dict):
            return []
        result: list[dict] = []
        for part in model_input.get("parts") or []:
            if not isinstance(part, dict):
                continue
            content = part.get("content")
            if not isinstance(content, dict):
                continue
            kind = next((key for key in ("text", "image", "audio", "video", "file") if key in content), None)
            if kind is None:
                continue
            value = content[kind]
            if kind == "text":
                result.append({"kind": "text", "text": value})
            elif isinstance(value, dict):
                asset = value.get("asset") if kind == "file" else value
                if isinstance(asset, dict):
                    result.append({"kind": kind, "asset": asset,
                                   "semantic": part.get("semantic"),
                                   **({"name": value.get("name")} if kind == "file" else {})})
        return result

    @staticmethod
    def _legacy_media_unrecoverable(model_input: object) -> bool:
        if not isinstance(model_input, dict):
            return False
        return any(
            isinstance(item, dict) and item.get("uri") and item.get("modality") in ("image", "audio", "video")
            for item in model_input.get("items") or []
        )

    async def _route(self, content: dict) -> tuple[str, str, tuple, str | None]:
        text = content.get("text", "")
        text = text if isinstance(text, str) else ""
        model_input = content.get("model_input")
        if self._router is None or not model_input:
            return text, "", (), None
        try:
            route = await self._router.route(model_input)
        except Exception as exc:
            self._logger.warning("多模态路由失败，回落纯文本", error=str(exc))
            return text, "", (), None
        effective_text = route.primary_text or "[多模态输入]"
        semantic_text = route.semantic_text or ""
        vision = tuple(
            (message.prompt, message.uri, message.mime_type)
            for message in route.vision_messages
        )
        provider_key = None
        if vision and self._multimodal_core_model:
            provider_key = self._multimodal_core_model
        return effective_text, semantic_text, vision, provider_key

    def _update_emotion(self, inputs: list[str], turn: Any) -> None:
        if self._emotion is None or not inputs:
            return
        try:
            self._emotion.update_by_input("\n".join(inputs).strip())
            state = self._emotion.get_state()
        except Exception as exc:
            self._logger.warning("感知情绪评价失败（已隔离）", error=str(exc))
            return
        if not isinstance(state, dict):
            return
        self._observability.gauge(
            "emotion.intensity",
            float(state.get("intensity", 0.0)),
            labels={"emotion": str(state.get("emotion_type", ""))},
        )
        turn.pending_emotion_state = state

    def record_active_emotion(self, turn: Any) -> None:
        state = turn.pending_emotion_state
        if not isinstance(state, dict) or not turn.perception_moment_ids:
            return
        moment = self._recorder.record(
            MomentKind.EMOTION,
            content={"emotion": state},
            scene_id=turn.turn.scene_id or None,
            conversation_id=turn.turn.conversation_id,
            continuity_id=turn.turn.continuity_id,
            thread_id=turn.turn.thread_id,
            recall_scope=turn.turn.recall_scope,
            disclosure_scope=turn.turn.disclosure_scope,
            trace_id=turn.turn.turn_id or None,
            causation_ids=tuple(turn.perception_moment_ids),
            importance=0.4,
        )
        if moment is not None:
            turn.emotion_moment_id = moment.moment_id


class DeliberationController:
    """先生成 ActionPlan，再按计划决定回复、能力请求、澄清或沉默。"""

    def __init__(
        self,
        *,
        reasoning: InferenceController | None,
        planning_controller: PlanningController | None,
        memory=None,
        knowledge_base=None,
        conversation=None,
        recent_experience_source=None,
        activity_controller=None,
        emotion_system=None,
        persona_compiler=None,
        boundary_validator: Callable[[str], bool] | None = None,
        observability: ObservabilityPort,
    ) -> None:
        self._reasoning = reasoning
        self._planner = planning_controller or PlanningController(
            reasoning, observability=observability
        )
        self._context = ReplyContextBuilder(
            memory=memory,
            knowledge_base=knowledge_base,
            conversation=conversation,
            recent_experience_source=recent_experience_source,
            observability=observability,
        )
        self._activity = activity_controller
        self._emotion = emotion_system
        self._persona = persona_compiler
        self._boundary_validator = boundary_validator
        self._observability = observability
        self._logger = observability.logger("cognition_deliberation")

    async def deliberate(
        self, broadcast: Attention | None, turn: Any
    ) -> str | None:
        if self._reasoning is None or broadcast is None or broadcast.source != "perception":
            return None
        content = broadcast.content if isinstance(broadcast.content, dict) else {}
        if content.get("response_policy", "reply_allowed") == "observe_only":
            return None
        route = turn.routes.get(content.get("trace_id", ""), {})
        raw_text = content.get("text", "")
        user_text = route.get("user_text") or (
            raw_text if isinstance(raw_text, str) else ""
        )
        vision = route.get("vision", ())
        provider_key = route.get("provider_key")
        multimodal_text = route.get("multimodal_text", "")
        if (not user_text or not user_text.strip()) and not vision:
            return None

        plan = await self._plan(content, user_text, multimodal_text)
        if plan is not None:
            turn.action_plan = plan
            planned_reply = self._apply_plan(plan, turn)
            if plan.action == "skill_request" and turn.skill_request is not None:
                return None
            if plan.action in {"noop", "ask_clarification"}:
                return planned_reply

        request = InferenceRequest(
            system=await self._build_system_prompt(content, turn, multimodal_text),
            user=user_text,
            vision=vision,
            provider_key=provider_key,
            metadata={
                "purpose": "reply",
                "capture_category": "response",
                "scene_id": content.get("scene_id", ""),
                "trace_id": content.get("trace_id", ""),
            },
        )
        try:
            response = await self._reasoning.request(request, tier=self._reasoning_tier())
        except InferenceUnavailable as exc:
            self._logger.debug("回复推理不可用，本拍不回复", error=str(exc))
            return None
        except Exception as exc:
            self._logger.error("回复推理异常", error=str(exc), exc_info=True)
            self._observability.counter("cognition.deliberate_error", 1)
            return None
        reply = (response.text or "").strip()
        if not reply or not self._within_boundary(reply):
            return None
        return reply

    async def _plan(
        self, content: dict, user_text: str, multimodal_text: str
    ) -> ActionPlan | None:
        goal = "\n".join(
            part for part in [user_text, multimodal_text] if part
        ).strip()
        if not goal:
            return None
        return await self._planner.plan(
            goal=goal,
            scene_id=content.get("scene_id", ""),
            tier=self._reasoning_tier(),
            trace_id=content.get("trace_id", ""),
        )

    def _apply_plan(self, plan: ActionPlan, turn: Any) -> str | None:
        if plan.action == "skill_request":
            if plan.confidence >= 0.6 and plan.capability_kind != "none":
                turn.skill_request = {
                    "original_goal": plan.original_goal,
                    "reason": plan.reason,
                    "capability_kind": plan.capability_kind,
                    "confidence": plan.confidence,
                    "planning_hint": plan.planning_hint,
                }
            return None
        if plan.action == "noop":
            return None
        if plan.action != "ask_clarification":
            return None
        prompt = (plan.planning_hint or plan.reason or "").strip()
        if not prompt:
            prompt = "我需要再确认一下你的意思"
        if prompt.endswith(("?", "？")):
            return prompt
        return f"我想先确认一下：{prompt}"

    async def _build_system_prompt(
        self, content: dict, turn: Any, multimodal_text: str
    ) -> str:
        emotion_state: dict = {}
        if self._emotion is not None:
            try:
                emotion_state = self._emotion.get_state() or {}
            except Exception:
                emotion_state = {}
        persona_prompt = "你是当前角色。用简短、自然的中文回应。"
        if self._persona is not None:
            try:
                persona_prompt = self._persona.build_persona_prompt(
                    emotion_state=emotion_state,
                    address_mode=content.get("address_mode", "direct"),
                )
            except Exception as exc:
                self._logger.warning("角色 prompt 构建失败，使用最小 prompt", error=str(exc))
        user_text = content.get("text", "")
        return await self._context.build(
            persona_prompt=persona_prompt,
            scene_id=content.get("scene_id", ""),
            conversation_id=content.get("conversation_id", ""),
            thread_id=content.get("thread_id", "main"),
            actor_id=content.get("actor_id"),
            recall_scope=content.get("recall_scope", "conversation_private"),
            user_text=user_text if isinstance(user_text, str) else "",
            emotion_state=emotion_state,
            trace_id=turn.turn.turn_id,
            multimodal_text=multimodal_text,
        )

    def _reasoning_tier(self) -> ModelTier:
        if self._activity is not None:
            try:
                tier = self._activity.get_state().get("policy", {}).get("model_tier")
                if tier:
                    return ModelTier(tier)
            except Exception:
                pass
        return ModelTier.LOCAL_ONLY

    def _within_boundary(self, reply: str) -> bool:
        if self._boundary_validator is None:
            return True
        try:
            allowed = self._boundary_validator(reply)
        except Exception as exc:
            self._logger.error("角色边界校验异常，本拍不回复", error=str(exc), exc_info=True)
            self._observability.counter("cognition.deliberate_boundary_error", 1)
            return False
        if not allowed:
            self._logger.warning("回复越过角色边界，已拦截")
            self._observability.counter("cognition.deliberate_boundary_block", 1)
        return allowed

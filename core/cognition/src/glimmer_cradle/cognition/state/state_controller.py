"""Affect and cognitive activity lifecycle controllers."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from glimmer_cradle.cognition.ports.clock_port import ClockPort
from glimmer_cradle.cognition.ports.identity import IdGeneratorPort
from glimmer_cradle.cognition.ports.observability import LoggerPort, ObservabilityPort
from glimmer_cradle.cognition.state.cognitive_state import (
    CognitiveActivityState,
    EmotionState,
    EmotionType,
    policy_for,
)
from glimmer_cradle.cognition.state.decay import (
    ActivityTransition,
    ActivityTransitionConfig,
    DEFAULT_ACTIVITY_TRANSITION_CONFIG,
    DEFAULT_INTENSITY_DECAY_ON_NEUTRAL,
    decay_intensity,
    evaluate_transition,
    infer_emotion_by_input,
)
from glimmer_cradle.cognition.state.state_store import StateStore, StoredCognitiveState
from glimmer_cradle.conversation import ConversationRecorder, MomentKind


class EmotionSystem:
    """Continuous affect state with injected time and deterministic decay."""

    def __init__(self, *, clock: ClockPort, ids: IdGeneratorPort, logger: LoggerPort):
        self._clock = clock
        self._logger = logger
        self.current_state = EmotionState(
            emotion_type=EmotionType.CALM,
            intensity=0.2,
            trigger="init",
            trace_id=ids.new(),
            timestamp=clock.now(),
        )
        self.decay_rate = 0.001
        self._logger.info(
            "情绪系统初始化完成",
            initial_emotion=self.current_state.emotion_type.value,
        )

    def decay(self) -> None:
        now = self._clock.now()
        self.current_state.intensity = decay_intensity(
            self.current_state.intensity,
            elapsed_seconds=(now - self.current_state.timestamp).total_seconds(),
            decay_rate=self.decay_rate,
        )
        self.current_state.timestamp = now
        self._logger.debug(
            "情绪自然衰减完成",
            current_emotion=self.current_state.emotion_type.value,
            intensity=round(self.current_state.intensity, 2),
        )

    def update(
        self,
        new_emotion: EmotionType,
        intensity_delta: float,
        trigger: str = "",
    ) -> None:
        if not -1.0 <= intensity_delta <= 1.0:
            raise ValueError(
                f"情绪强度变化值必须在-1.0~1.0之间，当前值：{intensity_delta}"
            )
        self.decay()
        self.current_state.emotion_type = new_emotion
        self.current_state.intensity = max(
            0.1, min(1.0, self.current_state.intensity + intensity_delta)
        )
        self.current_state.trigger = trigger
        self.current_state.timestamp = self._clock.now()
        self._logger.info(
            "情绪状态更新完成",
            new_emotion=new_emotion.value,
            intensity=round(self.current_state.intensity, 2),
            trigger=trigger,
        )

    def update_by_input(self, user_input: str) -> None:
        self.decay()
        inferred = infer_emotion_by_input(user_input)
        if inferred is not None:
            emotion_name, intensity_delta = inferred
            self.update(EmotionType(emotion_name), intensity_delta, trigger=user_input[:20])
            return
        self.update(
            self.current_state.emotion_type,
            DEFAULT_INTENSITY_DECAY_ON_NEUTRAL,
            trigger=user_input[:20],
        )

    def get_state(self) -> dict[str, object]:
        return {
            "emotion_type": self.current_state.emotion_type.value,
            "intensity": round(self.current_state.intensity, 2),
            "trigger": self.current_state.trigger,
        }


@dataclass(frozen=True)
class ActivityHistory:
    direct_at: datetime | None = None
    observed_at: datetime | None = None
    self_at: datetime | None = None

    @property
    def has_activity(self) -> bool:
        return any((self.direct_at, self.observed_at, self.self_at))


def parse_iso_ms(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def project_activity_history(recorder: ConversationRecorder) -> ActivityHistory:
    direct_at: datetime | None = None
    observed_at: datetime | None = None
    self_at: datetime | None = None
    kinds = {MomentKind.PERCEPTION.value, MomentKind.REPLY.value, MomentKind.ACTION.value}
    for moment in recorder.recent_moments(limit=2000, kinds=kinds):
        try:
            occurred_at = parse_iso_ms(moment.occurred_at)
        except ValueError:
            continue
        if moment.kind == MomentKind.PERCEPTION.value:
            if observed_at is None or occurred_at > observed_at:
                observed_at = occurred_at
            content = moment.content if isinstance(moment.content, dict) else {}
            if content.get("address_mode") == "direct" and (
                direct_at is None or occurred_at > direct_at
            ):
                direct_at = occurred_at
        elif moment.kind in {MomentKind.REPLY.value, MomentKind.ACTION.value} and (
            self_at is None or occurred_at > self_at
        ):
            self_at = occurred_at
    return ActivityHistory(direct_at, observed_at, self_at)


def compute_idle_seconds(now: datetime, last_at: datetime | None) -> float:
    if last_at is None:
        return float("inf")
    if last_at.tzinfo is None:
        last_at = last_at.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return max(0.0, (now - last_at).total_seconds())


def _iso_ms(value: datetime) -> str:
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class CognitiveActivityController:
    """Resource policy state; transitions emit telemetry, never Experience."""

    def __init__(
        self,
        *,
        experience_recorder: ConversationRecorder,
        affect_activation_provider: Callable[[], float],
        clock: ClockPort,
        observability: ObservabilityPort,
        state_store: StateStore | None = None,
        config: ActivityTransitionConfig = DEFAULT_ACTIVITY_TRANSITION_CONFIG,
        tick_interval_s: float = 5.0,
    ) -> None:
        self._config = config
        self._tick_interval_s = max(1.0, tick_interval_s)
        self._recorder = experience_recorder
        self._affect_activation = affect_activation_provider
        self._clock = clock
        self._observability = observability
        self._state_store = state_store
        self._state_revision: int | None = None
        self._logger = observability.logger("cognitive_activity_controller")
        self._state = CognitiveActivityState.AMBIENT
        self._since_at = clock.now()
        self._last_direct_interaction_at: datetime | None = None
        self._last_observed_activity_at: datetime | None = None
        self._last_self_activity_at: datetime | None = None
        self._engage_requested = False
        self._observed_activity_requested = False
        self._task: asyncio.Task | None = None
        self._running = False
        self._transition_callbacks: list[Callable[[], None]] = []

    async def start(self) -> None:
        if self._state_store is not None:
            stored = await self._state_store.load("activity")
            if stored is not None:
                self._restore(stored)
        try:
            history = project_activity_history(self._recorder)
        except Exception as exc:
            self._logger.warning("认知活动冷启动投影失败，使用空活动基线", error=str(exc))
            history = None
        now = self._clock.now()
        if history is None or not history.has_activity:
            if self._state_revision is not None:
                self._state = self._bootstrap_state(now)
            else:
                self._last_observed_activity_at = now
                self._state = CognitiveActivityState.AMBIENT
        else:
            self._last_direct_interaction_at = _latest(
                self._last_direct_interaction_at, history.direct_at
            )
            self._last_observed_activity_at = _latest(
                self._last_observed_activity_at, history.observed_at
            )
            self._last_self_activity_at = _latest(
                self._last_self_activity_at, history.self_at
            )
            self._state = self._bootstrap_state(now)
        self._since_at = now
        self._running = True
        self._task = asyncio.create_task(self._tick_loop())
        self._emit_state_metric()
        self._logger.info("认知活动控制器已启动", initial_state=self._state.value)

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self._persist()
        self._logger.info("认知活动控制器已停止", final_state=self._state.value)

    def on_transition(self, callback: Callable[[], None]) -> None:
        self._transition_callbacks.append(callback)

    def engage(self, reason: str = "direct_interaction") -> None:
        now = self._clock.now()
        self._engage_requested = False
        self._observed_activity_requested = False
        self._last_direct_interaction_at = now
        self._last_observed_activity_at = now
        if self._state != CognitiveActivityState.ENGAGED:
            self._apply_transition(ActivityTransition(CognitiveActivityState.ENGAGED, True, reason))

    def observe_activity(self, reason: str = "ambient_observation") -> None:
        self._observed_activity_requested = True
        self._last_observed_activity_at = self._clock.now()
        if self._state == CognitiveActivityState.QUIESCENT:
            self._observed_activity_requested = False
            self._apply_transition(ActivityTransition(CognitiveActivityState.AMBIENT, True, reason))

    def record_self_activity(self, reason: str = "self_activity") -> None:
        self._last_self_activity_at = self._clock.now()
        self._logger.debug("记录角色活动", reason=reason, state=self._state.value)

    def get_state(self) -> dict[str, object]:
        now = self._clock.now()
        idle_values = [
            self._idle(now, value)
            for value in (
                self._last_direct_interaction_at,
                self._last_observed_activity_at,
                self._last_self_activity_at,
            )
        ]
        finite = [value for value in idle_values if value < 1e9]
        return {
            "state": self._state.value,
            "since_at": _iso_ms(self._since_at),
            "idle_seconds": round(min(finite) if finite else 0.0, 3),
            "policy": policy_for(self._state).model_dump(),
        }

    @property
    def state(self) -> CognitiveActivityState:
        return self._state

    async def _tick_loop(self) -> None:
        while self._running:
            try:
                await self._clock.wait(self._tick_interval_s)
                self._do_tick()
                await self._persist()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self._logger.error("认知活动状态计算异常", error=str(exc), exc_info=True)

    def _do_tick(self) -> None:
        now = self._clock.now()
        try:
            activation = float(self._affect_activation())
        except Exception as exc:
            self._logger.warning("情感激活强度采集失败，按 0 处理", error=str(exc))
            activation = 0.0
        result = evaluate_transition(
            self._state,
            direct_idle_seconds=self._idle(now, self._last_direct_interaction_at),
            observed_idle_seconds=self._idle(now, self._last_observed_activity_at),
            state_elapsed_seconds=max(0.0, (now - self._since_at).total_seconds()),
            affect_activation=activation,
            engage_requested=self._engage_requested,
            observed_activity_requested=self._observed_activity_requested,
            config=self._config,
        )
        self._engage_requested = False
        self._observed_activity_requested = False
        self._emit_state_metric()
        if result.changed:
            self._apply_transition(result)

    def _apply_transition(self, result: ActivityTransition) -> None:
        previous = self._state.value
        self._state = result.state
        self._since_at = self._clock.now()
        self._observability.counter(
            "cognition.activity.transition",
            labels={"from": previous, "to": self._state.value, "reason": result.reason},
        )
        self._logger.info(
            "认知活动状态变化",
            from_state=previous,
            to_state=self._state.value,
            reason=result.reason,
        )
        for callback in list(self._transition_callbacks):
            try:
                callback()
            except Exception as exc:
                self._logger.warning("认知活动状态回调失败", error=str(exc))

    def _bootstrap_state(self, now: datetime) -> CognitiveActivityState:
        if self._idle(now, self._last_direct_interaction_at) < self._config.engaged_to_ambient_idle_s:
            return CognitiveActivityState.ENGAGED
        if self._idle(now, self._last_observed_activity_at) < self._config.ambient_to_quiescent_idle_s:
            return CognitiveActivityState.AMBIENT
        return CognitiveActivityState.QUIESCENT

    @staticmethod
    def _idle(now: datetime, last_at: datetime | None) -> float:
        value = compute_idle_seconds(now, last_at)
        return 1e9 if value == float("inf") else value

    def _emit_state_metric(self) -> None:
        level = {
            CognitiveActivityState.QUIESCENT: 0.0,
            CognitiveActivityState.AMBIENT: 1.0,
            CognitiveActivityState.ENGAGED: 2.0,
        }[self._state]
        self._observability.gauge(
            "cognition.activity.state", level, labels={"state": self._state.value}
        )

    def _restore(self, stored: StoredCognitiveState) -> None:
        payload = stored.payload
        try:
            self._state = CognitiveActivityState(str(payload["state"]))
            self._since_at = parse_iso_ms(str(payload["since_at"]))
            self._last_direct_interaction_at = _optional_time(payload.get("direct_at"))
            self._last_observed_activity_at = _optional_time(payload.get("observed_at"))
            self._last_self_activity_at = _optional_time(payload.get("self_at"))
            self._state_revision = stored.revision
        except (KeyError, TypeError, ValueError) as exc:
            self._logger.warning("认知状态快照无效，改从 Conversation Log 恢复", error=str(exc))

    async def _persist(self) -> None:
        if self._state_store is None:
            return
        now = self._clock.now()
        candidate = StoredCognitiveState(
            state_key="activity",
            revision=self._state_revision or 0,
            payload={
                "state": self._state.value,
                "since_at": _iso_ms(self._since_at),
                "direct_at": _iso_ms(self._last_direct_interaction_at) if self._last_direct_interaction_at else None,
                "observed_at": _iso_ms(self._last_observed_activity_at) if self._last_observed_activity_at else None,
                "self_at": _iso_ms(self._last_self_activity_at) if self._last_self_activity_at else None,
            },
            updated_at=_iso_ms(now),
        )
        saved = await self._state_store.save(
            candidate, expected_revision=self._state_revision
        )
        self._state_revision = saved.revision


def _optional_time(value: object) -> datetime | None:
    return parse_iso_ms(str(value)) if value else None


def _latest(first: datetime | None, second: datetime | None) -> datetime | None:
    if first is None:
        return second
    if second is None:
        return first
    return max(first, second)

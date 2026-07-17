"""认知活动状态的生命周期、信号收集与受控投影。"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import datetime, timezone

from glimmer_cradle.cognition.activity.policy import (
    ActivityTransitionConfig,
    CognitiveActivityState,
    DEFAULT_ACTIVITY_TRANSITION_CONFIG,
    policy_for,
)
from glimmer_cradle.cognition.activity.projection import (
    compute_idle_seconds,
    project_activity_history,
)
from glimmer_cradle.cognition.activity.transition import ActivityTransition, evaluate_transition
from glimmer_cradle.cognition.experience.recorder import ExperienceRecorder
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.metrics import counter, gauge

logger = get_logger("cognitive_activity_controller")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _iso_ms(value: datetime) -> str:
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class CognitiveActivityController:
    """管理认知活动策略；自动状态迁移只进入 telemetry，不进入 Experience。"""

    def __init__(
        self,
        *,
        experience_recorder: ExperienceRecorder,
        affect_activation_provider: Callable[[], float],
        config: ActivityTransitionConfig = DEFAULT_ACTIVITY_TRANSITION_CONFIG,
        tick_interval_s: float = 5.0,
    ) -> None:
        self._config = config
        self._tick_interval_s = max(1.0, tick_interval_s)
        self._recorder = experience_recorder
        self._affect_activation = affect_activation_provider
        self._state = CognitiveActivityState.AMBIENT
        self._since_at = _now_utc()
        self._last_direct_interaction_at: datetime | None = None
        self._last_observed_activity_at: datetime | None = None
        self._last_self_activity_at: datetime | None = None
        self._engage_requested = False
        self._observed_activity_requested = False
        self._task: asyncio.Task | None = None
        self._running = False
        self._transition_callbacks: list[Callable[[], None]] = []

    async def start(self) -> None:
        try:
            history = project_activity_history(self._recorder)
        except Exception as exc:
            logger.warning("认知活动冷启动投影失败，使用空活动基线", error=str(exc))
            history = None
        now = _now_utc()
        if history is None or not history.has_activity:
            self._last_observed_activity_at = now
            self._state = CognitiveActivityState.AMBIENT
        else:
            self._last_direct_interaction_at = history.direct_at
            self._last_observed_activity_at = history.observed_at
            self._last_self_activity_at = history.self_at
            self._state = self._bootstrap_state(now)
        self._since_at = now
        self._running = True
        self._task = asyncio.create_task(self._tick_loop())
        self._emit_state_metric()
        logger.info(
            "认知活动控制器已启动",
            initial_state=self._state.value,
            direct_idle_seconds=self._idle(now, self._last_direct_interaction_at),
            observed_idle_seconds=self._idle(now, self._last_observed_activity_at),
        )

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("认知活动控制器已停止", final_state=self._state.value)

    def on_transition(self, callback: Callable[[], None]) -> None:
        self._transition_callbacks.append(callback)

    def engage(self, reason: str = "direct_interaction") -> None:
        now = _now_utc()
        self._engage_requested = False
        self._observed_activity_requested = False
        self._last_direct_interaction_at = now
        self._last_observed_activity_at = now
        if self._state == CognitiveActivityState.ENGAGED:
            logger.debug("记录直接互动", reason=reason, state=self._state.value)
            return
        self._apply_transition(
            ActivityTransition(CognitiveActivityState.ENGAGED, True, reason)
        )

    def observe_activity(self, reason: str = "ambient_observation") -> None:
        self._observed_activity_requested = True
        self._last_observed_activity_at = _now_utc()
        if self._state == CognitiveActivityState.QUIESCENT:
            self._observed_activity_requested = False
            self._apply_transition(
                ActivityTransition(CognitiveActivityState.AMBIENT, True, reason)
            )

    def record_self_activity(self, reason: str = "self_activity") -> None:
        self._last_self_activity_at = _now_utc()
        logger.debug("记录角色活动", reason=reason, state=self._state.value)

    def get_state(self) -> dict:
        now = _now_utc()
        direct_idle = self._idle(now, self._last_direct_interaction_at)
        observed_idle = self._idle(now, self._last_observed_activity_at)
        self_idle = self._idle(now, self._last_self_activity_at)
        finite_idle = [value for value in (direct_idle, observed_idle, self_idle) if value < 1e9]
        idle = min(finite_idle) if finite_idle else 0.0
        return {
            "state": self._state.value,
            "since_at": _iso_ms(self._since_at),
            "idle_seconds": round(idle, 3),
            "policy": policy_for(self._state).model_dump(),
        }

    @property
    def state(self) -> CognitiveActivityState:
        return self._state

    async def _tick_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(self._tick_interval_s)
                self._do_tick()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("认知活动状态计算异常", error=str(exc), exc_info=True)

    def _do_tick(self) -> None:
        now = _now_utc()
        try:
            activation = float(self._affect_activation())
        except Exception as exc:
            logger.warning("情感激活强度采集失败，按 0 处理", error=str(exc))
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
        self._since_at = _now_utc()
        counter(
            "cognition.activity.transition",
            labels={"from": previous, "to": self._state.value, "reason": result.reason},
        )
        logger.info(
            "认知活动状态变化",
            from_state=previous,
            to_state=self._state.value,
            reason=result.reason,
        )
        for callback in list(self._transition_callbacks):
            try:
                callback()
            except Exception as exc:
                logger.warning("认知活动状态回调失败", error=str(exc))

    def _bootstrap_state(self, now: datetime) -> CognitiveActivityState:
        direct_idle = self._idle(now, self._last_direct_interaction_at)
        observed_idle = self._idle(now, self._last_observed_activity_at)
        if direct_idle < self._config.engaged_to_ambient_idle_s:
            return CognitiveActivityState.ENGAGED
        if observed_idle < self._config.ambient_to_quiescent_idle_s:
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
        gauge("cognition.activity.state", level, labels={"state": self._state.value})

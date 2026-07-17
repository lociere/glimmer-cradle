"""
DriveProvider —— 内在动机专家。

维护 3 个 [0,1] drive：curiosity / companionship / rest。
每拍累积（按 cognitive activity boost），消费 pending 满足事件，选最高过阈投放。

外部信号：
- ``signal_satisfied(drive)``  通知某 drive 已被满足，下一拍立即衰减
- 无持久化（drive 跨次启动从 0 起；认知活动投影不持久化 drive）
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from glimmer_cradle.cognition.cycle.providers.base import Provider
from glimmer_cradle.cognition.cycle.workspace import WorkspaceItem, make_item


@dataclass(frozen=True)
class DriveConfig:
    """Drive 模型参数（设计 §3.9）。"""

    # 自然上升速率（每秒）
    curiosity_rise_per_s: float = 0.005
    companionship_rise_per_s: float = 0.003
    rest_rise_per_s: float = 0.002
    # 满足事件衰减量
    curiosity_satisfaction: float = 0.4
    companionship_satisfaction: float = 0.5
    rest_satisfaction: float = 0.7
    # 投放阈值
    propose_threshold: float = 0.6
    # 静息态冻结 drive 累积，完整互动时加速。
    activity_boost: dict[str, float] = field(default_factory=lambda: {
        "engaged": 1.5, "ambient": 1.0, "quiescent": 0.0,
    })
    # 强情绪触发 rest 加速
    emotion_strong_threshold: float = 0.7
    emotion_strong_rest_multiplier: float = 2.0


def _now() -> datetime:
    return datetime.now(timezone.utc)


class DriveProvider(Provider):
    name = "drive"

    DRIVES = ("curiosity", "companionship", "rest")

    def __init__(
        self,
        *,
        activity_controller=None,
        emotion_system=None,
        config: DriveConfig | None = None,
    ) -> None:
        self._cfg = config or DriveConfig()
        self._activity = activity_controller
        self._emotion = emotion_system

        self._levels: dict[str, float] = {d: 0.0 for d in self.DRIVES}
        self._last_tick_at: datetime | None = None
        self._pending_satisfaction: set[str] = set()

    # ── 输入信号 ─────────────────────────────────────────────────────────

    def signal_satisfied(self, drive: str) -> None:
        """外部通知：某 drive 已被满足。"""
        if drive not in self._levels:
            return
        self._pending_satisfaction.add(drive)

    @property
    def levels(self) -> dict[str, float]:
        return dict(self._levels)

    # ── propose ──────────────────────────────────────────────────────────

    async def propose(self, workspace_snapshot: list[WorkspaceItem]) -> list[WorkspaceItem]:
        now = _now()
        if self._last_tick_at is None:
            tick_seconds = 0.0  # 首拍不累积
        else:
            tick_seconds = max(0.0, (now - self._last_tick_at).total_seconds())
        self._last_tick_at = now

        boost = self._compute_activity_boost()
        emotion_strong = self._compute_emotion_strong()

        # 1. 累积
        self._levels["curiosity"] = min(
            1.0, self._levels["curiosity"] + self._cfg.curiosity_rise_per_s * tick_seconds * boost
        )
        self._levels["companionship"] = min(
            1.0, self._levels["companionship"]
            + self._cfg.companionship_rise_per_s * tick_seconds * boost
        )
        rest_mul = self._cfg.emotion_strong_rest_multiplier if emotion_strong else 1.0
        self._levels["rest"] = min(
            1.0, self._levels["rest"] + self._cfg.rest_rise_per_s * tick_seconds * rest_mul
        )

        # 2. 消费满足事件
        sat_map = {
            "curiosity": self._cfg.curiosity_satisfaction,
            "companionship": self._cfg.companionship_satisfaction,
            "rest": self._cfg.rest_satisfaction,
        }
        for drive in list(self._pending_satisfaction):
            self._levels[drive] = max(0.0, self._levels[drive] - sat_map[drive])
        self._pending_satisfaction.clear()

        # 3. 选最高过阈投放
        top_drive = max(self._levels, key=lambda d: self._levels[d])
        top_level = self._levels[top_drive]
        if top_level < self._cfg.propose_threshold:
            return []

        return [make_item(
            source=self.name,
            content={
                "drive": top_drive,
                "level": top_level,
                "all_levels": dict(self._levels),
            },
            salience=top_level,
        )]

    # ── helpers ──────────────────────────────────────────────────────────

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

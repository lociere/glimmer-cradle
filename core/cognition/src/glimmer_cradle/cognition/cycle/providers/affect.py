"""
AffectProvider —— 情绪专家模块。

每拍读 EmotionSystem.get_state() 当前情绪 → 产出 1 个 WorkspaceItem(source=affect)。
salience 直接用情绪 intensity ——
- 情绪强（intensity 接近 1）→ 易胜出工作区竞争 → 影响后续 Deliberation
- 情绪平淡（intensity 接近 0.1，本系统最低不低于 0.1）→ 易被其他 source 挤掉

设计依据：蓝图 §3.2 "对当前局面产生情绪反应，维护情绪向量与心境" —— 是常驻
不间断的“心境呼吸”，作为常驻专家参与每拍竞争。

注：当前 EmotionSystem 单一 emotion + intensity；将来 valence×arousal 二维
情绪模型重写时，content 字段会带更丰富的描述（蓝图 §3.5 强情绪 hold 留口）。
"""
from __future__ import annotations

from glimmer_cradle.cognition.cycle.providers.base import Provider
from glimmer_cradle.cognition.cycle.workspace import WorkspaceItem, make_item
from glimmer_cradle.cognition.affect.emotion import EmotionSystem


class AffectProvider(Provider):
    name = "affect"

    def __init__(self, emotion_system: EmotionSystem) -> None:
        self._emotion = emotion_system

    async def propose(self, workspace_snapshot: list[WorkspaceItem]) -> list[WorkspaceItem]:
        try:
            state = self._emotion.get_state()
        except Exception:
            return []

        intensity = float(state.get("intensity", 0.0))
        # 工作区 salience 严格 (0,1]，太弱（≤0.05）就别投放占容量
        if intensity <= 0.05:
            return []

        return [make_item(
            source=self.name,
            content={
                "emotion_type": state.get("emotion_type", ""),
                "intensity": intensity,
                "trigger": state.get("trigger", ""),
            },
            salience=min(1.0, intensity),
        )]

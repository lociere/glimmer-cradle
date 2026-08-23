"""
连续意愿值计算。

```
willingness = Σ weight_i × score_i
score 各自归一到 [0,1]：
  address_score   = direct → 1.0, ambient → 0.5, 其他 → 0.0
  emotion_score   = emotion_intensity
  intimacy_score  = relationship_intimacy
  drive_score     = drive_companionship
  silence_score   = min(1.0, silence_seconds / silence_normalize_s)
  persona_score   = persona_extraversion（缺省时取 config.default_extraversion）
threshold = threshold_by_activity[activity_state]
意愿 > 阈值且 cognitive activity policy 允许主动行为 → 触发行动
```

Ambient 时阈值高；Engaged 时阈值低；Quiescent 阈值大于 1，不触发主动行为。
"""
from __future__ import annotations

from dataclasses import dataclass, field


def _clip01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


@dataclass(frozen=True)
class WillingnessConfig:
    """意愿公式权重 + 阈值表（设计 §3.8）。"""

    # 权重（不强制求和为 1；clip 后输出仍在 [0,1]）
    weight_address: float = 0.30
    weight_emotion: float = 0.20
    weight_intimacy: float = 0.15
    weight_drive: float = 0.15
    weight_silence: float = 0.10
    weight_persona: float = 0.10

    # cognitive activity state → 意愿阈值。
    threshold_by_activity: dict[str, float] = field(default_factory=lambda: {
        "engaged": 0.40,
        "ambient": 0.70,
        "quiescent": 1.10,
    })

    # 默认外向度（人格未提供 extraversion 时回落）
    default_extraversion: float = 0.5

    # "很久没说话" 的归一化阈（秒）—— 达到此值 silence_score = 1
    silence_normalize_s: float = 600.0


@dataclass(frozen=True)
class WillingnessInputs:
    """意愿公式的输入。每一项可缺省，缺省即按 0 / 默认值处理。"""

    address_mode: str = ""          # "direct" / "ambient" / ""
    emotion_intensity: float = 0.0  # [0, 1]
    relationship_intimacy: float = 0.0  # [0, 1]
    drive_companionship: float = 0.0    # [0, 1]
    silence_seconds: float = 0.0        # 距上次发言间隔（秒）
    persona_extraversion: float | None = None  # None → 用 config.default_extraversion


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
    """按公式与权重计算意愿值，结果 clip 到 [0, 1]。"""
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
    """根据认知活动态取意愿阈值；未知态用 0.5 兜底。"""
    cfg = config or WillingnessConfig()
    return float(cfg.threshold_by_activity.get(activity_state, 0.5))

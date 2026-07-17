"""
意图仲裁：同一拍只允许有限且不冲突的行动胜出。

输入：本拍内候选 Intent 列表 + 当前阈值 + activity policy 主动性闸
输出：accepted（按 willingness 倒序）+ suppressed（含被压抑原因，便于观测）

仲裁规则：
1. reactive 意图来自已准入感知和 Deliberation 决策，不再经过主动意愿闸
2. proactive 意图 willingness < threshold → 抑制（"意愿不够"）
3. allows_proactive=False 时，proactive 意图 → 抑制
3. reply 唯一性：同拍多个 reply 意图，最高 willingness 胜出，其余抑制
4. 输出按 willingness 降序
"""
from __future__ import annotations

from dataclasses import dataclass, field

from glimmer_cradle.cognition.protocol.generated.models.intent import Intent


@dataclass(frozen=True)
class ArbitrationResult:
    """仲裁结果。"""

    accepted: list[Intent] = field(default_factory=list)
    suppressed: list[tuple[Intent, str]] = field(default_factory=list)


def arbitrate(
    intents: list[Intent],
    *,
    threshold: float,
    allows_proactive: bool,
) -> ArbitrationResult:
    """对本拍的候选 Intent 做合并 / 抑制。

    Args:
        intents:          本拍所有候选意图
        threshold:        意愿阈值（来自 ``threshold_for(activity_state)``）
        allows_proactive: cognitive activity policy 的主动性开关
    """
    accepted: list[Intent] = []
    suppressed: list[tuple[Intent, str]] = []

    # 1. 主动意图才受连续意愿阈值约束；响应性意图已由感知策略与 Deliberation 决策。
    above: list[Intent] = []
    for it in intents:
        initiative = it.initiative.value if hasattr(it.initiative, "value") else str(it.initiative)
        if initiative == "proactive" and float(it.willingness) < threshold:
            suppressed.append((it, "below_threshold"))
        else:
            above.append(it)

    # 2. 认知活动策略只阻止角色主动行为，不阻止对已准入用户请求的回应。
    if not allows_proactive:
        passable: list[Intent] = []
        for it in above:
            initiative = it.initiative.value if hasattr(it.initiative, "value") else str(it.initiative)
            if initiative == "proactive":
                suppressed.append((it, "proactive_blocked"))
            else:
                passable.append(it)
        above = passable

    # 3. reply 唯一性
    replies: list[Intent] = []
    others: list[Intent] = []
    for it in above:
        t = it.type.value if hasattr(it.type, "value") else str(it.type)
        if t == "reply":
            replies.append(it)
        else:
            others.append(it)

    if replies:
        replies.sort(key=lambda x: float(x.willingness), reverse=True)
        accepted.append(replies[0])
        for r in replies[1:]:
            suppressed.append((r, "reply_duplicate"))
    accepted.extend(others)

    accepted.sort(key=lambda x: float(x.willingness), reverse=True)
    return ArbitrationResult(accepted=accepted, suppressed=suppressed)

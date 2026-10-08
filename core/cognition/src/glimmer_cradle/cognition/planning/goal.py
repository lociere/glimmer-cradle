"""Cognition-owned semantic goal definitions."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class GoalVersion:
    """不可变长期目标；完成条件只由 Cognition 解释，不由 Jobs 状态替代。"""

    goal_id: str
    scope_id: str
    version: int
    text: str
    completion_condition: str

    def __post_init__(self) -> None:
        if any(
            not isinstance(value, str) or not value.strip()
            for value in (
                self.goal_id,
                self.scope_id,
                self.text,
                self.completion_condition,
            )
        ):
            raise ValueError("长期目标身份、语义与完成条件不得为空")
        if type(self.version) is not int or not 1 <= self.version <= 2**53 - 1:
            raise ValueError("长期目标版本无效")


@dataclass(frozen=True, slots=True)
class PlanningAssessment:
    """Cognition 的语义评估提案；未经 source 复验和持久接纳不完成承诺。"""

    completed: bool
    evidence_ids: tuple[str, ...]
    reason: str

    def __post_init__(self) -> None:
        if type(self.completed) is not bool or not isinstance(self.evidence_ids, tuple):
            raise TypeError("Planning 评估字段无效")
        if len(self.evidence_ids) > 64 or any(
            not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > 4096
            for value in self.evidence_ids
        ) or len(set(self.evidence_ids)) != len(self.evidence_ids):
            raise ValueError("Planning 评估证据引用无效")
        if self.completed and not self.evidence_ids:
            raise ValueError("完成判断必须引用实际证据")
        if not isinstance(self.reason, str) or not self.reason.strip() or len(self.reason.encode("utf-8")) > 2000:
            raise ValueError("Planning 评估理由无效")

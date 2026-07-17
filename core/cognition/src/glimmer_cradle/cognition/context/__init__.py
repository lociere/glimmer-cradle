"""
上下文源与有界装配。

把"记忆 + 知识 + 关系"在**检索层**统一为同一概念 —— 可激活的上下文源。
存储层各自独立（Memory / Knowledge / Relationship），但检索层走同一接口：
``ContextSource.activate(query) → list[ContextItem]``。

ContextAssembly 是装配器：拉所有源 → 打分（recency · importance · relevance）→
按认知活动预算因子裁剪 → 带 source 标签输出（区分"我记得" vs "我知道"）。

铁律边界：扩展可贡献新 ContextSource（如新 Lorebook / 外部知识接口），
**不能加新专家模块**（蓝图 §3.2 "能力 vs 器官"）。
"""

from glimmer_cradle.cognition.context.sources.base import ContextItem, ContextQuery, ContextSource
from glimmer_cradle.cognition.context.assembly import AssembledContext, ContextAssembly

__all__ = [
    "AssembledContext",
    "ContextAssembly",
    "ContextItem",
    "ContextQuery",
    "ContextSource",
]

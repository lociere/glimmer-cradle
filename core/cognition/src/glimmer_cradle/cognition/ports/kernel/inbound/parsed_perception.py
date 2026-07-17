"""KernelIngressCortex 解析后的平台无关感知 DTO。"""
from __future__ import annotations

from dataclasses import dataclass

from glimmer_cradle.cognition.protocol.generated.models.perception_event import PerceptionContent


@dataclass
class ParsedPerception:
    """解析后的标准化感知输入。

    完全屏蔽平台 / 场景细节 —— 由 Cortex 在入站口归一化完成，AI 层不再处理任何
    场景规则。
    """

    # 统一模型输入（含文本、图片、视频等多模态字段）
    model_input: PerceptionContent | dict
    # Kernel 解析后的 canonical Scene，用于经历、作用域和外部环境归属。
    scene_id: str
    conversation_id: str
    continuity_id: str
    thread_id: str
    recall_scope: str
    disclosure_scope: str
    # 对话对象熟悉度 0-10（10=核心用户，0=陌生人，内核已计算完成）
    familiarity: int = 0
    # 寻址模式：direct=明确呼唤（唤醒词/@/私聊），ambient=焦点窗口内的环境感知
    address_mode: str = "direct"
    # 响应策略：observe_only 只进入经历/记忆，不生成外显回复
    response_policy: str = "reply_allowed"
    # 全链路追踪 ID
    trace_id: str = ""
    origin: dict | None = None
    retention_ceiling: str = "experience"
    interaction_id: str = ""

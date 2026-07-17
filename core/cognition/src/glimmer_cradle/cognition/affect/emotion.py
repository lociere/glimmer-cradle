"""
文件名称：emotion_system.py
所属层级：领域层-情绪模块
核心作用：实现当前角色的连续情绪流转，自然衰减、触发、变化，完全符合真人逻辑
设计原则：
1. 情绪是连续的，不会随对话结束重置
2. 有自然衰减机制，心情会慢慢平复
3. 完全基于人设规则，无硬编码业务逻辑
4. 情绪仅由输入内容和主动思维触发，不碰场景规则
"""
import time
from dataclasses import dataclass, field
from enum import StrEnum
from uuid import uuid4
from datetime import datetime
from glimmer_cradle.cognition.foundation.exceptions import EmotionException
from glimmer_cradle.cognition.affect.rules import (
    DEFAULT_INTENSITY_DECAY_ON_NEUTRAL,
    infer_emotion_by_input,
)
from glimmer_cradle.cognition.observability.logger import get_logger

# 初始化模块日志器
logger = get_logger("emotion_system")


# ======================================
# 情绪类型枚举（完全贴合傲娇少女人设）
# ======================================
class EmotionType(StrEnum):
    CALM = "calm"       # 平静（默认状态）
    HAPPY = "happy"     # 开心
    SHY = "shy"         # 害羞
    ANGRY = "angry"     # 生气
    SULKY = "sulky"     # 赌气/闹别扭
    CURIOUS = "curious" # 好奇
    SAD = "sad"         # 难过


# ======================================
# 情绪状态实体
# ======================================
@dataclass
class EmotionState:
    """情绪状态实体，记录当前的情绪、强度、触发源"""
    # 情绪类型
    emotion_type: EmotionType
    # 情绪强度 0~1，0=无情绪，1=情绪最强烈
    intensity: float
    # 情绪触发源
    trigger: str = ""
    # 全链路追踪ID
    trace_id: str = field(default_factory=lambda: str(uuid4()))
    # 情绪更新时间
    timestamp: datetime = field(default_factory=datetime.now)


# ======================================
# 情绪系统核心实现
# ======================================
class EmotionSystem:
    """
    当前角色的情绪系统核心
    核心特性：连续流转、自然衰减、符合人设的触发规则
    真人逻辑对齐：情绪不会突然消失，会随时间慢慢平复，符合人类情绪变化规律
    """
    def __init__(self):
        # 当前情绪状态，初始为平静
        self.current_state: EmotionState = EmotionState(
            emotion_type=EmotionType.CALM,
            intensity=0.2,
            trigger="init"
        )
        # 情绪衰减系数（每秒衰减0.1%，符合真人心情慢慢平复的逻辑）
        self.decay_rate: float = 0.001
        logger.info("情绪系统初始化完成", initial_emotion=self.current_state.emotion_type.value)

    def decay(self) -> None:
        """
        情绪自然衰减，每次操作前都会调用，保证情绪连续
        核心逻辑：情绪强度随时间自然降低，最低保留0.1的基础情绪，不会完全归零
        """
        now = time.time()
        # 计算距离上次更新的秒数
        delta_seconds = now - self.current_state.timestamp.timestamp()
        # 计算衰减后的强度
        new_intensity = self.current_state.intensity * max(0.1, 1 - delta_seconds * self.decay_rate)
        # 更新强度和时间
        self.current_state.intensity = max(0.1, new_intensity)
        self.current_state.timestamp = datetime.now()
        logger.debug(
            "情绪自然衰减完成",
            current_emotion=self.current_state.emotion_type.value,
            intensity=round(self.current_state.intensity, 2)
        )

    def update(self, new_emotion: EmotionType, intensity_delta: float, trigger: str = "") -> None:
        """
        更新情绪状态
        参数：
            new_emotion: 新的情绪类型
            intensity_delta: 强度变化值（正负都可，正数增强，负数减弱）
            trigger: 情绪触发源，用于日志和记忆
        异常：
            EmotionException: 强度超出范围时抛出
        """
        if not (-1.0 <= intensity_delta <= 1.0):
            raise EmotionException(f"情绪强度变化值必须在-1.0~1.0之间，当前值：{intensity_delta}")
        
        # 先执行自然衰减，保证情绪连续
        self.decay()
        # 更新情绪类型
        self.current_state.emotion_type = new_emotion
        # 更新强度，限制在0.1~1.0之间，避免完全无情绪
        self.current_state.intensity = max(0.1, min(1.0, self.current_state.intensity + intensity_delta))
        # 更新触发源和时间
        self.current_state.trigger = trigger
        self.current_state.timestamp = datetime.now()

        logger.info(
            "情绪状态更新完成",
            new_emotion=new_emotion.value,
            intensity=round(self.current_state.intensity, 2),
            trigger=trigger
        )

    def update_by_input(self, user_input: str) -> None:
        """
        基于用户输入自动更新情绪（符合傲娇少女人设）
        参数：
            user_input: 用户输入的纯文本
        """
        # 先执行自然衰减
        self.decay()

        inferred = infer_emotion_by_input(user_input)
        if inferred is not None:
            emotion_name, intensity_delta = inferred
            self.update(EmotionType(emotion_name), intensity_delta, trigger=user_input[:20])
            return

        # 无明显触发，沿当前情绪轻微衰减
        self.update(self.current_state.emotion_type, DEFAULT_INTENSITY_DECAY_ON_NEUTRAL, trigger=user_input[:20])

    def get_state(self) -> dict:
        """
        获取当前情绪状态的字典格式，用于同步给内核和prompt注入
        返回：标准化的情绪状态字典
        """
        return {
            "emotion_type": self.current_state.emotion_type.value,
            "intensity": round(self.current_state.intensity, 2),
            "trigger": self.current_state.trigger
        }

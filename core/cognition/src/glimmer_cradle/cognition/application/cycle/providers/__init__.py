"""心智的并行常驻专家模块。

5 个内置 provider，对齐 Attention.source 枚举：
- MemoryProvider      按当前焦点通过 ContextAssembler 检索相关记忆
- SocialProvider      关系模型 → 对话对象的特征注入

扩展可贡献上下文与能力，不能注册改变人格主权的内置专家器官。
"""
from glimmer_cradle.cognition.application.cycle.providers.base import Provider
from glimmer_cradle.cognition.application.cycle.providers.memory import MemoryProvider
from glimmer_cradle.cognition.application.cycle.providers.social import SocialProvider

__all__ = [
    "Provider",
    "MemoryProvider",
    "SocialProvider",
]

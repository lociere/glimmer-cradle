"""心智的并行常驻专家模块。

5 个内置 provider，对齐 WorkspaceItem.source 枚举：
- PerceptionProvider  把感知事件翻译为意义
- AffectProvider      情绪反应 → 工作区候选
- MemoryProvider      按当前焦点通过 ContextAssembly 检索相关记忆
- DriveProvider       内在动机：好奇 / 陪伴欲 / 休息欲（沉默时的来源）
- SocialProvider      关系模型 → 对话对象的特征注入

扩展可贡献上下文与能力，不能注册改变人格主权的内置专家器官。
"""
from glimmer_cradle.cognition.cycle.providers.base import Provider
from glimmer_cradle.cognition.cycle.providers.perception import PerceptionProvider
from glimmer_cradle.cognition.cycle.providers.affect import AffectProvider
from glimmer_cradle.cognition.cycle.providers.memory import MemoryProvider
from glimmer_cradle.cognition.cycle.providers.drive import DriveProvider
from glimmer_cradle.cognition.cycle.providers.social import SocialProvider

ALL_PROVIDER_CLASSES = (
    PerceptionProvider,
    AffectProvider,
    MemoryProvider,
    DriveProvider,
    SocialProvider,
)

__all__ = [
    "Provider",
    "PerceptionProvider",
    "AffectProvider",
    "MemoryProvider",
    "DriveProvider",
    "SocialProvider",
    "ALL_PROVIDER_CLASSES",
]

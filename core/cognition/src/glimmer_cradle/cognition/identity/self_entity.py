"""当前角色身份、人格相关状态与认知子系统的领域根。"""
from typing import Final
from glimmer_cradle.cognition.foundation.config import (
    CharacterManifestConfig,
    CharacterProfileConfig,
    DialoguePolicyConfig,
    InferenceConfig,
    MemoryConfig,
    SafetyConfig,
)
from glimmer_cradle.cognition.affect.emotion import EmotionSystem, EmotionType
from glimmer_cradle.cognition.memory.substrate import MemorySubstrate
from glimmer_cradle.cognition.memory.knowledge_base import KnowledgeBase
from glimmer_cradle.cognition.persona.persona_injector import PersonaInjector
from glimmer_cradle.cognition.foundation.exceptions import ConfigException
from glimmer_cradle.cognition.observability.logger import get_logger

# 初始化模块日志器
logger = get_logger("self_entity")


class SelfEntity:
    """由 CognitionComponents 独占、会话期配置冻结的角色领域根。"""

    def __init__(
        self,
        manifest_config: CharacterManifestConfig = None,
        inference_config: InferenceConfig = None,
        profile_config: CharacterProfileConfig = None,
        dialogue_config: DialoguePolicyConfig = None,
        safety_config: SafetyConfig = None,
        memory_config: MemoryConfig = None,
    ):
        """
        使用 Kernel 注入的冻结配置初始化自我实体。
        参数：
            manifest_config: 内核注入的冻结角色包 manifest
            profile_config: 内核注入的冻结角色作者种子配置
            dialogue_config: 内核注入的冻结对话呈现策略配置
            safety_config: 内核注入的冻结安全边界配置
            inference_config: 内核注入的冻结推理配置
        异常：
            ConfigException: 未注入配置时抛出
        """
        # 必须由内核注入配置才能初始化，绝对不读本地文件
        if (
            manifest_config is None
            or profile_config is None
            or dialogue_config is None
            or safety_config is None
            or inference_config is None
        ):
            raise ConfigException("必须由内核注入 manifest/profile/dialogue/safety/inference 配置才能初始化自我实体")
        
        # ======================================
        # 冻结的核心配置，会话期不可修改
        # ======================================
        self.manifest_config: Final[CharacterManifestConfig] = manifest_config
        self.profile_config: Final[CharacterProfileConfig] = profile_config
        self.dialogue_config: Final[DialoguePolicyConfig] = dialogue_config
        self.safety_config: Final[SafetyConfig] = safety_config
        self.inference_config: Final[InferenceConfig] = inference_config

        # ======================================
        # 核心子系统，终身唯一，不可替换
        # ======================================
        # 情绪系统
        self.emotion_system: Final[EmotionSystem] = EmotionSystem()
        # 版本化 Memory Substrate
        retrieval = memory_config.retrieval if memory_config else None
        self.memory: Final[MemorySubstrate] = MemorySubstrate(
            token_budget=retrieval.token_budget if retrieval else 800,
            candidate_limit=retrieval.candidate_limit if retrieval else 24,
            result_limit=retrieval.result_limit if retrieval else 6,
        )
        # 独立知识库
        self.knowledge_base: Final[KnowledgeBase] = KnowledgeBase()
        # 人设注入器
        self.persona_injector: Final[PersonaInjector] = PersonaInjector()

        # ======================================
        # 运行状态
        # ======================================
        self.is_awake: bool = False
        logger.info(
            "角色自我实体初始化完成",
            name=self.manifest_config.base.name,
            nickname=self.manifest_config.base.nickname
        )

    def wake_up(self) -> None:
        """唤醒当前角色，仅内核可调用"""
        self.is_awake = True
        self.emotion_system.update(
            EmotionType.HAPPY,
            0.2,
            trigger="wake_up"
        )
        logger.info(f"{self.manifest_config.base.nickname} 已醒来")

    def sleep(self) -> None:
        """让当前角色进入休眠，仅内核可调用"""
        self.is_awake = False
        self.emotion_system.update(
            EmotionType.CALM,
            0.1,
            trigger="sleep"
        )
        logger.info(f"{self.manifest_config.base.nickname} 已进入休眠")

    def validate_boundary(self, content: str) -> bool:
        """
        边界红线校验，所有输出必须经过该校验
        参数：
            content: 待校验的生成内容
        返回：True=符合人设边界，False=突破红线
        """
        return self.persona_injector.validate_boundary(content)

    def set_cognitive_activity_provider(self, provider) -> None:
        """注入认知活动快照提供者（callable() -> dict）。"""
        self._cognitive_activity_provider = provider

    def get_state(self) -> dict:
        """
        获取当前完整状态，用于同步给内核和渲染层
        返回：标准化的状态字典
        """
        state = {
            "name": self.manifest_config.base.nickname,
            "is_awake": self.is_awake,
            "emotion": self.emotion_system.get_state(),
            "memory_count": self.memory.count()
        }
        # 认知活动只以受控快照进入跨进程状态投影。
        provider = getattr(self, "_cognitive_activity_provider", None)
        if provider is not None:
            try:
                state["cognitive_activity"] = provider()
            except Exception:
                # 活动态采集失败不阻塞 state_sync。
                pass
        return state

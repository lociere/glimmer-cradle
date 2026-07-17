"""
文件名称：config.py
所属层级：基础设施层
核心作用：AI 层全局配置的入口模块。

阶段 P.4a-1 起，配置块（CharacterManifest / CharacterProfile / DialoguePolicy / Safety / Inference / LLM / Experience / Cognition）
**由 JSON Schema codegen 产出**（``glimmer_cradle.cognition.protocol.generated.config``），本模块
仅做以下两件事：

1. **重导出**：对外稳定 import 路径 ``glimmer_cradle.cognition.foundation.config.{CharacterManifestConfig, ...}``
   不变 —— 业务代码无需修改。
2. **聚合**：``CharacterRuntimeConfig`` 在此手写，因为是多个独立 schema 的聚合根，没有
   单独的 schema 文件（CharacterRuntimeConfig.schema.json 暂不引入，避免跨文件 ``$ref``
   在 datamodel-codegen 下的退化）。聚合本身仅是 5 个字段的容器，没有规则。

⚠️ 一旦改任一配置块字段：改对应 ``protocol/src/schemas/config/*.schema.json``，
跑 ``python scripts/sync_contracts.py``。**不要**直接改 generated/*.py。
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from glimmer_cradle.cognition.protocol.generated.config.character_manifest_config import CharacterManifestConfig
from glimmer_cradle.cognition.protocol.generated.config.character_profile_config import CharacterProfileConfig
from glimmer_cradle.cognition.protocol.generated.config.cognition_config import CognitionConfig
from glimmer_cradle.cognition.protocol.generated.config.dialogue_policy_config import DialoguePolicyConfig
from glimmer_cradle.cognition.protocol.generated.config.embedding_config import EmbeddingConfig
from glimmer_cradle.cognition.protocol.generated.config.inference_config import InferenceConfig
from glimmer_cradle.cognition.protocol.generated.config.llm_config import LLMConfig
from glimmer_cradle.cognition.protocol.generated.config.memory_config import MemoryConfig
from glimmer_cradle.cognition.protocol.generated.config.safety_config import SafetyConfig


class CharacterRuntimeConfig(BaseModel):
    """当前角色运行配置 —— 多个 schema 块的聚合根。

    内核启动时一次性注入（``GLIMMER_CRADLE_CONFIG`` env / ``--config-json`` arg），
    运行时完全冻结。
    """
    model_config = ConfigDict(frozen=True)

    manifest: CharacterManifestConfig
    profile: CharacterProfileConfig
    dialogue: DialoguePolicyConfig
    safety: SafetyConfig
    inference: InferenceConfig
    llm: LLMConfig | None = None
    memory: MemoryConfig | None = None
    embedding: EmbeddingConfig | None = None
    # 认知循环配置（可选；内核未注入时用 CognitionConfig 默认值）
    cognition: CognitionConfig | None = None


__all__ = [
    "CharacterManifestConfig",
    "CognitionConfig",
    "CharacterProfileConfig",
    "DialoguePolicyConfig",
    "EmbeddingConfig",
    "MemoryConfig",
    "CharacterRuntimeConfig",
    "InferenceConfig",
    "LLMConfig",
    "SafetyConfig",
]

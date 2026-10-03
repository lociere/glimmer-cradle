"""Kernel normalized canonical Document 到 Cognition 内部 settings 的 fail-closed 映射。"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, ValidationError

from glimmer_cradle.cognition.adapters.inference.embedding import EmbeddingSettings
from glimmer_cradle.cognition.adapters.inference.gateway import LLMSettings
from glimmer_cradle.cognition.inference import InferenceSettings
from glimmer_cradle.cognition.loop import CognitionSettings
from glimmer_cradle.cognition.memory import MemorySettings
from glimmer_cradle.cognition.persona import (
    CharacterManifestSettings,
    CharacterProfileSettings,
    DialoguePolicySettings,
    SafetySettings,
)


class ConfigException(ValueError):
    """Kernel 规范化配置无法映射为 Worker 运行时投影。"""

    code = "CONFIG_ERROR"

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(f"[{self.code}] {message}")


class ActionStreamSettings(BaseModel):
    """Worker/Kernel action projection configuration, outside Inference Core."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    enabled: bool
    channel: str


class WorkerInferenceSettings(InferenceSettings):
    action_stream: ActionStreamSettings


class CharacterRuntimeSettings(BaseModel):
    """Worker 接收的完整、冻结配置 Document 投影。"""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    manifest: CharacterManifestSettings
    profile: CharacterProfileSettings
    dialogue: DialoguePolicySettings
    safety: SafetySettings
    inference: WorkerInferenceSettings
    llm: LLMSettings | None = None
    memory: MemorySettings
    embedding: EmbeddingSettings
    cognition: CognitionSettings


def map_character_runtime_document(document: Mapping[str, Any]) -> CharacterRuntimeSettings:
    """只接受 Kernel Schema normalizer 输出的完整、无未知字段 Document。"""
    try:
        return CharacterRuntimeSettings.model_validate(dict(document))
    except ValidationError as error:
        details = "; ".join(
            f"{'.'.join(str(part) for part in item['loc'])}: {item['type']}"
            for item in error.errors(include_url=False)
        )
        raise ConfigException(f"Cognition 配置 Document 映射失败: {details}") from error

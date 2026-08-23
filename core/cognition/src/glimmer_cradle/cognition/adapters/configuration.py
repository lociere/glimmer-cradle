"""Kernel normalized canonical Document 到 Cognition 内部 settings 的 fail-closed 映射。"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from glimmer_cradle.cognition.domain.configuration import CharacterRuntimeSettings
from glimmer_cradle.cognition.domain.exceptions import ConfigException


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

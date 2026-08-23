"""Cognition 内部冻结配置视图；外部 Document 只在配置 Adapter 中出现。"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any


def _freeze(value: Any) -> Any:
    if isinstance(value, SettingsNode):
        return value
    if isinstance(value, Mapping):
        return SettingsNode(value)
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


def _thaw(value: Any) -> Any:
    if isinstance(value, SettingsNode):
        return value.to_mapping()
    if isinstance(value, tuple):
        return [_thaw(item) for item in value]
    return value


class SettingsNode(Mapping[str, Any]):
    """只暴露 Cognition 需要的属性式读取，不复制跨语言 Schema 类型。"""

    __slots__ = ("_values",)

    def __init__(self, values: Mapping[str, Any] | None = None, /, **updates: Any) -> None:
        merged = dict(values or {})
        merged.update(updates)
        object.__setattr__(
            self,
            "_values",
            MappingProxyType({key: _freeze(value) for key, value in merged.items()}),
        )

    def __getattribute__(self, name: str) -> Any:
        if not name.startswith("_"):
            values = object.__getattribute__(self, "_values")
            if name in values:
                return values[name]
        return object.__getattribute__(self, name)

    def __getattr__(self, name: str) -> Any:
        try:
            return self._values[name]
        except KeyError as error:
            raise AttributeError(name) from error

    def __getitem__(self, key: str) -> Any:
        return self._values[key]

    def __iter__(self):
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, SettingsNode):
            return self.to_mapping() == other.to_mapping()
        if isinstance(other, Mapping):
            return self.to_mapping() == dict(other)
        return False

    def __setattr__(self, name: str, value: Any) -> None:
        raise TypeError("Cognition settings are frozen")

    def to_mapping(self) -> dict[str, Any]:
        return {key: _thaw(value) for key, value in self._values.items()}

    @classmethod
    def model_validate(cls, value: Mapping[str, Any]) -> "SettingsNode":
        return cls(value)

    def model_dump(self, **_: Any) -> dict[str, Any]:
        return self.to_mapping()

    def with_updates(self, **updates: Any) -> "SettingsNode":
        return SettingsNode(self.to_mapping(), **updates)


class CharacterManifestSettings(SettingsNode):
    pass


class CharacterProfileSettings(SettingsNode):
    pass


class CognitionSettings(SettingsNode):
    def __init__(self, values: Mapping[str, Any] | None = None, /, **updates: Any) -> None:
        defaults = {"workspace_capacity": 7, "default_tick_interval_ms": 5000}
        defaults.update(values or {})
        defaults.update(updates)
        super().__init__(defaults)


class DialoguePolicySettings(SettingsNode):
    pass


class EmbeddingSettings(SettingsNode):
    def __init__(self, values: Mapping[str, Any] | None = None, /, **updates: Any) -> None:
        merged = dict(values or {})
        merged.update(updates)
        providers = merged.get("providers")
        if isinstance(providers, Mapping):
            merged["providers"] = {
                str(key).replace("-", "_"): value for key, value in providers.items()
            }
        super().__init__(merged)


class InferenceSettings(SettingsNode):
    pass


class LLMSettings(SettingsNode):
    def __init__(self, values: Mapping[str, Any] | None = None, /, **updates: Any) -> None:
        defaults: dict[str, Any] = {
            "api_type": None,
            "api_key": None,
            "base_url": None,
            "models": {},
            "providers": {},
            "temperature": None,
            "request_method": None,
            "request_path": None,
            "request_headers": None,
            "request_body_template": None,
            "response_extract": None,
        }
        defaults.update(values or {})
        defaults.update(updates)
        super().__init__(defaults)


class MemorySettings(SettingsNode):
    pass


class SafetySettings(SettingsNode):
    pass


@dataclass(frozen=True, slots=True)
class CharacterRuntimeSettings:
    manifest: CharacterManifestSettings
    profile: CharacterProfileSettings
    dialogue: DialoguePolicySettings
    safety: SafetySettings
    inference: InferenceSettings
    llm: LLMSettings | None
    memory: MemorySettings
    embedding: EmbeddingSettings | None
    cognition: CognitionSettings

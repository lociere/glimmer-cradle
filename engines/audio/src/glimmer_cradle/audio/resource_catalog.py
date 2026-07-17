from __future__ import annotations

import json
import os
from functools import lru_cache
from importlib.resources import files
from pathlib import Path
from typing import Any, Literal

from .runtime_paths import resolve_models_path


AudioLane = Literal["tts", "asr"]


@lru_cache(maxsize=1)
def load_resource_catalog() -> dict[str, Any]:
    """读取音频资源目录；外部投影只在显式配置时替代内置目录。"""

    external = os.environ.get("GLIMMER_CRADLE_AUDIO_RESOURCE_CATALOG")
    catalog_path = (
        Path(external)
        if external
        else files("glimmer_cradle.audio").joinpath("resources.json")
    )
    with catalog_path.open("r", encoding="utf-8") as handle:
        catalog = json.load(handle)
    _validate_catalog(catalog)
    return catalog


def resolve_resource(lane: AudioLane, selected_id: str | None = None) -> dict[str, Any]:
    catalog = load_resource_catalog()
    resource_id = selected_id or os.environ.get(
        f"GLIMMER_CRADLE_{lane.upper()}_RESOURCE_ID"
    )
    resource_id = resource_id or catalog["defaults"].get(lane)
    if not resource_id:
        raise ValueError(f"音频资源目录未声明 {lane} 默认 resource")
    for resource in catalog["resources"]:
        if resource["id"] == resource_id and resource["lane"] == lane:
            return resource
    raise ValueError(f"音频资源目录未声明 {lane} resource: {resource_id}")


def resolve_model_directory(relative_path: str) -> Path:
    """把 catalog 的相对模型目录约束在统一 models 根目录内。"""

    return resolve_models_path(relative_path)


def _validate_catalog(catalog: Any) -> None:
    if not isinstance(catalog, dict):
        raise ValueError("音频资源目录必须是对象")
    defaults = catalog.get("defaults")
    provider_defaults = catalog.get("providerDefaults", {})
    resources = catalog.get("resources")
    if not isinstance(defaults, dict) or not isinstance(resources, list):
        raise ValueError("音频资源目录缺少 defaults 或 resources")

    ids: set[str] = set()
    for resource in resources:
        if not isinstance(resource, dict):
            raise ValueError("音频资源条目必须是对象")
        resource_id = resource.get("id")
        if not isinstance(resource_id, str) or not resource_id:
            raise ValueError("音频资源缺少 id")
        if resource_id in ids:
            raise ValueError(f"音频资源 id 重复: {resource_id}")
        if resource.get("lane") not in ("tts", "asr"):
            raise ValueError(f"音频资源 lane 无效: {resource_id}")
        ids.add(resource_id)

    for lane, default_id in defaults.items():
        if lane not in ("tts", "asr"):
            raise ValueError(f"默认音频资源 lane 无效: {lane}")
        if not any(
            resource.get("id") == default_id and resource.get("lane") == lane
            for resource in resources
        ):
            raise ValueError(f"默认音频资源未声明: {lane}={default_id}")

    if "asr" not in defaults:
        raise ValueError("音频资源目录必须声明 ASR 默认资源")

    if not isinstance(provider_defaults, dict):
        raise ValueError("providerDefaults 必须是对象")
    for provider, resource_id in provider_defaults.items():
        if not any(
            resource.get("id") == resource_id and resource.get("provider") == provider
            for resource in resources
        ):
            raise ValueError(f"provider 默认资源未声明: {provider}={resource_id}")

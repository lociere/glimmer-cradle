from __future__ import annotations

import os
from importlib.util import find_spec
from pathlib import Path
from typing import Any

from ..resource_catalog import resolve_model_directory, resolve_resource


class FunASREngine:
    """FunASR ASR provider。

    依赖采用懒加载：没有安装 FunASR 时音频引擎仍可启动，并在 health
    里明确报告缺失原因，避免控制中心只显示“等待中”。
    """

    name = "funasr"

    def __init__(
        self,
        model: str | None = None,
        device: str | None = None,
        vad_model: str | None = None,
        punc_model: str | None = None,
        resource_id: str | None = None,
    ) -> None:
        resource = resolve_resource("asr", resource_id)
        if resource.get("provider") != self.name:
            raise ValueError(f"ASR resource {resource['id']} 不能由 FunASR 加载")
        self.resource_id = resource["id"]
        default_model = resource["modelRepository"]
        aliases = {alias: default_model for alias in resource.get("aliases", [])}
        configured_model = (
            model or os.environ.get("GLIMMER_CRADLE_FUNASR_MODEL") or default_model
        )
        self.model = aliases.get(configured_model, configured_model)
        self.device = (
            device
            or os.environ.get("GLIMMER_CRADLE_FUNASR_DEVICE")
            or _resolve_default_device()
        )
        self.vad_model = (
            vad_model
            if vad_model is not None
            else os.environ.get("GLIMMER_CRADLE_FUNASR_VAD_MODEL")
        )
        self.punc_model = (
            punc_model
            if punc_model is not None
            else os.environ.get("GLIMMER_CRADLE_FUNASR_PUNC_MODEL")
        )
        self.cache_home = self._ensure_cache_home(
            resolve_model_directory(resource["cacheDirectory"])
        )
        self._pipeline: Any | None = None

    def available(self) -> tuple[bool, str | None]:
        missing = [
            package
            for package in ("funasr", "torch", "torchaudio")
            if find_spec(package) is None
        ]
        if missing:
            return False, f"FunASR 依赖未安装：{', '.join(missing)}"
        return True, None

    def config_snapshot(self) -> dict[str, str | None]:
        return {
            "model": self.model,
            "resource_id": self.resource_id,
            "device": self.device,
            "vad_model": self.vad_model,
            "punc_model": self.punc_model,
            "cache_home": self.cache_home,
            "loaded": "true" if self._pipeline is not None else "false",
        }

    def model_readiness(self) -> dict[str, Any]:
        missing = [
            package
            for package in ("funasr", "torch", "torchaudio")
            if find_spec(package) is None
        ]
        return {
            "ready": not missing,
            "loaded": self._pipeline is not None,
            "model": self.model,
            "resource_id": self.resource_id,
            "device": self.device,
            "cache_home": self.cache_home,
            "missing_dependencies": missing,
            "download_stage": "warmup",
        }

    def warmup(self) -> None:
        """提前加载 FunASR 模型，避免第一次语音输入承担冷启动成本。"""

        self._ensure_pipeline()

    def recognize_file(self, audio_path: str) -> str:
        path = Path(audio_path)
        if not path.exists():
            raise FileNotFoundError(f"audio file not found: {path}")

        pipeline = self._ensure_pipeline()
        result = pipeline.generate(input=str(path))
        return normalize_funasr_result(result)

    def _ensure_pipeline(self) -> Any:
        if self._pipeline is None:
            try:
                from funasr import AutoModel
            except Exception as exc:
                raise RuntimeError(f"FunASR 不可用：{exc}") from exc

            kwargs: dict[str, Any] = {
                "model": self.model,
                # FunASR 默认会检查版本更新，Windows 下会让首次识别额外等待。
                # 项目依赖版本由 uv 环境管理，因此推理时禁用这个网络检查。
                "disable_update": True,
                "disable_pbar": True,
                "check_latest": False,
                "log_level": "WARNING",
            }
            if self.device != "auto":
                kwargs["device"] = self.device
            if self.vad_model:
                kwargs["vad_model"] = self.vad_model
            if self.punc_model:
                kwargs["punc_model"] = self.punc_model
            self._pipeline = AutoModel(**kwargs)
        return self._pipeline

    def _ensure_cache_home(self, default_cache_dir: Path) -> str:
        configured = (
            os.environ.get("GLIMMER_CRADLE_FUNASR_CACHE")
            or os.environ.get("MODELSCOPE_CACHE")
            or os.environ.get("HF_HOME")
            or str(default_cache_dir)
        )
        cache_path = Path(configured)
        cache_path.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("MODELSCOPE_CACHE", str(cache_path))
        os.environ.setdefault("HF_HOME", str(cache_path))
        return str(cache_path)


def normalize_funasr_result(result: Any) -> str:
    """把 FunASR 的多种返回形态收束为文本。"""

    if isinstance(result, str):
        return result.strip()

    if isinstance(result, dict):
        text = result.get("text")
        if isinstance(text, str):
            return text.strip()
        if "sentence_info" in result:
            return normalize_funasr_result(result["sentence_info"])

    if isinstance(result, list):
        parts: list[str] = []
        for item in result:
            text = normalize_funasr_result(item)
            if text:
                parts.append(text)
        return "".join(parts).strip()

    return str(result).strip()


def _resolve_default_device() -> str:
    try:
        import torch
    except Exception:
        return "auto"
    cuda = getattr(torch, "cuda", None)
    if cuda is None:
        return "auto"
    try:
        return "cuda:0" if cuda.is_available() else "auto"
    except Exception:
        return "auto"

from __future__ import annotations

import json
import os
import time
from typing import Any, Literal

from .asr import FunASREngine
from .tts import DashScopeCosyVoiceEngine, TTSRoute

AudioLane = Literal["tts", "asr", "all"]


class AudioEngineApp:
    def __init__(
        self,
        lane: AudioLane | None = None,
        audio_config: dict[str, Any] | None = None,
        voice_config: dict[str, Any] | None = None,
    ) -> None:
        self.lane = lane or _resolve_audio_lane()
        self.audio_config = audio_config or _read_json_env(
            "GLIMMER_CRADLE_AUDIO_CONFIG", _default_audio_config()
        )
        self.voice_config = voice_config or _read_json_env(
            "GLIMMER_CRADLE_VOICE_CONFIG", _default_voice_config()
        )
        self._asr: FunASREngine | None = None
        self._tts_route: TTSRoute | None = None

    @property
    def asr(self) -> FunASREngine:
        if self.lane not in ("asr", "all"):
            raise RuntimeError("当前音频进程未启用 ASR lane")
        if self._asr is None:
            asr_config = self.audio_config["asr"]
            self._asr = FunASREngine(resource_id=asr_config["resource_id"])
        return self._asr

    @property
    def tts_route(self) -> TTSRoute:
        if self.lane not in ("tts", "all"):
            raise RuntimeError("当前音频进程未启用 TTS lane")
        if self._tts_route is None:
            self._tts_route = self._build_tts_route()
        return self._tts_route

    def health_snapshot(self) -> dict[str, Any]:
        providers: dict[str, Any] = {}
        if self.lane in ("asr", "all"):
            asr_ok, asr_reason = self.asr.available()
            providers["asr"] = {
                    "route_state": "ready" if asr_ok else "unavailable",
                    "active_provider": self.asr.name if asr_ok else None,
                    "providers": [
                        {
                            "provider_id": self.asr.name,
                            "role": "primary",
                            "execution": "local",
                            "status": "ready" if asr_ok else "unavailable",
                            **({"message": asr_reason} if asr_reason else {}),
                        }
                    ],
                    "config": self.asr.config_snapshot(),
                    "model_readiness": self.asr.model_readiness(),
            }
        if self.lane in ("tts", "all"):
            providers["tts"] = self.tts_route.snapshot()
        return {"engine": "audio", "lane": self.lane, "providers": providers}

    def warmup(self, lane: Literal["tts", "asr"]) -> dict[str, Any]:
        self._require_lane(lane)
        if lane == "tts":
            return self.tts_route.warmup()
        self.asr.warmup()
        return {"provider_id": self.asr.name}

    def synthesize(self, text: str, output_path: str) -> dict[str, Any]:
        self._require_lane("tts")
        if not text.strip():
            raise ValueError("text is required")
        return self.tts_route.synthesize_to_file(text, output_path)

    def recognize(self, audio_path: str) -> dict[str, Any]:
        self._require_lane("asr")
        started = time.monotonic()
        text = self.asr.recognize_file(audio_path)
        return {
            "text": text,
            "provider_id": self.asr.name,
            "duration_ms": round((time.monotonic() - started) * 1000, 2),
        }

    def close(self) -> None:
        if self._tts_route is not None:
            self._tts_route.close()

    def _build_tts_route(self) -> TTSRoute:
        tts = self.audio_config["tts"]
        route = tts["route"]
        providers = tts["providers"]
        voice = self.voice_config
        bindings = voice["bindings"]
        ordered = [route["primary"], *route["fallbacks"]]
        unknown = [
            provider_id for provider_id in ordered if provider_id not in providers
        ]
        if unknown:
            raise ValueError(f"TTS route 引用了未配置 provider: {', '.join(unknown)}")
        disabled = [
            provider_id
            for provider_id in ordered
            if not providers[provider_id]["enabled"]
        ]
        if disabled:
            raise ValueError(f"TTS route 引用了已关闭 provider: {', '.join(disabled)}")

        dashscope = providers["dashscope-cosyvoice"]
        prosody = voice["prosody"]
        factories = {
            "dashscope-cosyvoice": lambda: DashScopeCosyVoiceEngine(
                api_key=os.environ.get("DASHSCOPE_API_KEY", ""),
                endpoint=dashscope["endpoint"],
                model=dashscope["model"],
                voice_id=bindings["dashscope-cosyvoice"]["voice_id"],
                audio_format=dashscope["format"],
                sample_rate=dashscope["sample_rate"],
                connect_timeout_ms=dashscope["connect_timeout_ms"],
                receive_timeout_ms=dashscope["receive_timeout_ms"],
                max_retries=dashscope["max_retries"],
                language=voice["language"],
                instruction=voice.get("style_instruction", ""),
                rate=prosody["rate"],
                pitch=prosody["pitch"],
                volume=prosody["volume"],
            ),
        }
        missing_factories = [
            provider_id for provider_id in ordered if provider_id not in factories
        ]
        if missing_factories:
            raise ValueError(
                f"TTS provider 尚未注册 adapter: {', '.join(missing_factories)}"
            )
        circuit = route["circuit_breaker"]
        return TTSRoute(
            primary=route["primary"],
            fallbacks=list(route["fallbacks"]),
            provider_factories=factories,
            failure_threshold=circuit["failure_threshold"],
            recovery_timeout_ms=circuit["recovery_timeout_ms"],
        )

    def _require_lane(self, lane: Literal["tts", "asr"]) -> None:
        if self.lane not in (lane, "all"):
            raise RuntimeError(f"{lane.upper()} lane is not enabled in this process")


def _resolve_audio_lane() -> AudioLane:
    raw = os.environ.get("GLIMMER_CRADLE_AUDIO_LANE", "all").strip().lower()
    if raw in ("tts", "asr", "all"):
        return raw  # type: ignore[return-value]
    raise ValueError(f"unsupported GLIMMER_CRADLE_AUDIO_LANE: {raw}")


def _read_json_env(name: str, fallback: dict[str, Any]) -> dict[str, Any]:
    raw = os.environ.get(name)
    if not raw:
        return fallback
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError(f"{name} 必须是 JSON object")
    return value


def _default_audio_config() -> dict[str, Any]:
    return {
        "tts": {
            "route": {
                "primary": "dashscope-cosyvoice",
                "fallbacks": [],
                "circuit_breaker": {
                    "failure_threshold": 3,
                    "recovery_timeout_ms": 30000,
                },
            },
            "providers": {
                "dashscope-cosyvoice": {
                    "enabled": True,
                    "endpoint": "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
                    "model": "cosyvoice-v3.5-flash",
                    "format": "wav",
                    "sample_rate": 24000,
                    "connect_timeout_ms": 5000,
                    "receive_timeout_ms": 20000,
                    "max_retries": 1,
                },
            },
        },
        "asr": {"provider": "funasr", "resource_id": "funasr.sensevoice-small"},
    }


def _default_voice_config() -> dict[str, Any]:
    return {
        "profile_id": "unbound",
        "language": "zh-CN",
        "style_instruction": "",
        "prosody": {"rate": 1.0, "pitch": 1.0, "volume": 50},
        "bindings": {
            "dashscope-cosyvoice": {"voice_id": ""},
        },
    }


def main() -> int:
    from .grpc_host import run_grpc_host

    return run_grpc_host()


if __name__ == "__main__":
    raise SystemExit(main())

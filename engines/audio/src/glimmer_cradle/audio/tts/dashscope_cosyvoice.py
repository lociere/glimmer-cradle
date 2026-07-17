from __future__ import annotations

import json
import random
import struct
import time
from pathlib import Path
from typing import Any
from uuid import uuid4


def finalize_streaming_wav(audio: bytes) -> bytes:
    """Replace streaming RIFF sentinels with the final container sizes."""
    if len(audio) < 20 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        raise RuntimeError("CosyVoice 返回的 WAV 数据缺少有效 RIFF/WAVE 头")
    if len(audio) - 8 > 0xFFFFFFFF:
        raise RuntimeError("CosyVoice 返回的 WAV 文件超过 RIFF 容器大小上限")

    finalized = bytearray(audio)
    struct.pack_into("<I", finalized, 4, len(finalized) - 8)
    cursor = 12
    while cursor + 8 <= len(finalized):
        chunk_id = bytes(finalized[cursor : cursor + 4])
        declared_size = struct.unpack_from("<I", finalized, cursor + 4)[0]
        payload_start = cursor + 8
        if chunk_id == b"data":
            actual_size = len(finalized) - payload_start
            struct.pack_into("<I", finalized, cursor + 4, actual_size)
            return bytes(finalized)
        next_chunk = payload_start + declared_size + (declared_size & 1)
        if next_chunk > len(finalized):
            raise RuntimeError("CosyVoice 返回的 WAV chunk 长度非法")
        cursor = next_chunk
    raise RuntimeError("CosyVoice 返回的 WAV 数据缺少 data chunk")


class DashScopeCosyVoiceEngine:
    provider_id = "dashscope-cosyvoice"
    execution = "cloud"

    def __init__(
        self,
        *,
        api_key: str,
        endpoint: str,
        model: str,
        voice_id: str,
        audio_format: str = "wav",
        sample_rate: int = 24000,
        connect_timeout_ms: int = 5000,
        receive_timeout_ms: int = 20000,
        max_retries: int = 1,
        language: str = "zh-CN",
        instruction: str = "",
        rate: float = 1.0,
        pitch: float = 1.0,
        volume: int = 50,
    ) -> None:
        self.api_key = api_key.strip()
        self.endpoint = endpoint
        self.model = model
        self.voice_id = voice_id.strip()
        self.audio_format = audio_format
        self.sample_rate = sample_rate
        self.connect_timeout = connect_timeout_ms / 1000
        self.receive_timeout = receive_timeout_ms / 1000
        self.max_retries = max_retries
        self.language = language.split("-", 1)[0].lower()
        self.instruction = instruction[:100]
        self.rate = rate
        self.pitch = pitch
        self.volume = volume
        self._socket: Any | None = None

    def available(self) -> tuple[bool, str | None]:
        if not self.api_key:
            return False, "缺少 DASHSCOPE_API_KEY"
        if not self.voice_id:
            return False, "角色 voice.yaml 尚未绑定 CosyVoice voice_id"
        if not self.endpoint.startswith("wss://"):
            return False, "CosyVoice endpoint 必须使用 wss://"
        return True, None

    def warmup(self) -> None:
        available, reason = self.available()
        if not available:
            raise RuntimeError(reason)
        self._ensure_connection()

    def config_snapshot(self) -> dict[str, Any]:
        return {
            "provider_id": self.provider_id,
            "execution": self.execution,
            "endpoint": self.endpoint,
            "model": self.model,
            "voice_configured": bool(self.voice_id),
            "credential_configured": bool(self.api_key),
            "format": self.audio_format,
            "sample_rate": self.sample_rate,
        }

    def synthesize_to_file(self, text: str, output_path: str) -> str:
        available, reason = self.available()
        if not available:
            raise RuntimeError(reason)
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                audio = self._run_task(text)
                if not audio:
                    raise RuntimeError("CosyVoice 未返回音频数据")
                if self.audio_format == "wav":
                    audio = finalize_streaming_wav(audio)
                output = Path(output_path)
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(audio)
                return str(output)
            except Exception as exc:
                last_error = exc
                self.close()
                if attempt >= self.max_retries:
                    break
                time.sleep(min(0.2 * (2**attempt) + random.uniform(0, 0.1), 1.0))
        raise RuntimeError(f"CosyVoice synthesis failed: {last_error}") from last_error

    def close(self) -> None:
        socket = self._socket
        self._socket = None
        if socket is not None:
            try:
                socket.close()
            except Exception:
                pass

    def _ensure_connection(self) -> Any:
        if self._socket is not None:
            return self._socket
        try:
            from websockets.sync.client import connect
        except Exception as exc:
            raise RuntimeError(f"websockets 未安装：{exc}") from exc
        self._socket = connect(
            self.endpoint,
            additional_headers={
                "Authorization": f"Bearer {self.api_key}",
                "User-Agent": "Glimmer-Cradle-Audio/0.1",
            },
            open_timeout=self.connect_timeout,
            close_timeout=2,
        )
        return self._socket

    def _run_task(self, text: str) -> bytes:
        socket = self._ensure_connection()
        task_id = str(uuid4())
        parameters: dict[str, Any] = {
            "text_type": "PlainText",
            "voice": self.voice_id,
            "format": self.audio_format,
            "sample_rate": self.sample_rate,
            "volume": self.volume,
            "rate": self.rate,
            "pitch": self.pitch,
            "enable_ssml": False,
            "language_hints": [self.language],
        }
        if self.instruction:
            parameters["instruction"] = self.instruction
        socket.send(
            json.dumps(
                {
                    "header": {
                        "action": "run-task",
                        "task_id": task_id,
                        "streaming": "duplex",
                    },
                    "payload": {
                        "task_group": "audio",
                        "task": "tts",
                        "function": "SpeechSynthesizer",
                        "model": self.model,
                        "parameters": parameters,
                        "input": {},
                    },
                },
                ensure_ascii=False,
            )
        )
        self._wait_for_event(socket, task_id, "task-started")
        socket.send(
            json.dumps(
                {
                    "header": {
                        "action": "continue-task",
                        "task_id": task_id,
                        "streaming": "duplex",
                    },
                    "payload": {"input": {"text": text}},
                },
                ensure_ascii=False,
            )
        )
        socket.send(
            json.dumps(
                {
                    "header": {
                        "action": "finish-task",
                        "task_id": task_id,
                        "streaming": "duplex",
                    },
                    "payload": {"input": {}},
                }
            )
        )

        chunks: list[bytes] = []
        while True:
            message = socket.recv(timeout=self.receive_timeout)
            if isinstance(message, bytes):
                chunks.append(message)
                continue
            event = json.loads(message)
            header = event.get("header", {})
            if header.get("task_id") not in (None, task_id):
                continue
            event_name = header.get("event")
            if event_name == "task-failed":
                raise RuntimeError(self._event_error(event))
            if event_name == "task-finished":
                return b"".join(chunks)

    def _wait_for_event(self, socket: Any, task_id: str, expected: str) -> None:
        while True:
            message = socket.recv(timeout=self.receive_timeout)
            if isinstance(message, bytes):
                continue
            event = json.loads(message)
            header = event.get("header", {})
            if header.get("task_id") not in (None, task_id):
                continue
            event_name = header.get("event")
            if event_name == "task-failed":
                raise RuntimeError(self._event_error(event))
            if event_name == expected:
                return

    @staticmethod
    def _event_error(event: dict[str, Any]) -> str:
        header = event.get("header", {})
        return str(
            header.get("error_message")
            or header.get("error_code")
            or "CosyVoice task failed"
        )
